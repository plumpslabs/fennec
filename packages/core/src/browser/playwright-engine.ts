/**
 * Playwright Engine — Fennec Browser Engine Implementation
 *
 * Wraps Playwright's chromium/firefox/webkit APIs behind Fennec's
 * BrowserEngine interface. This is the default engine.
 */

import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';
import { randomUUID } from 'node:crypto';
import type {
  BrowserEngine,
  BrowserInstance,
  BrowserSession,
  BrowserLaunchOptions,
  BrowserSessionOptions,
  NavigateOptions,
  NavigationResult,
  WaitForSelectorOptions,
  Locator,
  ElementHandle,
  BoundingBox,
  Route,
  BrowserCDPSession,
  CookieInput,
  BrowserType,
} from './types.js';

/**
 * Lazy-load playwright — it's an optional peer dependency.
 */
async function getPlaywright() {
  try {
    return await import('playwright');
  } catch (err) {
    // "Cannot find module" covers both CJS (MODULE_NOT_FOUND) and ESM (ERR_MODULE_NOT_FOUND)
    const isModuleNotFound = err instanceof Error && err.message?.includes('Cannot find module');
    if (isModuleNotFound) {
      throw new Error('Playwright is not installed. Install it with: npm install playwright');
    }
    throw new Error(
      'Failed to load Playwright: ' + (err instanceof Error ? err.message : String(err)),
    );
  }
}

// ─── Helper: generate a unique session ID ────────────────────────

function generateSessionId(): string {
  return `sess_${randomUUID().slice(0, 8)}`;
}

// ─── Helper: wrap a Playwright locator into a Fennec Locator ─────

function wrapLocator(pwLocator: ReturnType<Page['locator']>): Locator {
  const wrapped: Locator & { _pwLocator?: ReturnType<Page['locator']> } = {
    click: (opts) => pwLocator.click(opts).then(),
    fill: (text) => pwLocator.fill(text),
    pressSequentially: (text, opts) => pwLocator.pressSequentially(text, opts).then(),
    selectOption: (value) => pwLocator.selectOption(value),
    hover: () => pwLocator.hover(),
    focus: () => pwLocator.focus(),
    boundingBox: () =>
      pwLocator
        .boundingBox()
        .then((b) => (b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null)),
    isVisible: () => pwLocator.isVisible(),
    isEnabled: () => pwLocator.isEnabled(),
    textContent: () => pwLocator.textContent(),
    inputValue: () => pwLocator.inputValue(),
    innerText: () => pwLocator.innerText(),
    allTextContents: () => pwLocator.allTextContents(),
    setInputFiles: (paths) => pwLocator.setInputFiles(paths),
    setChecked: (checked) => pwLocator.setChecked(checked),
    evaluate: (fn: any, ...args: any[]) => pwLocator.evaluate(fn, ...args),
    evaluateAll: (fn: any, ...args: any[]) => pwLocator.evaluateAll(fn as any, ...args as any),
    elementHandle: () => pwLocator.elementHandle().then((h) => (h ? wrapElementHandle(h) : null)),
    first: () => wrapLocator(pwLocator.first()),
    all: () => pwLocator.all().then(() => [] as Locator[]),
    dragTo: (target) =>
      pwLocator.dragTo(
        ((target as unknown as { _pwLocator?: ReturnType<Page['locator']> })._pwLocator ??
          target) as unknown as ReturnType<Page['locator']>,
      ),
    count: () => pwLocator.count(),
  };
  wrapped._pwLocator = pwLocator;
  return wrapped;
}

// ─── Helper: wrap a Playwright element handle into a Fennec ElementHandle ─

function wrapElementHandle(h: Awaited<ReturnType<Page['$']>>): ElementHandle {
  return {
    boundingBox: () =>
      h!
        .boundingBox()
        .then((b) => (b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null)),
    click: () => h!.click(),
    $: async (sel) => {
      const child = await h!.$(sel);
      return child ? wrapElementHandle(child) : null;
    },
  };
}

// ─── Engine Factory ──────────────────────────────────────────────

export class PlaywrightEngineFactory {
  create(type: BrowserType): BrowserEngine {
    switch (type) {
      case 'chromium':
        return new PlaywrightEngine('chromium');
      case 'firefox':
        return new PlaywrightEngine('firefox');
      case 'webkit':
        return new PlaywrightEngine('webkit');
    }
  }

  getAvailableTypes(): BrowserType[] {
    return ['chromium', 'firefox', 'webkit'];
  }
}

// ─── Browser Engine (launches browser) ───────────────────────────

class PlaywrightEngine implements BrowserEngine {
  readonly type: BrowserType;

