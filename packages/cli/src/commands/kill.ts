/**
 * Command: kill — Kill process by PID, name, or kill all user processes.
 */
import pc from "picocolors";
import { renderError, createSpinner, selectPrompt, confirmPrompt } from "../utils/format.js";
import { getSystemProcesses, killProcess as sysKill, isProcessRunning } from "../utils/system-process.js";
import { readTracked, removeTrackedByPid } from "./tracker.js";

export async function killCommand(args: string[]): Promise<void> {
  const rawTarget = args[0];
  const signalIndex = args.indexOf("--signal");
  const signalRaw = signalIndex !== -1 ? args[signalIndex + 1] : "SIGTERM";
  const signal = (signalRaw ?? "SIGTERM") as NodeJS.Signals;

  if (rawTarget === "all" || args.includes("--all") || args.includes("-a")) {
    await killAll(signal);
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
    if (trackedMatch && isProcessRunning(trackedMatch.pid)) {
      targetPid = trackedMatch.pid;
      displayName = `${trackedMatch.name} (PID ${targetPid})`;
    } else {
      const matches = getSystemProcesses({ name: rawTarget, userOnly: true, sortBy: "cpu" });
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

  const confirmed = await confirmPrompt(`Kill ${pc.bold(displayName)} with ${pc.yellow(signal)}?`, false);
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}`); return; }

  const spinner = createSpinner(`Sending ${signal} to ${displayName}...`);
  const success = sysKill(targetPid, signal);

  if (success) {
    await new Promise((r) => setTimeout(r, 200));
    const stillRunning = isProcessRunning(targetPid);
    if (stillRunning && signal !== "SIGKILL") {
      spinner.warn(`${displayName} did not respond to ${signal}`);
      const forceKill = await confirmPrompt(`Send ${pc.red("SIGKILL")} to force stop?`, true);
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

async function killAll(signal: NodeJS.Signals): Promise<void> {
  const userProcs = getSystemProcesses({ userOnly: true, sortBy: "cpu", limit: 200 });
  if (userProcs.length === 0) { console.error(`  ${pc.dim("No user processes to kill.")}`); return; }

  console.error(`\n  ${pc.bold(`Kill ${userProcs.length} user processes?`)}`);
  console.error(`  ${pc.dim("This will stop ALL your running processes.")}`);
  console.error(`  ${pc.yellow("⚠ System processes will not be affected.")}\n`);

  const confirmed = await confirmPrompt(`${pc.red("Are you sure?")} ${pc.dim("This cannot be undone")}`, false);
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled.")}`); return; }

  const spinner = createSpinner(`Killing ${userProcs.length} processes...`);
  let killed = 0, failed = 0;
  for (const proc of userProcs) {
    if (sysKill(proc.pid, signal)) { killed++; removeTrackedByPid(proc.pid); } else { failed++; }
    if (killed % 10 === 0) await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 500));
  killed > 0 ? spinner.succeed(`${killed} process(es) killed`) : spinner.fail("Failed to kill processes");
  if (failed > 0) console.error(`  ${pc.yellow(`${failed} process(es) could not be killed`)} ${pc.dim("(try with sudo)")}`);
}
