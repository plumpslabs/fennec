#!/usr/bin/env node

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { FennecServer, SessionStore, ProcessManager } from "@plumpslabs/fennec-core";
import pc from "picocolors";
import { printBanner } from "./utils/banner.js";
import { showHelp } from "./utils/help.js";
import { pipeCommand } from "./commands/pipe.js";
import { attachPidCommand } from "./commands/attach-pid.js";
import { attachPortCommand } from "./commands/attach-port.js";
import { watchCommand } from "./commands/watch.js";
import {
  symbols,
  renderTable,
  renderKV,
  renderError,
  renderSuccess,
  renderCommand,
  renderAppName,
  logLevel,
  timestamp,
  divider,
  createSpinner,
  selectPrompt,
  confirmPrompt,
  type Column,
  type Row,
} from "./utils/format.js";
import {
  getSystemProcesses,
  killProcess as sysKill,
  isProcessRunning,
  formatProcessState,
} from "./utils/system-process.js";

const [, , command, ...args] = process.argv;

// ─── Process Tracking ────────────────────────────────────────────

interface TrackedProcess {
  name: string;
  pid: number;
  command: string;
  port?: number;
  cwd?: string;
  startedAt: string;
}

function getTrackedPath(): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), ".fennec");
  return resolve(dir, "tracked.json");
}

function readTracked(): TrackedProcess[] {
  try {
    const path = getTrackedPath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

function saveTracked(processes: TrackedProcess[]): void {
  try {
    const path = getTrackedPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(processes, null, 2), "utf-8");
  } catch {
    // Best-effort
  }
}

function addTracked(proc: TrackedProcess): void {
  const tracked = readTracked();
  // Remove old entry with same name
  const filtered = tracked.filter((t) => t.name !== proc.name);
  filtered.push(proc);
  saveTracked(filtered);
}

function removeTracked(name: string): void {
  const tracked = readTracked();
  saveTracked(tracked.filter((t) => t.name !== name));
}

function removeTrackedByPid(pid: number): void {
  const tracked = readTracked();
  saveTracked(tracked.filter((t) => t.pid !== pid));
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!command || command === "start") {
    // Dual-mode: if first arg is a flag (--), start MCP server.
    // If first arg is a bare command (node, npm, etc.), start an app.
    if (args.length === 0 || args[0]?.startsWith("--")) {
      await startServer(args);
    } else {
      await startCommand(args);
    }
  } else if (command === "run") {
    await runCommand(args);
  } else if (command === "ps") {
    await psCommand(args);
  } else if (command === "status") {
    await statusCommand(args);
  } else if (command === "log") {
    await logCommand(args);
  } else if (command === "kill") {
    await killCommand(args);
  } else if (command === "restart") {
    await restartCommand(args);
  } else if (command === "attach") {
    await attachCommand(args);
  } else if (command === "pipe") {
    await pipeCommand(args);
  } else if (command === "attach-pid") {
    await attachPidCommand(args);
  } else if (command === "attach-port") {
    await attachPortCommand(args);
  } else if (command === "watch") {
    await watchCommand(args);
  } else if (command === "sessions") {
    await sessionsCommand();
  } else if (command === "setup") {
    await setupCommand();
  } else if (command === "install-browsers") {
    printBanner();
    await installBrowsersCommand();
  } else if (command === "init") {
    printBanner();
    await initCommand();
  } else if (command === "version" || command === "--version" || command === "-v") {
    console.log(`  ${symbols.fox} ${pc.bold("Fennec")} ${pc.dim("v1.11.2")}`);
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(pc.dim("\n  Use 'fennec help' for more information.\n"));
    printBanner();
    showHelp();
  } else {
    console.error(renderError(`Unknown command: ${command}`, "Run 'fennec help' for usage information"));
    process.exit(1);
  }
}

// ─── Command: start ──────────────────────────────────────────────

