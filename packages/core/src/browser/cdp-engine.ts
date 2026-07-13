/**
 * CDP Observer Engine — Lightweight Browser Adapter
 *
 * Implements Fennec's BrowserSession interface using Chrome DevTools Protocol directly.
 * No Playwright dependency required. Uses Node.js built-in modules only.
 *
 * Capabilities:
 * ✅ Navigate to URL
 * ✅ Screenshot
 * ✅ Evaluate JavaScript
 * ✅ Console monitoring
 * ✅ Network monitoring
 * ✅ DOM query (via evaluate)
 * ✅ Cookies
 * ❌ Click/Type/Hover (automation — use PlaywrightAdapter)
 * ❌ File upload / Drag-drop
 * ❌ Shadow DOM piercing
 *
 * When to use:
 * - Default mode: lightweight observation without Playwright
 * - AI only needs to "look" at pages, not interact
 * - Token-sensitive contexts
 */

import { randomUUID } from 'node:crypto';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
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
  ScreenshotOpts,
  LoadEvent,
} from './types.js';
import type { ConsoleEvent, NetworkEvent } from '../session/types.js';
import { getLogger } from '../utils/logger.js';

// ─── CDP Client — Uses WebSocket API (Node.js 21+ built-in, or polyfill) ─

class CDPClient extends EventEmitter {
  private ws: import('node:net').Socket | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private messageBuffer = '';
  private connected = false;
  private wsHost = '';
  private wsPort = 0;
  private wsPath = '';

