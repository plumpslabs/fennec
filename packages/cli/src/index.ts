#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { FennecServer, SessionStore } from "@plumpslabs/fennec-core";
import { printBanner } from "./utils/banner.js";
import { showHelp } from "./utils/help.js";
import { pipeCommand } from "./commands/pipe.js";
import { attachPidCommand } from "./commands/attach-pid.js";
import { attachPortCommand } from "./commands/attach-port.js";
import { watchCommand } from "./commands/watch.js";

const [, , command, ...args] = process.argv;

// ─── Minimal readline-based prompt utilities ─────────────────────

function rlQuestion(query: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmPrompt(message: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = await rlQuestion(`\n${message} (${hint}): `);
  if (!answer) return defaultValue;
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

async function selectPrompt<T extends string>(
  message: string,
  options: { value: T; label: string }[],
): Promise<T | symbol> {
  console.log(`\n${message}\n`);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}) ${opt.label}`);
  });
  console.log(`  0) Cancel`);
  const answer = await rlQuestion(`\nEnter number (0-${options.length}): `);
  const num = parseInt(answer, 10);
  if (isNaN(num) || num === 0) return Symbol("cancel");
  const selected = options[num - 1];
  if (!selected) {
    console.log("  Invalid selection. Cancelled.");
    return Symbol("cancel");
  }
  return selected.value;
}

function simpleSpinner(text: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);
  return {
    stop(message?: string) {
      clearInterval(interval);
      process.stdout.write(`\r${message ? "✓" : " "} ${message ?? text}\n`);
    },
  };
}

const isCancel = (v: unknown): boolean => v === Symbol("cancel");

// ─── Main ────────────────────────────────────────────────────────

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

async function startServer(args: string[]): Promise<void> {
  const configIndex = args.indexOf("--config");
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const server = new FennecServer(configPath);
  await server.start();
}

async function sessionsCommand(): Promise<void> {
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
  console.log("\n  Fennec Setup\n");

  const mcpClient = await selectPrompt("Which MCP client are you using?", [
    { value: "claude", label: "Claude Desktop" },
    { value: "other", label: "Other MCP client" },
  ]);

  if (isCancel(mcpClient)) {
    console.log("Setup cancelled");
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

  console.log("Setup complete! Run 'fennec start' to begin.\n");
}

async function installBrowsersCommand(): Promise<void> {
  console.log("\n  Installing browser engines\n");

  const s = simpleSpinner("Installing Chromium...");

  try {
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      timeout: 120000,
    });
    s.stop("Chromium installed successfully");
  } catch {
    s.stop("Failed to install Chromium");
    console.error("Try running manually: npx playwright install chromium");
  }

  console.log("\nBrowser installation complete.\n");
}

async function initCommand(): Promise<void> {
  console.log("\n  Initialize Fennec Configuration\n");

  const configFile = resolve("./fennec.config.yaml");

  if (existsSync(configFile)) {
    const overwrite = await confirmPrompt(
      "fennec.config.yaml already exists. Overwrite?",
      false,
    );

    if (!overwrite) {
      console.log("Cancelled");
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
  console.log(`Configuration written to ${configFile}\n`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
