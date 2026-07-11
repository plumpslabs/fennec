/**
 * Command: supervisor — A detached background daemon that keeps
 * auto-restart apps alive even after the launching terminal is closed.
 *
 * Unlike the old foreground `--restart` watcher (which died when you
 * closed the terminal), the supervisor runs as its own detached process.
 * It polls tracked.json and re-spawns any app flagged `autoRestart` that
 * has died — with crash-loop backoff to avoid hammering a broken app.
 *
 * Sub-commands:
 *   fennec supervisor start     Start the supervisor daemon
 *   fennec supervisor stop      Stop it
 *   fennec supervisor status    Show status + managed apps
 *   fennec supervisor restart   Restart the daemon
 *
 * Internal:
 *   fennec __supervisor         The daemon loop itself (not user-facing)
 */
import pc from "picocolors";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { symbols, renderError, renderKV, createSpinner } from "../utils/format.js";
import { isProcessRunning, checkPort, checkHttp, resolveHealthUrl } from "../utils/system-process.js";
import {
  readTracked,
  respawnTracked,
  addTracked,
  isTrackedRunning,
  getSupervisorPidPath,
  logFilePathFor,
  rotateLogFile,
} from "./tracker.js";
import type { TrackedProcess } from "./tracker.js";

const POLL_INTERVAL_MS = 3000;
const CRASH_WINDOW_MS = 60_000; // window for crash-loop detection
const MAX_RESTARTS_IN_WINDOW = 5; // give up after this many crashes in the window
// Restarts (crash OR port-down) at/above this many within the window mark the
// app as "flapping" so users can see it's unstable in `dev status`.
const FLAPPING_THRESHOLD = 3;
// Don't health-check the port during this window after a (re)start: slow
// apps may take several seconds to begin listening, and killing them for a
// transient "not listening yet" would cause a restart loop.
const PORT_GRACE_MS = 15_000;
// Periodic log rotation: even long-lived apps that never restart would
// otherwise grow their log file without bound. Check hourly and rotate any
// log exceeding the size cap (see rotateLogFile defaults).
const LOG_ROTATE_CHECK_MS = 60 * 60 * 1000;

// ─── Public helpers ──────────────────────────────────────────────

/** Read the supervisor PID if the daemon is currently running. */
export function getSupervisorPid(): number | null {
  const path = getSupervisorPidPath();
  if (!existsSync(path)) return null;
  const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
  if (isNaN(pid)) return null;
  return isProcessRunning(pid) ? pid : null;
}

export function isSupervisorRunning(): boolean {
  return getSupervisorPid() !== null;
}

/**
 * Ensure the supervisor daemon is running; start it (detached) if not.
 * Returns the running PID. Safe to call repeatedly.
 */
export function ensureSupervisorRunning(): number {
  const existing = getSupervisorPid();
  if (existing) return existing;
  return startSupervisorDaemon();
}

