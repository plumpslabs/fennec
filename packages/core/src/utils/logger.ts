/**
 * Zero-dependency logger for Fennec.
 *
 * ⚠️ CRITICAL for MCP stdio transport:
 * All logging MUST go to stderr (file descriptor 2), NOT stdout (fd 1).
 * stdout is reserved exclusively for JSON-RPC MCP messages.
 * Writing anything to stdout will corrupt the MCP protocol communication.
 */

import { appendFileSync } from "node:fs";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_NUM: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface FennecLogger {
  level: LogLevel;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): FennecLogger;
}

export interface LoggerConfig {
  level?: LogLevel;
  format?: "pretty" | "json";
  file?: string | null;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, obj: unknown, msg?: string): string {
  const ts = formatTimestamp();
  let extra = "";
  if (obj && typeof obj === "object" && obj !== null && !(obj instanceof Error)) {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length > 0) {
      try {
        extra = " " + JSON.stringify(obj);
      } catch {
        extra = " [object]";
      }
    }
  } else if (obj instanceof Error) {
    extra = ` ${obj.message}\n${obj.stack ?? ""}`;
  } else if (obj !== undefined) {
    extra = ` ${String(obj)}`;
  }
  return `${ts} [${level.toUpperCase()}]${extra}${msg ? " " + msg : ""}\n`;
}

function formatMessageJson(level: LogLevel, obj: unknown, msg?: string): string {
  const entry: Record<string, unknown> = {
    time: Date.now(),
    level: level === "error" ? 50 : level === "warn" ? 40 : level === "info" ? 30 : 20,
    msg: msg ?? "",
  };
  if (obj && typeof obj === "object" && obj !== null) {
    const keys = Object.keys(obj as Record<string, unknown>);
    // Spread object properties into the log entry
    if (!(obj instanceof Error)) {
      Object.assign(entry, obj);
    } else {
      entry.err = { message: (obj as Error).message, stack: (obj as Error).stack };
    }
  } else if (obj !== undefined) {
    entry.extra = obj;
  }
  return JSON.stringify(entry) + "\n";
}

function createWriteStream(target: number | string): (chunk: string) => void {
  if (typeof target === "number") {
    // fd number — synchronous write via process.binding (avoids async I/O mixing)
    return (chunk: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process as any).binding("fs").write(target, Buffer.from(chunk), 0, chunk.length, null);
      } catch {
        // Fallback
        process.stderr.write(chunk);
      }
    };
  }
  // File path — use fs.appendFileSync (imported at top level for ESM compat)
  return (chunk: string) => {
    try {
      appendFileSync(target, chunk, "utf-8");
    } catch {
      process.stderr.write(chunk);
    }
  };
}

let loggerInstance: FennecLogger | null = null;

export function createLogger(config: LoggerConfig = {}): FennecLogger {
  const level = config.level ?? ("info" as LogLevel);
  const format = config.format ?? "pretty";
  const destination = config.file ?? 2; // default to stderr

  const write = createWriteStream(destination);

  const formatter = format === "json" ? formatMessageJson : formatMessage;

  const makeLogFn =
    (lvl: LogLevel) =>
    (obj: unknown, msg?: string): void => {
      if (LEVEL_NUM[lvl] < LEVEL_NUM[level]) return;
      write(formatter(lvl, obj, msg));
    };

  const baseLogger: FennecLogger = {
    level,
    debug: makeLogFn("debug"),
    info: makeLogFn("info"),
    warn: makeLogFn("warn"),
    error: makeLogFn("error"),
    child(bindings: Record<string, unknown>): FennecLogger {
      const prefix = Object.entries(bindings)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
      return {
        ...baseLogger,
        debug: (obj, msg) => makeLogFn("debug")(obj, msg ? `[${prefix}] ${msg}` : `[${prefix}]`),
        info: (obj, msg) => makeLogFn("info")(obj, msg ? `[${prefix}] ${msg}` : `[${prefix}]`),
        warn: (obj, msg) => makeLogFn("warn")(obj, msg ? `[${prefix}] ${msg}` : `[${prefix}]`),
        error: (obj, msg) => makeLogFn("error")(obj, msg ? `[${prefix}] ${msg}` : `[${prefix}]`),
      };
    },
  };

  loggerInstance = baseLogger;
  return baseLogger;
}

export function getLogger(): FennecLogger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

export function setLogger(logger: FennecLogger): void {
  loggerInstance = logger;
}
