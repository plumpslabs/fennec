/**
 * Shared Process Tracking — Single source of truth for ~/.fennec/tracked.json
 *
 * Used by both:
 * - `packages/core/src/tools/process/index.ts` (AI agent tools)
 * - `packages/cli/src/commands/tracker.ts` (CLI commands)
 *
 * Prevents duplication and ensures both sides stay in sync.
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