async function startServer(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim("Starting Fennec MCP server...")}\n`);

  const configIndex = args.indexOf("--config");
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;

  const apiPortIndex = args.indexOf("--api-port");
  const apiPort = apiPortIndex !== -1 ? parseInt(args[apiPortIndex + 1]!, 10) : 3456;

  try {
    const server = new FennecServer(configPath);
    await server.start();

    console.error(`\n  ${pc.green("✓")} ${pc.bold("Fennec server is running")}`);
    console.error(`  ${renderKV("Transport", "stdio")}`);
    console.error(`  ${renderKV("Management API", `http://localhost:${apiPort}`)}`);
    console.error(`  ${renderKV("AI Agent", "Connect via MCP protocol")}`);
    console.error(`\n  ${pc.dim("Press Ctrl+C to stop")}\n`);
  } catch (error) {
    console.error(renderError("Failed to start server", String(error)));
    process.exit(1);
  }
}

// ─── Command: start (App Mode) ───────────────────────────────────

async function startCommand(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim("Starting app...")}\n`);
  await runCommand(args);
}

// ─── Shared: start/run a process ─────────────────────────────────

async function runCommand(args: string[]): Promise<void> {
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const portIndex = args.indexOf("--port");
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]!, 10) : undefined;
  const cwdIndex = args.indexOf("--cwd");
  const cwd = cwdIndex !== -1 ? args[cwdIndex + 1] : undefined;
  const restartFlag = args.includes("--restart");

  // Extract command (everything before --name, --port, or --cwd)
  const stopFlags = [nameIndex, portIndex, cwdIndex].filter((i) => i !== -1) as number[];
  const cmdEnd = Math.min(...stopFlags, Infinity);
  const cmdParts = args.slice(0, cmdEnd);
  const cmd = cmdParts.join(" ");

  if (!cmd) {
    console.error(renderError("Missing command", "Usage: fennec start|run <command> --name <name> [--port <port>] [--cwd <dir>] [--restart]"));
    process.exit(1);
  }

  const appName = name ?? cmdParts[0] ?? "app";

  console.error(`\n  ${symbols.fox} ${pc.bold("Running")} ${renderAppName(appName)}\n`);
  console.error(`  ${renderKV("Command", cmd)}`);
  if (port) console.error(`  ${renderKV("Port", String(port))}`);
  if (cwd) console.error(`  ${renderKV("Directory", cwd)}`);
  console.error(`  ${renderKV("Restart", restartFlag ? "on crash" : "off")}`);
  console.error(`  ${divider()}`);

  // Spawn process using ProcessManager
  const config = {
    maxProcesses: 10,
    logBufferLines: 2000,
    spawnAllowlist: [],
  };
  const pm = new ProcessManager(config);

  try {
    const proc = pm.spawn(cmdParts[0]!, cmdParts.slice(1), cwd, undefined, appName);

    // Save to tracked processes
    addTracked({
      name: appName,
      pid: proc.pid,
      command: cmd,
      port,
      cwd,
      startedAt: new Date().toISOString(),
    });

    console.error(`\n  ${pc.green("●")} ${pc.bold(appName)} ${pc.dim(`started (PID: ${proc.pid})`)}${port ? pc.dim(` :${port}`) : ""}\n`);

    // Forward logs to console
    const stdout = proc.child.stdout;
    const stderr = proc.child.stderr;

    if (stdout) {
      stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          const level = line.includes("error") || line.includes("Error") ? "error" as const
            : line.includes("warn") || line.includes("WARN") ? "warn" as const
            : "info" as const;
          const time = timestamp();
          const lvl = logLevel(level);
          process.stdout.write(`  ${time} ${lvl} ${line}\n`);
        }
      });
    }

    if (stderr) {
      stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          const time = timestamp();
          const lvl = logLevel("error");
          process.stderr.write(`  ${time} ${lvl} ${pc.red(line)}\n`);
        }
      });
    }

    // Handle process exit
    proc.child.on("exit", (code, signal) => {
      // Auto-cleanup tracked process
      removeTracked(appName);
      if (restartFlag && code !== 0) {
        console.error(`\n  ${pc.yellow("⚠")} ${appName} ${pc.dim(`exited (${code}), restarting...`)}`);
        pm.restart(appName).catch(() => {});
      } else {
        console.error(`\n  ${pc.dim("○")} ${pc.bold(appName)} ${pc.dim(`exited (${code})`)}`);
      }
    });

    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error(renderError(`Failed to run ${appName}`, String(error)));
    process.exit(1);
  }
}

// ─── Command: ps (List Managed / Tracked Processes) ───────────────
// Like PM2: by default shows only Fennec-tracked apps.
// Use --system or -a to see all system processes.