  constructor(type: BrowserType) {
    this.type = type;
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserInstance> {
    const opts = {
      headless: options.headless,
      slowMo: options.slowMo,
      args: options.args ?? ['--no-sandbox', '--disable-setuid-sandbox'],
      ignoreHTTPSErrors: options.ignoreHTTPSErrors,
    };

    const pw = await getPlaywright();
    let browser: Browser;
    switch (this.type) {
      case 'chromium':
        browser = await pw.chromium.launch(opts);
        break;
      case 'firefox':
        browser = await pw.firefox.launch(opts);
        break;
      case 'webkit':
        browser = await pw.webkit.launch(opts);
        break;
    }

    return new PlaywrightInstance(this.type, browser!);
  }
}

// ─── Browser Instance ────────────────────────────────────────────

class PlaywrightInstance implements BrowserInstance {
  readonly type: BrowserType;
  private browser: Browser;

  constructor(type: BrowserType, browser: Browser) {
    this.type = type;
    this.browser = browser;
  }

  async createSession(options?: BrowserSessionOptions): Promise<BrowserSession> {
    const context = await this.browser.newContext({
      viewport: options?.viewport,
      locale: options?.locale,
      timezoneId: options?.timezoneId,
      userAgent: options?.userAgent,
    });
    const page = await context.newPage();
    const cdpSession = await context.newCDPSession(page);
    return new PlaywrightSession(
      generateSessionId(),
      this.type,
      page,
      context,
      cdpSession,
      this.browser,
      options,
    );
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

// ─── Browser Session (wraps Page + BrowserContext + CDPSession) ──

class PlaywrightSession implements BrowserSession {
  readonly id: string;
  readonly type: BrowserType;
  private page: Page;
  private context: BrowserContext;
  private cdpSession: CDPSession;
  private parent: Browser;
  private options?: BrowserSessionOptions;

  constructor(
    id: string,
    type: BrowserType,
    page: Page,
    context: BrowserContext,
    cdpSession: CDPSession,
    parent: Browser,
    options?: BrowserSessionOptions,
  ) {
    this.id = id;
    this.type = type;
    this.page = page;
    this.context = context;
    this.cdpSession = cdpSession;
    this.parent = parent;
    this.options = options;
  }

  // ── Navigation ──

  async navigate(url: string, options?: NavigateOptions): Promise<NavigationResult> {
    const startTime = Date.now();
    await this.page.goto(url, {
      waitUntil: options?.waitUntil ?? 'networkidle',
      timeout: options?.timeout ?? 30000,
    });
    const statusCode = await this.page
      .evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0] as
          PerformanceNavigationTiming | undefined;
        return perf?.responseStatus ?? 200;
      })
      .catch(() => 200);
    return { finalUrl: this.page.url(), statusCode, loadTimeMs: Date.now() - startTime };
  }

  async goBack(): Promise<void> {
    await this.page.goBack();
  }
  async goForward(): Promise<void> {
    await this.page.goForward();
  }