/** Spawn the supervisor as a detached daemon and return its PID. */
export function startSupervisorDaemon(): number {
  const logFilePath = logFilePathFor("supervisor");
  mkdirSync(dirname(logFilePath), { recursive: true });
  const fd = openSync(logFilePath, "a");

  // Re-invoke this same CLI with the internal __supervisor command.
  const child = spawn(process.execPath, [process.argv[1]!, "__supervisor"], {
    env: { ...process.env },
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  child.once("spawn", () => { try { closeSync(fd); } catch { /* best-effort */ } });
  return child.pid ?? 0;
}

// ─── User-facing command ─────────────────────────────────────────

export async function supervisorCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";

  switch (sub) {
    case "start":
      return supervisorStart();
    case "stop":
      return supervisorStop();
    case "restart":
      await supervisorStop();
      return supervisorStart();
    case "status":
      return supervisorStatus();
    default:
      console.error(renderError("Unknown sub-command", `"${sub}" — use: start | stop | status | restart`));
      process.exit(1);
  }
}

function supervisorStart(): void {
  const existing = getSupervisorPid();
  if (existing) {
    console.error(`\n  ${pc.yellow("⚠")} Supervisor already running ${pc.dim(`(PID ${existing})`)}\n`);
    return;
  }
  const pid = startSupervisorDaemon();
  console.error(`\n  ${pc.green("✓")} ${pc.bold("Supervisor started")} ${pc.dim(`(PID ${pid})`)}`);
  console.error(`  ${renderKV("Logs", pc.cyan("fennec log supervisor"))}`);
  console.error(`  ${pc.dim("It will auto-restart apps started with")} ${pc.cyan("--restart")} ${pc.dim("even if you close this terminal.")}\n`);
}

function supervisorStop(): void {
  const pid = getSupervisorPid();
  if (!pid) {
    console.error(`\n  ${pc.dim("Supervisor is not running.")}\n`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.error(`\n  ${pc.green("✓")} ${pc.bold("Supervisor stopped")} ${pc.dim(`(PID ${pid})`)}\n`);
  } catch (err) {
    console.error(renderError("Failed to stop supervisor", String(err)));
  }
  try { unlinkSync(getSupervisorPidPath()); } catch { /* best-effort */ }
}

function supervisorStatus(): void {
  const pid = getSupervisorPid();
  const tracked = readTracked();
  const managed = tracked.filter((t) => t.autoRestart);

  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Supervisor")}`);
  if (pid) {
    console.error(`  ${pc.green("●")} running ${pc.dim(`(PID ${pid})`)}`);
  } else {
    console.error(`  ${pc.red("○")} not running ${pc.dim("— start with")} ${pc.cyan("fennec supervisor start")}`);
  }

  console.error(`\n  ${pc.bold("Managed apps")} ${pc.dim(`(${managed.length} with auto-restart)`)}`);
  if (managed.length === 0) {
    console.error(`  ${pc.dim("None. Start one with")} ${pc.cyan("fennec start <cmd> --name <name> --restart")}`);
  } else {
    for (const t of managed) {
      const running = isTrackedRunning(t);
      const dot = running ? pc.green("●") : pc.red("○");
      const state = running ? pc.green(`running (PID ${t.pid})`) : pc.red("stopped");
      console.error(`  ${dot} ${pc.bold(t.name)} ${pc.dim("—")} ${state}`);
    }
  }
  console.error();
}

// ─── The daemon loop (internal `__supervisor`) ───────────────────

interface CrashRecord {
  windowStart: number;
  count: number;
  gaveUp: boolean;
  /** Consecutive port health-check failures (app alive but not listening). */
  portFails: number;
}

/** Restart an app after this many consecutive port health-check failures. */
const PORT_FAIL_THRESHOLD = 2;

export async function runSupervisor(): Promise<void> {
  const pidPath = getSupervisorPidPath();
  mkdirSync(dirname(pidPath), { recursive: true });

  // Refuse to run twice.
  const existing = getSupervisorPid();
  if (existing && existing !== process.pid) {
    log(`supervisor already running (PID ${existing}); exiting`);
    return;
  }
  writeFileSync(pidPath, String(process.pid), "utf-8");
  log(`supervisor started (PID ${process.pid}), polling every ${POLL_INTERVAL_MS}ms`);

  const crashes = new Map<string, CrashRecord>();
  let stopped = false;

  const cleanup = (): void => {
    stopped = true;
    try { unlinkSync(pidPath); } catch { /* best-effort */ }
    log("supervisor stopping");
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  const tick = async (): Promise<void> => {
    if (stopped) return;
    let tracked;
    try {
      tracked = readTracked();
    } catch (err) {
      log(`failed to read tracked.json: ${String(err)}`);
      return;
    }

    for (const t of tracked) {
      if (!t.autoRestart) continue;

      // Port health-check: the app is alive but not listening on its
      // advertised port (hung / deadlocked). This catches the "running
      // but broken" case that a plain PID check misses. Only apps with a
      // `port` are health-checked; we require a couple of consecutive
      // failures to avoid restarting during slow startup. Skipped during
      // the post-start grace window so slow apps aren't killed prematurely.
      if (t.port && isTrackedRunning(t)) {
        const startedAt = Date.parse(t.startedAt);
        const ageMs = Number.isNaN(startedAt) ? Number.POSITIVE_INFINITY : Date.now() - startedAt;
        if (ageMs >= PORT_GRACE_MS) {
          let rec = crashes.get(t.name);
          if (!rec) {
            rec = { windowStart: Date.now(), count: 0, gaveUp: false, portFails: 0 };
            crashes.set(t.name, rec);
          }
          let listening = false;
          const healthUrl = t.healthCheck ? resolveHealthUrl(t.healthCheck, t.port) : null;
          try {
            listening = healthUrl ? await checkHttp(healthUrl) : await checkPort(t.port);
          } catch {
            listening = false;
          }
          if (listening) {
            rec.portFails = 0;
            // App has been listening steadily through a full window — clear any
            // stale flapping flag.
            if (t.flapping && Date.now() - rec.windowStart > CRASH_WINDOW_MS) setFlapping(t, false);
          } else {
            rec.portFails++;
            const probe = healthUrl ? `health check ${healthUrl}` : `port ${t.port}`;
            if (rec.portFails >= PORT_FAIL_THRESHOLD) {
              rec.portFails = 0;
              rec.count++;
              if (rec.count >= FLAPPING_THRESHOLD) setFlapping(t, true);
              log(`${t.name}: alive but ${probe} not responding ${PORT_FAIL_THRESHOLD}x — restarting`);
              try {
                const newPid = respawnTracked(t, "port-down");
                log(`${t.name}: restarted (PID ${newPid}) after ${probe} failure`);
              } catch (err) {
                log(`${t.name}: restart failed: ${String(err)}`);
              }
            } else {
              log(`${t.name}: ${probe} not responding (${rec.portFails}/${PORT_FAIL_THRESHOLD})`);
            }
          }
        }
        continue;
      }

      if (isTrackedRunning(t)) continue;

      // Crash-loop backoff.
      const now = Date.now();
      let rec = crashes.get(t.name);
      // Allow a retry once the crash window has elapsed since we gave up.
      if (rec?.gaveUp && now - rec.windowStart > CRASH_WINDOW_MS) rec = undefined;
      if (!rec || now - rec.windowStart > CRASH_WINDOW_MS) {
        rec = { windowStart: now, count: 0, gaveUp: false, portFails: 0 };
        crashes.set(t.name, rec);
        if (t.flapping) setFlapping(t, false); // old window elapsed — clear stale flag
      }
      if (rec.gaveUp) continue;
      if (rec.count >= MAX_RESTARTS_IN_WINDOW) {
        rec.gaveUp = true;
        log(`${t.name}: crashed ${rec.count}x in <60s — giving up (will retry after window resets)`);
        continue;
      }

      rec.count++;
      if (rec.count >= FLAPPING_THRESHOLD) setFlapping(t, true);
      try {
        const newPid = respawnTracked(t, "crash");
        log(`${t.name}: restarted (PID ${newPid}) [${rec.count}/${MAX_RESTARTS_IN_WINDOW} in window]`);
      } catch (err) {
        log(`${t.name}: restart failed: ${String(err)}`);
      }
    }
  };

  // Run immediately, then on an interval. The (ref'd) interval keeps the
  // process alive until it receives SIGTERM/SIGINT.
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
  // Rotate logs for long-lived apps that may never restart (bound the growth).
  setInterval(rotateAllLogs, LOG_ROTATE_CHECK_MS);
  await new Promise<void>(() => { /* run until SIGTERM/SIGINT */ });
}

/** Rotate the log of every tracked app whose log exceeds the size cap. */
function rotateAllLogs(): void {
  try {
    for (const t of readTracked()) {
      try {
        rotateLogFile(logFilePathFor(t.name));
      } catch { /* best-effort per-app */ }
    }
  } catch (err) {
    log(`log rotation pass failed: ${String(err)}`);
  }
}

function setFlapping(t: TrackedProcess, val: boolean): void {
  if (!!t.flapping === val) return;
  t.flapping = val;
  try {
    addTracked({ ...t, flapping: val });
  } catch { /* best-effort */ }
}

function log(msg: string): void {
  // stdout is redirected to the supervisor log file by the daemon spawner.
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}
