/**
 * Lazy Context Levels 1-3 — Middleware Layers
 *
 * Implements the on-demand context levels as middleware that can be
 * selectively enabled/disabled via config:
 *
 * Level 1 (Summary):  ~50 tokens — Attached when the response has errors
 *                     or the tool input requests detail="summary"|"full"
 * Level 2 (Detail):   ~200 tokens — Attached when input has detail="full"
 *                     or includeRaw=true
 * Level 3 (Raw):      ~2000+ tokens — Attached only on explicit includeRaw=true
 *
 * Each level uses the LazyContext service internally to build its payload.
 * The middleware pattern means higher levels only run when triggered,
 * keeping token costs minimal.
 *
 * Usage in config:
 *   {
 *     lazyContext: {
 *       level1: true,   // Enable summary middleware
 *       level2: false,  // Disable detail middleware
 *       level3: false   // Disable raw middleware
 *     }
 *   }
 */

import type { MiddlewareFn } from "./Pipeline.js";
import type { LazyContext } from "./LazyContext.js";
import { getLogger } from "../utils/logger.js";

// ─── Level 1: Summary Middleware ────────────────────────────────

export interface LazyLevel1Options {
  enabled: boolean;
  /** Attach summary on error responses even if not requested */
  autoOnError: boolean;
  /** Max tokens for Level 1 summary (default: 100) */
  maxTokens: number;
}

const DEFAULT_LEVEL1: LazyLevel1Options = {
  enabled: true,
  autoOnError: true,
  maxTokens: 100,
};

/**
 * Creates middleware that conditionally attaches Level 1 (Summary) context.
 *
 * Triggers:
 * - Tool input has `detail: "summary"` or `detail: "full"`
 * - Response contains errors (if autoOnError is true)
 */
export function createLazyLevel1(
  lazyContext: LazyContext,
  options?: Partial<LazyLevel1Options>,
): MiddlewareFn {
  const opts = { ...DEFAULT_LEVEL1, ...options };
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    if (!opts.enabled || !ctx.session) {
      return result;
    }

    try {
      const parsedInput = ctx.parsedInput as Record<string, unknown>;
      const detail = parsedInput.detail as string | undefined;
      const resultObj = result as Record<string, unknown>;
      const hasErrors =
        resultObj.success === false ||
        (ctx.session && ctx.session.consoleBuffer.filter((l) => l.level === "error").length > 0);

      // Determine if Level 1 should be attached
      const shouldAttach =
        detail === "summary" ||
        detail === "full" ||
        (opts.autoOnError && hasErrors);

      if (shouldAttach) {
        // Get pulse from the response meta if available
        const meta = resultObj.meta as Record<string, unknown> | undefined;
        const pulse = meta?.pulse as Record<string, unknown> | undefined;
        const pulseObj = pulse
          ? {
              level: 0 as const,
              status: (pulse.status as "healthy" | "warning" | "error") ?? "healthy",
              consoleErrors: (pulse.consoleErrors as number) ?? 0,
              consoleWarnings: (pulse.consoleWarnings as number) ?? 0,
              corsWarnings: (pulse.corsWarnings as number) ?? 0,
              networkFailures: (pulse.networkFailures as number) ?? 0,
              networkSlow: (pulse.networkSlow as number) ?? 0,
              summary: (pulse.summary as string) ?? "",
            }
          : undefined;

        if (pulseObj) {
          const summary = lazyContext.getSummary(ctx.session, pulseObj, opts.maxTokens);

          // Attach Level 1 to meta
          if (!resultObj.meta) {
            resultObj.meta = {};
          }
          (resultObj.meta as Record<string, unknown>).lazyLevel1 = summary;
        }
      }
    } catch (error) {
      // Level 1 is best-effort
      logger.warn({ error }, "LazyLevel1: failed to attach summary");
    }

    return result;
  };
}

// ─── Level 2: Detail Middleware ─────────────────────────────────

export interface LazyLevel2Options {
  enabled: boolean;
  /** Max tokens for Level 2 detail (default: 500) */
  maxTokens: number;
}

const DEFAULT_LEVEL2: LazyLevel2Options = {
  enabled: false,
  maxTokens: 500,
};

/**
 * Creates middleware that conditionally attaches Level 2 (Detail) context.
 *
 * Triggers:
 * - Tool input has `detail: "full"`
 * - Tool input has `includeRaw: true` (implies detail)
 */
export function createLazyLevel2(
  lazyContext: LazyContext,
  options?: Partial<LazyLevel2Options>,
): MiddlewareFn {
  const opts = { ...DEFAULT_LEVEL2, ...options };
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    if (!opts.enabled || !ctx.session) {
      return result;
    }

    try {
      const parsedInput = ctx.parsedInput as Record<string, unknown>;
      const detail = parsedInput.detail as string | undefined;
      const includeRaw = parsedInput.includeRaw as boolean | undefined;

      // Determine if Level 2 should be attached
      const shouldAttach =
        detail === "full" ||
        includeRaw === true;

      if (shouldAttach) {
        const incidentId = parsedInput.incidentId as string | undefined;
        const detailData = lazyContext.getDetail(ctx.session, incidentId, opts.maxTokens);

        const resultObj = result as Record<string, unknown>;
        if (!resultObj.meta) {
          resultObj.meta = {};
        }
        (resultObj.meta as Record<string, unknown>).lazyLevel2 = detailData;
      }
    } catch (error) {
      logger.warn({ error }, "LazyLevel2: failed to attach detail");
    }

    return result;
  };
}

// ─── Level 3: Raw Middleware ────────────────────────────────────

export interface LazyLevel3Options {
  enabled: boolean;
  /** Max tokens for Level 3 raw data (default: 2000) */
  maxTokens: number;
}

const DEFAULT_LEVEL3: LazyLevel3Options = {
  enabled: false,
  maxTokens: 2000,
};

/**
 * Creates middleware that conditionally attaches Level 3 (Raw) context.
 *
 * This is the most expensive level (~2000+ tokens) and is only
 * triggered on explicit request via `includeRaw: true`.
 *
 * Triggers:
 * - Tool input has `includeRaw: true`
 */
export function createLazyLevel3(
  lazyContext: LazyContext,
  options?: Partial<LazyLevel3Options>,
): MiddlewareFn {
  const opts = { ...DEFAULT_LEVEL3, ...options };
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    if (!opts.enabled || !ctx.session) {
      return result;
    }

    try {
      const parsedInput = ctx.parsedInput as Record<string, unknown>;
      const includeRaw = parsedInput.includeRaw as boolean | undefined;

      // Level 3 only on explicit includeRaw=true
      if (includeRaw === true) {
        const rawData = lazyContext.getRaw(ctx.session, opts.maxTokens);

        const resultObj = result as Record<string, unknown>;
        if (!resultObj.meta) {
          resultObj.meta = {};
        }
        (resultObj.meta as Record<string, unknown>).lazyLevel3 = rawData;
      }
    } catch (error) {
      logger.warn({ error }, "LazyLevel3: failed to attach raw data");
    }

    return result;
  };
}
