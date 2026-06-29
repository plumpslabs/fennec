/**
 * Fennec Browser Engine Abstraction Layer
 *
 * This module provides interfaces and implementations for browser operations,
 * decoupling Fennec from direct Playwright dependency.
 *
 * ## Usage (future, after v2.0 migration)
 *
 * ```typescript
 * import { EngineFactory } from "./browser/index.js";
 *
 * const factory = new PlaywrightEngineFactory();
 * const engine = factory.create("chromium");
 * const instance = await engine.launch({ headless: true });
 * const session = await instance.createSession();
 * await session.navigate("https://example.com");
 * ```
 *
 * ## Architecture
 *
 * ```
 * Tool Handler → BrowserSession (interface) ← PlaywrightSession (impl)
 *                                                    ↓
 *                                           Playwright Page/BrowserContext
 * ```
 */

export { PlaywrightEngineFactory } from "./playwright-engine.js";
export type {
  BrowserEngine,
  BrowserInstance,
  BrowserSession,
  BrowserLaunchOptions,
  BrowserSessionOptions,
  BrowserCDPSession,
  NavigateOptions,
  NavigationResult,
  WaitForSelectorOptions,
  Locator,
  ElementHandle,
  BoundingBox,
  Route,
  Cookie,
  CookieInput,
  BrowserType,
  ScreenshotOpts,
  LoadEvent,
  EngineFactory,
} from "./types.js";
