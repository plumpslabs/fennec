#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { intro, outro, spinner, confirm, select, isCancel } from "@clack/prompts";
import { FennecServer } from "@fennec/core";

const [, , command, ...args] = process.argv;

function printBanner(): void {
  // MCP stdio transport: stderr for non-JSON output
  // stdout is reserved for JSON-RPC messages only!
  console.error(`
  /\\   /\\
 (  o o  )    fennec v0.1.0
 =( Y )=      ears everywhere in your stack.
   )   (
  `);
}

async function main(): Promise<void> {
  if (!command || command === "start") {
    await startServer(args);
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
  } else if (command === "help" || command === "--help" || command === "-h") {
    printBanner();
    showHelp();
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'fennec help' for usage information");
    process.exit(1);
  }
}

function showHelp(): void {
  console.error(`
Usage: fennec <command> [options]

Commands:
  start              Start the MCP server (default)
    --transport      Transport type (stdio | sse) [default: stdio]
    --port           SSE port [default: 3333]
    --config         Path to config file

  pipe               Pipe stdin to log watcher
    --name           Watcher name (required)

  attach-pid         Attach to a running process by PID
    <pid>            Process ID (required)
    --name           Name for the process

  attach-port        Attach to a process by port
    <port>           Port number (required)
    --name           Name for the process

  watch              Watch a log file
    --file           File path (required)
    --name           Watcher name

  sessions           List saved auth sessions
  setup              Configure MCP client (Claude Desktop)
  install-browsers   Install Playwright browser engines
  init               Generate fennec.config.yaml

  help               Show this help message
  `);
}

async function attachPidCommand(args: string[]): Promise<void> {
  const pid = parseInt(args[0]!, 10);
  if (isNaN(pid)) {
    console.error("Error: valid PID is required");
    process.exit(1);
  }
  const { PortDetector } = await import("@fennec/core");
  const detector = new PortDetector();
  const info = detector.detectByPid(pid);
  if (info) {
    console.log(`Attached to PID ${pid}${info.command ? ` (${info.command})` : ""}`);
    if (info.port) console.log(`   Port: ${info.port}`);
  } else {
    console.error(`Could not find process with PID ${pid}`);
    process.exit(1);
  }
}

async function attachPortCommand(args: string[]): Promise<void> {
  const port = parseInt(args[0]!, 10);
  if (isNaN(port)) {
    console.error("Error: valid port number is required");
    process.exit(1);
  }
  const { PortDetector } = await import("@fennec/core");
  const detector = new PortDetector();
  const info = detector.detectByPort(port);
  if (info) {
    console.log(`Found process on port ${port}: PID ${info.pid}${info.command ? ` (${info.command})` : ""}`);
  } else {
    console.error(`No process found listening on port ${port}`);
    process.exit(1);
  }
}

async function watchCommand(args: string[]): Promise<void> {
  const fileIndex = args.indexOf("--file");
  const filePath = fileIndex !== -1 ? args[fileIndex + 1] : undefined;
  if (!filePath) {
    console.error("Error: --file is required for watch command");
    process.exit(1);
  }
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }
  const { LogWatcher } = await import("@fennec/core");
  const watcher = new LogWatcher();
  const watcherId = watcher.watchFile(resolvedPath, name);
  console.log(`Watching file: ${resolvedPath}`);
  console.log(`Watcher ID: ${watcherId}`);
  process.stdin.resume();
}

async function startServer(args: string[]): Promise<void> {
  const configIndex = args.indexOf("--config");
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const server = new FennecServer(configPath);
  await server.start();
}

async function pipeCommand(args: string[]): Promise<void> {
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : "pipe";

  if (!name) {
    console.error("Error: --name is required for pipe command");
    process.exit(1);
  }

  const { PipeWatcher } = await import("@fennec/core");
  const watcher = new PipeWatcher();
  const { write } = watcher.createPipe(name);

  console.error(`Pipe watcher '${name}' active. Forwarding stdin...`);

  // Backpressure-aware passthrough
  const onDrain = () => {
    process.stdin.resume();
  };
  process.stdout.on("drain", onDrain);

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (data: string) => {
    try {
      write(data);
      const canContinue = process.stdout.write(data);
      if (!canContinue) {
        process.stdin.pause();
      }
    } catch (error) {
      console.error("Pipe error:", error);
    }
  });

  process.stdin.on("error", (error) => {
    console.error("Pipe stdin error:", error);
  });

  process.stdin.on("end", () => {
    console.error(`Pipe watcher '${name}' ended.`);
    watcher.cleanup();
  });

  // Graceful shutdown
  const shutdown = () => {
    watcher.cleanup();
    process.stdout.removeListener("drain", onDrain);
    process.stdin.removeAllListeners();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function sessionsCommand(): Promise<void> {
  const { SessionStore } = await import("@fennec/core");
  const store = new SessionStore("./.fennec/sessions");
  const sessions = store.list();

  if (sessions.length === 0) {
    console.log("No saved sessions found.");
    return;
  }

  console.log("Saved sessions:");
  for (const s of sessions) {
    console.log(`  ${s.name} at ${s.origin} (saved: ${new Date(s.savedAt).toLocaleString()})`);
  }
  console.log(`\nTotal: ${sessions.length} session(s)`);
}

async function setupCommand(): Promise<void> {
  intro("Fennec Setup");

  const mcpClient = await select({
    message: "Which MCP client are you using?",
    options: [
      { value: "claude", label: "Claude Desktop" },
      { value: "other", label: "Other MCP client" },
    ],
  });

  if (isCancel(mcpClient)) {
    outro("Setup cancelled");
    return;
  }

  if (mcpClient === "claude") {
    console.log(`
To configure Claude Desktop for Fennec, add to your config:

{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"]
    }
  }
}
    `);
  }

  outro("Setup complete! Run 'fennec start' to begin.");
}

async function installBrowsersCommand(): Promise<void> {
  intro("Installing browser engines");

  const s = spinner();
  s.start("Installing Chromium...");

  try {
    const { execSync } = await import("node:child_process");
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      timeout: 120000,
    });
    s.stop("Chromium installed successfully");
  } catch {
    s.stop("Failed to install Chromium");
    console.error("Try running manually: npx playwright install chromium");
  }

  outro("Browser installation complete.");
}

async function initCommand(): Promise<void> {
  intro("Initialize Fennec Configuration");

  const configFile = resolve("./fennec.config.yaml");

  if (existsSync(configFile)) {
    const overwrite = await confirm({
      message: "fennec.config.yaml already exists. Overwrite?",
    });

    if (isCancel(overwrite) || !overwrite) {
      outro("Cancelled");
      return;
    }
  }

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
  persistPath: "./.fennec/sessions"

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
  exportPath: "./.fennec/exports"
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

  const { writeFileSync } = await import("node:fs");
  writeFileSync(configFile, config, "utf-8");
  outro(`Configuration written to ${configFile}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
