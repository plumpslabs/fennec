/**
 * Secret redaction for AI-safe log/inspect output.
 * Mirrors the CLI's redaction so MCP tools never leak credentials into an
 * AI assistant's context window. Best-effort, not a substitute for proper
 * secret management.
 */
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._\-]+/gi },
  { name: "authorization", re: /\bAuthorization\s*:\s*\S+/gi },
  { name: "apikey", re: /\b(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi },
  { name: "aws", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "slack", re: /\bxox[baprs]-[0-9A-Za-z\-]{10,}/g },
  { name: "stripe", re: /\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{16,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*/g },
  { name: "google", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: "github", re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  { name: "token", re: /\b(token|secret|password|passwd|pwd|client[_-]?secret)\s*[:=]\s*\S+/gi },
  { name: "connstr", re: /\b(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp|sqlserver):\/\/[^\s:]+:[^\s@]+@/gi },
  { name: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function redactLogLine(line: string): string {
  let out = stripAnsi(line);
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      const head = m.slice(0, Math.min(m.length, name.length + 4));
      return `${head}…[REDACTED]`;
    });
  }
  return out;
}

/** Count secret matches in a line (post-redaction it would be 0). */
export function redactionCount(rawLine: string): number {
  let n = 0;
  const s = stripAnsi(rawLine);
  for (const { re } of SECRET_PATTERNS) {
    const m = s.match(re);
    if (m) n += m.length;
  }
  return n;
}

export interface ReadLogOptions {
  tail?: number;
  sinceMs?: number;
  parseTimestamp?: boolean;
}

/** Hard ceiling so a tool can never return an unbounded number of lines. */
export const HARD_LOG_CAP = 500;

/**
 * Clamp a requested line count to a safe maximum, optionally tightening it
 * further when the AI context has a token budget. Keeps tool output bounded
 * and predictable so an agent never blows its context window by accident.
 *   - hardMax: absolute ceiling (e.g. 200 for inspect, 500 for raw logs)
 *   - budget:  ToolContext.tokenBudget (tokens remaining); ~80 tok/line est.
 */
export function clampLineCount(
  requested: number | undefined,
  fallback: number,
  hardMax: number,
  budget?: { maxResponseTokens?: number },
): number {
  let cap = Math.min(requested ?? fallback, hardMax, HARD_LOG_CAP);
  if (budget?.maxResponseTokens && budget.maxResponseTokens > 0) {
    // ~80 tokens per line is a safe upper bound; never go below 10 lines.
    cap = Math.min(cap, Math.max(10, Math.floor(budget.maxResponseTokens / 80)));
  }
  return Math.max(1, cap);
}

/**
 * Extract a timestamp from a log line. Handles both plain text logs and
 * structured JSONL (`{"ts":"...",...}`). Returns the ISO string or null.
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

/** Read a log file, redact, apply a tail budget and optional time window. */
export function readLogLines(path: string, opts: ReadLogOptions = {}): string[] {
  if (!existsSync(path)) return [];
  let lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const now = Date.now();
  if (opts.sinceMs && opts.parseTimestamp) {
    lines = lines.filter((l) => {
      const ts = extractTimestamp(l);
      if (ts === null) return true;
      const t = Date.parse(ts);
      return !isNaN(t) && now - t <= opts.sinceMs!;
    });
  }
  lines = lines.map(redactLogLine);
  if (opts.tail && opts.tail > 0 && lines.length > opts.tail) {
    lines = lines.slice(-opts.tail);
  }
  return lines;
}

/**
 * AI watch-mode: read only the bytes AFTER `offset` so an agent can poll for
 * NEW lines without re-downloading the whole file (token-efficient real-time).
 * Returns the new redacted lines and the new file offset (watermark) to pass
 * back on the next call. When offset is undefined/0, returns the tail budget.
 */
export function readLogLinesFromOffset(
  path: string,
  offset?: number,
  tail = 200,
): { lines: string[]; watermark: number } {
  if (!existsSync(path)) return { lines: [], watermark: offset ?? 0 };
  const size = statSync(path).size;
  const start = offset && offset > 0 && offset < size ? offset : Math.max(0, size - tail * 200);
  // Peek one byte before `start` so a mid-line read start can be detected and
  // the leading partial line dropped (avoids returning garbled first lines).
  const readStart = start > 0 ? start - 1 : 0;
  let content = "";
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(size - readStart);
      const n = readSync(fd, buf, 0, buf.length, readStart);
      content = buf.slice(0, n).toString("utf-8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return { lines: [], watermark: size };
  }
  // If the byte before `start` wasn't a newline, the first segment is a
  // partial line — drop it so only complete new lines are returned.
  if (start > 0 && content.charCodeAt(0) !== 10) {
    const nl = content.indexOf("\n");
    if (nl !== -1) content = content.slice(nl + 1);
  }
  const lines = content.split("\n").filter(Boolean).map(redactLogLine);
  const sliced = offset && offset > 0 ? lines : lines.slice(-tail);
  return { lines: sliced, watermark: size };
}
