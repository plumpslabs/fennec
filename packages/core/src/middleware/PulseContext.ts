/**
 * PulseContext Middleware — Lazy Context Level 0
 *
 * Attaches a minimal "pulse" (health summary) to every tool response.
 * This is the token-efficient Level 0 of the Lazy Context system:
 * AI always gets a quick health summary without having to ask.
 *
 * Level 0 format:
 *   "Page: healthy | 2 errors | 1 warning | 3 failed requests"
 *
 * On error:
 *   "Page: error | 5 console errors | 2 failed requests"
 */

import type { MiddlewareFn } from './Pipeline.js';
import { getLogger } from '../utils/logger.js';
import type { BrowserSession } from '../browser/types.js';

export interface Pulse {
  level: 0;
  status: 'healthy' | 'warning' | 'error';
  page?: string;
  consoleErrors: number;
  consoleWarnings: number;
  corsWarnings: number;
  networkFailures: number;
  networkSlow: number;
  summary: string;
}

/**
 * Build a pulse from the current browser session.
 * This is extremely lightweight — just counters and a one-line summary.
 * NO screenshots, NO full logs, NO DOM.
 *
 * Severity weighting: a single CORS false-positive (or other noisy console
 * error) must NOT flip the whole health status to "error". CORS console
 * messages are counted as `corsWarnings` (low severity) and only contribute
 * to a "warning", never an "error". Real uncaught errors and >=400 network
 * failures drive "error".
 */
async function buildPulse(session: {
  browser?: BrowserSession;
  consoleBuffer: Array<{ level: string; message?: string }>;
  networkBuffer: Array<{ status: number; duration: number }>;
}): Promise<Pulse> {
  const pulse: Pulse = {
    level: 0,
    status: 'healthy',
    consoleErrors: 0,
    consoleWarnings: 0,
    corsWarnings: 0,
    networkFailures: 0,
    networkSlow: 0,
    summary: '',
  };

  const isCorsNoise = (msg?: string): boolean =>
    !!msg && /cors|cross-origin|access-control|blocked by/i.test(msg);

  // Count console logs by level (fast, in-memory)
  for (const log of session.consoleBuffer) {
    if (log.level === 'error') {
      if (isCorsNoise(log.message)) pulse.corsWarnings++;
      else pulse.consoleErrors++;
    } else if (log.level === 'warn') {
      pulse.consoleWarnings++;
    }
  }

  // Count network issues (fast, in-memory)
  for (const req of session.networkBuffer) {
    if (req.status >= 400) pulse.networkFailures++;
    if (req.duration > 1000) pulse.networkSlow++;
  }

  // Severity-weighted status:
  //  - error  : real (non-CORS) console errors OR >=400 network failures
  //  - warning: CORS noise, console warnings, or slow requests
  // A lone CORS false-positive therefore reads as "warning", not "error".
  if (pulse.consoleErrors > 0 || pulse.networkFailures > 0) {
    pulse.status = 'error';
  } else if (pulse.corsWarnings > 0 || pulse.consoleWarnings > 0 || pulse.networkSlow > 0) {
    pulse.status = 'warning';
  }

  // Get page URL if available (cross-domain safe)
  if (session.browser) {
    try {
      pulse.page = session.browser.url().slice(0, 200);
    } catch {
      pulse.page = 'unknown';
    }
  }

  // Build one-line summary (Level 0 — minimal tokens)
  const parts: string[] = [];
  if (pulse.page) {
    const pageLabel = pulse.page.replace(/^https?:\/\//, '').slice(0, 60);
    parts.push(`Page: ${pageLabel}`);
  }
  parts.push(`status: ${pulse.status}`);
  if (pulse.consoleErrors > 0) parts.push(`${pulse.consoleErrors} error(s)`);
  if (pulse.consoleWarnings > 0) parts.push(`${pulse.consoleWarnings} warning(s)`);
  if (pulse.corsWarnings > 0) parts.push(`${pulse.corsWarnings} cors warning(s)`);
  if (pulse.networkFailures > 0) parts.push(`${pulse.networkFailures} failed request(s)`);
  if (pulse.networkSlow > 0) parts.push(`${pulse.networkSlow} slow request(s)`);
  pulse.summary = parts.join(' | ');

  return pulse;
}

/**
 * Creates a middleware that injects a Level 0 pulse into every tool response.
 * This gives the AI a constant health summary without any additional API calls.
 */
export function createPulseContext(): MiddlewareFn {
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    // Attach pulse to every response — success or error
    if (ctx.session) {
      try {
        const pulse = await buildPulse(ctx.session);

        // Always attach pulse to meta
        const resultObj = result as Record<string, unknown>;
        if (!resultObj.meta) {
          resultObj.meta = {};
        }
        (resultObj.meta as Record<string, unknown>).pulse = pulse;
      } catch (error) {
        // Pulse is best-effort
        logger.warn({ error }, 'PulseContext: failed to build pulse');
      }
    }

    return result;
  };
}
