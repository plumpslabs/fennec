/**
 * Process Tracking — Syncs CLI-tracked processes (tracked.json) with MCP tools.
 * Used by process_spawn, process_kill, process_restart tools to maintain
 * a persistent process registry accessible from both CLI (`fennec ps`)
 * and MCP tools (`process_get_tracked`).
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

export interface TrackedEntry {
  name: string;
  pid: number;
  command: string;
  /**
   * Raw argv for re-spawning (spawn-safe). Mirrors the CLI's tracked.json
   * shape so `fennec spawn` and the supervisor can re-launch correctly.
   */
  args?: string[];
  port?: number;
  cwd?: string;
  /**
   * Environment captured at start time. Re-applied on re-spawn so the app
   * keeps its variables (DB URL, nvm PATH, ...) regardless of where the
   * supervisor/MCP server runs from.
   */
  env?: Record<string, string>;
  startedAt: string;
  /** When true, the supervisor daemon auto-restarts this app if it dies. */
  autoRestart?: boolean;
}

export function getTrackedPath(): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), ".fennec");
  return resolve(dir, "tracked.json");
}

/** Absolute path to an app's on-disk log file. MUST match the CLI's
 *  `logFilePathFor` (same data-dir resolution) so logs written by an
 *  MCP-spawned/adopted process are exactly where `fennec log` reads them. */
export function logPathFor(name: string): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), ".fennec");
  return resolve(dir, "logs", `${name}.log`);
}

export function readTracked(): TrackedEntry[] {
  try {
    const path = getTrackedPath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function saveTracked(processes: TrackedEntry[]): void {
  try {
    const path = getTrackedPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(processes, null, 2), "utf-8");
  } catch (err) {
    console.error("[fennec] Failed to save tracked processes:", err instanceof Error ? err.message : String(err));
  }
}

export function addTracked(proc: TrackedEntry): void {
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
