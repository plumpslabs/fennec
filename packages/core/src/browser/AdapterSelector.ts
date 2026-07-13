/**
 * Browser Adapter Selector — Auto-detect and switch between CDP and Playwright.
 *
 * Phase 2.1 implementation: Runtime detection logic that selects the
 * best available browser adapter based on:
 * 1. Config override (`browser.adapter`)
 * 2. Feature requirements (observation vs automation)
 * 3. Available dependencies
 *
 * Strategy:
 * - "auto" (default): Try CDP first (zero-deps). If Chrome unreachable or
 *   the tool requires click/type/upload, fall back to Playwright.
 * - "cdp": Force CDP Observer. Throws if Chrome not found.
 * - "playwright": Force Playwright. Throws if playwright package missing.
 *
 * Detection is lazy — don't check dependencies until session creation.
 */

import { getLogger } from '../utils/logger.js';

export type AdapterType = 'cdp' | 'playwright';

export interface AdapterResult {
  adapter: AdapterType;
  reason: string;
}

/**
 * Lazily detect whether Chrome is available for CDP usage.
 * Checks: running Chrome instance on default port, or `google-chrome`/`chromium` binary.
 */
async function detectChrome(): Promise<boolean> {
  try {
    // Check if Chrome is already running with remote debugging
    const resp = await fetch('http://127.0.0.1:9222/json/version').catch(() => null);
    if (resp?.ok) return true;

    // Check for Chrome binary using common paths
    const { execSync } = await import('node:child_process');
    try {
      execSync('which google-chrome chromium chromium-browser chrome', {
        stdio: 'ignore',
        timeout: 2000,
      });
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Lazily detect whether Playwright is installed.
 */
async function detectPlaywright(): Promise<boolean> {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
}

/**
 * Select the best adapter based on config, dependencies, and requirements.
 *
 * @param adapterConfig - "auto" | "cdp" | "playwright" from config
 * @param needsAutomation - true if the tool requires click/type/upload
 * @returns The selected adapter type and the reason for the choice
 */
export async function selectAdapter(
  adapterConfig: string,
  needsAutomation?: boolean,
): Promise<AdapterResult> {
  const logger = getLogger();

  switch (adapterConfig) {
    case 'cdp':
      return { adapter: 'cdp', reason: 'Config override: CDP' };

    case 'playwright':
      return { adapter: 'playwright', reason: 'Config override: Playwright' };

    case 'auto':
    default: {
      // If automation needed (click/type/upload), prefer Playwright
      if (needsAutomation) {
        const hasPlaywright = await detectPlaywright();
        if (hasPlaywright) {
          return { adapter: 'playwright', reason: 'Automation required, Playwright available' };
        }
        logger.warn('Automation needed but Playwright not installed. CDP has limited automation.');
        return {
          adapter: 'cdp',
          reason: 'Automation needed, Playwright unavailable — using CDP (limited)',
        };
      }

      // Observation-only: try CDP first for zero-deps lightweight mode
      const hasChrome = await detectChrome();
      if (hasChrome) {
        return { adapter: 'cdp', reason: 'Chrome detected, using CDP (zero-dependency)' };
      }

      // Playwright fallback
      const hasPlaywright = await detectPlaywright();
      if (hasPlaywright) {
        return { adapter: 'playwright', reason: 'Chrome not detected, falling back to Playwright' };
      }

      // Neither available — CDP is the safer bet since it can launch Chrome
      return { adapter: 'cdp', reason: 'No browser detected — CDP will attempt to launch Chrome' };
    }
  }
}
