/**
 * Command: stop — Stop a tracked process but keep it in tracked.json.
 * Unlike `kill`, the process entry remains in tracked.json so it can
 * be re-spawned later via `fennec spawn <name>`.
 */
import pc from "picocolors";
import { renderError, createSpinner, confirmPrompt } from "../utils/format.js";
import { killProcess as sysKill, isProcessRunning } from "../utils/system-process.js";
import { readTracked } from "./tracker.js";
import { psCommand } from "./ps.js";

export async function stopCommand(args: string[]): Promise<void> {
  const stopAll = args.includes("--all") || args.includes("-a");

  if (stopAll) {
    await stopAllTracked();
    return;
  }

  const rawTarget = args[0];

  if (!rawTarget) {
    console.error(renderError("Missing name", "Usage: fennec stop <name|--all>"));
    process.exit(1);
  }

  // Only works on tracked processes
  const tracked = readTracked();
  const trackedMatch = tracked.find((t) => t.name === rawTarget);

  if (!trackedMatch) {
    console.error(renderError("Not found", `No tracked process named "${rawTarget}". Use ${pc.cyan("fennec kill <pid>")} to kill a system process.`));
    process.exit(1);
  }

  if (!isProcessRunning(trackedMatch.pid)) {
    console.error(`\n  ${pc.yellow("⚠")} ${pc.bold(rawTarget)} ${pc.dim("is already stopped")}`);
    console.error();
    process.exit(0);
  }

  const displayName = `${trackedMatch.name} (PID ${trackedMatch.pid})`;
  const confirmed = await confirmPrompt(`Stop ${pc.bold(displayName)}? ${pc.dim("It can be re-spawned later via fennec spawn")}`, false);
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}`); return; }

  await stopSingleProcess(trackedMatch.pid, trackedMatch.name);
}

/**
 * Stop all running tracked processes (keep them in tracked.json).
 */
async function stopAllTracked(): Promise<void> {
  const tracked = readTracked();
  const running = tracked.filter((t) => isProcessRunning(t.pid));

  if (running.length === 0) {
    console.error(`\n  ${pc.dim("No running tracked processes to stop.")}\n`);
    return;
  }

  console.error(`\n  ${pc.yellow("⚠")} ${pc.bold(`Stop all ${running.length} running process(es)?`)} ${pc.dim("(They can be re-spawned later)")}\n`);
  for (const t of running) {
    console.error(`  ${pc.green("●")} ${pc.bold(t.name)} ${pc.dim(`(PID ${t.pid})`)}`);
  }
  console.error();

  const confirmed = await confirmPrompt("Stop all?", false);
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}\n`); return; }

  const spinner = createSpinner(`Stopping ${running.length} process(es)...`);
  let stopped = 0;
  let failed = 0;

  for (const t of running) {
    if (sysKill(t.pid, "SIGTERM")) {
      stopped++;
    } else {
      failed++;
    }
  }

  await new Promise((r) => setTimeout(r, 300));
  spinner.stop();
  process.stdout.write("\r\x1b[K");

  if (stopped > 0) {
    console.error(`  ${pc.green("✓")} ${pc.bold(`Stopped ${stopped} process(es)`)} ${pc.dim("(kept in tracked.json)")}`);
  }
  if (failed > 0) {
    console.error(`  ${pc.red("✗")} ${pc.bold(`${failed} process(es) failed to stop`)}`);
  }

  console.error();
  await psCommand([]);
}

async function stopSingleProcess(pid: number, name: string): Promise<void> {
  const displayName = `${name} (PID ${pid})`;
  const spinner = createSpinner(`Stopping ${displayName}...`);
  const success = sysKill(pid, "SIGTERM");

  if (success) {
    await new Promise((r) => setTimeout(r, 200));
    const stillRunning = isProcessRunning(pid);
    if (stillRunning) {
      spinner.warn(`${displayName} did not respond to SIGTERM`);
      const forceKill = await confirmPrompt(`Send ${pc.red("SIGKILL")} to force stop?`, true);
      if (forceKill) {
        const forceSpinner = createSpinner(`Sending SIGKILL to ${displayName}...`);
        sysKill(pid, "SIGKILL");
        await new Promise((r) => setTimeout(r, 300));
        isProcessRunning(pid)
          ? forceSpinner.fail(`${displayName} could not be stopped (permission denied?)`)
          : forceSpinner.succeed(`${displayName} force stopped`);
      } else {
        console.error(`  ${pc.yellow("⚠")} ${displayName} ${pc.dim("may still be running")}`);
      }
    } else {
      spinner.succeed(`${displayName} stopped`);
    }

    console.error();
    await psCommand([]);
  } else {
    spinner.fail(`Failed to stop ${displayName}`);
    console.error(renderError("Permission denied", "Try running with sudo or use fennec kill."));
  }
}
