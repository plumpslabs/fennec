/**
 * Engine Selector — Unified browser engine factory.
 *
 * Selects the appropriate BrowserEngine implementation based on
 * the AdapterSelector result. This is the bridge between config-driven
 * adapter detection and the actual engine instantiation.
 *
 * Flow:
 *   selectAdapter("auto") → { adapter: "cdp", reason: "..." }
 *   createEngine("cdp")   → CDPObserverEngine (implements BrowserEngine)
 *
 * or:
 *   createEngine("playwright", "chromium") → PlaywrightEngine (implements BrowserEngine)
 */

import type { BrowserEngine, BrowserType } from "./types.js";
import { PlaywrightEngineFactory } from "./playwright-engine.js";
import type { AdapterType } from "./AdapterSelector.js";

/**
 * Create a BrowserEngine based on the selected adapter type.
 * CDP engine is lazy-loaded via dynamic import to avoid loading it
 * until it's actually needed.
 *
 * @param adapter - "cdp" or "playwright" from AdapterSelector
 * @param browserType - Browser type (chromium/firefox/webkit) — only relevant for Playwright
 * @returns A BrowserEngine instance ready to launch()
 */
export async function createEngine(
  adapter: AdapterType,
  browserType: BrowserType = "chromium",
): Promise<BrowserEngine> {
  switch (adapter) {
    case "cdp": {
      const { CDPObserverEngine } = await import("./cdp-engine.js");
      return new CDPObserverEngine();
    }
    case "playwright":
    default: {
      const factory = new PlaywrightEngineFactory();
      return factory.create(browserType);
    }
  }
}
