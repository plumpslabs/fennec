/**
 * Process Tracking — Syncs CLI-tracked processes (tracked.json) with MCP tools.
 * Used by process_spawn, process_kill, process_restart tools to maintain
 * a persistent process registry accessible from both CLI (`fennec ps`)
 * and MCP tools (`process_get_tracked`).
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { isProcessRunning, getProcessEnviron, getProcessCmdline } from '../utils/system-process.js';
import { getLogger } from '../utils/logger.js';

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
  /** Optional group this entry belongs to (enables group-scoped bulk ops). */
  group?: string;
  /** Log capture mode (mirrors CLI). */
  logMode?: 'text' | 'json';
  /**
   * True when the user/agent explicitly stopped this process.
   * Prevents resurrectTracked() from re-spawning it on server restart.
   * Cleared (set to false) when the process is spawned/resumed.
   */
  manualStop?: boolean;
}

export function getTrackedPath(): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), '.fennec');
  return resolve(dir, 'tracked.json');
}

/** Absolute path to an app's on-disk log file. MUST match the CLI's
 *  `logFilePathFor` (same data-dir resolution) so logs written by an
 *  MCP-spawned/adopted process are exactly where `fennec log` reads them. */
export function logPathFor(name: string): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), '.fennec');
  return resolve(dir, 'logs', `${name}.log`);
}

export function readTracked(): TrackedEntry[] {
  try {
    const path = getTrackedPath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveTracked(processes: TrackedEntry[]): void {
  try {
    const path = getTrackedPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(processes, null, 2), 'utf-8');
  } catch (err) {
    getLogger().error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to save tracked processes',
    );
  }
}

export function addTracked(proc: TrackedEntry): void {
  const tracked = readTracked();
  const filtered = tracked.filter((t) => t.name !== proc.name);
  // A fresh spawn/resume clears the manualStop flag so resurrection can
  // work for future deaths. This mirrors the CLI's addTracked behavior.
  filtered.push({ ...proc, manualStop: false });
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

// ─── Group + multi-target resolution (CLI parity) ───────────────
// Lets MCP tools do `process_kill --group backend`, `process_stop_tracked
// be-crm fe-crm`, `process_spawn_tracked --all`, etc. — the same bulk
// operations the CLI now supports.

export type Target =
  | { kind: 'single'; value: string }
  | { kind: 'names'; values: string[] }
  | { kind: 'group'; group: string }
  | { kind: 'all' }
  | { kind: 'none' };

/** Extract a flag's value from an args array (e.g. --group backend). */
export function extractFlagValue(args: string[], flag: string, alias?: string): string | undefined {
  const idx = args.findIndex((a) => a === flag || (alias && a === alias));
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/** List all distinct group names currently in tracked.json. */
export function getGroups(): string[] {
  const tracked = readTracked();
  const groups = new Set<string>();
  for (const t of tracked) if (t.group) groups.add(t.group);
  return [...groups];
}

/**
 * Resolve a list of positional args (+ flags) into a single/multi/group/all
 * target. Mirrors the CLI's `resolveTargets`.
 *
 *   kill be-crm fe-crm      -> { kind: "names", values: [...] }
 *   kill --group backend     -> { kind: "group", group: "backend" }
 *   kill --all / -a         -> { kind: "all" }
 *   kill web                -> { kind: "single", value: "web" }
 */
export function resolveTargets(args: string[]): Target {
  const groupFlag = extractFlagValue(args, '--group', '-g');
  if (groupFlag) return { kind: 'group', group: groupFlag };

  const allFlag = args.includes('--all') || args.includes('-a');
  if (allFlag) return { kind: 'all' };

  const positionals = args.filter((a) => !a.startsWith('-') && a !== 'all');
  if (positionals.length > 1) return { kind: 'names', values: positionals };
  if (positionals.length === 1) return { kind: 'single', value: positionals[0]! };

  return { kind: 'none' };
}

/** Rebuild the argv for re-spawning a tracked entry (mirrors CLI). */
export function resolveArgs(proc: TrackedEntry): string[] {
  if (proc.args && proc.args.length > 0) return [...proc.args];
  if (proc.command) return proc.command.split(/\s+/);
  return [proc.name];
}

/** Re-apply captured env on re-spawn so the app keeps its variables. */
export function buildSpawnEnv(env?: Record<string, string>): Record<string, string> {
  return { ...(process.env as Record<string, string>), ...(env ?? {}) };
}

/** Assign a group to an existing tracked entry (or remove by passing group:""). */
export function setGroup(name: string, group: string): boolean {
  const tracked = readTracked();
  const match = tracked.find((t) => t.name === name);
  if (!match) return false;
  if (group) match.group = group;
  else delete match.group;
  saveTracked(tracked);
  return true;
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

/**
 * Mark a tracked process as manually stopped (or not).
 * When true, `resurrectTracked()` will NOT re-spawn it on server restart.
 * Mirrors the CLI's setManualStop.
 */
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

/**
 * Robust check if a tracked process is actually running (not just dead/recycled PID).
 * Verifies ownership via the FENNEC_APP_NAME marker or command line basename match.
 */
export function isTrackedRunning(proc: TrackedEntry): boolean {
  // PID ≤ 0 is invalid — process.kill(0, 0) returns a false-positive
  // (it checks the calling process, not PID 0). Treat as not running.
  if (proc.pid <= 0) return false;
  if (!isProcessRunning(proc.pid)) return false;

  const environ = getProcessEnviron(proc.pid);
  if (environ && 'FENNEC_APP_NAME' in environ) {
    return environ.FENNEC_APP_NAME === proc.name;
  }

  const cmdline = getProcessCmdline(proc.pid);
  if (!cmdline) return true; // cannot verify — trust the PID

  const argv = resolveArgs(proc);
  const exe = argv[0];
  if (!exe) return true;

  const exeBase = basename(exe);
  if (exeBase.length === 0) return true;
  return cmdline.includes(exeBase);
}
