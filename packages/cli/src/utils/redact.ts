/**
 * Secret redaction + log shaping for AI-safe observability.
 *
 * Logs from real apps routinely contain credentials (DB connection
 * strings, API keys, session tokens). Because fennec is designed to be
 * inspected by an AI assistant — which has a finite, precious context
 * window — leaking those into the context is both a security risk and a
 * token-waste. These helpers strip known secret shapes (best-effort, not
 * a substitute for proper secret management) and bound/shape log output
 * so AI inspection stays controlled and predictable.
 */
import { existsSync, readFileSync } from "node:fs";

export interface RedactOptions {
  /** When false, no redaction is performed (e.g. user opted out). */
  enabled?: boolean;
}

// Order matters: more specific patterns first.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  // Bearer / auth tokens
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._\-]+/gi },
  // Authorization: <scheme> <token>
  { name: "authorization", re: /\bAuthorization\s*:\s*\S+/gi },
  // Generic API keys
  { name: "apikey", re: /\b(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi },
  // AWS
  { name: "aws", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // Slack tokens
  { name: "slack", re: /\bxox[baprs]-[0-9A-Za-z\-]{10,}/g },
  // Stripe
  { name: "stripe", re: /\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{16,}\b/g },
  // JWT
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*/g },
  // Google API
  { name: "google", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  // GitHub PAT
  { name: "github", re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  // Generic long hex/alpha tokens (>=32 chars) in common contexts
  { name: "token", re: /\b(token|secret|password|passwd|pwd|client[_-]?secret)\s*[:=]\s*\S+/gi },
  // Connection strings with credentials
  { name: "connstr", re: /\b(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp|sqlserver):\/\/[^\s:]+:[^\s@]+@/gi },
  // Private key blocks
  { name: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

export function redactLine(line: string, opts: RedactOptions = {}): string {
  if (opts.enabled === false) return line;
  let out = line;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      // Keep a hint of what was redacted so logs stay debuggable.
      const head = m.slice(0, Math.min(m.length, name.length + 4));
      return `${head}…[REDACTED]`;
    });
  }
  return out;
}

/** Count how many secret matches a line would produce (for threat signal). */
export function redactionCount(line: string): number {
  let n = 0;
  for (const { re } of SECRET_PATTERNS) {
    const m = line.match(re);
    if (m) n += m.length;
  }
  return n;
}

// Strip ANSI escape sequences so AI sees plain text.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export type LogLevel = "error" | "warn" | "info" | "debug" | "other";

const LEVEL_RE: { level: LogLevel; re: RegExp }[] = [
  { level: "error", re: /\b(ERROR|FATAL|CRITICAL|EXCEPTION|UNCAUGHT)\b/i },
  { level: "warn", re: /\b(WARN|WARNING)\b/i },
  { level: "info", re: /\b(INFO|NOTICE)\b/i },
  { level: "debug", re: /\b(DEBUG|TRACE)\b/i },
];

/** Classify a log line by level (best-effort, keyword based). */
export function classifyLevel(line: string): LogLevel {
  for (const { level, re } of LEVEL_RE) {
    if (re.test(line)) return level;
  }
  if (/\b(error|fail|failed|failure|denied|reject)\b/i.test(line)) return "error";
  if (/\b(warn)\b/i.test(line)) return "warn";
  return "other";
}

export interface ReadLogOptions {
  /** Max lines to keep (token budget). Keeps the most recent. */
  tail?: number;
  /** Only include lines whose timestamp is within the last `sinceMs`. */
  sinceMs?: number;
  /** Redact secrets. */
  redact?: boolean;
  /** Parse an ISO-ish [ts] prefix at the start of a line for --since. */
  parseTimestamp?: boolean;
}

/**
 * Extract a timestamp from a log line. Handles both plain text logs
 * (`[2026-...] msg` or `2026-... msg`) and structured JSONL (`{"ts":"...",...}`).
 * Returns the ISO string or null when no timestamp is found.
 */
export function extractTimestamp(line: string): string | null {
  const m = line.match(/^\s*\[?(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]?/);
  if (m) return m[1]!;
  const trimmed = line.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const ts = obj.ts ?? obj.time ?? obj.timestamp;
      if (typeof ts === "string") return ts;
      if (typeof ts === "number") return new Date(ts).toISOString();
    } catch { /* not JSON */ }
  }
  return null;
}

/** Read a log file, apply redaction + time filter, and enforce a tail budget. */
export function readLogLines(path: string, opts: ReadLogOptions = {}): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  let lines = raw.split("\n").filter(Boolean);
  const now = Date.now();

  if (opts.sinceMs && opts.parseTimestamp) {
    lines = lines.filter((l) => {
      const ts = extractTimestamp(l);
      if (ts === null) return true; // keep un-timestamped lines (don't drop unknown)
      const t = Date.parse(ts);
      return !isNaN(t) && now - t <= opts.sinceMs!;
    });
  }

  if (opts.redact === false) {
    // still strip ANSI for machine consumption
    lines = lines.map(stripAnsi);
  } else {
    lines = lines.map((l) => stripAnsi(redactLine(l)));
  }

  if (opts.tail && opts.tail > 0 && lines.length > opts.tail) {
    lines = lines.slice(-opts.tail);
  }
  return lines;
}

/** Parse a human duration like "10m", "1h", "30s", "2d" into milliseconds. */
export function parseDuration(input: string): number | null {
  const m = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!.toLowerCase();
  const mul = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mul;
}