async function psCommand(args: string[]): Promise<void> {
  const watchFlag = args.includes("-w") || args.includes("--watch");
  const systemFlag = args.includes("--system") || args.includes("-a") || args.includes("--all");
  const nameFilter = args.includes("--name") ? args[args.indexOf("--name") + 1] : undefined;
  const sortBy = args.includes("--sort")
    ? (args[args.indexOf("--sort") + 1] as "cpu" | "mem" | "pid" | "name")
    : "name";

  if (watchFlag && systemFlag) {
    await watchSystemProcesses(sortBy, 15);
    return;
  }

  // ─── Mode 1: Show all system processes (--system / -a) ──
  if (systemFlag) {
    const spinner = createSpinner("Scanning system processes...");
    try {
      const processes = getSystemProcesses({
        name: nameFilter,
        userOnly: true,
        sortBy,
        limit: 30,
      });
      spinner.stop();
      process.stdout.write("\r\x1b[K");

      if (processes.length === 0) {
        console.error(`\n  ${pc.dim("No system processes found.")}\n`);
        return;
      }

      const columns: Column[] = [
        { key: "pid", label: "PID", align: "right", format: (v) => pc.dim(String(v).padStart(6)) },
        { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
        { key: "cpu", label: "CPU%", align: "right", format: (v) => {
          const num = v as number;
          return num > 10 ? pc.red(String(num)) : num > 5 ? pc.yellow(String(num)) : pc.dim(String(num));
        }},
        { key: "mem", label: "MEM%", align: "right", format: (v) => {
          const num = v as number;
          return num > 10 ? pc.red(String(num)) : num > 5 ? pc.yellow(String(num)) : pc.dim(String(num));
        }},
        { key: "state", label: "State", format: (v) => {
          const s = String(v);
          if (s === "R" || s === "Running") return pc.green(s);
          if (s === "Z" || s === "Zombie") return pc.red(s);
          if (s === "S" || s === "Sleeping") return pc.cyan(s);
          return pc.dim(s);
        }},
      ];

      const rows: Row[] = processes.map((p) => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpuPercent,
        mem: p.memPercent,
        state: formatProcessState(p.state),
      }));

      console.error(`\n  ${symbols.fox} ${pc.bold("System Processes")} ${pc.dim(`(top ${processes.length} by ${sortBy})`)}\n`);
      console.error(renderTable(columns, rows));
      console.error();
    } catch (error) {
      spinner.fail("Failed to scan processes");
      console.error(renderError("Process scan failed", String(error)));
    }
    return;
  }

  // ─── Mode 2: Show only Fennec-tracked processes (default) ─
  const tracked = readTracked();

  if (tracked.length === 0) {
    console.error(`\n  ${pc.dim("No tracked processes.")}`);
    console.error(`  ${pc.dim("Start an app with:")} ${pc.cyan("fennec start <command> --name <name>")}\n`);
    return;
  }

  const columns: Column[] = [
    { key: "name", label: "App", format: (v) => pc.bold(String(v)) },
    { key: "pid", label: "PID", align: "right" },
    { key: "status", label: "Status", format: (v) => {
      const s = v as string;
      if (s === "running") return pc.green("● running");
      return pc.red("○ stopped");
    }},
    { key: "port", label: "Port", format: (v) => {
      const p = v as number | null;
      return p ? pc.yellow(`:${p}`) : pc.dim("-");
    }},
    { key: "command", label: "Command", format: (v) => {
      const c = String(v);
      return c.length > 50 ? c.slice(0, 50) + "…" : c;
    }},
    { key: "uptime", label: "Uptime", format: (v) => pc.dim(String(v)) },
  ];

  const rows: Row[] = tracked.map((t) => {
    const running = isProcessRunning(t.pid);
    const uptime = running
      ? formatUptime(Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000))
      : "-";
    return {
      name: t.name,
      pid: running ? String(t.pid) : pc.dim(String(t.pid)),
      status: running ? "running" : "stopped",
      port: t.port ?? null,
      command: t.command,
      uptime,
    };
  });

  const runningCount = tracked.filter((t) => isProcessRunning(t.pid)).length;

  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Apps")} ${pc.dim(`(${runningCount}/${tracked.length} running)`)}\n`);
  console.error(renderTable(columns, rows));
  console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec start <command> --name <name> --port <port>")} ${pc.dim("to add more apps.")}`);
  console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec log <name>")} ${pc.dim("to view logs.")}`);
  console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec kill <name>")} ${pc.dim("to stop an app.")}`);
  console.error();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m}m`;
  }
  return `${h}h ${m}m`;
}

async function watchSystemProcesses(sortBy: string, limit: number): Promise<void> {
  console.error(`\n  ${pc.bold("Watching system processes")} ${pc.dim("(Ctrl+C to stop, refreshes every 3s)")}\n`);

  const render = () => {
    const processes = getSystemProcesses({
      userOnly: true,
      sortBy: sortBy as "cpu" | "mem" | "pid" | "name",
      limit,
    });

    const columns: Column[] = [
      { key: "pid", label: "PID", align: "right", format: (v) => pc.dim(String(v).padStart(6)) },
      { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
      { key: "cpu", label: "CPU%", align: "right", format: (v) => {
        const num = v as number;
        return num > 10 ? pc.red(String(num)) : num > 5 ? pc.yellow(String(num)) : pc.dim(String(num));
      }},
      { key: "mem", label: "MEM%", align: "right", format: (v) => {
        const num = v as number;
        return num > 10 ? pc.red(String(num)) : num > 5 ? pc.yellow(String(num)) : pc.dim(String(num));
      }},
      { key: "state", label: "S", align: "center" },
    ];

    const rows: Row[] = processes.map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: p.cpuPercent,
      mem: p.memPercent,
      state: p.state,
    }));

    return `  ${timestamp()} ${pc.dim(`${processes.length} processes`)}\n${renderTable(columns, rows, { compact: true })}`;
  };

  console.error(render());
  const interval = setInterval(() => {
    process.stdout.write("\x1B[J"); // Clear from cursor to end
    console.error(render());
  }, 3000);

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {});
}

// ─── Command: status ─────────────────────────────────────────────

async function statusCommand(_args: string[]): Promise<void> {
  const watchFlag = _args.includes("-w") || _args.includes("--watch");

  // Show tracked processes + system overview
  const tracked = readTracked();
  const topSystem = getSystemProcesses({ userOnly: true, sortBy: "cpu", limit: 5 });
  const totalUserProcs = getSystemProcesses({ userOnly: true }).length;

  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Status")}\n`);

  // ─── Tracked Apps Section ────────────────────────
  if (tracked.length > 0) {
    const runningCount = tracked.filter((t) => isProcessRunning(t.pid)).length;
    console.error(`  ${pc.bold("Managed Apps")} ${pc.dim(`(${runningCount}/${tracked.length} running)`)}\n`);

    for (const t of tracked) {
      const running = isProcessRunning(t.pid);
      const statusIcon = running ? pc.green("●") : pc.red("○");
      const portStr = t.port ? ` ${pc.yellow(`:${t.port}`)}` : "";
      const uptime = running
        ? pc.dim(formatUptime(Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000)))
        : pc.red("stopped");
      console.error(`  ${statusIcon} ${pc.bold(t.name)}${portStr} ${pc.dim(`(PID ${t.pid})`)} — ${uptime}`);
    }
    console.error();
  } else {
    console.error(`  ${pc.dim("No managed apps.")} ${pc.cyan("fennec start <command> --name <name>")}\n`);
  }

  // ─── System Summary ──────────────────────────────
  console.error(`  ${pc.bold("System")} ${pc.dim(`(${totalUserProcs} user processes)`)}`);

  for (const p of topSystem) {
    const cpuStr = p.cpuPercent > 10 ? pc.red(`${p.cpuPercent}%`) : p.cpuPercent > 5 ? pc.yellow(`${p.cpuPercent}%`) : pc.dim(`${p.cpuPercent}%`);
    const memStr = p.memPercent > 10 ? pc.red(`${p.memPercent}%`) : p.memPercent > 5 ? pc.yellow(`${p.memPercent}%`) : pc.dim(`${p.memPercent}%`);
    console.error(`  ${pc.dim(`PID ${p.pid}`)} ${pc.bold(p.name)} — CPU: ${cpuStr} MEM: ${memStr}`);
  }

  if (watchFlag) {
    await watchSystemProcesses("cpu", 15);
  }

  console.error();
}

