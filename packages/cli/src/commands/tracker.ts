/**
 * Process Tracker — Shared state for managing ~/.fennec/tracked.json
 * Extracted from index.ts to be reusable across all CLI command files.
 */
import {
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  renameSync,
  statSync,
  rmSync,
  openSync,
  closeSync,
  writeSync,
} from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import {
  isProcessRunning,
  getProcessCmdline,
  getProcessEnviron,
  getProcessCwd,
  findPidOnPort,
  killTree,
} from '../utils/system-process.js';

export interface TrackedProcess {
  name: string;
  pid: number;
  command: string;
  /**
   * The raw argv used to spawn the process. Preferred over `command`
   * (a display string) when re-spawning, because splitting `command`
   * on whitespace breaks arguments that contain spaces/quotes.
   */
  args?: string[];
  port?: number;
  cwd?: string;
  /**
   * Environment captured when the app was first started. Re-applied on
   * spawn/respawn so apps started in one terminal keep their variables
   * (DATABASE_URL, PATH from nvm, NODE_ENV, ...) even when later managed
   * from a different terminal or by the detached supervisor.
   */
  env?: Record<string, string>;
  startedAt: string;
  /** When true, the supervisor daemon auto-restarts this app if it dies. */
  autoRestart?: boolean;
  /** Restart-cause annotation (e.g. "crash", "port-down") set by supervisor. */
  restartCause?: string;
  /** True when the supervisor has restarted this app repeatedly in a short
   *  window (crash-loop / flapping) — surfaced so users know it's unstable. */
  flapping?: boolean;
  /**
   * Log format written by spawnDaemon. "text" = raw app output (human
   * readable, default). "jsonl" = structured per-line JSON (timestamp +
   * level + source) so AI tools can query/filter reliably. Stored so
   * re-spawns keep the same format.
   */
  logMode?: 'text' | 'jsonl';
  /** HTTP readiness URL (resolved at spawn) — supervisor health-checks this
   *  instead of a bare TCP port when present. */
  healthCheck?: string;
  /** Optional logical group this entry belongs to (e.g. "crm", "staging"). */
  group?: string;
  /** True if the process was manually stopped by the user. */
  manualStop?: boolean;
}

export type TargetKind = 'single' | 'names' | 'group' | 'all' | 'none';
export interface Target {
  kind: TargetKind;
  /** name or pid string for kind === "single" */
  value?: string;
  /** multiple names/pids for kind === "names" (e.g. `kill a b c`) */
  values?: string[];
  /** group name for kind === "group" */
  group?: string;
}

/** Extract `--flag value`, `--flag=value`, or `-f value` from args. */
export function extractFlagValue(args: string[], long: string, short?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === long || (short && a === short)) return args[i + 1];
    if (a.startsWith(`${long}=`)) return a.slice(long.length + 1);
    if (short && a.startsWith(`${short}=`)) return a.slice(short.length + 1);
  }
  return undefined;
}

/** Distinct non-empty groups present in tracked.json, sorted. */
export function getGroups(): string[] {
  const tracked = readTracked();
  const groups = new Set<string>();
  for (const t of tracked) if (t.group) groups.add(t.group);
  return [...groups].sort();
}

/**
 * Resolve a bulk command's scope from its args:
 *  - `--group X` / `-g X`              → group X
 *  - positional matching a known group → group X (shorthand)
 *  - positional otherwise              → single name/pid
 *  - `--all` / `-a`                    → all tracked
 *  - nothing                           → none (caller decides)
 */
