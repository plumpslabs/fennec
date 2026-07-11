/**
 * Command: kill — Kill process by PID, name, or kill all Fennec-tracked apps.
 */
import pc from "picocolors";
import { renderError, createSpinner, selectPrompt, confirmPrompt } from "../utils/format.js";
import { getSystemProcesses, killProcess as sysKill, isProcessRunning } from "../utils/system-process.js";
import { readTracked, removeTrackedByPid, isTrackedRunning } from "./tracker.js";

export async function killCommand(args: string[]): Promise<void> {
  const rawTarget = args[0];
  const signalIndex = args.indexOf("--signal");
  const signalRaw = signalIndex !== -1 ? args[signalIndex + 1] : "SIGTERM";
  const signal = (signalRaw ?? "SIGTERM") as NodeJS.Signals;
  const force = args.includes("-y") || args.includes("--yes");

  if (rawTarget === "all" || args.includes("--all") || args.includes("-a")) {
    await killAll(signal, force);
    return;
  }

  if (!rawTarget) {
    console.error(renderError("Missing target", "Usage: fennec kill <pid|name|all> [--signal SIGTERM|SIGKILL|SIGINT]"));
    process.exit(1);
  }

  let targetPid: number;
  let displayName: string;
  const pid = parseInt(rawTarget, 10);

  if (!isNaN(pid) && String(pid) === rawTarget) {
    if (!isProcessRunning(pid)) { console.error(renderError("Process not found", `No process with PID ${pid} is running`)); process.exit(1); }
    targetPid = pid;
    displayName = `PID ${pid}`;
  } else {
    // First check tracked processes (from fennec start / tracked.json)
    const tracked = readTracked();
    const trackedMatch = tracked.find((t) => t.name === rawTarget);
    if (trackedMatch) {
      if (!isTrackedRunning(trackedMatch)) {
        console.error(`\n  ${pc.yellow("⚠")} ${pc.bold(rawTarget)} ${pc.dim("is already stopped (no running process to kill)")}`);
        console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec spawn")} ${pc.dim("to resume")}`);
        process.exit(0);
      }
      targetPid = trackedMatch.pid;
      displayName = `${trackedMatch.name} (PID ${targetPid})`;
    } else {
      const currentPid = process.pid;
      let matches = getSystemProcesses({ name: rawTarget, userOnly: true, sortBy: "cpu" });
      // Filter out current process (self-kill protection)
      matches = matches.filter((m) => m.pid !== currentPid);
      if (matches.length === 0) { console.error(renderError("Process not found", `No running process matching "${rawTarget}"`)); process.exit(1); }
      if (matches.length > 1) {
        console.error(`\n  ${pc.bold(`Multiple processes match "${rawTarget}":`)}`);
        const selected = await selectPrompt("Select which to kill:", matches.map((p, i) => ({ value: String(i), label: `${p.name} (PID ${p.pid})`, description: `${p.command.slice(0, 80)} — CPU: ${p.cpuPercent}% MEM: ${p.memPercent}%` })));
        if (selected === null) { console.error(`  ${pc.dim("Cancelled")}`); return; }
        const idx = parseInt(selected, 10);
        targetPid = matches[idx]!.pid;
        displayName = `${matches[idx]!.name} (PID ${targetPid})`;
      } else {
        targetPid = matches[0]!.pid;
        displayName = `${matches[0]!.name} (PID ${targetPid})`;
      }
    }
  }

  const confirmed = force || (await confirmPrompt(`Kill ${pc.bold(displayName)} with ${pc.yellow(signal)}?`, false));
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}`); return; }

  const spinner = createSpinner(`Sending ${signal} to ${displayName}...`);
  const success = sysKill(targetPid, signal);

  if (success) {
    await new Promise((r) => setTimeout(r, 200));
    const stillRunning = isProcessRunning(targetPid);
    if (stillRunning && signal !== "SIGKILL") {
      spinner.warn(`${displayName} did not respond to ${signal}`);
      const forceKill = force || (await confirmPrompt(`Send ${pc.red("SIGKILL")} to force stop?`, true));
      if (forceKill) {
        const forceSpinner = createSpinner(`Sending SIGKILL to ${displayName}...`);
        sysKill(targetPid, "SIGKILL");
        await new Promise((r) => setTimeout(r, 300));
        isProcessRunning(targetPid) ? forceSpinner.fail(`${displayName} could not be stopped (permission denied?)`) : forceSpinner.succeed(`${displayName} force stopped`);
      } else {
        console.error(`  ${pc.dim("Retrying with SIGTERM...")}`);
        sysKill(targetPid, "SIGTERM");
        console.error(`  ${pc.yellow("⚠")} ${displayName} ${pc.dim("may still be running")}`);
      }
    } else {
      removeTrackedByPid(targetPid);
      spinner.succeed(`${displayName} stopped`);
    }
  } else {
    spinner.fail(`Failed to kill ${displayName}`);
    console.error(renderError("Permission denied", "Try running with sudo or use a different signal."));
  }
}

async function killAll(signal: NodeJS.Signals, force: boolean): Promise<void> {
  // Scope strictly to Fennec-tracked apps — NEVER all user processes.
  const tracked = readTracked();
  const running = tracked.filter((t) => isTrackedRunning(t));
  if (running.length === 0) { console.error(`  ${pc.dim("No running tracked apps to kill.")}`); return; }

  console.error(`\n  ${pc.bold(`Kill ${running.length} tracked app(s)?`)}`);
  console.error(`  ${pc.dim("This stops every Fennec-tracked running process only — other processes are untouched.")}\n`);

  const confirmed = force || (await confirmPrompt(`${pc.red("Are you sure?")} ${pc.dim("This cannot be undone")}`, false));
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled.")}`); return; }

  const spinner = createSpinner(`Killing ${running.length} tracked app(s)...`);
  let killed = 0, failed = 0;
  for (const t of running) {
    if (sysKill(t.pid, signal)) { killed++; removeTrackedByPid(t.pid); } else { failed++; }
  }
  await new Promise((r) => setTimeout(r, 300));
  killed > 0 ? spinner.succeed(`${killed} tracked app(s) killed`) : spinner.fail("Failed to kill apps");
  if (failed > 0) console.error(`  ${pc.yellow(`${failed} app(s) could not be killed`)}`);
}
