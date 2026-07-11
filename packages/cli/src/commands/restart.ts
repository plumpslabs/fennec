/**
 * Command: restart — Kill and re-spawn a tracked process from tracked.json config.
 * Fixed: now actually re-spawns (instead of just killing + suggesting manual re-run).
 */
import pc from "picocolors";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { renderError, renderCommand, createSpinner, confirmPrompt } from "../utils/format.js";
import { killProcess as sysKill, isProcessRunning } from "../utils/system-process.js";
import { readTracked, addTracked, removeTrackedByPid, spawnDaemon, resolveArgs, buildSpawnEnv } from "./tracker.js";

export async function restartCommand(args: string[]): Promise<void> {
  const raw = args[0];
  if (!raw) { console.error(renderError("Missing process name/pid", "Usage: fennec restart <name|pid> [-y]")); process.exit(1); }

  const tracked = readTracked();
  const pidNum = parseInt(raw, 10);
  // Resolve by tracked name OR by a tracked PID. Intentionally NOT falling back
  // to a system-wide name search — restart is only meaningful for Fennec-tracked
  // apps (it re-spawns from saved config). Killing arbitrary system processes by
  // name here would be a footgun (see the kill -all incident).
  const trackedEntry =
    tracked.find((t) => t.name === raw) ??
    (!isNaN(pidNum) && String(pidNum) === raw ? tracked.find((t) => t.pid === pidNum) : undefined);

  if (!trackedEntry) {
    console.error(renderError("Not tracked", `No tracked process named or with PID "${raw}".\nfennec restart only re-spawns Fennec-tracked apps (from their saved config).`));
    process.exit(1);
  }

  const targetPid = trackedEntry.pid;
  const force = args.includes("-y") || args.includes("--yes");
  const confirmed = force || (await confirmPrompt(`Restart ${pc.bold(`${trackedEntry.name} (PID ${targetPid})`)}?`, false));
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}`); return; }

  const spinner = createSpinner(`Stopping ${trackedEntry.name} (PID ${targetPid})...`);
  const killed = sysKill(targetPid, "SIGTERM");
  if (!killed) { spinner.fail(`Failed to stop PID ${targetPid}`); return; }

  await new Promise((r) => setTimeout(r, 1000));
  if (isProcessRunning(targetPid)) {
    spinner.warn("Process didn't stop, sending SIGKILL...");
    sysKill(targetPid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
  }

  spinner.succeed(`${trackedEntry.name} stopped`);

  const respawnSpinner = createSpinner(`Re-spawning ${trackedEntry.name}...`);
  try {
    const cmdParts = resolveArgs(trackedEntry);
    const logDir = resolve(homedir(), ".fennec", "logs");
    mkdirSync(logDir, { recursive: true });
    const logFilePath = resolve(logDir, `${trackedEntry.name}.log`);

    const child = spawnDaemon({ cmdParts, name: trackedEntry.name, cwd: trackedEntry.cwd, logFilePath, env: buildSpawnEnv(trackedEntry.env), logMode: trackedEntry.logMode });

    // Remove old PID entry, add new one (only after successful spawn)
    removeTrackedByPid(targetPid);
    addTracked({
      name: trackedEntry.name,
      pid: child.pid ?? 0,
      command: trackedEntry.command,
      args: cmdParts,
      port: trackedEntry.port,
      cwd: trackedEntry.cwd,
      env: trackedEntry.env,
      startedAt: new Date().toISOString(),
      autoRestart: trackedEntry.autoRestart,
      logMode: trackedEntry.logMode,
    });

    respawnSpinner.succeed(`${trackedEntry.name} restarted (PID: ${child.pid})`);
  } catch (error) {
    respawnSpinner.fail(`Failed to re-spawn ${trackedEntry.name}: ${String(error)}`);
    console.error(`  ${pc.dim("Config preserved. Re-run manually:")} ${renderCommand(trackedEntry.command)}`);
  }
}
