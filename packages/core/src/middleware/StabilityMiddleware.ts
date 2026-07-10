/**
 * Stability Middleware — auto-waits for page stability before interactions.
 *
 * For tools like browser_click, browser_type, browser_navigate, etc.,
 * this middleware ensures the page has settled (network idle, no DOM mutations)
 * before the tool handler executes. This dramatically reduces flaky
 * "element not found" errors caused by dynamic content changes.
 *
 * The approach:
 * 1. Before interaction tools, wait for network idle (no requests for 500ms)
 * 2. Wait for DOM mutations to settle (no new mutations for 300ms)
 * 3. Then let the tool handler execute normally
 *
 * Uses Playwright's built-in waitForLoadState("networkidle") when available.
 * Falls back to JS-based polling for DOM mutations.
 */
import type { MiddlewareFn, MiddlewareContext } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";

const INTERACTION_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_hover",
  "browser_scroll",
  "browser_press_key",
  "browser_focus",
  "browser_clear",
  "browser_upload_file",
  "browser_drag_drop",
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_reload",
]);

const NETWORK_IDLE_TIMEOUT = 5_000; // Max time to wait for network idle
const MUTATION_SETTLE_TIME = 300;   // How long without mutations before settling

/**
 * Wait for the page to reach network idle state.
 * Uses Playwright's native waitForLoadState when available.
 */
async function waitForNetworkIdle(session: NonNullable<MiddlewareContext["session"]>): Promise<void> {
  if (!session.browser?.waitForLoadState) return;

  try {
    await session.browser.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT });
  } catch {
    // Timeout is non-fatal — page might have persistent connections (WebSockets, SSE)
    getLogger().warn("StabilityMiddleware: network idle wait timed out (non-fatal)");
  }
}

/**
 * Wait for DOM mutations to settle — no new mutations for MUTATION_SETTLE_TIME ms.
 * Uses a MutationObserver via page.evaluate.
 */
async function waitForDomSettle(session: NonNullable<MiddlewareContext["session"]>): Promise<void> {
  if (!session.browser?.evaluate) return;

  try {
    await session.browser.evaluate((settleMs: number) => {
      return new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const observer = new MutationObserver(() => {
          // Reset timer on each mutation
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, settleMs);
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: false, // Skip attribute changes — less critical
          characterData: false,
        });

        // Fallback: resolve after max 5s even if mutations keep happening
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 5000);
      });
    }, MUTATION_SETTLE_TIME);
  } catch {
    // DOM settle is best-effort
  }
}

/**
 * Create the Stability middleware.
 * Auto-waits for page stability before interaction tools.
 */
export function createStabilityMiddleware(): MiddlewareFn {
  const logger = getLogger();

  return async (ctx: MiddlewareContext, next) => {
    // Only apply to interaction tools that need page stability
    if (!INTERACTION_TOOLS.has(ctx.toolName)) {
      return next();
    }

    const session = ctx.session;
    if (!session?.browser) {
      return next();
    }

    logger.info({ tool: ctx.toolName }, "StabilityMiddleware: waiting for page stability");

    // 1. Wait for network idle
    await waitForNetworkIdle(session);

    // 2. Wait for DOM mutations to settle
    await waitForDomSettle(session);

    logger.info({ tool: ctx.toolName }, "StabilityMiddleware: page stable, proceeding");

    return next();
  };
}
