import pino from "pino";

let loggerInstance: pino.Logger | null = null;

export interface LoggerConfig {
  level?: "debug" | "info" | "warn" | "error";
  format?: "pretty" | "json";
  file?: string | null;
}

/**
 * Create a pino logger instance.
 * 
 * ⚠️ CRITICAL for MCP stdio transport:
 * All logging MUST go to stderr (file descriptor 2), NOT stdout (fd 1).
 * stdout is reserved exclusively for JSON-RPC MCP messages.
 * Writing anything to stdout will corrupt the MCP protocol communication.
 */
export function createLogger(config: LoggerConfig = {}): pino.Logger {
  const level = config.level ?? "info";
  const format = config.format ?? "pretty";

  // For MCP compatibility: always use stderr (fd 2) for logging
  // stdout (fd 1) is reserved for JSON-RPC messages only
  if (format === "pretty") {
    loggerInstance = pino({
      level,
      transport: {
        target: "pino/file",
        options: { destination: config.file ?? 2 }, // stderr
      },
    });
  } else {
    loggerInstance = pino({
      level,
      ...(config.file ? { destination: config.file } : { destination: 2 }), // stderr
    });
  }

  return loggerInstance;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

export function setLogger(logger: pino.Logger): void {
  loggerInstance = logger;
}