export function resolveTargets(args: string[]): Target {
  const groupFlag = extractFlagValue(args, '--group', '-g');
  const all = args.includes('--all') || args.includes('-a');
  // All non-flag, non `--key=value` positionals (names/pids passed directly).
  const positionals = args.filter((a) => !a.startsWith('-') && !a.includes('='));
  const groups = getGroups();

  if (groupFlag) return { kind: 'group', group: groupFlag };
  // Legacy bare `kill all` / `stop all` / `spawn all` — means "all tracked".
  if (positionals.length === 1 && positionals[0] === 'all') return { kind: 'all' };
  if (all) return { kind: 'all' };
  // Single positional that matches a known group → group shorthand.
  if (positionals.length === 1 && groups.includes(positionals[0]!)) {
    return { kind: 'group', group: positionals[0] };
  }
  if (positionals.length === 1) return { kind: 'single', value: positionals[0] };
  if (positionals.length > 1) return { kind: 'names', values: positionals };
  return { kind: 'none' };
}

/** Assign (or clear, with `undefined`) a group on an existing tracked entry. */
export function setGroup(name: string, group?: string): boolean {
  const tracked = readTracked();
  const idx = tracked.findIndex((t) => t.name === name);
  if (idx === -1) return false;
  tracked[idx] = { ...tracked[idx]!, group };
  saveTracked(tracked);
  return true;
}

/** Marker line written to a log when the supervisor restarts an app. */
export const RESTART_CAUSE = 'fennec:restart';

export function getFennecDir(): string {
  return process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), '.fennec');
}

export function getTrackedPath(): string {
  return resolve(getFennecDir(), 'tracked.json');
}

/** Path to the supervisor daemon's PID file. */
export function getSupervisorPidPath(): string {
  return resolve(getFennecDir(), 'supervisor.pid');
}

/** Absolute path to an app's log file (respects FENNEC_DATA_DIR). */
export function logFilePathFor(name: string): string {
  return resolve(getFennecDir(), 'logs', `${name}.log`);
}