  async connect(host: string, port: number): Promise<void> {
    const logger = getLogger();

    // Step 1: Get WebSocket debugger URL via HTTP
    const httpUrl = `http://${host}:${port}/json/version`;
    const httpResp = await fetch(httpUrl);
    const info = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    const wsUrl = info.webSocketDebuggerUrl ?? '';

    if (!wsUrl) {
      throw new Error('No WebSocket debugger URL available');
    }

    // Step 2: Connect via Node.js built-in WebSocket (available in Node 21+)
    // Fallback: use raw TCP for Chrome DevTools Protocol
    const url = new URL(wsUrl);
    this.wsHost = url.hostname;
    this.wsPort = parseInt(url.port, 10);
    this.wsPath = url.pathname + url.search;

    // Connect using raw TCP and implement WebSocket protocol
    const net = await import('node:net');
    this.ws = net.createConnection(this.wsPort, this.wsHost, () => {
      // Perform WebSocket upgrade
      const key = randomUUID().replace(/-/g, '').slice(0, 16);
      const keyEncoded = Buffer.from(key).toString('base64');
      const upgrade = [
        `GET ${this.wsPath} HTTP/1.1`,
        `Host: ${this.wsHost}:${this.wsPort}`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Key: ${keyEncoded}`,
        `Sec-WebSocket-Version: 13`,
        ``,
        ``,
      ].join('\r\n');
      this.ws!.write(upgrade);
    });

    return new Promise((resolve, reject) => {
      let upgraded = false;

      this.ws!.on('data', (data: Buffer) => {
        if (!upgraded) {
          const response = data.toString('utf-8');
          if (response.includes('101 Switching Protocols')) {
            upgraded = true;
            this.connected = true;
            logger.info('CDP WebSocket connected');
            resolve();
          } else {
            reject(new Error(`WebSocket upgrade failed: ${response.slice(0, 100)}`));
          }
          return;
        }

        // Parse WebSocket frames (text frames only, unmasked server frames)
        let offset = 0;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

        while (offset < buf.length) {
          // Minimum frame size is 2 bytes
          if (offset + 2 > buf.length) break;

          const firstByte = buf[offset]!;
          const secondByte = buf[offset + 1]!;
          const opcode = firstByte & 0x0f;
          const masked = (secondByte & 0x80) !== 0;
          let payloadLen = secondByte & 0x7f;
          let headerLen = 2;

          if (payloadLen === 126) {
            if (offset + 4 > buf.length) break;
            payloadLen = buf.readUInt16BE(offset + 2);
            headerLen = 4;
          } else if (payloadLen === 127) {
            if (offset + 10 > buf.length) break;
            payloadLen = Number(buf.readBigUInt64BE(offset + 2));
            headerLen = 10;
          }

          const maskLen = masked ? 4 : 0;
          const totalLen = headerLen + maskLen + payloadLen;

          if (offset + totalLen > buf.length) break;

          // Read payload
          let payloadStart = offset + headerLen + maskLen;
          let payload: Buffer;
          if (masked) {
            const mask = buf.slice(offset + headerLen, offset + headerLen + 4);
            payload = Buffer.alloc(payloadLen);
            for (let i = 0; i < payloadLen; i++) {
              payload[i] = buf[payloadStart + i]! ^ mask[i % 4]!;
            }
          } else {
            payload = buf.slice(payloadStart, payloadStart + payloadLen);
          }

          if (opcode === 0x1 || opcode === 0x2) {
            // Text or binary frame
            const text = payload.toString('utf-8');
            this.handleMessage(text);
          } else if (opcode === 0x9) {
            // Ping — send pong
            const pong = Buffer.alloc(2);
            pong[0] = 0x8a; // FIN + opcode 0xA (pong)
            pong[1] = 0x00;
            this.ws?.write(pong);
          }

          offset += totalLen;
        }
      });

      this.ws!.on('error', (err: Error) => {
        logger.error({ error: err.message }, 'CDP WebSocket error');
        if (!upgraded) reject(err);
      });

      this.ws!.on('close', () => {
        this.connected = false;
        this.emit('close');
      });

      setTimeout(() => {
        if (!upgraded) reject(new Error('CDP connection timeout'));
      }, 10000);
    });
  }

  private handleMessage(text: string): void {
    try {
      const msg = JSON.parse(text);
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          } else {
            pending.resolve(msg.result);
          }
        }
      } else if (msg.method) {
        this.emit(msg.method, msg.params);
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || !this.connected) {
      throw new Error('CDP not connected');
    }

    const id = ++this.requestId;
    const payload = Buffer.from(JSON.stringify({ id, method, params: params ?? {} }), 'utf-8');

    // Build WebSocket frame (masked client → server)
    const mask = Buffer.alloc(4);
    for (let i = 0; i < 4; i++) mask[i] = Math.floor(Math.random() * 256);

    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81; // FIN + text opcode
      header[1] = 0x80 | payload.length; // MASK + length
      header[2] = mask[0]!;
      header[3] = mask[1]!;
      header[4] = mask[2]!;
      header[5] = mask[3]!;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      header[4] = mask[0]!;
      header[5] = mask[1]!;
      header[6] = mask[2]!;
      header[7] = mask[3]!;
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      header[10] = mask[0]!;
      header[11] = mask[1]!;
      header[12] = mask[2]!;
      header[13] = mask[3]!;
    }

    // Mask the payload
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i]! ^ mask[i % 4]!;
    }

    const frame = Buffer.concat([header, masked]);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject: reject as (e: Error) => void,
      });
      this.ws!.write(frame);

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  close(): void {
    // Send close frame
    if (this.ws) {
      const closeFrame = Buffer.alloc(2);
      closeFrame[0] = 0x88; // FIN + close opcode
      closeFrame[1] = 0x00;
      try {
        this.ws.write(closeFrame);
      } catch {
        /* ignore */
      }
      this.ws.end();
      this.ws.destroy();
    }
    this.connected = false;
  }
}

// ─── Chrome Process Manager ──────────────────────────────────────

let chromeProcess: ChildProcess | null = null;
let chromePort = 0;

async function findChromeBinary(): Promise<string> {
  const candidates = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  for (const c of candidates) {
    try {
      execSync(`command -v "${c}" 2>/dev/null || which "${c}" 2>/dev/null`, {
        stdio: 'ignore',
        timeout: 3000,
      });
      return c;
    } catch {
      continue;
    }
  }

  // Default fallback
  return 'google-chrome';
}

async function launchChrome(headless: boolean, userPort?: number): Promise<number> {
  const port = userPort ?? 9222;
  const logger = getLogger();

  // Check if Chrome is already running with debug port
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (resp.ok) {
      logger.info({ port }, 'CDP Engine: Reusing existing Chrome instance');
      chromePort = port;
      return port;
    }
  } catch {
    // No existing instance
  }

  // Find and launch Chrome
  const chromeBin = await findChromeBinary();

  const args = [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,720',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  chromeProcess = spawn(chromeBin, args, { stdio: 'ignore' });
  chromePort = port;
  logger.info({ port, chromeBin }, 'CDP Engine: Chrome launched');

  // Wait for Chrome to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) {
        logger.info({ port }, 'CDP Engine: Chrome ready');
        return port;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error('Chrome did not become ready within 15 seconds');
}

function cleanupChrome(): void {
  if (chromeProcess) {
    try {
      chromeProcess.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    chromeProcess = null;
  }
}

// ─── The rest of the file stays the same (CDPBrowserSession, CDPInstance, CDPObserverEngine) ─

// ─── CDP Browser Session ─────────────────────────────────────────

class CDPBrowserSession implements BrowserSession {
  readonly id: string;
  readonly type: BrowserType = 'chromium';
  private client: CDPClient;
  private targetId: string;
  private currentUrl = 'about:blank';
  private _consoleCallbacks: Array<(event: ConsoleEvent) => void> = [];
  private _networkCallbacks: Array<(event: NetworkEvent) => void> = [];

  constructor(client: CDPClient, targetId: string) {
    this.id = `cdp_${randomUUID().slice(0, 8)}`;
    this.client = client;
    this.targetId = targetId;

    // Subscribe to console events
    this.client.on('Runtime.consoleAPICalled', (params: any) => {
      const args = params.args?.map((a: any) => a.value ?? a.description ?? '').join(' ') ?? '';
      const level =
        params.type === 'error'
          ? 'error'
          : params.type === 'warning'
            ? 'warn'
            : params.type === 'info'
              ? 'info'
              : 'log';

      const event: ConsoleEvent = {
        level: level as ConsoleEvent['level'],
        message: args,
        source: params.stackTrace?.callFrames?.[0]?.url ?? 'unknown',
        timestamp: new Date().toISOString(),
      };

      for (const cb of this._consoleCallbacks) cb(event);
    });

    // Subscribe to network events
    this.client.on('Network.responseReceived', (params: any) => {
      const req = params.response;
      const event: NetworkEvent = {
        requestId: params.requestId,
        method: req.requestHeaders?.method ?? 'GET',
        url: req.url,
        status: req.status,
        statusText: req.statusText,
        duration: req.timing?.receiveHeadersEnd ?? 0,
        timestamp: new Date().toISOString(),
        type: req.type?.toLowerCase() ?? 'other',
      };

      for (const cb of this._networkCallbacks) cb(event);
    });
  }

  // ── Navigation ──

  async navigate(url: string, options?: NavigateOptions): Promise<NavigationResult> {
    const startTime = Date.now();
    const result = await this.client.send<any>('Page.navigate', { url });
    this.currentUrl = url;

    // Wait for load
    if (options?.waitUntil !== 'commit') {
      await this.waitForLoadState(options?.waitUntil ?? 'load', { timeout: options?.timeout });
    }

    return {
      finalUrl: result.url ?? url,
      statusCode: 200,
      loadTimeMs: Date.now() - startTime,
    };
  }

  async goBack(): Promise<void> {
    await this.client.send('Page.navigateToHistoryEntry', { entryId: -1 });
  }

  async goForward(): Promise<void> {
    await this.client.send('Page.navigateToHistoryEntry', { entryId: 1 });
  }

  async reload(options?: { waitUntil?: LoadEvent }): Promise<void> {
    await this.client.send('Page.reload');
    if (options?.waitUntil !== 'commit') {
      await this.waitForTimeout(2000);
    }
  }

  // ── URL & State ──

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    try {
      return await this.client
        .send<string>('Runtime.evaluate', {
          expression: 'document.title',
          returnByValue: true,
        })
        .then((r: any) => r.result?.value ?? '');
    } catch {
      return '';
    }
  }

  async readyState(): Promise<string> {
    try {
      const r = await this.client.send<any>('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      return r.result?.value ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  viewportSize(): { width: number; height: number } | null {
    return { width: 1280, height: 720 };
  }

  isClosed(): boolean {
    return false;
  }

  async close(): Promise<void> {
    try {
      await this.client.send('Page.close');
    } catch {
      /* ignore */
    }
  }

  async bringToFront(): Promise<void> {
    try {
      await this.client.send('Page.bringToFront');
    } catch {
      /* ignore */
    }
  }

  async rotateContext(): Promise<void> {
    // CDP sessions attach to an existing browser target; there is no
    // Fennec-owned BrowserContext to recycle. Rotation is a no-op here.
  }

  // ── Element Discovery (minimal — only via evaluate) ──

  async $(selector: string): Promise<ElementHandle | null> {
    // CDP cannot return element handles like Playwright
    // Use evaluate to check existence instead
    const exists = await this.client.send<any>('Runtime.evaluate', {
      expression: `!!document.querySelector('${selector.replace(/'/g, "\\'")}')`,
      returnByValue: true,
    });
    return exists?.result?.value
      ? { boundingBox: async () => null, click: async () => {}, $: async () => null }
      : null;
  }

