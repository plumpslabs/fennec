/**
 * System Process Scanner
 *
 * Reads real system processes from /proc (Linux) or ps (macOS/BSD).
 * Returns process info: pid, name, cpu%, mem%, status, command, ports.
 *
 * Design principles:
 * - Zero external dependencies (uses Node.js built-ins only)
 * - Cross-platform (Linux via /proc, macOS/Windows via exec)
 * - Safe errors (never throws, returns empty array on failure)
 */

import { readdirSync, readFileSync, existsSync, readlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { cpus } from 'node:os';
import net from 'node:net';

// ─── Types ───────────────────────────────────────────────────────

export interface SystemProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
  memRss: number; // Resident Set Size in KB
  state: string; // R=Running, S=Sleeping, Z=Zombie, etc.
  startedAt: string | null;
  ports: number[]; // Listening ports (if any)
  isUserProcess: boolean; // true if owned by current user
}

export interface SystemProcessFilter {
  name?: string;
  pid?: number;
  port?: number;
  userOnly?: boolean;
  sortBy?: 'cpu' | 'mem' | 'pid' | 'name';
  limit?: number;
}

// ─── Linux /proc Scanner ─────────────────────────────────────────

function readProcProcesses(): SystemProcessInfo[] {
  const processes: SystemProcessInfo[] = [];
  const currentUid = process.getuid?.();
  const totalMemKb = readTotalMem();

  try {
    const pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));

    for (const pidStr of pids) {
      try {
        const pid = parseInt(pidStr, 10);
        const proc = readSingleProcProcess(pid, currentUid, totalMemKb);
        if (proc) processes.push(proc);
      } catch {
        // Process might have exited between readdir and stat
        continue;
      }
    }
  } catch {
    // /proc not available (not Linux)
    return [];
  }

  return processes;
}

function readSingleProcProcess(
  pid: number,
  currentUid: number | undefined,
  totalMemKb: number,
): SystemProcessInfo | null {
  const statPath = `/proc/${pid}/stat`;
  const statusPath = `/proc/${pid}/status`;
  const cmdlinePath = `/proc/${pid}/cmdline`;

  if (!existsSync(statPath)) return null;

  // Read /proc/[pid]/status for name, uid, memory
  const statusText = readSafe(statusPath);
  if (!statusText) return null;

  const nameMatch = statusText.match(/Name:\s+(.+)/);
  const uidMatch = statusText.match(/Uid:\s+(\d+)/);
  const vmRssMatch = statusText.match(/VmRSS:\s+(\d+)/);
  const stateMatch = statusText.match(/State:\s+(\S)/);
  const name = nameMatch?.[1] ?? `pid_${pid}`;
  const uid = uidMatch ? parseInt(uidMatch[1]!, 10) : undefined;
  const vmRss = vmRssMatch ? parseInt(vmRssMatch[1]!, 10) : 0;
  const state = stateMatch?.[1] ?? '?';

  const isUserProcess = uid !== undefined && currentUid !== undefined && uid === currentUid;

  // Read /proc/[pid]/stat for CPU ticks
  const statText = readSafe(statPath);
  let cpuPercent = 0;
  let startedAt: string | null = null;

  if (statText) {
    // Parse /proc/[pid]/stat format
    // Format: pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt
    // cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime
    const parenEnd = statText.lastIndexOf(')');
    if (parenEnd > 0) {
      const fields = statText.slice(parenEnd + 2).split(/\s+/);
      const utime = parseInt(fields[11] ?? '0', 10); // User mode jiffies
      const stime = parseInt(fields[12] ?? '0', 10); // Kernel mode jiffies
      const starttime = parseInt(fields[19] ?? '0', 10); // Start time in jiffies

      // CPU usage = (utime + stime) / uptime_seconds / Hz
      const hertz = 100; // CLK_TCK, typically 100
      const uptimeSeconds = readUptime();
      const totalJiffies = utime + stime;

      if (uptimeSeconds > 0) {
        const elapsedJiffies = uptimeSeconds * hertz;
        const processJiffies = totalJiffies;
        cpuPercent = Math.min(
          100,
          (processJiffies / Math.max(1, elapsedJiffies)) * 100 * cpus().length,
        );
      }

      // Boot time for startedAt
      startedAt = formatStartTime(starttime, uptimeSeconds, hertz);
    }
  }

  // Read /proc/[pid]/cmdline for full command
  const cmdlineRaw = readSafe(cmdlinePath);
  const command = cmdlineRaw ? cmdlineRaw.split('\0').filter(Boolean).join(' ') : name;

  // Read listening ports
  const ports = detectListeningPorts(pid);

  const memPercent = totalMemKb > 0 ? (vmRss / totalMemKb) * 100 : 0;

  return {
    pid,
    name,
    command: command.length > 200 ? command.slice(0, 200) + '…' : command,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memPercent: Math.round(memPercent * 10) / 10,
    memRss: vmRss,
    state,
    startedAt,
    ports,
    isUserProcess,
  };
}