export function readTracked(): TrackedProcess[] {
  try {
    const path = getTrackedPath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveTracked(processes: TrackedProcess[]): void {
  try {
    const path = getTrackedPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(processes, null, 2), 'utf-8');
  } catch (err) {
    console.error(
      '[fennec] Failed to save tracked processes:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function addTracked(proc: TrackedProcess): void {
  const tracked = readTracked();
  const filtered = tracked.filter((t) => t.name !== proc.name);
  filtered.push({ ...proc, manualStop: false });
  saveTracked(filtered);
}

export function removeTracked(name: string): void {
  const tracked = readTracked();
  saveTracked(tracked.filter((t) => t.name !== name));
}

/**
 * Toggle the auto-restart flag for a tracked app by name.
 * Used so an intentional `stop` isn't immediately undone by the supervisor.
 */
export function setAutoRestart(name: string, value: boolean): void {
  const tracked = readTracked();
  let changed = false;
  for (const t of tracked) {
    if (t.name === name) {
      t.autoRestart = value;
      changed = true;
    }
  }
  if (changed) saveTracked(tracked);
}

export function setManualStop(name: string, value: boolean): void {
  const tracked = readTracked();
  let changed = false;
  for (const t of tracked) {
    if (t.name === name) {
      t.manualStop = value;
      changed = true;
    }
  }
  if (changed) saveTracked(tracked);
}

export function removeTrackedByPid(pid: number): void {
  const tracked = readTracked();
  saveTracked(tracked.filter((t) => t.pid !== pid));
}

/**
 * Resolve the argv for a tracked process. Prefers the stored `args`
 * array (spawn-safe); falls back to whitespace-splitting `command`
 * for entries saved before `args` existed.
 */
export function resolveArgs(proc: Pick<TrackedProcess, 'args' | 'command'>): string[] {
  if (proc.args && proc.args.length > 0) return proc.args;
  return proc.command.split(/\s+/).filter(Boolean);
}

/**
 * Adopt an ALREADY-RUNNING process (started via raw bash, another tool, or a
 * previous session) into fennec's tracked registry — without restarting it.
 * This is the human-facing counterpart to the agent's `process_adopt`: it
 * stops an externally-launched server from becoming an untracked orphan (and
 * prevents `start`/`spawn` from creating a duplicate that fails with
 * EADDRINUSE). Enriches the entry from /proc when details are omitted.
 */
export function adoptProcess(
  pid: number,
  opts: {
    name?: string;
    port?: number;
    command?: string;
    cwd?: string;
    env?: Record<string, string>;
    autoRestart?: boolean;
  } = {},
): TrackedProcess | null {
  if (!isProcessRunning(pid)) return null;
  const command = opts.command ?? getProcessCmdline(pid) ?? `pid ${pid}`;
  const cwd = opts.cwd ?? getProcessCwd(pid) ?? undefined;
  const name = opts.name ?? `pid_${pid}`;
  const entry: TrackedProcess = {
    name,
    pid,
    command,
    port: opts.port,
    cwd,
    env: opts.env,
    startedAt: new Date().toISOString(),
    autoRestart: opts.autoRestart ?? true,
    flapping: false,
  };
  addTracked(entry);
  return entry;
}

/**
 * If something is ALREADY listening on `port` (e.g. an AI agent launched the
 * server via raw bash, or a previous `start` is still bound), adopt that
 * existing process instead of spawning a duplicate that would fail with
 * EADDRINUSE. Returns the adopted entry, or null if nothing is listening (or
 * the listener is already one of our tracked processes).
 */
export function adoptExternalOnPort(port: number, name?: string): TrackedProcess | null {
  const occ = findPidOnPort(port);
  if (!occ) return null;
  const tracked = readTracked();
  if (tracked.some((t) => t.pid === occ.pid)) return null; // already ours
  return adoptProcess(occ.pid, { port, name });
}

/**
 * Verify a tracked process is genuinely still OUR process — not just a
 * live PID. Guards against PID reuse: after a process dies the OS may
 * assign the same PID to an unrelated program, which would otherwise
 * show up as a false "running". We confirm the live PID's cmdline still
 * matches the executable we spawned.
 *
 * On platforms without /proc (cmdline unavailable) we can't verify, so
 * we fall back to the plain liveness check to avoid false negatives.
 */
export function isTrackedRunning(proc: TrackedProcess): boolean {
  if (!isProcessRunning(proc.pid)) return false;

  // Preferred: verify ownership via the FENNEC_APP_NAME marker we inject at
  // spawn. Robust even if the app re-execs a different binary (where cmdline
  // matching would wrongly report "dead"). Only treat the marker as
  // authoritative when it is PRESENT — an adopted/external process has no
  // marker, so we must fall through to the cmdline check instead of assuming
  // "not ours".
  const environ = getProcessEnviron(proc.pid);
  if (environ && 'FENNEC_APP_NAME' in environ) {
    return environ.FENNEC_APP_NAME === proc.name;
  }

  // Fallback (non-Linux / no /proc/environ): trust cmdline basename match.
  const cmdline = getProcessCmdline(proc.pid);
  if (!cmdline) return true; // cannot verify — trust the PID

  const argv = resolveArgs(proc);
  const exe = argv[0];
  if (!exe) return true;

  // The process was spawned directly, so argv[0] should appear in the
  // live cmdline. Compare on basename to tolerate absolute-path resolution.
  const exeBase = basename(exe);
  if (exeBase.length === 0) return true;
  return cmdline.includes(exeBase);
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
      try {
        rmSync(oldestPath);
      } catch {
        /* best-effort */
      }
    }

    // Shift existing rotations
    for (let i = maxFiles - 1; i >= 1; i--) {
      const src = resolve(dir, `${base}.${i}`);
      const dst = resolve(dir, `${base}.${i + 1}`);
      if (existsSync(src)) {
        try {
          renameSync(src, dst);
        } catch {
          /* best-effort */
        }
      }
    }

    // Rotate current file
    try {
      renameSync(filePath, resolve(dir, `${base}.1`));
    } catch {
      /* best-effort */
    }

    return true;
  } catch (err) {
    console.error(
      '[fennec] Log rotation failed:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

// ─── Daemon Spawner ───────────────────────────────────────────────
// Spawns a detached daemon whose stdout/stderr are redirected DIRECTLY
// to the log file descriptor (style). This is critical: it means
// the child writes its own logs to disk, so the launching CLI process
// can exit immediately without killing logging — and `fennec log -f`
// keeps receiving new lines after the launcher is gone.

export interface SpawnDaemonOptions {
  cmdParts: string[];
  /** App name — injected as FENNEC_APP_NAME so fennec can verify ownership. */
  name: string;
  cwd?: string;
  logFilePath: string;
  env?: Record<string, string>;
  /** "jsonl" writes structured per-line JSON (timestamp+level+source+line). */
  logMode?: 'text' | 'jsonl';
}

// ─── Secret redaction (AI-safe) ───────────────────────────────────
// Mirrors the core package so daemon-written logs never hit disk with
// raw credentials. Best-effort: keeps a hint of the shape for debugging.
/**
 * Build the environment for a spawned app. Starts from the environment
 * captured at `start` time (so app-specific vars survive being managed
 * from another terminal/supervisor), then overlays the current process
 * environment so live system paths (PATH, HOME, TERM, ...) are current,
 * and finally pins fennec's own state dirs so the child logs/supervises
 * into the same fennec instance regardless of where it's launched.
 */
export function buildSpawnEnv(stored?: Record<string, string>): Record<string, string> {
  // Start from the live environment so system paths (PATH, HOME, TERM, ...)
  // stay current, then overlay the explicitly-provided (start-time/config)
  // env so those values win over anything inherited. This keeps config
  // `env: { PORT: "47111" }` authoritative instead of being clobbered.
  const merged: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [k, v] of Object.entries(stored ?? {})) {
    if (v !== undefined) merged[k] = v;
  }
  if (process.env.FENNEC_DATA_DIR) merged.FENNEC_DATA_DIR = process.env.FENNEC_DATA_DIR;
  if (process.env.HOME) merged.HOME = process.env.HOME;
  return merged;
}

/**
 * Spawn a detached background process that logs directly to a file.
 * The returned ChildProcess is unref'd so it won't keep the parent
 * event loop alive. The parent may still listen to its "exit" event
 * (e.g. for --restart watching) as long as the loop is kept alive by
 * other means.
 */
/**
 * Respawn a tracked process quietly (no UI) and update its registry entry
 * with the new PID/args. Returns the new PID. Used by the supervisor and
 * by command-level respawns.
 */
export function respawnTracked(proc: TrackedProcess, cause?: string): number {
  const cmdParts = resolveArgs(proc);
  const logFilePath = logFilePathFor(proc.name);
  mkdirSync(dirname(logFilePath), { recursive: true });
  if (cause) annotateRestart(logFilePath, cause);
  // Kill the (possibly still-alive) previous instance so a "port-down"
  // restart doesn't leave an orphan holding the port (which would then
  // cause an EADDRINUSE cascade on the new instance). Kill the whole
  // tree so grandchildren (npm → vite → esbuild) don't survive.
  if (isProcessRunning(proc.pid)) {
    try {
      killTree(proc.pid, 'SIGTERM');
    } catch {
      /* best-effort */
    }
  }
  const child = spawnDaemon({
    cmdParts,
    name: proc.name,
    cwd: proc.cwd,
    logFilePath,
    env: buildSpawnEnv(proc.env),
    logMode: proc.logMode,
  });
  const pid = child.pid ?? 0;
  addTracked({
    ...proc,
    pid,
    args: cmdParts,
    startedAt: new Date().toISOString(),
    restartCause: cause,
  });
  return pid;
}

/**
 * Spawn a process as a detached daemon whose output is written straight to the
 * log file, so logs survive the launching CLI process exiting.
 *
 * - text mode: the child inherits the log file fd directly.
 * - jsonl mode: a tiny detached relay process wraps each line as structured
 *   JSON ({ts,level,source,line}) and writes to the file. The relay outlives
 *   the launching CLI because it is detached (otherwise the parent relay would
 *   die with the CLI and lose all output).
 */
export function spawnDaemon(opts: SpawnDaemonOptions): ChildProcess {
  rotateLogFile(opts.logFilePath);
  // Inject a marker so fennec can verify process ownership even if the app
  // later re-execs a different binary (cmdline matching alone is fragile).
  const env = { ...(opts.env ?? buildSpawnEnv()), FENNEC_APP_NAME: opts.name };
  if (opts.logMode === 'jsonl') {
    return spawnDaemonJsonl(opts, env);
  }
  const fd = openSync(opts.logFilePath, 'a');
  const child = spawn(opts.cmdParts[0]!, opts.cmdParts.slice(1), {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  child.unref();
  // Child now owns a dup of the fd; we can close our copy.
  child.once('spawn', () => {
    try {
      closeSync(fd);
    } catch {
      /* best-effort */
    }
  });
  return child;
}

/** jsonl variant: a detached relay reads the child's stdout+stderr and writes JSONL. */
function spawnDaemonJsonl(opts: SpawnDaemonOptions, env: Record<string, string>): ChildProcess {
  const relay = spawn(process.execPath, ['-e', JSONL_RELAY], {
    env: { ...process.env, FENNEC_RELAY_LOG: opts.logFilePath },
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
  });
  relay.unref();
  const child = spawn(opts.cmdParts[0]!, opts.cmdParts.slice(1), {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', relay.stdin!, relay.stdin!],
    detached: true,
  });
  child.unref();
  // Release the parent's hold on the relay's stdin write-end. `spawn` dups the
  // fd into the child, so the child keeps writing; but destroying our copy
  // means the relay receives EOF (and exits) when the child dies — otherwise a
  // long-lived parent (the supervisor) would keep the pipe open forever and
  // leak relays (which also risks SIGPIPE-killing the app).
  try {
    relay.stdin?.destroy();
  } catch {
    /* best-effort */
  }
  // The relay flushes and exits once the child's streams close.
  return child;
}

/**
 * Self-contained JSONL relay (runs in a detached node process). Reads raw lines
 * from stdin, redacts obvious secrets, classifies level, and appends structured
 * JSON to the file named by FENNEC_RELAY_LOG.
 */
const JSONL_RELAY = `
const fs = require('fs');
const fd = fs.openSync(process.env.FENNEC_RELAY_LOG, 'a');
let buf = '';
const SECRET = new RegExp('(password|passwd|token|secret|api[_-]?key|access[_-]?key).{0,60}', 'gi');
function redact(s){ return s.replace(SECRET, '$1***'); }
function level(s){
  const t = s.toLowerCase();
  if (t.indexOf('error')>=0 || t.indexOf('fail')>=0 || t.indexOf('fatal')>=0 || t.indexOf('exception')>=0 || t.indexOf('denied')>=0 || t.indexOf('refused')>=0 || t.indexOf('cannot')>=0 || t.indexOf('panic')>=0) return 'error';
  if (t.indexOf('warn')>=0) return 'warn';
  return 'info';
}
function flush(){
  const parts = buf.split('\\n');
  buf = parts.pop() || '';
  for (const r of parts){
    if (!r) continue;
    const line = redact(r);
    try { fs.writeSync(fd, JSON.stringify({ ts: new Date().toISOString(), level: level(line), source: 'app', line }) + '\\n'); } catch (e) {}
  }
}
process.stdin.on('data', (c) => { buf += c.toString('utf8'); flush(); });
process.stdin.on('end', () => { flush(); try { fs.closeSync(fd); } catch (e) {} process.exit(0); });
process.stdin.on('error', () => { process.exit(0); });
`;

/** Write a restart-cause separator into the log (used by the supervisor). */
export function annotateRestart(logFilePath: string, cause: string): void {
  try {
    const fd = openSync(logFilePath, 'a');
    try {
      writeSync(fd, `\n${RESTART_CAUSE} cause=${cause} at=${new Date().toISOString()}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* best-effort */
  }
}