  async $$(selector: string): Promise<ElementHandle[]> {
    return [];
  }

  async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
    const timeout = options?.timeout ?? 10000;
    const state = options?.state ?? 'visible';
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await this.client.send<any>('Runtime.evaluate', {
        expression: `(function() {
          const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!el) return 'not_found';
          if ('${state}' === 'visible') {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' ? 'found' : 'hidden';
          }
          if ('${state}' === 'attached') return 'found';
          if ('${state}' === 'hidden') {
            const style = window.getComputedStyle(el);
            return style.display === 'none' || style.visibility === 'hidden' ? 'found' : 'visible';
          }
          return 'found';
        })()`,
        returnByValue: true,
      });

      if (result?.result?.value === 'found') return;
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`Element not found: ${selector} (state: ${state}, timeout: ${timeout}ms)`);
  }

  async waitForURL(
    urlOrFn: string | ((url: string) => boolean),
    options?: { timeout?: number },
  ): Promise<void> {
    const timeout = options?.timeout ?? 10000;
    const start = Date.now();
    const predicate = typeof urlOrFn === 'string' ? (u: string) => u.includes(urlOrFn) : urlOrFn;

    while (Date.now() - start < timeout) {
      const url = await this.title().catch(() => '');
      if (predicate(this.currentUrl)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async waitForLoadState(state?: LoadEvent, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const rs = await this.readyState();
      if (state === 'networkidle') {
        if (rs === 'complete') {
          // Additional wait for network idle
          await this.waitForTimeout(1000);
          return;
        }
      } else if (state === 'load' || state === 'domcontentloaded') {
        if (rs === 'complete' || rs === 'interactive') return;
      } else if (state === 'commit') {
        return;
      } else {
        if (rs === 'complete') return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async waitForRequest(
    urlOrPredicate: string | ((req: { url: () => string; method: () => string }) => boolean),
    options?: { timeout?: number },
  ): Promise<any> {
    throw new Error(
      'waitForRequest not supported in CDP Observer mode. Use PlaywrightAdapter for this feature.',
    );
  }

  // ── JavaScript Execution ──

  async evaluate<T = unknown>(
    fn: string | ((...args: any[]) => T),
    ...args: unknown[]
  ): Promise<T> {
    if (typeof fn === 'string') {
      const result = await this.client.send<any>('Runtime.evaluate', {
        expression: fn,
        returnByValue: true,
        awaitPromise: true,
      });
      return result?.result?.value as T;
    }

    // For function evaluation, serialize and inject
    const fnStr = fn.toString();
    const serializedArgs = args.map((a) => JSON.stringify(a)).join(',');
    const expression = `(${fnStr})(${serializedArgs})`;

    const result = await this.client.send<any>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Evaluation error');
    }

    return result?.result?.value as T;
  }

  // ── Locator ──

  locator(_selector: string): Locator {
    throw new Error('Locator not supported in CDP Observer mode. Use evaluate() for DOM queries.');
  }

  // ── Screenshot ──

  async screenshot(options?: ScreenshotOpts): Promise<Buffer> {
    const format = options?.type ?? 'png';
    const params: Record<string, unknown> = { format };
    if (format === 'jpeg' && options?.quality != null) {
      params.quality = options.quality;
    }
    if (options?.fullPage) {
      // Get full page dimensions
      const { result } = await this.client.send<any>('Runtime.evaluate', {
        expression:
          'JSON.stringify({width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth), height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})',
        returnByValue: true,
      });
      const dims = JSON.parse(result?.value ?? '{}');
      params.width = dims.width ?? 1280;
      params.height = dims.height ?? 720;
    }

    const result = await this.client.send<any>('Page.captureScreenshot', params);
    if (result?.data) {
      return Buffer.from(result.data, 'base64');
    }
    throw new Error('Screenshot capture failed');
  }

  // ── Network Interception (not supported in observer mode) ──

  async route(_urlPattern: string, _handler: (route: Route) => Promise<void>): Promise<void> {
    throw new Error(
      'Network interception not supported in CDP Observer mode. Use PlaywrightAdapter.',
    );
  }

  async unroute(_urlPattern: string): Promise<void> {
    throw new Error('Network interception not supported in CDP Observer mode.');
  }

  // ── Keyboard ──

  async keyboardPress(_key: string, _options?: { modifiers?: string[] }): Promise<void> {
    throw new Error('Keyboard input not supported in CDP Observer mode. Use PlaywrightAdapter.');
  }

  // ── CDP Access ──

  cdp(): BrowserCDPSession {
    return {
      send: <T>(method: string, params?: Record<string, unknown>) =>
        this.client.send<T>(method, params),
      on: (event: string, handler: (params: unknown) => void) => this.client.on(event, handler),
      off: (event: string, handler: (params: unknown) => void) => this.client.off(event, handler),
    };
  }

  // ── Context-level operations ──

  async contextCookies(): Promise<import('./types.js').Cookie[]> {
    try {
      const result = await this.client.send<any>('Network.getAllCookies');
      return (result?.cookies ?? []).map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: (c.sameSite ?? 'Lax') as 'Strict' | 'Lax' | 'None',
        expires: c.expires ?? undefined,
      }));
    } catch {
      return [];
    }
  }

  async contextAddCookies(cookies: CookieInput[]): Promise<void> {
    await this.client.send('Network.setCookies', { cookies: cookies as any });
  }

  async contextClearCookies(): Promise<void> {
    await this.client.send('Network.clearBrowserCookies');
  }

  async contextNewPage(): Promise<BrowserSession> {
    throw new Error('Multi-page not supported in CDP Observer mode.');
  }

  contextPages(): BrowserSession[] {
    return [this];
  }

  // ── Events ──

  onConsole(callback: (event: ConsoleEvent) => void): () => void {
    this._consoleCallbacks.push(callback);
    // Enable console
    this.client.send('Runtime.enable').catch(() => {});
    this.client.send('Console.enable').catch(() => {});
    return () => {
      this._consoleCallbacks = this._consoleCallbacks.filter((c) => c !== callback);
    };
  }

  onNetworkRequest(callback: (event: NetworkEvent) => void): () => void {
    this._networkCallbacks.push(callback);
    // Enable network
    this.client.send('Network.enable').catch(() => {});
    return () => {
      this._networkCallbacks = this._networkCallbacks.filter((c) => c !== callback);
    };
  }
}

