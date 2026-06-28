import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page, type CDPSession } from "playwright";
import { randomUUID } from "node:crypto";
import { getLogger } from "../utils/logger.js";
import type { FennecSession, ConsoleEvent, NetworkEvent, SessionMeta } from "./types.js";
import { SessionStore } from "./SessionStore.js";
import type { FennecConfig } from "../config/defaults.js";

export class SessionManager {
  private sessions: Map<string, FennecSession> = new Map();
  private defaultSessionId: string | null = null;
  private config: FennecConfig;
  private store: SessionStore;
  private browser: Browser | null = null;

  constructor(config: FennecConfig) {
    this.config = config;
    this.store = new SessionStore(config.session.persistPath);
  }

  async initialize(): Promise<void> {
    const logger = getLogger();
    logger.info("Initializing Fennec session manager");

    const browserType = this.config.browser.type;
    const browserOptions = {
      headless: this.config.browser.headless,
      slowMo: this.config.browser.slowMo,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ignoreHTTPSErrors: this.config.browser.ignoreHTTPSErrors,
    };

    switch (browserType) {
      case "chromium":
        this.browser = await chromium.launch(browserOptions);
        break;
      case "firefox":
        this.browser = await firefox.launch(browserOptions);
        break;
      case "webkit":
        this.browser = await webkit.launch(browserOptions);
        break;
    }

    // Create default session
    await this.createDefaultSession();
  }

  private async createDefaultSession(): Promise<FennecSession> {
    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    const context = await this.browser.newContext({
      viewport: this.config.browser.viewport,
      locale: this.config.browser.locale,
      timezoneId: this.config.browser.timezone,
      userAgent: this.config.browser.userAgent ?? undefined,
    });

    const page = await context.newPage();
    const cdpSession = await context.newCDPSession(page);

    const session: FennecSession = {
      id: `sess_${randomUUID().slice(0, 8)}`,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      browser: this.browser,
      context,
      page,
      cdpSession,
      consoleBuffer: [],
      networkBuffer: [],
      metadata: {},
    };

    this.sessions.set(session.id, session);
    this.defaultSessionId = session.id;
    return session;
  }

  async createSession(name?: string): Promise<FennecSession> {
    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    // Check max sessions
    if (this.sessions.size >= this.config.session.maxSessions) {
      // Auto-cleanup oldest idle session
      await this.cleanupIdleSessions();
    }

    const context = await this.browser.newContext({
      viewport: this.config.browser.viewport,
      locale: this.config.browser.locale,
      timezoneId: this.config.browser.timezone,
    });

    const page = await context.newPage();
    const cdpSession = await context.newCDPSession(page);

    const session: FennecSession = {
      id: `sess_${randomUUID().slice(0, 8)}`,
      name,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      browser: this.browser,
      context,
      page,
      cdpSession,
      consoleBuffer: [],
      networkBuffer: [],
      metadata: {},
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id?: string): FennecSession {
    const sessionId = id ?? this.defaultSessionId;
    const session = this.sessions.get(sessionId!);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.lastUsedAt = new Date();
    return session;
  }

  getOrDefault(id?: string): FennecSession {
    try {
      return this.getSession(id);
    } catch {
      return this.getSession(this.defaultSessionId!);
    }
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    try {
      await session.page.close();
      await session.context.close();
    } catch {
      // Ignore cleanup errors
    }

    this.sessions.delete(id);

    if (this.defaultSessionId === id) {
      this.defaultSessionId = null;
    }
  }

  async destroyAll(): Promise<void> {
    for (const [id] of this.sessions) {
      await this.destroySession(id);
    }
  }

  listSessions(): Array<{ id: string; name?: string; createdAt: Date; lastUsedAt: Date }> {
    const list: Array<{ id: string; name?: string; createdAt: Date; lastUsedAt: Date }> = [];
    for (const [id, session] of this.sessions) {
      list.push({
        id,
        name: session.name,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
      });
    }
    return list;
  }

  addConsoleEvent(sessionId: string, event: ConsoleEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.consoleBuffer.push(event);
    if (session.consoleBuffer.length > this.config.console.bufferSize) {
      session.consoleBuffer.shift();
    }
  }

  addNetworkEvent(sessionId: string, event: NetworkEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.networkBuffer.push(event);
    if (session.networkBuffer.length > this.config.network.bufferSize) {
      session.networkBuffer.shift();
    }
  }

  getConsoleBuffer(sessionId: string, options?: { level?: string; limit?: number; since?: string; keyword?: string }): ConsoleEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    let logs = session.consoleBuffer;

    if (options?.level) {
      logs = logs.filter((l) => l.level === options.level);
    }
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() > sinceTime);
    }
    if (options?.keyword) {
      const kw = options.keyword.toLowerCase();
      logs = logs.filter((l) => l.message.toLowerCase().includes(kw));
    }

    if (options?.limit && options.limit > 0) {
      logs = logs.slice(-options.limit);
    }

    return logs;
  }

  clearConsoleBuffer(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    const count = session.consoleBuffer.length;
    session.consoleBuffer = [];
    return count;
  }

  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const idleTimeout = this.config.session.idleTimeoutSecs * 1000;

    for (const [id, session] of this.sessions) {
      if (id === this.defaultSessionId) continue;
      if (now - session.lastUsedAt.getTime() > idleTimeout) {
        await this.destroySession(id);
      }
    }
  }

  buildMeta(session: FennecSession | { id: string }): SessionMeta {
    return {
      elapsed: 0,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    };
  }

  buildError(
    error: unknown,
    session?: FennecSession | null,
    options?: { suggestions?: string[]; context?: Record<string, unknown> },
  ): { success: false; error: { code: string; message: string; suggestions: string[]; context: Record<string, unknown> }; meta: SessionMeta } {
    const err = error instanceof Error ? error : new Error(String(error));
    const meta = session ? this.buildMeta(session) : { elapsed: 0, sessionId: "", timestamp: new Date().toISOString() };

    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: err.message,
        suggestions: options?.suggestions ?? [],
        context: options?.context ?? {},
      },
      meta,
    };
  }

  async close(): Promise<void> {
    await this.destroyAll();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
