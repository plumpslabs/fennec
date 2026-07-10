/**
 * Command: spawn — List stopped tracked processes or re-spawn one.
 *
 * Without args: shows a selectable list of stopped tracked processes.
 * With name: re-spawns the named process from its saved command in tracked.json.
 * With --all: re-spawns all stopped processes that have saved commands.
 *
 * Unlike `fennec start <cmd> --name <name>` which creates a brand new connection,
 * `fennec spawn` revives a previously stopped process.
 */
import pc from "picocolors";
import { createWriteStream, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { symbols, renderError, renderKV, renderAppName, createSpinner, selectPrompt } from "../utils/format.js";
import { readTracked, addTracked, rotateLogFile } from "./tracker.js";
import { isProcessRunning } from "../utils/system-process.js";
import { psCommand } from "./ps.js";

export async function spawnCommand(args: string[]): Promise<void> {
  const spawnAll = args.includes("--all") || args.includes("-a");
  const name = args[0];

  if (spawnAll) {
    await spawnAllStopped();
    return;
  }

  if (!name) {
    // No args: list stopped processes for selection
    await spawnList();
    return;
  }

  // With name: find and re-spawn
  const tracked = readTracked();
  const match = tracked.find((t) => t.name === name);

  if (!match) {
    console.error(renderError("Not found", `No tracked process named "${name}". Use ${pc.cyan("fennec spawn")} to see available processes, or ${pc.cyan("fennec start <command> --name <name>")} to create a new one.`));
    process.exit(1);
  }

  if (isProcessRunning(match.pid)) {
    console.error(`\n  ${pc.yellow("⚠")} ${pc.bold(name)} ${pc.dim("is already running (PID:")} ${match.pid}${pc.dim(")")}`);
    console.error(`  ${pc.dim("Use")} ${pc.cyan(`fennec stop ${name}`)} ${pc.dim("to stop it first.")}`);
    console.error();
    process.exit(0);
  }

  if (!match.command) {
    console.error(renderError("No command saved", `"${name}" has no saved command and cannot be re-spawned.`));
    process.exit(1);
  }

  await respawnProcess(match);
}

/**
 * Re-spawn ALL stopped tracked processes that have saved commands.
 */
async function spawnAllStopped(): Promise<void> {
  const tracked = readTracked();
  const toSpawn = tracked.filter((t) => !isProcessRunning(t.pid) && t.command);

  if (toSpawn.length === 0) {
    console.error(`\n  ${pc.dim("No stopped processes with saved commands to spawn.")}\n`);
    return;
  }

  console.error(`\n  ${symbols.fox} ${pc.bold(`Spawning ${toSpawn.length} process(es)...`)}\n`);
  for (const t of toSpawn) {
    console.error(`  ${pc.dim("·")} ${pc.bold(t.name)} ${pc.dim(`(${t.command})`)}`);
  }
  console.error();

  const spinner = createSpinner("Spawning...");
  let spawned = 0;
  let failed = 0;

  for (const proc of toSpawn) {
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

      const pid = child.pid ?? 0;
      rotateLogFile(logFilePath);
      const logStream = createWriteStream(logFilePath, { flags: "a" });
      if (child.stdout) child.stdout.pipe(logStream);
      if (child.stderr) child.stderr.pipe(logStream);
      child.unref();

      addTracked({
        name: proc.name,
        pid,
        command: proc.command,
        port: proc.port,
        cwd: proc.cwd,
        startedAt: new Date().toISOString(),
      });

      spawned++;
    } catch {
      failed++;
    }
  }

  spinner.stop();
  process.stdout.write("\r\x1b[K");

  if (spawned > 0) {
    console.error(`  ${pc.green("✓")} ${pc.bold(`Spawned ${spawned} process(es)`)}`);
  }
  if (failed > 0) {
    console.error(`  ${pc.red("✗")} ${pc.bold(`${failed} process(es) failed to spawn`)}`);
  }

  console.error();
  await psCommand([]);
}

/**
 * Show a selectable list of stopped tracked processes.
 */
async function spawnList(): Promise<void> {
  const tracked = readTracked();

  if (tracked.length === 0) {
    console.error(`\n  ${pc.dim("No tracked processes found.")}`);
    console.error(`  ${pc.dim("Start an app first:")} ${pc.cyan("fennec start <command> --name <name>")}`);
    console.error();
    return;
  }

  const stopped = tracked.filter((t) => !isProcessRunning(t.pid));
  const running = tracked.filter((t) => isProcessRunning(t.pid));

  if (stopped.length === 0) {
    console.error(`\n  ${pc.dim("All tracked processes are running. Nothing to spawn.")}`);
    console.error();
    return;
  }

  console.error(`\n  ${symbols.fox} ${pc.bold("Available to spawn")} ${pc.dim(`(${stopped.length}/${tracked.length} stopped)`)}`);

  // Show running ones as info
  if (running.length > 0) {
    console.error(`  ${pc.dim("Running (use stop first):")}`);
    for (const r of running) {
      console.error(`    ${pc.green("●")} ${pc.bold(r.name)} ${pc.dim(`(PID ${r.pid})`)}`);
    }
    console.error();
  }

  // Show stopped ones as selectable
  const selected = await selectPrompt("Select a process to spawn:", stopped.map((t) => ({
    value: t.name,
    label: t.name,
    description: t.command.length > 80 ? t.command.slice(0, 80) + "..." : t.command,
  })));

  if (selected === null) {
    console.error(`  ${pc.dim("Cancelled")}`);
    return;
  }

  const match = stopped.find((t) => t.name === selected);
  if (match) {
    await respawnProcess(match);
  }
}

/**
 * Re-spawn a stopped tracked process from its saved command/cwd.
 */
async function respawnProcess(proc: { name: string; command: string; cwd?: string; port?: number }): Promise<void> {
  const cmdParts = proc.command.split(/\s+/);
  const logDir = resolve(homedir(), ".fennec", "logs");
  mkdirSync(logDir, { recursive: true });
  const logFilePath = resolve(logDir, `${proc.name}.log`);

  console.error(`\n  ${symbols.fox} ${pc.bold("Spawning")} ${renderAppName(proc.name)} ${pc.dim("(from saved config)")}\n`);
  console.error(`  ${renderKV("Command", proc.command)}`);
  if (proc.cwd) console.error(`  ${renderKV("Directory", proc.cwd)}`);
  if (proc.port) console.error(`  ${renderKV("Port", String(proc.port))}`);

  try {
    const child = spawn(cmdParts[0]!, cmdParts.slice(1), {
      cwd: proc.cwd,
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

    // Update tracked.json with new PID
    addTracked({
      name: proc.name,
      pid,
      command: proc.command,
      port: proc.port,
      cwd: proc.cwd,
      startedAt: new Date().toISOString(),
    });

    console.error(`  ${pc.green("✓")} ${pc.bold(proc.name)} ${pc.dim(`spawned (PID: ${pid})`)}`);

    // Show the process table
    await psCommand([]);
  } catch (error) {
    console.error(renderError(`Failed to spawn ${proc.name}`, String(error)));
    process.exit(1);
  }
}
