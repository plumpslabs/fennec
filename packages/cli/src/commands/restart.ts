/**
 * Command: restart — Kill and re-spawn a tracked process from tracked.json config.
 * Fixed: now actually re-spawns (instead of just killing + suggesting manual re-run).
 */
import pc from "picocolors";
import { mkdirSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { renderError, renderCommand, createSpinner, confirmPrompt } from "../utils/format.js";
import { getSystemProcesses, killProcess as sysKill, isProcessRunning } from "../utils/system-process.js";
import { readTracked, addTracked, removeTrackedByPid, rotateLogFile } from "./tracker.js";

export async function restartCommand(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) { console.error(renderError("Missing process name/pid", "Usage: fennec restart <name|pid>")); process.exit(1); }

  const tracked = readTracked();
  let trackedEntry = tracked.find((t) => t.name === name);
  let targetPid: number;

  if (trackedEntry) {
    targetPid = trackedEntry.pid;
  } else {
    const pid = parseInt(name, 10);
    if (!isNaN(pid) && String(pid) === name) {
      targetPid = pid;
    } else {
      const processes = getSystemProcesses({ name, userOnly: true, limit: 1 });
      if (processes.length === 0) { console.error(renderError("Process not found", `No process matching "${name}"`)); process.exit(1); }
      targetPid = processes[0]!.pid;
    }
  }

  const confirmed = await confirmPrompt(`Restart ${pc.bold(`${name} (PID ${targetPid})`)}?`, false);
  if (!confirmed) { console.error(`  ${pc.dim("Cancelled")}`); return; }

  const spinner = createSpinner(`Stopping PID ${targetPid}...`);
  const killed = sysKill(targetPid, "SIGTERM");
  if (!killed) { spinner.fail(`Failed to stop PID ${targetPid}`); return; }

  await new Promise((r) => setTimeout(r, 1000));
  if (isProcessRunning(targetPid)) {
    spinner.warn("Process didn't stop, sending SIGKILL...");
    sysKill(targetPid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
  }

  spinner.succeed(`${name} stopped`);

  if (trackedEntry) {
    const respawnSpinner = createSpinner(`Re-spawning ${trackedEntry.name}...`);
    try {
      const cmdParts = trackedEntry.command.split(" ");
      const logDir = resolve(homedir(), ".fennec", "logs");
      mkdirSync(logDir, { recursive: true });
      const logFilePath = resolve(logDir, `${trackedEntry.name}.log`);

      const child = spawn(cmdParts[0]!, cmdParts.slice(1), {
        cwd: trackedEntry.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      // Rotate log if >10MB, then create write stream
      rotateLogFile(logFilePath);
      const logStream = createWriteStream(logFilePath, { flags: "a" });
      if (child.stdout) child.stdout.pipe(logStream);
      if (child.stderr) child.stderr.pipe(logStream);
      child.unref();

      // Remove old PID entry, add new one (only after successful spawn)
      removeTrackedByPid(targetPid);
      addTracked({
        name: trackedEntry.name,
        pid: child.pid ?? 0,
        command: trackedEntry.command,
        port: trackedEntry.port,
        cwd: trackedEntry.cwd,
        startedAt: new Date().toISOString(),
      });

      respawnSpinner.succeed(`${trackedEntry.name} restarted (PID: ${child.pid})`);
    } catch (error) {
      respawnSpinner.fail(`Failed to re-spawn ${trackedEntry.name}: ${String(error)}`);
      console.error(`  ${pc.dim("Config preserved. Re-run manually:")} ${renderCommand(trackedEntry.command)}`);
    }
  } else {
    console.error(`  ${pc.dim("No tracked config found. Re-run manually:")} ${renderCommand(name)}`);
  }
}
