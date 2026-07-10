/**
 * Command: start / run — Spawn a process as a detached daemon.
 * Includes auto-resurrect: on server start, re-spawns tracked processes
 * that died since last session (like PM2 resurrect).
 *
 * With --restart flag: auto-restarts the process if it crashes (like PM2 watch).
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { FennecServer } from "@plumpslabs/fennec-core";
import pc from "picocolors";
import { printBanner } from "../utils/banner.js";
import { symbols, renderKV, renderAppName, renderError, divider, createSpinner } from "../utils/format.js";
import { readTracked, addTracked, removeTracked, rotateLogFile } from "./tracker.js";
import { isProcessRunning } from "../utils/system-process.js";
import { psCommand } from "./ps.js";
import type { TrackedProcess } from "./tracker.js";

// Re-export from tracker for backward compat
export type { TrackedProcess };

export async function startServer(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim("Starting Fennec MCP server...")}\n`);

  const configIndex = args.indexOf("--config");
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const useSse = args.includes("--sse");

  // Set env var so ConfigLoader picks it up (overrides config file)
  if (useSse) {
    process.env.FENNEC_TRANSPORT_TYPE = "sse";
  }

  try {
    const server = new FennecServer(configPath);

    // Auto-resurrect: re-spawn tracked processes that died since last session
    await resurrectTracked();

    await server.start();

    if (useSse) {
      const port = server.getConfig().transport.port;
      console.error(`\n  ${pc.green("✓")} ${pc.bold("Fennec server is running")}`);
      console.error(`  ${renderKV("Transport", pc.cyan("SSE (HTTP)"))}`);
      console.error(`  ${renderKV("URL", pc.cyan(`http://localhost:${port}/sse`))}`);
      console.error(`  ${renderKV("MCP Config", pc.cyan(`{ \"type\": \"remote\", \"url\": \"http://localhost:${port}/sse\" }`))}`);
      console.error(`  ${renderKV("OpenCode", pc.cyan(`type: remote, url: http://localhost:${port}/sse`))}`);
      console.error(`\n  ${pc.dim("Press Ctrl+C to stop")}\n`);
    } else {
      console.error(`\n  ${pc.green("✓")} ${pc.bold("Fennec server is running")}`);
      console.error(`  ${renderKV("Transport", "stdio")}`);
      console.error(`  ${renderKV("AI Agent", "Connect via MCP protocol")}`);
      console.error(`  ${renderKV("Tip", pc.dim("For SSE mode: fennec start --sse"))}`);
      console.error(`\n  ${pc.dim("Press Ctrl+C to stop")}\n`);
    }
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
  const restartFlag = args.includes("--restart");

  const stopFlags = [nameIndex, portIndex, cwdIndex].filter((i) => i !== -1) as number[];
  const cmdEnd = Math.min(...stopFlags, Infinity);
  const cmdParts = args.slice(0, cmdEnd);
  const cmd = cmdParts.join(" ");

  if (!cmd) {
    console.error(renderError("Missing command", "Usage: fennec start|run <command> --name <name> [--port <port>] [--cwd <dir>] [--restart]"));
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
  if (restartFlag) console.error(`  ${renderKV("Auto-restart", pc.green("enabled"))}`);
  console.error(`  ${divider()}`);

  try {
    let currentChild = spawn(cmdParts[0]!, cmdParts.slice(1), {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = currentChild.pid ?? 0;

    // Rotate log if >10MB, then create write stream
    rotateLogFile(logFilePath);
    const logStream = createWriteStream(logFilePath, { flags: "a" });
    if (currentChild.stdout) currentChild.stdout.pipe(logStream);
    if (currentChild.stderr) currentChild.stderr.pipe(logStream);

    currentChild.unref();

    addTracked({
      name: appName,
      pid,
      command: cmd,
      port,
      cwd,
      startedAt: new Date().toISOString(),
    });

    console.error(`  ${pc.green("✓")} ${pc.bold(appName)} ${pc.dim(`started (PID: ${pid})`)}`);

    // If --restart flag is set, watch for crashes and auto-restart
    if (restartFlag) {
      console.error(`  ${pc.dim("Auto-restart enabled — watching for crashes...")}\n`);

      // Shared handler to set up log rotation + exit watcher on a child
      function setupRestartWatch(c: typeof currentChild): void {
        c.on("exit", (code, signal) => {
          if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL") {
            console.error(`  ${pc.yellow("⚠")} ${pc.bold(appName)} ${pc.dim(`exited with code ${code}, restarting...`)}`);
            const restarted = spawn(cmdParts[0]!, cmdParts.slice(1), {
              cwd,
              env: { ...process.env },
              stdio: ["ignore", "pipe", "pipe"],
              detached: true,
            });
            const newPid = restarted.pid ?? 0;
            rotateLogFile(logFilePath);
            const rs = createWriteStream(logFilePath, { flags: "a" });
            if (restarted.stdout) restarted.stdout.pipe(rs);
            if (restarted.stderr) restarted.stderr.pipe(rs);
            restarted.unref();
            addTracked({ name: appName, pid: newPid, command: cmd, port, cwd, startedAt: new Date().toISOString() });
            console.error(`  ${pc.green("✓")} ${pc.bold(appName)} ${pc.dim(`restarted (PID: ${newPid})`)}`);
            // Watch the new child too (continuous restart)
            currentChild = restarted;
            setupRestartWatch(restarted);
          }
        });
      }

      setupRestartWatch(currentChild);

      // Keep the process alive to watch for crashes
      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => {
          currentChild.kill("SIGTERM");
          resolve();
        });
      });
    }

    // Show the process table instead of logs (only if not in --restart mode)
    if (!restartFlag) {
      await psCommand([]);
    }
  } catch (error) {
    console.error(renderError(`Failed to start ${appName}`, String(error)));
    process.exit(1);
  }
}

/**
 * PM2-like resurrect: Re-spawn tracked processes that died.
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