// ─── Command: kill ───────────────────────────────────────────────

async function killCommand(args: string[]): Promise<void> {
  const rawTarget = args[0];
  const signalIndex = args.indexOf("--signal");
  const signalRaw = signalIndex !== -1 ? args[signalIndex + 1] : "SIGTERM";
  const signal = (signalRaw ?? "SIGTERM") as NodeJS.Signals;

  // ─── Kill All Mode ─────────────────────────────────────
  if (rawTarget === "all" || args.includes("--all") || args.includes("-a")) {
    const userProcs = getSystemProcesses({ userOnly: true, sortBy: "cpu", limit: 200 });
    if (userProcs.length === 0) {
      console.error(`  ${pc.dim("No user processes to kill.")}`);
      return;
    }

    console.error(`\n  ${pc.bold(`Kill ${userProcs.length} user processes?`)}`);
    console.error(`  ${pc.dim("This will stop ALL your running processes.")}`);
    console.error(`  ${pc.yellow("⚠ System processes will not be affected.")}\n`);

    const confirmed = await confirmPrompt(
      `${pc.red("Are you sure?")} ${pc.dim("This cannot be undone")}`,
      false,
    );

    if (!confirmed) {
      console.error(`  ${pc.dim("Cancelled.")}`);
      return;
    }

    const spinner = createSpinner(`Killing ${userProcs.length} processes...`);
    let killed = 0;
    let failed = 0;

    for (const proc of userProcs) {
      if (sysKill(proc.pid, signal)) {
        killed++;
        removeTrackedByPid(proc.pid);
      } else {
        failed++;
      }
      // Small delay to avoid overwhelming system
      if (killed % 10 === 0) await new Promise((r) => setTimeout(r, 50));
    }

    await new Promise((r) => setTimeout(r, 500));

    if (killed > 0) {
      spinner.succeed(`${killed} process(es) killed`);
    } else {
      spinner.fail(`Failed to kill processes`);
    }

    if (failed > 0) {
      console.error(`  ${pc.yellow(`${failed} process(es) could not be killed`)} ${pc.dim("(try with sudo)")}`);
    }
    return;
  }

  // ─── Single Kill Mode ─────────────────────────────────
  if (!rawTarget) {
    console.error(renderError("Missing target", "Usage: fennec kill <pid|name|all> [--signal SIGTERM|SIGKILL|SIGINT]"));
    process.exit(1);
  }

  // Resolve target: numeric = PID, string = find by name
  let targetPid: number;
  let displayName: string;

  const pid = parseInt(rawTarget, 10);
  if (!isNaN(pid) && String(pid) === rawTarget) {
    // Direct PID
    if (!isProcessRunning(pid)) {
      console.error(renderError("Process not found", `No process with PID ${pid} is running`));
      process.exit(1);
    }
    targetPid = pid;
    displayName = `PID ${pid}`;
  } else {
    // Find by name — show options if multiple matches
    const matches = getSystemProcesses({ name: rawTarget, userOnly: true, sortBy: "cpu" });
    if (matches.length === 0) {
      console.error(renderError("Process not found", `No running process matching "${rawTarget}"`));
      process.exit(1);
    }

    if (matches.length > 1) {
      // Multiple matches — let user pick
      console.error(`\n  ${pc.bold(`Multiple processes match "${rawTarget}":`)}`);
      const selected = await selectPrompt(
        `Select which to kill:`,
        matches.map((p, i) => ({
          value: String(i),
          label: `${p.name} (PID ${p.pid})`,
          description: `${p.command.slice(0, 80)} — CPU: ${p.cpuPercent}% MEM: ${p.memPercent}%`,
        })),
      );
      if (selected === null) {
        console.error(`  ${pc.dim("Cancelled")}`);
        return;
      }
      const idx = parseInt(selected, 10);
      targetPid = matches[idx]!.pid;
      displayName = `${matches[idx]!.name} (PID ${targetPid})`;
    } else {
      targetPid = matches[0]!.pid;
      displayName = `${matches[0]!.name} (PID ${targetPid})`;
    }
  }

  const confirmed = await confirmPrompt(
    `Kill ${pc.bold(displayName)} with ${pc.yellow(signal)}?`,
    false,
  );

  if (!confirmed) {
    console.error(`  ${pc.dim("Cancelled")}`);
    return;
  }

  const spinner = createSpinner(`Sending ${signal} to ${displayName}...`);

  const success = sysKill(targetPid, signal);

  if (success) {
    // Wait a moment to verify
    await new Promise((r) => setTimeout(r, 200));
    const stillRunning = isProcessRunning(targetPid);
    if (stillRunning && signal !== "SIGKILL") {
      spinner.warn(`${displayName} did not respond to ${signal}`);
      const forceKill = await confirmPrompt(
        `Send ${pc.red("SIGKILL")} to force stop?`,
        true,
      );
      if (forceKill) {
        const forceSpinner = createSpinner(`Sending SIGKILL to ${displayName}...`);
        sysKill(targetPid, "SIGKILL");
        await new Promise((r) => setTimeout(r, 300));
        if (!isProcessRunning(targetPid)) {
          forceSpinner.succeed(`${displayName} force stopped`);
        } else {
          forceSpinner.fail(`${displayName} could not be stopped (permission denied?)`);
        }
      } else {
        console.error(`  ${pc.dim("Retrying with SIGTERM...")}`);
        sysKill(targetPid, "SIGTERM");
        console.error(`  ${pc.yellow("⚠")} ${displayName} ${pc.dim("may still be running")}`);
      }
    } else {
      // Clean up tracked process
      removeTrackedByPid(targetPid);
      spinner.succeed(`${displayName} stopped`);
    }
  } else {
    spinner.fail(`Failed to kill ${displayName}`);
    console.error(renderError("Permission denied", `Try running with sudo or use a different signal.`));
  }
}

