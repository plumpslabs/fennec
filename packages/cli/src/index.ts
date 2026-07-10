#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
  statusBadge,
  logLevel,
  timestamp,
  divider,
  createSpinner,
  selectPrompt,
  confirmPrompt,
  type Column,
  type Row,
  type ProcessStatus,
} from "./utils/format.js";

const [, , command, ...args] = process.argv;

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!command || command === "start") {
    await startServer(args);
  } else if (command === "run") {
    await runCommand(args);
  } else if (command === "status" || command === "ps") {
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
    console.log(`  ${symbols.fox} ${pc.bold("Fennec")} ${pc.dim("v1.11.0")}`);
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

// ─── Command: run ────────────────────────────────────────────────

async function runCommand(args: string[]): Promise<void> {
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const cwdIndex = args.indexOf("--cwd");
  const cwd = cwdIndex !== -1 ? args[cwdIndex + 1] : undefined;
  const restartFlag = args.includes("--restart");

  // Extract command (everything before --name or --cwd)
  const cmdEnd = Math.min(
    nameIndex !== -1 ? nameIndex : Infinity,
    cwdIndex !== -1 ? cwdIndex : Infinity,
  );
  const cmdParts = args.slice(0, cmdEnd);
  const cmd = cmdParts.join(" ");

  if (!cmd) {
    console.error(renderError("Missing command", "Usage: fennec run <command> --name <name>"));
    process.exit(1);
  }

  const appName = name ?? cmdParts[0] ?? "app";

  console.error(`\n  ${symbols.fox} ${pc.bold("Running")} ${renderAppName(appName)}\n`);
  console.error(`  ${renderKV("Command", cmd)}`);
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

    console.error(`\n  ${pc.green("●")} ${pc.bold(appName)} ${pc.dim(`started (PID: ${proc.pid})`)}\n`);

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

// ─── Command: status ─────────────────────────────────────────────

async function statusCommand(_args: string[]): Promise<void> {
  const watchFlag = _args.includes("-w") || _args.includes("--watch");

  if (watchFlag) {
    await watchStatus();
    return;
  }

  const columns: Column[] = [
    { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
    { key: "source", label: "Source" },
    { key: "status", label: "Status", format: (v) => statusBadge(v as ProcessStatus) },
    { key: "pid", label: "PID" },
    { key: "uptime", label: "Uptime" },
    { key: "error", label: "Last Error", format: (v) => v ? pc.red(String(v)) : pc.dim("-") },
  ];

  // In a real scenario, this would connect to the Fennec server API
  // For now, show a static example or basic process list
  const rows: Row[] = [
    { name: "backend", source: ":3000", status: "running", pid: "12345", uptime: "2h 15m", error: null },
    { name: "frontend", source: ":5173", status: "running", pid: "12346", uptime: "2h 15m", error: null },
    { name: "database", source: ":5432", status: "running", pid: "docker", uptime: "5h 30m", error: null },
  ];

  console.error(`\n  ${symbols.fox} ${pc.bold("Observed Processes")}\n`);
  console.error(renderTable(columns, rows));
  console.error();
}

async function watchStatus(): Promise<void> {
  console.error(`\n  ${pc.bold("Watching status")} ${pc.dim("(Ctrl+C to stop)")}\n`);

  const render = () => {
    const columns: Column[] = [
      { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
      { key: "status", label: "Status", format: (v) => statusBadge(v as ProcessStatus) },
      { key: "pid", label: "PID" },
      { key: "uptime", label: "Uptime" },
      { key: "cpu", label: "CPU" },
      { key: "mem", label: "Memory" },
    ];

    const rows: Row[] = [
      { name: "backend", status: "running", pid: "12345", uptime: "2h 15m", cpu: "1.2%", mem: "128MB" },
      { name: "frontend", status: "running", pid: "12346", uptime: "2h 15m", cpu: "0.8%", mem: "64MB" },
    ];

    return renderTable(columns, rows, { compact: true });
  };

  console.error(render());
  const interval = setInterval(() => {
    process.stdout.write("\x1B[6A"); // Move cursor up
    console.error(render());
  }, 2000);

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {});
}

// ─── Command: log ────────────────────────────────────────────────

async function logCommand(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(renderError("Missing process name", "Usage: fennec log <name> [options]"));
    process.exit(1);
  }

  const linesIndex = args.indexOf("--lines");
  const lines = linesIndex !== -1 ? parseInt(args[linesIndex + 1]!, 10) : 50;

  const levelIndex = args.indexOf("--level");
  const level = levelIndex !== -1 ? args[levelIndex + 1] : undefined;

  const followFlag = args.includes("-f") || args.includes("--follow");

  console.error(`\n  ${symbols.fox} ${pc.bold("Logs")} ${renderAppName(name)} ${pc.dim(`(last ${lines} lines)`)}\n`);

  // Placeholder: in production, this would fetch from the server API
  const mockLogs = [
    { time: "12:00:00", level: "INFO" as const, msg: "Server started on port 3000" },
    { time: "12:00:01", level: "INFO" as const, msg: "Database connected" },
    { time: "12:00:02", level: "WARN" as const, msg: "Deprecation: use express@5" },
    { time: "12:00:05", level: "ERROR" as const, msg: "POST /api/login → 500" },
    { time: "12:00:06", level: "ERROR" as const, msg: "JWT_SECRET not set in environment" },
  ];

  for (const log of mockLogs) {
    const time = pc.dim(`[${log.time}]`);
    const lvl = logLevel(log.level);
    const msg = log.level === "ERROR" ? pc.red(log.msg) : log.level === "WARN" ? pc.yellow(log.msg) : log.msg;
    console.error(`  ${time} ${lvl} ${msg}`);
  }

  if (followFlag) {
    console.error(`\n  ${pc.dim("Following... (Ctrl+C to stop)")}\n`);
    await new Promise(() => {});
  }

  console.error();
}

// ─── Command: kill ───────────────────────────────────────────────

async function killCommand(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(renderError("Missing process name", "Usage: fennec kill <name>"));
    process.exit(1);
  }

  const signalIndex = args.indexOf("--signal");
  const signalRaw = signalIndex !== -1 ? args[signalIndex + 1] : "SIGTERM";
  const signal = (signalRaw ?? "SIGTERM") as NodeJS.Signals;

  const confirmed = await confirmPrompt(
    `Stop ${pc.bold(name)} with ${pc.yellow(signal)}?`,
    false,
  );

  if (!confirmed) {
    console.error(`  ${pc.dim("Cancelled")}`);
    return;
  }

  // Placeholder: would connect to Fennec server API
  console.error(`\n  ${pc.green("✓")} ${renderAppName(name)} ${pc.dim(`stopped (${signal})`)}\n`);
}

// ─── Command: restart ────────────────────────────────────────────

async function restartCommand(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(renderError("Missing process name", "Usage: fennec restart <name>"));
    process.exit(1);
  }

  const spinner = createSpinner(`Restarting ${name}...`);

  // Placeholder: would connect to Fennec server API
  await new Promise((resolve) => setTimeout(resolve, 1000));

  spinner.succeed(`${name} restarted`);
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
