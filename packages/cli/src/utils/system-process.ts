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

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { cpus } from "node:os";

// ─── Types ───────────────────────────────────────────────────────

export interface SystemProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
  memRss: number;        // Resident Set Size in KB
  state: string;          // R=Running, S=Sleeping, Z=Zombie, etc.
  startedAt: string | null;
  ports: number[];        // Listening ports (if any)
  isUserProcess: boolean; // true if owned by current user
}

export interface SystemProcessFilter {
  name?: string;
  pid?: number;
  port?: number;
  userOnly?: boolean;
  sortBy?: "cpu" | "mem" | "pid" | "name";
  limit?: number;
}

// ─── Linux /proc Scanner ─────────────────────────────────────────

function readProcProcesses(): SystemProcessInfo[] {
  const processes: SystemProcessInfo[] = [];
  const currentUid = process.getuid?.();
  const totalMemKb = readTotalMem();

  try {
    const pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));

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
  const state = stateMatch?.[1] ?? "?";

  const isUserProcess = uid !== undefined && currentUid !== undefined && uid === currentUid;

  // Read /proc/[pid]/stat for CPU ticks
  const statText = readSafe(statPath);
  let cpuPercent = 0;
  let startedAt: string | null = null;

  if (statText) {
    // Parse /proc/[pid]/stat format
    // Format: pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt
    // cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime
    const parenEnd = statText.lastIndexOf(")");
    if (parenEnd > 0) {
      const fields = statText.slice(parenEnd + 2).split(/\s+/);
      const utime = parseInt(fields[11] ?? "0", 10); // User mode jiffies
      const stime = parseInt(fields[12] ?? "0", 10); // Kernel mode jiffies
      const starttime = parseInt(fields[19] ?? "0", 10); // Start time in jiffies

      // CPU usage = (utime + stime) / uptime_seconds / Hz
      const hertz = 100; // CLK_TCK, typically 100
      const uptimeSeconds = readUptime();
      const totalJiffies = utime + stime;

      if (uptimeSeconds > 0) {
        const elapsedJiffies = uptimeSeconds * hertz;
        const processJiffies = totalJiffies;
        cpuPercent = Math.min(100, (processJiffies / Math.max(1, elapsedJiffies)) * 100 * cpus().length);
      }

      // Boot time for startedAt
      startedAt = formatStartTime(starttime, uptimeSeconds, hertz);
    }
  }

  // Read /proc/[pid]/cmdline for full command
  const cmdlineRaw = readSafe(cmdlinePath);
  const command = cmdlineRaw
    ? cmdlineRaw.split("\0").filter(Boolean).join(" ")
    : name;

  // Read listening ports
  const ports = detectListeningPorts(pid);

  const memPercent = totalMemKb > 0 ? (vmRss / totalMemKb) * 100 : 0;

  return {
    pid,
    name,
    command: command.length > 200 ? command.slice(0, 200) + "…" : command,
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
      "ps axo pid,comm,pcpu,pmem,rss,state,etime,user --sort=-pcpu 2>/dev/null | head -200",
      { encoding: "utf-8", timeout: 5000 },
    );

    const lines = output.trim().split("\n").slice(1); // Skip header
    const currentUser = execSync("whoami", { encoding: "utf-8", timeout: 1000 }).trim();

    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0] ?? "0", 10);
      const name = parts[1] ?? "";
      const cpu = parseFloat(parts[2] ?? "0");
      const mem = parseFloat(parts[3] ?? "0");
      const rss = parseInt(parts[4] ?? "0", 10);
      const state = parts[5] ?? "?";
      const elapsed = parts[6] ?? "";
      const user = parts[7] ?? "";
      const command = parts.slice(1).join(" ");

      return {
        pid,
        name,
        command: command.length > 200 ? command.slice(0, 200) + "…" : command,
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

function mapBsdState(s: string): string {
  switch (s) {
    case "R": return "R";
    case "S": return "S";
    case "Z": return "Z";
    case "T": return "T";
    case "I": return "S";
    default: return s;
  }
}

// ─── Port Scanner ────────────────────────────────────────────────

function detectListeningPorts(pid: number): number[] {
  try {
    // Read per-process /proc/[pid]/net/tcp to find ports owned by this process
    // This is only available on Linux and only readable by the process owner or root
    const tcpFile = `/proc/${pid}/net/tcp`;
    const tcp6File = `/proc/${pid}/net/tcp6`;
    const ports: number[] = [];

    for (const f of [tcpFile, tcp6File]) {
      try {
        const data = readSafe(f);
        if (data) {
          for (const port of parseProcNetTcp(data)) {
            if (!ports.includes(port)) ports.push(port);
          }
        }
      } catch {
        continue;
      }
    }

    return ports.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function parseProcNetTcp(data: string): number[] {
  const ports: number[] = [];
  const lines = data.split("\n").slice(1); // Skip header

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;

    const localAddr = parts[1] ?? "";
    const state = parts[3] ?? "";

    // Only LISTEN state (0x0A)
    if (state !== "0A") continue;

    // Format: 00000000:0050 (hex IP:hex port)
    const portMatch = localAddr.match(/:([0-9a-fA-F]+)$/);
    if (portMatch) {
      const port = parseInt(portMatch[1]!, 16);
      if (port > 0 && port <= 65535) {
        ports.push(port);
      }
    }
  }

  return ports;
}

// ─── Helpers ─────────────────────────────────────────────────────

function readSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readTotalMem(): number {
  try {
    const memInfo = readSafe("/proc/meminfo");
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
    const data = readSafe("/proc/uptime");
    if (data) {
      return parseFloat(data.split(/\s+/)[0] ?? "0");
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

  // Try /proc first (Linux), fall back to ps (macOS/BSD)
  if (existsSync("/proc")) {
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
        (p) => p.name.toLowerCase().includes(nameLower) || p.command.toLowerCase().includes(nameLower),
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
          case "cpu":  return b.cpuPercent - a.cpuPercent;
          case "mem":  return b.memPercent - a.memPercent;
          case "pid":  return a.pid - b.pid;
          case "name": return a.name.localeCompare(b.name);
          default:     return b.cpuPercent - a.cpuPercent;
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
export function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
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
 * Get human-readable process state.
 */
export function formatProcessState(state: string): string {
  switch (state) {
    case "R": return "Running";
    case "S": return "Sleeping";
    case "D": return "Disk Sleep";
    case "Z": return "Zombie";
    case "T": return "Stopped";
    case "t": return "Tracing";
    case "X": return "Dead";
    case "I": return "Idle";
    default:  return state;
  }
}