// ─── CDP Instance ────────────────────────────────────────────────

class CDPInstance implements BrowserInstance {
  readonly type: BrowserType = 'chromium';
  private client: CDPClient;
  private targetId: string;

  constructor(client: CDPClient, targetId: string) {
    this.client = client;
    this.targetId = targetId;
  }

  async createSession(_options?: BrowserSessionOptions): Promise<BrowserSession> {
    return new CDPBrowserSession(this.client, this.targetId);
  }

  async close(): Promise<void> {
    cleanupChrome();
  }
}

// ─── CDP Engine Factory ──────────────────────────────────────────

export class CDPObserverEngine implements BrowserEngine {
  readonly type: BrowserType = 'chromium';

  async launch(options: BrowserLaunchOptions): Promise<BrowserInstance> {
    const port = await launchChrome(options.headless, 9222);
    const client = new CDPClient();
    await client.connect('127.0.0.1', port);

    // Get available targets and create a page target
    const targets = await client.send<any[]>('Target.getTargets');
    let targetId: string | null = null;

    // Reuse existing page if available
    for (const t of targets ?? []) {
      if (t.type === 'page' && t.url !== 'about:blank') {
        targetId = t.targetId;
        break;
      }
    }

    // Create new page if needed
    if (!targetId) {
      const result = await client.send<any>('Target.createTarget', {
        url: 'about:blank',
        width: 1280,
        height: 720,
      });
      targetId = result.targetId;
    }

    // Attach to the target
    await client.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });

    // Enable necessary domains
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('DOM.enable').catch(() => {});

    return new CDPInstance(client, targetId!);
  }
}
