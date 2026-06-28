import type { Browser, BrowserContext, Page, CDPSession } from "playwright";

export interface ConsoleEvent {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  source: string;
  timestamp: string;
  stackTrace?: string[];
}

export interface NetworkEvent {
  requestId: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timestamp: string;
  type: "fetch" | "xhr" | "document" | "stylesheet" | "script" | "image" | "font" | "other";
}

export interface FennecSession {
  id: string;
  name?: string;
  createdAt: Date;
  lastUsedAt: Date;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdpSession: CDPSession;
  consoleBuffer: ConsoleEvent[];
  networkBuffer: NetworkEvent[];
  metadata: {
    tags?: string[];
    savedStatePath?: string;
    linkedProcessId?: string;
  };
}

export interface SessionConfig {
  maxSessions: number;
  idleTimeoutSecs: number;
  persistPath: string;
}

export interface SessionMeta {
  elapsed: number;
  sessionId: string;
  timestamp: string;
}