// ─── Command: restart ────────────────────────────────────────────

async function restartCommand(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(renderError("Missing process name/pid", "Usage: fennec restart <pid|name>"));
    process.exit(1);
  }

  // Resolve PID
  let targetPid: number;
  const pid = parseInt(name, 10);
  if (!isNaN(pid) && String(pid) === name) {
    targetPid = pid;
  } else {
    const processes = getSystemProcesses({ name, userOnly: true, limit: 1 });
    if (processes.length === 0) {
      console.error(renderError("Process not found", `No process matching "${name}"`));
      process.exit(1);
    }
    targetPid = processes[0]!.pid;
  }

  const confirmed = await confirmPrompt(
    `Restart ${pc.bold(`${name} (PID ${targetPid})`)}?`,
    false,
  );

  if (!confirmed) {
    console.error(`  ${pc.dim("Cancelled")}`);
    return;
  }

  const spinner = createSpinner(`Stopping PID ${targetPid}...`);

  // Kill the process
  const killed = sysKill(targetPid, "SIGTERM");
  if (!killed) {
    spinner.fail(`Failed to stop PID ${targetPid}`);
    return;
  }

  // Wait for exit
  await new Promise((r) => setTimeout(r, 1000));

  const stillRunning = isProcessRunning(targetPid);
  if (stillRunning) {
    spinner.warn(`Process didn't stop, sending SIGKILL...`);
    sysKill(targetPid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
  }

  // Get the command from the process info to suggest restart command
  const procInfo = getSystemProcesses({ pid: targetPid, limit: 1 })[0];
  let suggestion = "";
  if (procInfo) {
    suggestion = `\n  ${pc.dim("Re-run:")} ${renderCommand(procInfo.command)}`;
  }

  spinner.succeed(`${name} stopped${suggestion}`);
}

