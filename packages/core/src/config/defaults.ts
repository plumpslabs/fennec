import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Global store base: FENNEC_HOME | FENNEC_DATA_DIR | ~/.fennec (matches process tracking). */
const STORE_BASE = resolve(
  process.env.FENNEC_HOME ?? process.env.FENNEC_DATA_DIR ?? homedir(),
  '.fennec',
);

/**
 * Pure dev-tool websocket noise that should never be treated as a page error.
 * Vite (and similar dev servers) log an error when the HMR websocket can't
 * connect (e.g. insecure ws on https, or ws upgrade refused). These are
 * dev-only artifacts, not application bugs. Applied by default on top of any
 * user-supplied `console.ignorePatterns`.
 */
export const DEFAULT_CONSOLE_IGNORE_PATTERNS: string[] = [
  'failed to connect to websocket',
  'insecure websocket connection',
  'websocket connection to',
  'hot update failed',
  'hmr update failed',
];

export interface FennecConfig {
  browser: {
    adapter: 'auto' | 'cdp' | 'playwright';
    type: 'chromium' | 'firefox' | 'webkit';
    headless: boolean;
    slowMo: number;
    defaultTimeout: number;
    viewport: { width: number; height: number };
    userAgent: string | null;
    locale: string;
    timezone: string;
    ignoreHTTPSErrors: boolean;
  };
  session: {
    maxSessions: number;
    idleTimeoutSecs: number;
    maxSessionAgeSecs: number;
    rotationIntervalSecs: number;
    persistPath: string;
  };
  process: {
    maxProcesses: number;
    logBufferLines: number;
    spawnAllowlist: string[];
  };
  terminal: {
    logBufferLines: number;
    watchDebounceMs: number;
  };
  network: {
    bufferSize: number;
    captureRequestBody: boolean;
    captureResponseBody: boolean;
    captureHeaders: boolean;
    slowRequestThresholdMs: number;
  };
  console: {
    bufferSize: number;
    levels: string[];
    /**
     * Console message patterns to silently ignore. Matches are dropped before they
     * reach the console buffer, pulse status, or incident engine — so benign dev
     * noise (e.g. Vite HMR websocket errors) never flips the page status to
     * `error` or triggers a false-positive incident. Strings are treated as
     * case-insensitive substring matches; wrap in `/.../` for regex.
     */
    ignorePatterns?: string[];
  };
  correlation: {
    windowMs: number;
    enableRootCauseInference: boolean;
    minConfidence: number;
  };
  lazyContext: {
    level1: boolean;
    level2: boolean;
    level3: boolean;
  };
  tokenBudget: {
    /** Max tokens per tool response (default: 8000). Responses exceeding this are truncated. */
    maxResponseTokens: number;
    /** Max tokens for LazyContext Level 1 summary */
    level1MaxTokens: number;
    /** Max tokens for LazyContext Level 2 detail */
    level2MaxTokens: number;
    /** Max tokens for LazyContext Level 3 raw data */
    level3MaxTokens: number;
    /** Max tokens for debug tool responses (default: 2000). Truncated if exceeded. */
    debugMaxTokens?: number;
    /** Max variables per scope snapshot (default: 20) */
    debugMaxVariables?: number;
    /** Max stack frames per trace (default: 10) */
    debugMaxStackFrames?: number;
  };
  debug?: {
    /** Allow debug features globally. Default: false */
    allowDebug: boolean;
    /** Allow expression evaluation in breakpoint context (high risk). Default: false */
    allowDebugEval: boolean;
    /** Restrict breakpoints to only these directories. Empty = no restriction */
    allowedDirs?: string[];
    /** Allow breakpoints in dependency directories (node_modules, .venv, etc). Default: false */
    allowDependencies: boolean;
  };
  security: {
    sandbox: boolean;
    readOnly: boolean;
    allowProcessSpawn: boolean;
    allowProcessKill: boolean;
    allowedDomains: string[];
    blockedDomains: string[];
    allowFileProtocol: boolean;
    allowCDPRawAccess: boolean;
    allowJSEvaluation: boolean;
    exportPath: string;
    maxExportSizeMB: number;
  };
  transport: {
    type: 'stdio' | 'sse';
    port: number;
    host: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'pretty' | 'json';
    file: string | null;
  };
  db: {
    strict: boolean;
    allowedHosts: string[];
    maxRows: number;
    queryTimeout: number;
    allowWrite: boolean;
    binaryPath: string;
  };
}

export const defaultConfig: FennecConfig = {
  browser: {
    adapter: 'auto',
    type: 'chromium',
    headless: true,
    slowMo: 0,
    defaultTimeout: 30000,
    viewport: { width: 1280, height: 720 },
    userAgent: null,
    locale: 'en-US',
    timezone: 'Asia/Jakarta',
    ignoreHTTPSErrors: false,
  },
  session: {
    maxSessions: 10,
    idleTimeoutSecs: 1800,
    maxSessionAgeSecs: 0,
    rotationIntervalSecs: 0,
    persistPath: resolve(STORE_BASE, 'sessions'),
  },
  process: {
    maxProcesses: 10,
    logBufferLines: 2000,
    spawnAllowlist: ['npm', 'node', 'pnpm', 'yarn', 'bun', 'python', 'python3'],
  },
  terminal: {
    logBufferLines: 2000,
    watchDebounceMs: 50,
  },
  network: {
    bufferSize: 1000,
    captureRequestBody: true,
    captureResponseBody: true,
    captureHeaders: true,
    slowRequestThresholdMs: 2000,
  },
  console: {
    bufferSize: 500,
    levels: ['log', 'info', 'warn', 'error', 'debug'],
    ignorePatterns: [...DEFAULT_CONSOLE_IGNORE_PATTERNS],
  },
  correlation: {
    windowMs: 500,
    enableRootCauseInference: true,
    minConfidence: 0.7,
  },
  lazyContext: {
    level1: true,
    level2: false,
    level3: false,
  },
  tokenBudget: {
    maxResponseTokens: 8000,
    level1MaxTokens: 100,
    level2MaxTokens: 500,
    level3MaxTokens: 2000,
    debugMaxTokens: 2000,
    debugMaxVariables: 20,
    debugMaxStackFrames: 10,
  },
  debug: {
    allowDebug: false,
    allowDebugEval: false,
    allowedDirs: [],
    allowDependencies: false,
  },
  security: {
    sandbox: true,
    readOnly: false,
    allowProcessSpawn: true,
    allowProcessKill: false,
    allowedDomains: [],
    blockedDomains: [],
    allowFileProtocol: false,
    allowCDPRawAccess: false,
    allowJSEvaluation: true,
    exportPath: resolve(STORE_BASE, 'exports'),
    maxExportSizeMB: 10,
  },
  transport: {
    type: 'stdio',
    port: 3333,
    host: '127.0.0.1',
  },
  logging: {
    level: 'info',
    format: 'pretty',
    file: null,
  },
  db: {
    strict: true,
    allowedHosts: ['localhost', '127.0.0.1', '::1'],
    maxRows: 1000,
    queryTimeout: 30000,
    allowWrite: false,
    binaryPath: '',
  },
};
