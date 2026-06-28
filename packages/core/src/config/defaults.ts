export interface FennecConfig {
  browser: {
    type: "chromium" | "firefox" | "webkit";
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
  };
  correlation: {
    windowMs: number;
    enableRootCauseInference: boolean;
    minConfidence: number;
  };
  security: {
    sandbox: boolean;
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
    type: "stdio" | "sse";
    port: number;
    host: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    format: "pretty" | "json";
    file: string | null;
  };
}

export const defaultConfig: FennecConfig = {
  browser: {
    type: "chromium",
    headless: true,
    slowMo: 0,
    defaultTimeout: 30000,
    viewport: { width: 1280, height: 720 },
    userAgent: null,
    locale: "en-US",
    timezone: "Asia/Jakarta",
    ignoreHTTPSErrors: false,
  },
  session: {
    maxSessions: 10,
    idleTimeoutSecs: 1800,
    persistPath: "./.fennec/sessions",
  },
  process: {
    maxProcesses: 10,
    logBufferLines: 2000,
    spawnAllowlist: ["npm", "node", "pnpm", "yarn", "bun", "python", "python3"],
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
    slowRequestThresholdMs: 1000,
  },
  console: {
    bufferSize: 500,
    levels: ["log", "info", "warn", "error", "debug"],
  },
  correlation: {
    windowMs: 500,
    enableRootCauseInference: true,
    minConfidence: 0.7,
  },
  security: {
    sandbox: true,
    allowProcessSpawn: true,
    allowProcessKill: false,
    allowedDomains: [],
    blockedDomains: [],
    allowFileProtocol: false,
    allowCDPRawAccess: false,
    allowJSEvaluation: true,
    exportPath: "./.fennec/exports",
    maxExportSizeMB: 10,
  },
  transport: {
    type: "stdio",
    port: 3333,
    host: "127.0.0.1",
  },
  logging: {
    level: "info",
    format: "pretty",
    file: null,
  },
};
