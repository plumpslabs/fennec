/**
 * Command: start / run — Spawn a process as a detached daemon.
 * Includes auto-resurrect: on server start, re-spawns tracked processes
 * that died since last session (like PM2 resurrect).
 */
import { createWriteStream, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { FennecServer } from "@plumpslabs/fennec-core";
import pc from "picocolors";
import { printBanner } from "../utils/banner.js";
import { symbols, renderKV, renderAppName, renderError, divider, createSpinner } from "../utils/format.js";
import { readTracked, addTracked, removeTracked, rotateLogFile } from "./tracker.js";
import { isProcessRunning } from "../utils/system-process.js";
import type { TrackedProcess } from "./tracker.js";

// Re-export from tracker for backward compat
export type { TrackedProcess };

export async function startServer(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim("Starting Fennec MCP server...")}\n`);

  const configIndex = args.indexOf("--config");
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;

  try {
    const server = new FennecServer(configPath);

    // 🔥 Auto-resurrect: re-spawn tracked processes that died since last session
    await resurrectTracked();

    await server.start();

    console.error(`\n  ${pc.green("✓")} ${pc.bold("Fennec server is running")}`);
    console.error(`  ${renderKV("Transport", "stdio")}`);
    console.error(`  ${renderKV("AI Agent", "Connect via MCP protocol")}`);
    console.error(`\n  ${pc.dim("Press Ctrl+C to stop")}\n`);
  } catch (error) {
    console.error(renderError("Failed to start server", String(error)));
    process.exit(1);
  }
}

export async function startCommand(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim("Starting app...")}\n`);
  await runCommand(args);
}

export async function runCommand(args: string[]): Promise<void> {
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const portIndex = args.indexOf("--port");
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]!, 10) : undefined;
  const cwdIndex = args.indexOf("--cwd");
  const cwd = cwdIndex !== -1 ? args[cwdIndex + 1] : undefined;

  const stopFlags = [nameIndex, portIndex, cwdIndex].filter((i) => i !== -1) as number[];
  const cmdEnd = Math.min(...stopFlags, Infinity);
  const cmdParts = args.slice(0, cmdEnd);
  const cmd = cmdParts.join(" ");

  if (!cmd) {
    console.error(renderError("Missing command", "Usage: fennec start|run <command> --name <name> [--port <port>] [--cwd <dir>]"));
    process.exit(1);
  }

  const appName = name ?? cmdParts[0] ?? "app";

  // Duplicate Prevention
  const tracked = readTracked();
  const existing = tracked.find((t) => t.name === appName);
  if (existing && isProcessRunning(existing.pid)) {
    console.error();
    console.error(`  ${pc.yellow("⚠")} ${pc.bold(appName)} ${pc.dim(`is already running (PID: ${existing.pid})`)}`);
    console.error(`  ${renderKV("Logs", pc.cyan(`fennec log ${appName}`))}`);
    console.error(`  ${renderKV("Stop", pc.cyan(`fennec kill ${appName}`))}`);
    console.error();
    process.exit(0);
  }

  const logDir = resolve(homedir(), ".fennec", "logs");
  mkdirSync(logDir, { recursive: true });
  const logFilePath = resolve(logDir, `${appName}.log`);

  console.error(`\n  ${symbols.fox} ${pc.bold("Starting")} ${renderAppName(appName)} ${pc.dim("(daemon)")}\n`);
  console.error(`  ${renderKV("Command", cmd)}`);
  if (port) console.error(`  ${renderKV("Port", String(port))}`);
  if (cwd) console.error(`  ${renderKV("Directory", cwd)}`);
  console.error(`  ${divider()}`);

  try {
    const child = spawn(cmdParts[0]!, cmdParts.slice(1), {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = child.pid ?? 0;

    // Rotate log if >10MB, then create write stream
    rotateLogFile(logFilePath);
    const logStream = createWriteStream(logFilePath, { flags: "a" });
    if (child.stdout) child.stdout.pipe(logStream);
    if (child.stderr) child.stderr.pipe(logStream);

    child.unref();

    addTracked({
      name: appName,
      pid,
      command: cmd,
      port,
      cwd,
      startedAt: new Date().toISOString(),
    });

    console.error(`\n  ${pc.green("●")} ${pc.bold(appName)} ${pc.dim(`started (PID: ${pid})`)}${port ? pc.dim(` :${port}`) : ""}\n`);

    await new Promise((r) => setTimeout(r, 1500));

    try {
      const initialLogs = readFileSync(logFilePath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .slice(-8);
      if (initialLogs.length > 0) {
        for (const line of initialLogs) {
          const truncated = line.length > 150 ? line.slice(0, 150) + "\u2026" : line;
          if (line.toLowerCase().includes("error")) {
            console.error(`  ${pc.dim("│")} ${pc.red(truncated)}`);
          } else if (line.toLowerCase().includes("warn")) {
            console.error(`  ${pc.dim("│")} ${pc.yellow(truncated)}`);
          } else {
            console.error(`  ${pc.dim("│")} ${truncated}`);
          }
        }
      }
    } catch { /* initial log peek is best-effort */ }

    console.error();
    console.error(`  ${pc.green("✓")} ${pc.bold(appName)} running in background`);
    console.error(`  ${renderKV("Logs", pc.cyan(`fennec log ${appName}`))}`);
    console.error(`  ${renderKV("Status", pc.cyan("fennec ps"))}`);
    console.error(`  ${renderKV("Stop", pc.cyan(`fennec kill ${appName}`))}`);
    console.error();
  } catch (error) {
    console.error(renderError(`Failed to start ${appName}`, String(error)));
    process.exit(1);
  }
}

/**
 * 🔥 PM2-like resurrect: Re-spawn tracked processes that died.
 * Called automatically during `fennec start` (server mode).
 * Reads tracked.json, checks each PID, re-spawns stopped ones.
 */
export async function resurrectTracked(): Promise<void> {
  const tracked = readTracked();
  if (tracked.length === 0) return;

  const dead = tracked.filter((t) => !isProcessRunning(t.pid));
  if (dead.length === 0) return;

  const spinner = createSpinner(`Resurrecting ${dead.length} stopped process(es)...`);
  let resurrected = 0;
  let failed = 0;

  for (const proc of dead) {
    // Only resurrect if the process has a command (not just a PID reference)
    if (!proc.command) {
      removeTracked(proc.name);
      continue;
    }

    try {
      const cmdParts = proc.command.split(/\s+/);
      const logDir = resolve(homedir(), ".fennec", "logs");
      mkdirSync(logDir, { recursive: true });
      const logFilePath = resolve(logDir, `${proc.name}.log`);

      const child = spawn(cmdParts[0]!, cmdParts.slice(1), {
        cwd: proc.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      rotateLogFile(logFilePath);
      const logStream = createWriteStream(logFilePath, { flags: "a" });
      if (child.stdout) child.stdout.pipe(logStream);
      if (child.stderr) child.stderr.pipe(logStream);
      child.unref();

      // Update PID in tracked.json
      addTracked({
        name: proc.name,
        pid: child.pid ?? 0,
        command: proc.command,
        port: proc.port,
        cwd: proc.cwd,
        startedAt: new Date().toISOString(),
      });

      resurrected++;
    } catch {
      failed++;
    }
  }

  spinner.stop();
  process.stdout.write("\r\x1b[K");

  if (resurrected > 0) {
    console.error(`  ${pc.green("●")} ${pc.bold(`Resurrected ${resurrected} process(es)`)}`);
  }
  if (failed > 0) {
    console.error(`  ${pc.red("●")} ${pc.bold(`${failed} process(es) failed to resurrect`)}`);
  }
}