  async reload(options?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  }): Promise<void> {
    await this.page.reload({ waitUntil: options?.waitUntil ?? 'networkidle' });
  }

  // ── URL & State ──

  url(): string {
    return this.page.url();
  }
  async title(): Promise<string> {
    return this.page.title();
  }
  async readyState(): Promise<string> {
    return this.page.evaluate(() => document.readyState);
  }
  viewportSize(): { width: number; height: number } | null {
    return this.page.viewportSize() ?? null;
  }
  isClosed(): boolean {
    return this.page.isClosed();
  }
  async close(): Promise<void> {
    // Close the PAGE *and* its BrowserContext. Closing only the page
    // leaks the context (cookies, cache, service workers, network
    // state) — over many sessions that's exactly the "nyampah" memory
    // growth we want to avoid. The whole context must be torn down.
    await this.page.close().catch(() => {});
    await this.context.close().catch(() => {});
  }
  isAlive(): boolean {
    // `page.isClosed()` flips to true when the target is detached
    // (e.g. cross-scheme https->http navigation killing the CDP target).
    return !this.page.isClosed();
  }
  async recreate(): Promise<void> {
    if (!this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
    const newPage = await this.context.newPage();
    const newCdp = await this.context.newCDPSession(newPage);
    this.page = newPage;
    this.cdpSession = newCdp;
  }
  async bringToFront(): Promise<void> {
    await this.page.bringToFront();
  }

  // ── Element Discovery ──

  async $(selector: string): Promise<ElementHandle | null> {
    const el = await this.page.$(selector);
    return el ? wrapElementHandle(el) : null;
  }

  async $$(selector: string): Promise<ElementHandle[]> {
    const els = await this.page.$$(selector);
    return els.map((el) => wrapElementHandle(el));
  }

  async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
    await this.page.waitForSelector(selector, {
      state: options?.state ?? 'visible',
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForURL(
    urlOrFn: string | ((url: string) => boolean),
    options?: { timeout?: number },
  ): Promise<void> {
    const pwPredicate =
      typeof urlOrFn === 'function' ? (url: URL) => urlOrFn(url.href) : urlOrFn;
    await this.page.waitForURL(pwPredicate, { timeout: options?.timeout });
  }

  async waitForLoadState(
    state?: 'load' | 'domcontentloaded' | 'networkidle',
    options?: { timeout?: number },
  ): Promise<void> {
    await this.page.waitForLoadState(state ?? 'networkidle', { timeout: options?.timeout });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async waitForRequest(
    urlOrPredicate: string | ((req: { url: () => string; method: () => string }) => boolean),
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
  }> {
    const predicate =
      typeof urlOrPredicate === 'string'
        ? (req: { url: () => string }) => req.url().includes(urlOrPredicate)
        : urlOrPredicate;
    const req = await this.page.waitForRequest(predicate as (req: { url: () => string; method: () => string }) => boolean, { timeout: options?.timeout });
    return {
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
      resourceType: req.resourceType(),
      response: async () => {
        const r = await req.response();
        return r
          ? { status: r.status(), statusText: r.statusText(), headers: r.headers(), url: r.url() }
          : null;
      },
    };
  }

  // ── JavaScript Execution ──

  async evaluate<T = unknown>(
    fn: string | ((...args: unknown[]) => T),
    ...args: unknown[]
  ): Promise<T> {
    return typeof fn === 'string'
      ? this.page.evaluate(fn)
      : this.page.evaluate(fn as (...args: unknown[]) => T, ...args);
  }

  // ── Locator ──

  locator(selector: string): Locator {
    return wrapLocator(this.page.locator(selector));
  }

  // ── Screenshot ──

  async screenshot(options?: {
    fullPage?: boolean;
    clip?: BoundingBox;
    type?: 'png' | 'jpeg';
    quality?: number;
  }): Promise<Buffer> {
    return this.page.screenshot(options as {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      type?: 'png' | 'jpeg';
      quality?: number;
    } | undefined);
  }

  // ── Network Interception ──

  async route(urlPattern: string, handler: (route: Route) => Promise<void>): Promise<void> {
    await this.page.route(urlPattern, async (pwRoute) => {
      await handler({
        request: {
          url: pwRoute.request().url(),
          method: pwRoute.request().method(),
          headers: pwRoute.request().headers(),
          postData: pwRoute.request().postData(),
        },
        continue: () => pwRoute.continue(),
        fulfill: (opts) => pwRoute.fulfill(opts as {
          status?: number;
          contentType?: string;
          body?: string;
          headers?: Record<string, string>;
        }).then(),
      });
    });
  }

  async unroute(urlPattern: string): Promise<void> {
    await this.page.unroute(urlPattern);
  }

  // ── Keyboard ──

  async keyboardPress(key: string, options?: { modifiers?: string[] }): Promise<void> {
    if (options?.modifiers?.length) {
      for (const mod of options.modifiers) await this.page.keyboard.down(mod);
    }
    await this.page.keyboard.press(key);
    if (options?.modifiers?.length) {
      for (let i = options.modifiers.length - 1; i >= 0; i--) {
        await this.page.keyboard.up(options.modifiers[i]!);
      }
    }
  }

  // ── CDP ──

  cdp(): BrowserCDPSession {
    return {
      send: <T>(method: string, params?: Record<string, unknown>) =>
        this.cdpSession.send(method as string, params as Record<string, unknown>) as Promise<T>,
      on: (event, handler) =>
        void this.cdpSession.on(event as string, handler as (params: unknown) => void),
      off: (event, handler) =>
        void this.cdpSession.off(event as string, handler as (params: unknown) => void),
    };
  }

  // ── Context-level operations ──

  async rotateContext(): Promise<void> {
    // Tear down the current context and build a fresh one. This frees the
    // memory accumulated in a long-lived context (DOM, listeners, network
    // state, service workers) without losing the logged-in session — cookies
    // and localStorage are preserved via storageState.
    const storageState = await this.context.storageState().catch(() => null);
    await this.page.close().catch(() => {});
    await this.context.close().catch(() => {});

    const newContext = await this.parent.newContext({
      ...(storageState ? { storageState } : {}),
      viewport: this.options?.viewport,
      locale: this.options?.locale,
      timezoneId: this.options?.timezoneId,
      userAgent: this.options?.userAgent,
    });
    const newPage = await newContext.newPage();
    const newCdp = await newContext.newCDPSession(newPage);
    this.context = newContext;
    this.page = newPage;
    this.cdpSession = newCdp;
  }

  async contextCookies(): Promise<import('./types.js').Cookie[]> {
    const cookies = await this.context.cookies();
    return cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') ?? 'Lax',
      expires: c.expires,
    }));
  }

  async contextAddCookies(cookies: CookieInput[]): Promise<void> {
    await this.context.addCookies(cookies);
  }

  async contextClearCookies(): Promise<void> {
    await this.context.clearCookies();
  }

  async contextNewPage(): Promise<BrowserSession> {
    // Cap open pages per context so `tab_new` / repeated navigations
    // can't accumulate untracked pages ("nyampah"). When at the cap,
    // close the oldest non-active page first.
    const MAX_PAGES_PER_CONTEXT = 20;
    const pages = this.context.pages();
    if (pages.length >= MAX_PAGES_PER_CONTEXT) {
      const oldest = pages.find((p) => p !== this.page);
      if (oldest) await oldest.close().catch(() => {});
    }
    const newPage = await this.context.newPage();
    const newCdp = await this.context.newCDPSession(newPage);
    return new PlaywrightSession(
      generateSessionId(),
      this.type,
      newPage,
      this.context,
      newCdp,
      this.parent,
      this.options,
    );
  }

  contextPages(): BrowserSession[] {
    return this.context
      .pages()
      .map((p) => new PlaywrightPageSession(p, this.context, this.cdpSession, this.type));
  }

  onConsole(_callback: (event: any) => void): () => void {
    // Console events are handled via CDP collectors in SessionManager.
    // This interface method exists for future engine implementations.
    return () => {};
  }

  onNetworkRequest(_callback: (event: any) => void): () => void {
    // Network events are handled via CDP collectors in SessionManager.
    return () => {};
  }
}

