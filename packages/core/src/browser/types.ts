/**
 * Fennec Browser Engine Abstraction Layer
 *
 * Defines interfaces for all browser operations so Fennec can work with
 * multiple browser engines (Playwright, Puppeteer, CDP Direct, Remote, Mock).
 *
 * The current runtime implementation uses Playwright, but tools and modules
 * should only depend on these interfaces — never on Playwright types directly.
 *
 * Migration strategy (v2.0):
 * 1. ✅ Create interfaces (this file)
 * 2. ✅ Implementation wraps Playwright (playwright-engine.ts)
 * 3. ⏳ Replace FennecSession.page/cdpSession with BrowserSession
 * 4. ⏳ Tool handlers access session.browser instead of session.page
 * 5. ⏳ CDP collectors take BrowserCDPSession instead of CDPSession
 */

// ─── Browser Launcher ────────────────────────────────────────────

export interface BrowserLaunchOptions {
  headless: boolean;
  slowMo: number;
  args?: string[];
  ignoreHTTPSErrors?: boolean;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
  userAgent?: string;
  defaultTimeout?: number;
}

export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface BrowserEngine {
  readonly type: BrowserType;
  launch(options: BrowserLaunchOptions): Promise<BrowserInstance>;
}

export interface BrowserInstance {
  readonly type: BrowserType;
  createSession(options?: BrowserSessionOptions): Promise<BrowserSession>;
  close(): Promise<void>;
}

export interface BrowserSessionOptions {
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
}

// ─── Browser Session ─────────────────────────────────────────────

// ConsoleEvent and NetworkEvent are imported from session/types.ts to avoid duplication
import type { ConsoleEvent, NetworkEvent } from '../session/types.js';

export interface BrowserSession {
  readonly id: string;
  readonly type: BrowserType;

  // ── Navigation ──
  navigate(url: string, options?: NavigateOptions): Promise<NavigationResult>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(options?: { waitUntil?: LoadEvent }): Promise<void>;

  // ── URL & State ──
  url(): string;
  title(): Promise<string>;
  readyState(): Promise<string>;
  viewportSize(): { width: number; height: number } | null;
  isClosed(): boolean;
  close(): Promise<void>;
  bringToFront(): Promise<void>;

  /**
   * Best-effort liveness check. Returns false when the underlying page/target
   * has been torn down (e.g. cross-scheme navigation detaching the CDP
   * target), so callers can recover instead of failing every call.
   */
  isAlive(): boolean;
  /** Re-create the page (and CDPSession) inside the same context to recover a dead session. No-op when nothing is wrong. */
  recreate(): Promise<void>;

  // ── Element Discovery ──
  $(selector: string): Promise<ElementHandle | null>;
  $$(selector: string): Promise<ElementHandle[]>;
  waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void>;
  waitForURL(
    urlOrFn: string | ((url: string) => boolean),
    options?: { timeout?: number },
  ): Promise<void>;
  waitForLoadState(state?: LoadEvent, options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForRequest(
    urlOrPredicate: string | ((request: { url: () => string; method: () => string }) => boolean),
    options?: { timeout?: number },
  ): Promise<{
    url: string;
    method: string;
    headers: Record<string, string>;
    postData: string | null;
    resourceType: string;
    response: () => Promise<{
      status: number;
      statusText: string;
      headers: Record<string, string>;
      url: string;
    } | null>;
  }>;

  // ── JavaScript Execution ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T = unknown>(fn: string | ((...args: any[]) => T), ...args: unknown[]): Promise<T>;

  // ── Locator ──
  locator(selector: string): Locator;

  // ── Screenshot ──
  screenshot(options?: ScreenshotOpts): Promise<Buffer>;

  // ── Network Interception ──
  route(urlPattern: string, handler: (route: Route) => Promise<void>): Promise<void>;
  unroute(urlPattern: string): Promise<void>;

  // ── Keyboard ──
  keyboardPress(key: string, options?: { modifiers?: string[] }): Promise<void>;

  // ── CDP Access ──
  cdp(): BrowserCDPSession;

  // ── Context-level operations ──
  /** Recycle the underlying BrowserContext to free memory. Preserves cookies/localStorage via storageState. The current page URL is NOT restored by this method — callers should re-navigate if needed. */
  rotateContext(): Promise<void>;
  contextCookies(): Promise<Cookie[]>;
  contextAddCookies(cookies: CookieInput[]): Promise<void>;
  contextClearCookies(): Promise<void>;
  contextNewPage(): Promise<BrowserSession>;
  contextPages(): BrowserSession[];

  // ── Events ──
  onConsole(callback: (event: ConsoleEvent) => void): () => void;
  onNetworkRequest(callback: (event: NetworkEvent) => void): () => void;
}

// ─── Navigation ──────────────────────────────────────────────────

export type LoadEvent = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export interface NavigateOptions {
  waitUntil?: LoadEvent;
  timeout?: number;
}

export interface NavigationResult {
  finalUrl: string;
  statusCode: number;
  loadTimeMs: number;
}

// ─── Wait Options ────────────────────────────────────────────────

export interface WaitForSelectorOptions {
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeout?: number;
}

// ─── Element Locator ─────────────────────────────────────────────

export interface Locator {
  click(options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void>;
  fill(text: string): Promise<void>;
  pressSequentially(text: string, options?: { delay?: number }): Promise<void>;
  selectOption(value: string): Promise<string[]>;
  hover(): Promise<void>;
  focus(): Promise<void>;
  boundingBox(): Promise<BoundingBox | null>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  textContent(): Promise<string | null>;
  inputValue(): Promise<string>;
  innerText(): Promise<string>;
  allTextContents(): Promise<string[]>;
  setInputFiles(paths: string[]): Promise<void>;
  setChecked(checked: boolean): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T = unknown>(
    fn: string | ((el: Element, ...args: any[]) => T),
    ...args: unknown[]
  ): Promise<T>;
  evaluateAll<T = unknown>(fn: (els: Element[], ...args: any[]) => T, ...args: any[]): Promise<T>;
  elementHandle(): Promise<ElementHandle | null>;
  first(): Locator;
  all(): Promise<Locator[]>;
  dragTo(target: Locator): Promise<void>;
  count(): Promise<number>;
}

export interface ElementHandle {
  boundingBox(): Promise<BoundingBox | null>;
  click(): Promise<void>;
  $(selector: string): Promise<ElementHandle | null>;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Screenshot ──────────────────────────────────────────────────

export interface ScreenshotOpts {
  fullPage?: boolean;
  clip?: BoundingBox;
  type?: 'png' | 'jpeg';
  /** JPEG quality (0-100). Only applies to `jpeg`. Defaults to 50 in takeScreenshot. */
  quality?: number;
}

// ─── Network Route ───────────────────────────────────────────────

export interface Route {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData: string | null;
  };
  continue(): Promise<void>;
  fulfill(options: {
    status?: number;
    contentType?: string;
    body?: string;
    headers?: Record<string, string>;
  }): Promise<void>;
}

// ─── CDP ─────────────────────────────────────────────────────────

export interface BrowserCDPSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
}

// ─── Cookies ─────────────────────────────────────────────────────

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  expires?: number;
}

export interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  url?: string;
}

// ─── Engine Factory ──────────────────────────────────────────────

export interface EngineFactory {
  create(type: BrowserType): BrowserEngine;
  getAvailableTypes(): BrowserType[];
}
