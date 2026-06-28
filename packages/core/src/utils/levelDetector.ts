export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_PATTERNS: Record<LogLevel, RegExp[]> = {
  error: [/error/i, /exception/i, /fatal/i, /uncaught/i, /unhandled/i, /✗/, /×/],
  warn: [/warn(ing)?/i, /⚠/],
  info: [/info/i, /ready/i, /listening/i, /started/i, /✓/, /✔/, /success/i, /compiled/i],
  debug: [/debug/i, /verbose/i, /trace/i, /\[dbg\]/i],
};

export function detectLogLevel(line: string): LogLevel {
  for (const [level, patterns] of Object.entries(LEVEL_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return level as LogLevel;
      }
    }
  }
  return "info";
}

export function isErrorLine(line: string): boolean {
  return detectLogLevel(line) === "error";
}
