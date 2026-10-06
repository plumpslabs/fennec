/**
 * ProcessResolver — ONE source of truth for process identity.
 *
 * The historic split (ProcessManager in-memory buffer = MCP-spawned only,
 * tracked.json = everything incl. CLI-started) forced every tool to
 * hand-roll its own fallback chain — the root cause behind #135
 * (get_logs PROCESS_NOT_FOUND on tracked names) and #136 (wait_for_ready
 * blind to on-disk logs). All process tools must resolve through here.
 */
import { existsSync } from 'node:fs';
import type { ProcessManager, ManagedProcess } from './ProcessManager.js';
import {
  readTracked,
  logPathFor,
  isTrackedRunning,
  type TrackedEntry,
} from './tracking.js';
import { readLogLines, redactLogLine } from './redact.js';
import { detectLogLevel, type LogLevel } from '../utils/levelDetector.js';
import { extractTimestamp } from './redact.js';

export type ResolvedKind = 'live' | 'tracked' | 'file' | 'missing';

export interface ResolvedProcess {
  kind: ResolvedKind;
  /** Canonical name (tracked name, or the raw id when unknown). */
  name: string;
  /** Tracked registry entry, when one exists. */
  entry: TrackedEntry | null;
  /** Live MCP-managed process, when present in this server session. */
  live: ManagedProcess | null;
  /** On-disk log file for this name (may not exist yet). */
  logPath: string;
  /** Best-effort running state across both sources. */
  running: boolean;
}

/**
 * Resolve any process id/name to a unified view. Never throws —
 * unknown names return `{ kind: 'missing' }` so callers decide the error.
 */
export function resolveProcess(pm: ProcessManager, id: string): ResolvedProcess {
  const tracked = readTracked();
  let live: ManagedProcess | null = null;
  try {
    live = pm.get(id);
  } catch {
    live = null;
  }
  const entry = tracked.find((t) => t.name === id) ?? null;
  const logPath = logPathFor(entry?.name ?? id);

  if (live) {
    return {
      kind: 'live',
      name: entry?.name ?? id,
      entry,
      live,
      logPath,
      running: live.running || (entry ? isTrackedRunning(entry) : false),
    };
  }
  if (entry) {
    return { kind: 'tracked', name: entry.name, entry, live: null, logPath, running: isTrackedRunning(entry) };
  }
  if (existsSync(logPath)) {
    return { kind: 'file', name: id, entry: null, live: null, logPath, running: false };
  }
  return { kind: 'missing', name: id, entry: null, live: null, logPath, running: false };
}

export interface UnifiedLogOptions {
  lines?: number;
  level?: LogLevel;
  since?: string;
}

/**
 * Read logs from BOTH sources (live buffer first, on-disk file fills the
 * gaps), deduped, redacted, filtered. Throws `Process not found: <id>`
 * only when neither source knows the name — the single place that error
 * originates for log readers.
 */
export function readUnifiedLogs(
  pm: ProcessManager,
  id: string,
  options: UnifiedLogOptions = {},
): Array<{ line: string; level: LogLevel; timestamp: string }> {
  const r = resolveProcess(pm, id);
  if (r.kind === 'missing') throw new Error(`Process not found: ${id}`);

  const seen = new Set<string>();
  const out: Array<{ line: string; level: LogLevel; timestamp: string }> = [];
  const push = (line: string, level: LogLevel, timestamp: string) => {
    const clean = redactLogLine(line);
    if (seen.has(clean)) return;
    seen.add(clean);
    out.push({ line: clean, level, timestamp });
  };

  if (r.live) {
    try {
      const buf = pm.getLogs(r.live.processId, { lines: options.lines ?? 100 });
      for (const l of buf) push(l.line, l.level, l.timestamp);
    } catch {
      /* buffer lost mid-flight (restart race) — file below covers it */
    }
  }
  if (existsSync(r.logPath)) {
    const now = new Date().toISOString();
    for (const line of readLogLines(r.logPath, { tail: options.lines ?? 100 })) {
      push(line, detectLogLevel(line), extractTimestamp(line) ?? now);
    }
  }

  let filtered = out;
  if (options.level) filtered = filtered.filter((l) => l.level === options.level);
  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    if (!Number.isNaN(sinceTime)) {
      filtered = filtered.filter((l) => new Date(l.timestamp).getTime() > sinceTime);
    }
  }
  if (options.lines && options.lines > 0) filtered = filtered.slice(-options.lines);
  return filtered;
}