// ─── Command: log ────────────────────────────────────────────────

async function logCommand(args: string[]): Promise<void> {
  const target = args[0];
  if (!target) {
    console.error(renderError("Missing process name/pid", "Usage: fennec log <pid|name> [--lines N] [--level LEVEL] [-f]"));
    process.exit(1);
  }

  const linesIndex = args.indexOf("--lines");
  const lines = linesIndex !== -1 ? parseInt(args[linesIndex + 1]!, 10) : 30;
  const followFlag = args.includes("-f") || args.includes("--follow");

  // Resolve PID
  let targetPid: number;
  let displayName: string;
  const pid = parseInt(target, 10);
  if (!isNaN(pid) && String(pid) === target) {
    targetPid = pid;
    displayName = `PID ${pid}`;
  } else {
    const processes = getSystemProcesses({ name: target, userOnly: true, limit: 1 });
    if (processes.length === 0) {
      console.error(renderError("Process not found", `No process matching "${target}"`));
      process.exit(1);
    }
    targetPid = processes[0]!.pid;
    displayName = `${processes[0]!.name} (PID ${targetPid})`;
  }

  const spinner = createSpinner(`Fetching logs for ${displayName}...`);

  try {
    // Try journalctl first (Linux systemd), then fall back to /proc/pid/fd
    let logLines: string[] = [];

    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(
        `journalctl --no-pager -n ${lines} _PID=${targetPid} 2>/dev/null || tail -n ${lines} /proc/${targetPid}/fd/1 2>/dev/null || echo "No logs available"`,
        { encoding: "utf-8", timeout: 3000 },
      );
      logLines = output.trim().split("\n").filter(Boolean);
    } catch {
      logLines = [`  ${pc.dim("(no log access — process may not be managed by Fennec)")}`];
    }

    spinner.stop();
    process.stdout.write("\r\x1b[K");

    console.error(`\n  ${symbols.fox} ${pc.bold("Logs")} ${renderAppName(displayName)} ${pc.dim(`(last ${lines} lines)`)}\n`);

    for (const line of logLines.slice(-lines)) {
      const display = line.length > 200 ? line.slice(0, 200) + "…" : line;
      if (line.toLowerCase().includes("error") || line.toLowerCase().includes("fail")) {
        console.error(`  ${pc.red(display)}`);
      } else if (line.toLowerCase().includes("warn")) {
        console.error(`  ${pc.yellow(display)}`);
      } else {
        console.error(`  ${display}`);
      }
    }

    if (followFlag) {
      console.error(`\n  ${pc.dim("Following... (Ctrl+C to stop)")}\n`);
      await new Promise(() => {});
    }

    console.error();
  } catch (error) {
    spinner.fail(`Failed to fetch logs for ${displayName}`);
    console.error(renderError("Log fetch failed", String(error)));
  }
}

