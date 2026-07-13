import type { BrowserSession } from "../browser/types.js";

export interface ConsoleEvent {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  source: string;
  timestamp: string;
  stackTrace?: string[];
}

export interface NetworkTiming {
  /** CDP requestTime — base timestamp for all relative timing values (seconds since epoch) */
  requestTime: number;
  /** DNS lookup duration (ms) */
  dns: number;
  /** TCP connection duration (ms) */
  tcp: number;
  /** SSL/TLS handshake duration (ms) */
  ssl: number;
  /** Time to First Byte (ms) — from request start to first byte received */
  ttfb: number;
  /** Content download duration (ms) — calculated from loadingFinished */
  contentDownload: number;
  /** Total request duration (ms) — from request start to loading finished */
  total: number;
  /** Connection queuing time (ms) — before DNS starts */
  queuing: number;
  /** Request sending time (ms) — from sendStart to sendEnd */
  sending: number;
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
  /** Detailed timing breakdown (waterfall) — available when CDP timing data is captured */
  timing?: NetworkTiming;
}

export interface FennecSession {
  id: string;
  name?: string;
  createdAt: Date;
  lastUsedAt: Date;
  /** Epoch ms of the last context rotation — used by SessionManager for periodic rotation */
  lastRotatedAt?: number;
  /** Browser session abstraction — engine-agnostic */
  browser: BrowserSession;
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
