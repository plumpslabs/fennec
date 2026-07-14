/**
 * System process utilities — shared between CLI and MCP tools.
 */
import { readFileSync, readlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Check if a process is running by sending signal 0.
 * Works on Linux/macOS/Windows (Node.js handles cross-platform).
 */
export function isProcessRunning(pid: number): boolean {
  // PID ≤ 0 is invalid — kill(0, 0) would test the calling process itself,
  // returning false-positives and kill(0, SIGTERM) would kill the caller's
  // process group. Treat as "not running" immediately.
  if (pid <= 0) return false;
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
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    const joined = raw.split('\0').filter(Boolean).join(' ').trim();
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

/**
 * Kill a process AND its entire descendant tree (cross-platform).
 *
 * Apps are spawned `detached`, making the direct child a process-GROUP
 * leader on POSIX. A plain `kill(pid)` only stops that leader (e.g. `npm`),
 * leaving its children (`node` -> `vite` -> `esbuild`) as ORPHANS that keep
 * running and leaking CPU/memory/ports.
 *
 * - POSIX (Linux/macOS): signal the whole group via negative PID.
 * - Windows: `taskkill /T /F` kills the process and all descendants.
 */
export function killTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  // PID ≤ 0 is invalid — kill(0, SIGTERM) would kill the calling process
  // group (i.e. fennec itself). Treat as already-gone.
  if (pid <= 0) return false;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    }
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Cheaply read a single process's resident memory (RSS) in KB.
 * Unlike enumerating every process, this only touches the one target — so
 * calling it for a handful of tracked apps in a listing stays fast.
 */
export function getProcessMemRss(pid: number): number | null {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh 2>nul`, {
        encoding: 'utf-8',
        timeout: 3000,
      });
      for (const raw of out.split('\n')) {
        if (!raw.trim()) continue;
        const parts = raw.split('","').map((p) => p.replace(/^"|"$/g, ''));
        if (parseInt(parts[1] ?? '', 10) !== pid) continue;
        const memKb = parseInt((parts[4] ?? '').replace(/[^\d]/g, ''), 10);
        return isNaN(memKb) ? null : memKb;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (
    process.platform === 'darwin' ||
    process.platform === 'freebsd' ||
    process.platform === 'openbsd' ||
    process.platform === 'netbsd'
  ) {
    try {
      const { execSync } = require('node:child_process');
      const out = execSync(`ps -o rss= -p ${pid} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      const kb = parseInt(out, 10);
      return isNaN(kb) ? null : kb;
    } catch {
      return null;
    }
  }
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const m = status.match(/VmRSS:\s+(\d+)/);
    return m ? parseInt(m[1]!, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Read /proc/<pid>/environ to verify ownership via environment markers.
 * Null when unavailable (non-Linux or process exited).
 */
export function getProcessEnviron(pid: number): Record<string, string> | null {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf-8');
    const env: Record<string, string> = {};
    for (const pair of raw.split('\0')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      env[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    return env;
  } catch {
    return null;
  }
}