// ─── Command: attach ─────────────────────────────────────────────

async function attachCommand(args: string[]): Promise<void> {
  const port = parseInt(args[0]!, 10);
  if (isNaN(port)) {
    console.error(renderError("Invalid port", "Usage: fennec attach <port> --name <name>"));
    process.exit(1);
  }

  const nameIndex = args.indexOf("--name");
  const rawName = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const name = rawName ?? `port-${port}`;

  const spinner = createSpinner(`Attaching to :${port}...`);

  try {
    const { PortDetector } = await import("@plumpslabs/fennec-core");
    const detector = new PortDetector();
    const info = detector.detectByPort(port);

    if (info) {
      spinner.succeed(`Attached to :${port}`);
      console.error(`  ${renderKV("Name", renderAppName(name))}`);
      console.error(`  ${renderKV("PID", String(info.pid))}`);
      console.error(`  ${renderKV("Command", info.command || pc.dim("unknown"))}`);
    } else {
      spinner.fail(`No process found on port ${port}`);
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(`Failed to attach to :${port}`);
    console.error(renderError("Error", String(error)));
    process.exit(1);
  }
}

// ─── Command: sessions ───────────────────────────────────────────

async function sessionsCommand(): Promise<void> {
  const store = new SessionStore("./.fennec/sessions");
  const sessions = store.list();

  if (sessions.length === 0) {
    console.error(`\n  ${pc.dim("No saved sessions found.")}\n`);
    return;
  }

  const columns: Column[] = [
    { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
    { key: "origin", label: "Origin" },
    { key: "savedAt", label: "Saved", format: (v) => pc.dim(String(v)) },
  ];

  const rows: Row[] = sessions.map((s) => ({
    name: s.name,
    origin: s.origin,
    savedAt: new Date(s.savedAt).toLocaleString(),
  }));

  console.error(`\n  ${symbols.fox} ${pc.bold("Saved Sessions")}\n`);
  console.error(renderTable(columns, rows));
  console.error(`  ${pc.dim(`${sessions.length} session(s)`)}\n`);
}

// ─── Command: setup ──────────────────────────────────────────────

async function setupCommand(): Promise<void> {
  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Setup")}\n`);

  const mcpClient = await selectPrompt("Which MCP client are you using?", [
    { value: "claude", label: "Claude Desktop", description: "Anthropic's AI desktop app" },
    { value: "cursor", label: "Cursor", description: "AI-powered code editor" },
    { value: "cline", label: "Cline", description: "VS Code MCP client" },
    { value: "other", label: "Other MCP client", description: "Any MCP-compatible client" },
  ]);

  if (!mcpClient) {
    console.error(`  ${pc.dim("Setup cancelled.")}\n`);
    return;
  }

  console.error(`\n  ${pc.green("✓")} Selected: ${pc.bold(mcpClient)}\n`);

  const configSnippet = `{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"]
    }
  }
}`;

  console.error(`  ${pc.bold("Add this to your MCP client config:")}\n`);
  console.error(`  ${pc.dim("```")}`);
  console.error(configSnippet.split("\n").map((l) => `  ${l}`).join("\n"));
  console.error(`  ${pc.dim("```")}\n`);
  console.error(`  ${renderSuccess("Setup complete!")} ${pc.dim("Run")} ${renderCommand("fennec start")} ${pc.dim("to begin.")}\n`);
}

// ─── Command: install-browsers ───────────────────────────────────

async function installBrowsersCommand(): Promise<void> {
  console.error(`\n  ${pc.bold("Installing Browser Engines")}\n`);

  const spinner = createSpinner("Installing Chromium...");

  try {
    execSync("npx playwright install chromium", {
      stdio: "pipe",
      timeout: 120000,
    });
    spinner.succeed("Chromium installed successfully");
  } catch {
    spinner.fail("Failed to install Chromium");
    console.error(`  ${pc.yellow("→")} Try running: ${renderCommand("npx playwright install chromium")}`);
  }

  console.error(`\n  ${pc.green("✓")} Browser installation complete.\n`);
}

// ─── Command: init ───────────────────────────────────────────────

async function initCommand(): Promise<void> {
  console.error(`\n  ${pc.bold("Initialize Fennec Configuration")}\n`);

  const configFile = resolve("./fennec.config.yaml");

  if (existsSync(configFile)) {
    const overwrite = await confirmPrompt(
      `${pc.yellow("fennec.config.yaml")} already exists. Overwrite?`,
      false,
    );

    if (!overwrite) {
      console.error(`  ${pc.dim("Cancelled.")}\n`);
      return;
    }
  }

  const spinner = createSpinner("Generating configuration...");

  const config = `# Fennec Configuration
# Generated by 'fennec init'

browser:
  type: chromium
  headless: true
  defaultTimeout: 30000
  viewport:
    width: 1280
    height: 720

session:
  maxSessions: 10
  idleTimeoutSecs: 1800
  persistPath: ".fennec/sessions"

process:
  maxProcesses: 10
  logBufferLines: 2000
  spawnAllowlist:
    - "npm"
    - "node"
    - "pnpm"
    - "yarn"
    - "bun"
    - "python"
    - "python3"

terminal:
  logBufferLines: 2000
  watchDebounceMs: 50

network:
  bufferSize: 1000
  captureRequestBody: true
  captureResponseBody: true
  slowRequestThresholdMs: 1000

console:
  bufferSize: 500
  levels:
    - log
    - info
    - warn
    - error
    - debug

correlation:
  windowMs: 500
  enableRootCauseInference: true
  minConfidence: 0.7

security:
  sandbox: true
  allowProcessSpawn: true
  allowProcessKill: false
  allowedDomains: []
  blockedDomains: []
  allowFileProtocol: false
  allowCDPRawAccess: false
  exportPath: ".fennec/exports"
  maxExportSizeMB: 10

transport:
  type: stdio
  port: 3333
  host: "127.0.0.1"

logging:
  level: info
  format: pretty
  file: null
`;

  writeFileSync(configFile, config, "utf-8");

  spinner.succeed(`Configuration written to ${pc.bold(configFile)}`);
  console.error(`\n  ${pc.dim("Edit the file to customize Fennec behavior.")}\n`);
}

// ─── Start ───────────────────────────────────────────────────────

main().catch((error) => {
  console.error(renderError("Fatal error", String(error)));
  process.exit(1);
});