// ─── macOS / BSD ps fallback ─────────────────────────────────────

function runPsProcesses(): SystemProcessInfo[] {
  try {
    const output = execSync(
      'ps axo pid,comm,pcpu,pmem,rss,state,etime,user --sort=-pcpu 2>/dev/null | head -200',
      { encoding: 'utf-8', timeout: 5000 },
    );

    const lines = output.trim().split('\n').slice(1); // Skip header
    const currentUser = execSync('whoami', { encoding: 'utf-8', timeout: 1000 }).trim();

    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0] ?? '0', 10);
      const name = parts[1] ?? '';
      const cpu = parseFloat(parts[2] ?? '0');
      const mem = parseFloat(parts[3] ?? '0');
      const rss = parseInt(parts[4] ?? '0', 10);
      const state = parts[5] ?? '?';
      const elapsed = parts[6] ?? '';
      const user = parts[7] ?? '';
      const command = parts.slice(1).join(' ');

      return {
        pid,
        name,
        command: command.length > 200 ? command.slice(0, 200) + '…' : command,
        cpuPercent: Math.round(cpu * 10) / 10,
        memPercent: Math.round(mem * 10) / 10,
        memRss: rss,
        state: mapBsdState(state),
        startedAt: elapsed || null,
        ports: [] as number[],
        isUserProcess: user === currentUser,
      };
    });
  } catch {
    return [];
  }
}

