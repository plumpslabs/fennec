/**
 * Command: restart — Stop and re-spawn a tracked app from its saved config.
 * Supports a single name/pid, MULTIPLE names (`restart a b c`), or a
 * group (`--group <g>`). Unlike `fennec kill` (permanent), restart
 * re-spawns from saved config.
 */
import pc from "picocolors";
import { renderError, renderCommand, createSpinner, confirmPrompt } from "../utils/format.js";
import { killTree as sysKill, isProcessRunning } from "../utils/system-process.js";
import { readTracked, addTracked, removeTrackedByPid, spawnDaemon, resolveArgs, buildSpawnEnv, extractFlagValue, getGroups, resolveTargets, logFilePathFor, type TrackedProcess } from "./tracker.js";

export async function restartCommand(args: string[]): Promise<void> {
  const force = args.includes("-y") || args.includes("--yes");
  const target = resolveTargets(args);

  if (target.kind === "group") {
    await restartGroup(target.group!, force);
    return;
  }
  if (target.kind === "names") {
    for (const n of target.values!) await restartOne(n, force, true);
    return;
  }
  if (target.kind === "single") {
    await restartOne(target.value!, force, false);
    return;
  }

  console.error(renderError("Missing process name/pid", "Usage: fennec restart <name|pid> [-y] [--group <group>]"));
  process.exit(1);
}

/**
 * Restart ONE target (resolved by tracked name OR tracked PID). In `multi`
 * mode, failures print an error and return (instead of exiting) so the
 * rest of the batch can still be processed.
 */
async function restartOne(raw: string, force: boolean, multi: boolean): Promise<void> {
  const tracked = readTracked();
  const pidNum = parseInt(raw, 10);
  const trackedEntry =
    tracked.find((t) => t.name === raw) ??
    (!isNaN(pidNum) && String(pidNum) === raw ? tracked.find((t) => t.pid === pidNum) : undefined);

  if (!trackedEntry) {
    const msg = `No tracked process named or with PID "${raw}".\nfennec restart only re-spawns Fennec-tracked apps (from their saved config).`;
    if (multi) { console.error(renderError("Not tracked", msg)); return; }
    console.error(renderError("Not tracked", msg));
    process.exit(1);
  }

  const targetPid = trackedEntry.pid;
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
    const logFilePath = logFilePathFor(trackedEntry.name);

    const child = spawnDaemon({ cmdParts, name: trackedEntry.name, cwd: trackedEntry.cwd, logFilePath, env: buildSpawnEnv(trackedEntry.env), logMode: trackedEntry.logMode });

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
      group: trackedEntry.group,
    });

    respawnSpinner.succeed(`${trackedEntry.name} restarted (PID: ${child.pid})`);
  } catch (error) {
    respawnSpinner.fail(`Failed to re-spawn ${trackedEntry.name}: ${String(error)}`);
    console.error(`  ${pc.dim("Config preserved. Re-run manually:")} ${renderCommand(trackedEntry.command)}`);
  }
}

async function restartGroup(group: string, force: boolean): Promise<void> {
  const tracked = readTracked();
  const inGroup = tracked.filter((t) => t.group === group);
  if (inGroup.length === 0) {
    console.error(renderError("Empty group", `No tracked entries in group "${group}".\nKnown groups: ${pc.cyan(getGroups().join(", ") || "(none)")}`));
    process.exit(1);
  }

  const confirmed = force || (await confirmPrompt(`Restart ${pc.bold(`${inGroup.length}`)} process(es) in group ${pc.cyan(group)}?`, false));
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}`); return; }

  for (const trackedEntry of inGroup) {
    const spinner = createSpinner(`Restarting ${trackedEntry.name}...`);
    try {
      const cmdParts = resolveArgs(trackedEntry);
      const logFilePath = logFilePathFor(trackedEntry.name);

      const child = spawnDaemon({ cmdParts, name: trackedEntry.name, cwd: trackedEntry.cwd, logFilePath, env: buildSpawnEnv(trackedEntry.env), logMode: trackedEntry.logMode });

      removeTrackedByPid(trackedEntry.pid);
      addTracked({
        name: trackedEntry.name,
        pid: child.pid ?? 0,
        command: trackedEntry.command,
        args: cmdParts,
        port: trackedEntry.port,
        group: trackedEntry.group,
        cwd: trackedEntry.cwd,
        env: trackedEntry.env,
        startedAt: new Date().toISOString(),
        autoRestart: trackedEntry.autoRestart,
        logMode: trackedEntry.logMode,
      });
      spinner.succeed(`${trackedEntry.name} restarted (PID: ${child.pid})`);
    } catch (error) {
      spinner.fail(`Failed to re-spawn ${trackedEntry.name}: ${String(error)}`);
      console.error(`  ${pc.dim("Config preserved. Re-run manually:")} ${renderCommand(trackedEntry.command)}`);
    }
  }
}
