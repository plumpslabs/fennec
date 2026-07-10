/**
 * Process Tracker — Shared state for managing ~/.fennec/tracked.json
 * Extracted from index.ts to be reusable across all CLI command files.
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync, renameSync, statSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";

export interface TrackedProcess {
  name: string;
  pid: number;
  command: string;
  port?: number;
  cwd?: string;
  startedAt: string;
}

export function getTrackedPath(): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), ".fennec");
  return resolve(dir, "tracked.json");
}

export function readTracked(): TrackedProcess[] {
  try {
    const path = getTrackedPath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function saveTracked(processes: TrackedProcess[]): void {
  try {
    const path = getTrackedPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(processes, null, 2), "utf-8");
  } catch (err) {
    console.error("[fennec] Failed to save tracked processes:", err instanceof Error ? err.message : String(err));
  }
}

export function addTracked(proc: TrackedProcess): void {
  const tracked = readTracked();
  const filtered = tracked.filter((t) => t.name !== proc.name);
  filtered.push(proc);
  saveTracked(filtered);
}

export function removeTracked(name: string): void {
  const tracked = readTracked();
  saveTracked(tracked.filter((t) => t.name !== name));
}

export function removeTrackedByPid(pid: number): void {
  const tracked = readTracked();
  saveTracked(tracked.filter((t) => t.pid !== pid));
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m}m`;
  }
  return `${h}h ${m}m`;
}

// ─── Log Rotation ─────────────────────────────────────────────────
// Rotates log files when they exceed maxSize (default: 10MB).
// Keeps up to maxFiles rotated copies (default: 3) then deletes oldest.

const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_LOG_FILES = 3;

/**
 * Check if a log file needs rotation and rotate if necessary.
 * Returns true if rotation was performed.
 */
export function rotateLogFile(
  filePath: string,
  maxSize = DEFAULT_MAX_LOG_SIZE,
  maxFiles = DEFAULT_MAX_LOG_FILES,
): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const stats = statSync(filePath);
    if (stats.size < maxSize) return false;

    // Rotate: .log -> .log.1 -> .log.2 -> .log.3 (delete oldest)
    const dir = dirname(filePath);
    const base = basename(filePath);

    // Delete oldest if exists
    const oldestPath = resolve(dir, `${base}.${maxFiles}`);
    if (existsSync(oldestPath)) {
      try { rmSync(oldestPath); } catch { /* best-effort */ }
    }

    // Shift existing rotations
    for (let i = maxFiles - 1; i >= 1; i--) {
      const src = resolve(dir, `${base}.${i}`);
      const dst = resolve(dir, `${base}.${i + 1}`);
      if (existsSync(src)) {
        try { renameSync(src, dst); } catch { /* best-effort */ }
      }
    }

    // Rotate current file
    try {
      renameSync(filePath, resolve(dir, `${base}.1`));
    } catch { /* best-effort */ }

    return true;
  } catch (err) {
    console.error("[fennec] Log rotation failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}