/**
 * Thin wrapper around an existing Page for when we need to list
 * pages from a context (contextPages()). Shares the same BrowserContext
 * and CDPSession as the parent PlaywrightSession.
 */
class PlaywrightPageSession implements BrowserSession {
  readonly id: string;
  readonly type: BrowserType;
  private page: Page;
  private context: BrowserContext;
  private cdpSession: CDPSession;

  constructor(page: Page, context: BrowserContext, cdpSession: CDPSession, type: BrowserType) {
    this.id = `page_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.type = type;
    this.page = page;
    this.context = context;
    this.cdpSession = cdpSession;
  }

  async navigate(url: string, options?: NavigateOptions): Promise<NavigationResult> {
    const startTime = Date.now();
    await this.page.goto(url, {
      waitUntil: options?.waitUntil ?? 'networkidle',
      timeout: options?.timeout ?? 30000,
    });
    return { finalUrl: this.page.url(), statusCode: 200, loadTimeMs: Date.now() - startTime };
  }
  async goBack(): Promise<void> {
    await this.page.goBack();
  }
  async goForward(): Promise<void> {
    await this.page.goForward();
  }
  async reload(options?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  }): Promise<void> {
    await this.page.reload({ waitUntil: options?.waitUntil ?? 'networkidle' });
  }
  url(): string {
    return this.page.url();
  }
  async title(): Promise<string> {
    return this.page.title();
  }
  async readyState(): Promise<string> {
    return this.page.evaluate(() => document.readyState);
  }
  viewportSize(): { width: number; height: number } | null {
    return this.page.viewportSize() ?? null;
  }
  isClosed(): boolean {
    return this.page.isClosed();
  }
  async close(): Promise<void> {
    await this.page.close();
  }
  isAlive(): boolean {
    return !this.page.isClosed();
  }
  async recreate(): Promise<void> {
    /* page shares the parent context; recovery is done on the owner session */
  }
  async bringToFront(): Promise<void> {
    await this.page.bringToFront();
  }
  async rotateContext(): Promise<void> {
    // A page-session shares its parent PlaywrightSession's context. Rotation
    // is performed on the owning session; nothing to do here.
  }
  async $(selector: string): Promise<ElementHandle | null> {
    const el = await this.page.$(selector);
    return el ? wrapElementHandle(el) : null;
  }
  async $$(selector: string): Promise<ElementHandle[]> {
    const els = await this.page.$$(selector);
    return els.map((el) => wrapElementHandle(el));
  }
  async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
    await this.page.waitForSelector(selector, {
      state: options?.state ?? 'visible',
      timeout: options?.timeout ?? 30000,
    });
  }
  async waitForURL(
    urlOrFn: string | ((url: string) => boolean),
    options?: { timeout?: number },
  ): Promise<void> {
    const pwPredicate =
      typeof urlOrFn === 'function' ? (url: URL) => urlOrFn(url.href) : urlOrFn;
    await this.page.waitForURL(pwPredicate, { timeout: options?.timeout });
  }
  async waitForLoadState(
    state?: 'load' | 'domcontentloaded' | 'networkidle',
    options?: { timeout?: number },
  ): Promise<void> {
    await this.page.waitForLoadState(state ?? 'networkidle', { timeout: options?.timeout });
  }
  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
  async waitForRequest(
    urlOrPredicate: string | ((req: { url: () => string; method: () => string }) => boolean),
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
  }> {
    const predicate =
      typeof urlOrPredicate === 'string'
        ? (req: { url: () => string }) => req.url().includes(urlOrPredicate)
        : urlOrPredicate;
    const req = await this.page.waitForRequest(predicate as (req: { url: () => string; method: () => string }) => boolean, { timeout: options?.timeout });
    return {
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
      resourceType: req.resourceType(),
      response: async () => {
        const r = await req.response();
        return r
          ? { status: r.status(), statusText: r.statusText(), headers: r.headers(), url: r.url() }
          : null;
      },
    };
  }
  async evaluate<T = unknown>(
    fn: string | ((...args: unknown[]) => T),
    ...args: unknown[]
  ): Promise<T> {
    return typeof fn === 'string'
      ? this.page.evaluate(fn)
      : this.page.evaluate(fn as (...args: unknown[]) => T, ...args);
  }
  locator(selector: string): Locator {
    return wrapLocator(this.page.locator(selector));
  }
  async screenshot(options?: {
    fullPage?: boolean;
    clip?: BoundingBox;
    type?: 'png' | 'jpeg';
    quality?: number;
  }): Promise<Buffer> {
    return this.page.screenshot(options as {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      type?: 'png' | 'jpeg';
      quality?: number;
    } | undefined);
  }
  async route(urlPattern: string, handler: (route: Route) => Promise<void>): Promise<void> {
    await this.page.route(urlPattern, async (pwRoute) => {
      await handler({
        request: {
          url: pwRoute.request().url(),
          method: pwRoute.request().method(),
          headers: pwRoute.request().headers(),
          postData: pwRoute.request().postData(),
        },
        continue: () => pwRoute.continue(),
        fulfill: (opts) => pwRoute.fulfill(opts as {
          status?: number;
          contentType?: string;
          body?: string;
          headers?: Record<string, string>;
        }).then(),
      });
    });
  }
  async unroute(urlPattern: string): Promise<void> {
    await this.page.unroute(urlPattern);
  }
  async keyboardPress(key: string, options?: { modifiers?: string[] }): Promise<void> {
    if (options?.modifiers?.length) {
      for (const mod of options.modifiers) await this.page.keyboard.down(mod);
    }
    await this.page.keyboard.press(key);
    if (options?.modifiers?.length) {
      for (let i = options.modifiers.length - 1; i >= 0; i--) {
        await this.page.keyboard.up(options.modifiers[i]!);
      }
    }
  }
  cdp(): BrowserCDPSession {
    return {
      send: <T>(method: string, params?: Record<string, unknown>) =>
        this.cdpSession.send(method as string, params as Record<string, unknown>) as Promise<T>,
      on: (event, handler) =>
        void this.cdpSession.on(event as string, handler as (params: unknown) => void),
      off: (event, handler) =>
        void this.cdpSession.off(event as string, handler as (params: unknown) => void),
    };
  }
  async contextCookies(): Promise<import('./types.js').Cookie[]> {
    const cookies = await this.context.cookies();
    return cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') ?? 'Lax',
      expires: c.expires,
    }));
  }
  async contextAddCookies(cookies: CookieInput[]): Promise<void> {
    await this.context.addCookies(cookies);
  }
  async contextClearCookies(): Promise<void> {
    await this.context.clearCookies();
  }
  async contextNewPage(): Promise<BrowserSession> {
    const newPage = await this.context.newPage();
    const newCdp = await this.context.newCDPSession(newPage);
    return new PlaywrightPageSession(newPage, this.context, newCdp, this.type);
  }
  contextPages(): BrowserSession[] {
    return this.context
      .pages()
      .map((p) => new PlaywrightPageSession(p, this.context, this.cdpSession, this.type));
  }
  onConsole(_callback: (event: any) => void): () => void {
    return () => {};
  }
  onNetworkRequest(_callback: (event: any) => void): () => void {
    return () => {};
  }
}
