/**
 * System process utilities — shared between CLI and MCP tools.
 */
import { readFileSync, readlinkSync } from "node:fs";

/**
 * Check if a process is running by sending signal 0.
 * Works on Linux/macOS/Windows (Node.js handles cross-platform).
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read /proc/<pid>/cmdline (argv, space-joined). Null when unavailable. */
export function getProcessCmdline(pid: number): string | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    const joined = raw.split("\0").filter(Boolean).join(" ").trim();
    return joined.length > 0 ? joined : null;
  } catch {
    return null;
  }
}

/** Resolve a process's cwd via /proc/<pid>/cwd. Null when unavailable. */
export function getProcessCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`) || null;
  } catch {
    return null;
  }
}