function runTasklistProcesses(): SystemProcessInfo[] {
  try {
    const output = execSync('tasklist /fo csv /nh 2>nul', { encoding: 'utf-8', timeout: 5000 });
    const result: SystemProcessInfo[] = [];
    for (const raw of output.split('\n')) {
      if (!raw.trim()) continue;
      const parts = raw.split('","').map((p) => p.replace(/^"|"$/g, ''));
      const pid = parseInt(parts[1] ?? '', 10);
      if (isNaN(pid)) continue;
      const image = parts[0] ?? '';
      const name = image.replace(/\.[a-z0-9]+$/i, '');
      const memKb = parseInt((parts[4] ?? '').replace(/[^\d]/g, ''), 10) || 0;
      result.push({
        pid,
        name,
        command: image,
        cpuPercent: 0,
        memPercent: 0,
        memRss: memKb,
        state: 'R',
        startedAt: null,
        ports: [],
        isUserProcess: false,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function mapBsdState(s: string): string {
  switch (s) {
    case 'R':
      return 'R';
    case 'S':
      return 'S';
    case 'Z':
      return 'Z';
    case 'T':
      return 'T';
    case 'I':
      return 'S';
    default:
      return s;
  }
}

// ─── Port Scanner ────────────────────────────────────────────────
// NOTE: Per-process port detection via /proc/[pid]/net/tcp is unreliable
// because it shows network namespace ports, not per-process ports.
// Fennec tracks ports via the --port flag when starting apps.
// We keep the field for API compatibility but always return empty.

function detectListeningPorts(_pid: number): number[] {
  return [];
}

// ─── Helpers ─────────────────────────────────────────────────────

function readSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function readTotalMem(): number {
  try {
    const memInfo = readSafe('/proc/meminfo');
    if (memInfo) {
      const match = memInfo.match(/MemTotal:\s+(\d+)/);
      if (match) return parseInt(match[1]!, 10);
    }
  } catch {
    // ignore
  }
  return 16_000_000; // Default ~16GB
}

function readUptime(): number {
  try {
    const data = readSafe('/proc/uptime');
    if (data) {
      return parseFloat(data.split(/\s+/)[0] ?? '0');
    }
  } catch {
    // ignore
  }
  return 0;
}

function formatStartTime(starttime: number, uptimeSeconds: number, hertz: number): string | null {
  try {
    const bootTime = Date.now() / 1000 - uptimeSeconds;
    const processStart = bootTime + starttime / hertz;
    return new Date(processStart * 1000).toISOString();
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Get all system processes.
 * Uses /proc on Linux, falls back to `ps` on macOS/BSD.
 */
export function getSystemProcesses(filter?: SystemProcessFilter): SystemProcessInfo[] {
  let processes: SystemProcessInfo[];

  // Linux uses /proc (richest); macOS/BSD use ps; Windows uses tasklist.
  if (process.platform === 'win32') {
    processes = runTasklistProcesses();
  } else if (existsSync('/proc')) {
    processes = readProcProcesses();
  } else {
    processes = runPsProcesses();
  }

  // Apply filters
  if (filter) {
    if (filter.userOnly) {
      processes = processes.filter((p) => p.isUserProcess);
    }
    if (filter.name) {
      const nameLower = filter.name.toLowerCase();
      processes = processes.filter(
        (p) =>
          p.name.toLowerCase().includes(nameLower) || p.command.toLowerCase().includes(nameLower),
      );
    }
    if (filter.pid) {
      processes = processes.filter((p) => p.pid === filter.pid);
    }
    if (filter.port) {
      processes = processes.filter((p) => p.ports.includes(filter.port!));
    }

    // Sort
    if (filter.sortBy) {
      processes.sort((a, b) => {
        switch (filter.sortBy) {
          case 'cpu':
            return b.cpuPercent - a.cpuPercent;
          case 'mem':
            return b.memPercent - a.memPercent;
          case 'pid':
            return a.pid - b.pid;
          case 'name':
            return a.name.localeCompare(b.name);
          default:
            return b.cpuPercent - a.cpuPercent;
        }
      });
    }

    // Limit
    if (filter.limit && filter.limit > 0) {
      processes = processes.slice(0, filter.limit);
    }
  }

  return processes;
}

/**
 * Get a single process by PID. Returns null if not found.
 */
export function getProcessByPid(pid: number): SystemProcessInfo | null {
  const processes = getSystemProcesses({ pid });
  return processes[0] ?? null;
}

/**
 * Kill a process by PID. Returns true if successful.
 */
export function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process AND its entire descendant tree (cross-platform).
 *
 * Why this matters: apps are spawned `detached`, which makes the direct child a
 * process-GROUP leader on POSIX. A plain `kill(pid)` only stops that leader
 * (e.g. `npm`), leaving its children (`node` -> `vite` -> `esbuild`) as
 * ORPHANS that keep running and leaking CPU/memory/ports ("nyampah").
 *
 * - POSIX (Linux/macOS): signal the whole group via the negative PID
 *   (`process.kill(-pid, signal)`). Falls back to a direct PID kill when the
 *   target was not a group leader (e.g. ESRCH/EPERM paths).
 * - Windows: `process.kill(-pid)` is unsupported, so use `taskkill /T /F`
 *   which kills the process and all descendants natively.
 *
 * Best-effort: returns true if the root was signaled, false if it was
 * already gone. Never throws.
 */
export function killTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (process.platform === 'win32') {
    try {
      // /T = tree, /F = force. Windows has no clean SIGTERM-tree equivalent;
      // /F is the practical choice for stop/kill here.
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

  // POSIX: negative PID targets the entire process group.
  try {
    process.kill(-pid, signal);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false; // already gone
    // EPERM or other: try a plain single-PID kill as a last resort.
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Check if a process is running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks existence without killing
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheaply read a single process's resident memory (RSS) in KB.
 *
 * Unlike `getProcessByPid` (which enumerates EVERY process), this only
 * touches the one target process — so calling it for a handful of tracked
 * apps in `ps` stays fast. Returns null if the process is gone or the
 * platform lookup fails.
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

  // Linux / other /proc systems
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const m = status.match(/VmRSS:\s+(\d+)/);
    return m ? parseInt(m[1]!, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Recursively collect all descendant PIDs of a process (children,
 * grandchildren, etc.) via /proc on Linux.
 */
function getChildPids(pid: number): number[] {
  const children: number[] = [];
  try {
    const taskDir = `/proc/${pid}/task`;
    const tids = readdirSync(taskDir).filter((d) => /^\d+$/.test(d));
    for (const tid of tids) {
      try {
        const raw = readFileSync(`${taskDir}/${tid}/children`, 'utf-8').trim();
        if (!raw) continue;
        for (const childPid of raw.split(/\s+/)) {
          const cp = parseInt(childPid, 10);
          if (!isNaN(cp) && cp > 0) {
            children.push(cp);
            children.push(...getChildPids(cp));
          }
        }
      } catch {
        // Child may have exited — skip
      }
    }
  } catch {
    // Process may have exited — return what we have
  }
  return children;
}

/**
 * Read the total resident memory (RSS) of a process AND all its
 * descendants (children, grandchildren, etc.) in KB.
 *
 * This is useful when the tracked parent is a thin wrapper (e.g.
 * `make`, `npm run`) and the actual memory is consumed by child
 * processes. Falls back to `getProcessMemRss` (parent only) on
 * non-Linux platforms or when /proc is unavailable.
 *
 * Returns null if the root PID is gone or inaccessible.
 */
export function getProcessTreeMemRss(pid: number): number | null {
  const parentKb = getProcessMemRss(pid);
  if (parentKb === null) return null;

  if (process.platform !== 'linux') return parentKb;

  let total = parentKb;
  try {
    const childPids = getChildPids(pid);
    for (const cp of childPids) {
      const childKb = getProcessMemRss(cp);
      if (childKb !== null) total += childKb;
    }
  } catch {
    // Best-effort: return parent RSS if child scan fails
  }
  return total;
}

/**
 * Check if something is accepting TCP connections on a port.
 * Tries both IPv4 (127.0.0.1) and IPv6 (::1) loopback so apps that bind to
 * localhost (which often resolves to ::1, e.g. Next.js/Vite) aren't falsely
 * reported as "not listening". Resolves true if EITHER connects.
 */
export function checkPort(
  port: number,
  host: string = '127.0.0.1',
  timeout = 1000,
): Promise<boolean> {
  const tryHost = (h: string): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeout);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, h);
    });

  return tryHost(host).then((ok) => (ok ? true : tryHost('::1')));
}

/**
 * HTTP readiness/health probe. Resolves true only on a 2xx/3xx response;
 * any network error, timeout, or 4xx/5xx resolves false (so the supervisor
 * treats the app as unhealthy and restarts it). Used when an app declares a
 * `healthCheck` URL — a stronger signal than a bare TCP port check.
 */
export async function checkHttp(url: string, timeout = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a `healthCheck` declaration to a concrete URL.
 *  - starts with http(s):// → used verbatim
 *  - starts with "/"       → http://127.0.0.1:<port><path>
 * Returns null when the form can't be resolved (e.g. a path with no port).
 */
export function resolveHealthUrl(healthCheck: string, port?: number): string | null {
  if (/^https?:\/\//i.test(healthCheck)) return healthCheck;
  if (healthCheck.startsWith('/')) {
    if (!port) return null;
    return `http://127.0.0.1:${port}${healthCheck}`;
  }
  return null;
}

/**
 * Find the PID (and command) of whatever process is LISTENING on `port`.
 * Cross-platform: Linux via /proc, macOS via `lsof`, Windows via `netstat`.
 * Returns null when nothing is listening or the platform tools are missing.
 * Used to adopt an externally-started server (e.g. one an AI agent launched
 * via raw bash) instead of spawning a duplicate that fails with EADDRINUSE.
 */
export function findPidOnPort(port: number): { pid: number; command: string } | null {
  if (process.platform === 'win32') return findPidOnPortWindows(port);
  if (process.platform === 'darwin') return findPidOnPortMac(port);
  return findPidOnPortLinux(port);
}

function findPidOnPortLinux(port: number): { pid: number; command: string } | null {
  try {
    const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
    const inodes = new Set<number>();
    for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
      if (!existsSync(f)) continue;
      for (const line of readFileSync(f, 'utf-8').split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10) continue;
        if (cols[3] !== '0A') continue; // 0A = LISTEN
        const localPort = cols[1]?.split(':')[1];
        const inode = parseInt(cols[9] ?? '', 10);
        if (localPort === hexPort && !Number.isNaN(inode)) inodes.add(inode);
      }
    }
    if (inodes.size === 0) return null;
    for (const pidStr of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
      const pid = parseInt(pidStr, 10);
      try {
        const fdDir = `/proc/${pid}/fd`;
        for (const fd of readdirSync(fdDir)) {
          const link = readlinkSync(`${fdDir}/${fd}`);
          const m = link.match(/socket:\[(\d+)\]/);
          if (m && inodes.has(parseInt(m[1]!, 10))) {
            return { pid, command: getProcessCmdline(pid) ?? '' };
          }
        }
      } catch {
        /* pid may have exited */
      }
    }
    return null;
  } catch {
    return null;
  }
}

function findPidOnPortMac(port: number): { pid: number; command: string } | null {
  try {
    const out = execSync(`lsof -i :${port} -sTCP:LISTEN -P -n 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    for (const line of out.split('\n')) {
      if (!line.includes('LISTEN')) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const pid = parseInt(parts[1]!, 10);
        if (!isNaN(pid)) return { pid, command: parts[0] ?? '' };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function findPidOnPortWindows(port: number): { pid: number; command: string } | null {
  try {
    const out = execSync(`netstat -ano -p tcp 2>nul`, { encoding: 'utf-8', timeout: 5000 });
    const target = `:${port} `;
    for (const line of out.split('\n')) {
      const upper = line.toUpperCase();
      if (!upper.includes('LISTENING')) continue;
      if (!upper.includes(target)) continue;
      const pid = parseInt(line.trim().split(/\s+/).pop() ?? '', 10);
      if (!isNaN(pid)) return { pid, command: getProcessCmdline(pid) ?? '' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the full command line (argv, space-joined) of a running PID.
 * Cross-platform: Linux /proc, macOS `ps`, Windows `wmic`. Returns null when
 * unavailable — callers should treat null as "cannot verify", not "mismatch".
 */
export function getProcessCmdline(pid: number): string | null {
  if (process.platform === 'win32') return getProcessCmdlineWindows(pid);
  if (process.platform === 'darwin') return getProcessCmdlineMac(pid);
  return getProcessCmdlineLinux(pid);
}

function getProcessCmdlineLinux(pid: number): string | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    const joined = raw.split('\0').filter(Boolean).join(' ').trim();
    return joined.length > 0 ? joined : null;
  } catch {
    return null;
  }
}

function getProcessCmdlineMac(pid: number): string | null {
  try {
    const out = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8', timeout: 3000 });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function getProcessCmdlineWindows(pid: number): string | null {
  try {
    const out = execSync(`wmic process where ProcessId=${pid} get CommandLine /value 2>nul`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const line = out.split('\n').find((l) => l.includes('='));
    const value = line?.split('=')[1]?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a process's cwd. Linux /proc, macOS `lsof`; Windows cwd is not
 * easily available via built-ins, so it returns null there. Callers must
 * tolerate null.
 */
export function getProcessCwd(pid: number): string | null {
  if (process.platform === 'linux') {
    try {
      return readlinkSync(`/proc/${pid}/cwd`) || null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const out = execSync(`lsof -p ${pid} -a -d cwd -F n 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      });
      const line = out.split('\n').find((l) => l.startsWith('n'));
      return line ? line.slice(1) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read /proc/<pid>/environ (NUL-separated KEY=VALUE pairs) of a running PID.
 * Returns null when unavailable. Used to verify a tracked process is really
 * ours via the FENNEC_APP_NAME marker we inject at spawn time — robust even
 * when the app re-execs a different binary (where cmdline matching fails).
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

/**
 * Get human-readable process state.
 */
export function formatProcessState(state: string): string {
  switch (state) {
    case 'R':
      return 'Running';
    case 'S':
      return 'Sleeping';
    case 'D':
      return 'Disk Sleep';
    case 'Z':
      return 'Zombie';
    case 'T':
      return 'Stopped';
    case 't':
      return 'Tracing';
    case 'X':
      return 'Dead';
    case 'I':
      return 'Idle';
    default:
      return state;
  }
}
