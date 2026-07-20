/**
 * Command: start / run — Spawn a process as a detached daemon.
 * Includes auto-resurrect: on server start, re-spawns tracked processes
 * that died since last session (like resurrect).
 *
 * With --restart flag: auto-restarts the process if it crashes (watch).
 */
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FennecServer } from '@plumpslabs/fennec-core';
import pc from 'picocolors';
import { printBanner } from '../utils/banner.js';
import {
  symbols,
  renderKV,
  renderAppName,
  renderError,
  divider,
  createSpinner,
} from '../utils/format.js';
import {
  readTracked,
  addTracked,
  removeTracked,
  spawnDaemon,
  resolveArgs,
  isTrackedRunning,
  buildSpawnEnv,
  logFilePathFor,
  adoptExternalOnPort,
  extractFlagValue,
} from './tracker.js';
import { ensureSupervisorRunning } from './supervisor.js';
import { ensurePersistEnabled } from './persist.js';
import { isProcessRunning, checkPort } from '../utils/system-process.js';
import { psCommand } from './ps.js';
import type { TrackedProcess } from './tracker.js';

/** Sleep helper */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until a freshly spawned daemon is confirmed "ready":
 * - If a port is provided, wait until the port accepts connections.
 * - Otherwise, wait a short grace period and confirm the PID is still alive
 *   (catches commands that crash immediately, e.g. "No rule to make target").
 */
async function waitForReady(
  pid: number,
  port: number | undefined,
  timeoutMs = 8000,
): Promise<{ running: boolean; portReady: boolean }> {
  const start = Date.now();
  const graceMs = 700;

  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) return { running: false, portReady: false };
    if (port !== undefined) {
      if (await checkPort(port)) return { running: true, portReady: true };
      await sleep(250);
      continue;
    }
    // No port to probe: just make sure it survives the grace window.
    if (Date.now() - start >= graceMs) return { running: true, portReady: false };
    await sleep(150);
  }
  return { running: isProcessRunning(pid), portReady: port === undefined ? false : false };
}

// Re-export from tracker for backward compat
export type { TrackedProcess };

export async function startServer(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim('Starting Fennec MCP server...')}\n`);

  const configIndex = args.indexOf('--config');
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const useSse = args.includes('--sse');

  // Set env var so ConfigLoader picks it up (overrides config file)
  if (useSse) {
    process.env.FENNEC_TRANSPORT_TYPE = 'sse';
  }

  try {
    const server = new FennecServer(configPath);

    // Auto-resurrect: re-spawn tracked processes that died since last session
    await resurrectTracked();

    await server.start();

    if (useSse) {
      const port = server.getConfig().transport.port;
      console.error(`\n  ${pc.green('✓')} ${pc.bold('Fennec server is running')}`);
      console.error(`  ${renderKV('Transport', pc.cyan('SSE (HTTP)'))}`);
      console.error(`  ${renderKV('URL', pc.cyan(`http://localhost:${port}/sse`))}`);
      console.error(
        `  ${renderKV('MCP Config', pc.cyan(`{ \"type\": \"remote\", \"url\": \"http://localhost:${port}/sse\" }`))}`,
      );
      console.error(
        `  ${renderKV('OpenCode', pc.cyan(`type: remote, url: http://localhost:${port}/sse`))}`,
      );
      console.error(`\n  ${pc.dim('Press Ctrl+C to stop')}\n`);
    } else {
      console.error(`\n  ${pc.green('✓')} ${pc.bold('Fennec server is running')}`);
      console.error(`  ${renderKV('Transport', 'stdio')}`);
      console.error(`  ${renderKV('AI Agent', 'Connect via MCP protocol')}`);
      console.error(`  ${renderKV('Tip', pc.dim('For SSE mode: fennec start --sse'))}`);
      console.error(`\n  ${pc.dim('Press Ctrl+C to stop')}\n`);
    }
  } catch (error) {
    console.error(renderError('Failed to start server', String(error)));
    process.exit(1);
  }
}

export async function startCommand(args: string[]): Promise<void> {
  printBanner();
  console.error(`  ${pc.dim('Starting app...')}\n`);
  await runCommand(args);
}

export async function runCommand(args: string[]): Promise<void> {
  const nameIndex = args.indexOf('--name');
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]!, 10) : undefined;
  const cwdIndex = args.indexOf('--cwd');
  // Always record a working directory so the app can be re-spawned from
  // ANY terminal/path later (spawn/restart/supervisor). Defaults to the
  // directory where `fennec start` was run.
  const cwd = cwdIndex !== -1 ? resolve(args[cwdIndex + 1]!) : process.cwd();
  const restartFlag = args.includes('--restart');
  const jsonlFlag = args.includes('--jsonl');
  const group = extractFlagValue(args, '--group', '-g');
  const debugMode = extractFlagValue(args, '--debug');

  const stopFlags = [nameIndex, portIndex, cwdIndex].filter((i) => i !== -1) as number[];
  const cmdEnd = Math.min(...stopFlags, Infinity);
  const cmdParts = args.slice(0, cmdEnd);
  const cmd = cmdParts.join(' ');

  if (!cmd) {
    console.error(
      renderError(
        'Missing command',
        'Usage: fennec start|run <command> --name <name> [--port <port>] [--cwd <dir>] [--restart]',
      ),
    );
    process.exit(1);
  }

  const appName = name ?? cmdParts[0] ?? 'app';

  // Idempotent-by-port: if an EXTERNAL process is already listening on our
  // declared port (e.g. an AI agent launched it via raw bash), adopt it
  // instead of starting a duplicate that fails with EADDRINUSE.
  if (port !== undefined) {
    const adopted = adoptExternalOnPort(port, appName);
    if (adopted) {
      console.error(
        `\n  ${pc.green('✓')} ${pc.bold('Adopted')} ${pc.bold(adopted.name)} ${pc.dim(`(PID ${adopted.pid}) — already listening on :${port}`)}`,
      );
      console.error(`  ${renderKV('Logs', pc.cyan(`fennec log ${adopted.name}`))}`);
      console.error();
      return;
    }
  }

  // Duplicate Prevention
  const tracked = readTracked();
  const existing = tracked.find((t) => t.name === appName);
  if (existing && isTrackedRunning(existing)) {
    console.error();
    console.error(
      `  ${pc.yellow('⚠')} ${pc.bold(appName)} ${pc.dim(`is already running (PID: ${existing.pid})`)}`,
    );
    console.error(`  ${renderKV('Logs', pc.cyan(`fennec log ${appName}`))}`);
    console.error(`  ${renderKV('Stop', pc.cyan(`fennec kill ${appName}`))}`);
    console.error();
    process.exit(0);
  }

  const logDir = dirname(logFilePathFor(appName));
  mkdirSync(logDir, { recursive: true });
  const logFilePath = logFilePathFor(appName);

  console.error(
    `\n  ${symbols.fox} ${pc.bold('Starting')} ${renderAppName(appName)} ${pc.dim('(daemon)')}\n`,
  );
  console.error(`  ${renderKV('Command', cmd)}`);
  if (port) console.error(`  ${renderKV('Port', String(port))}`);
  if (cwd) console.error(`  ${renderKV('Directory', cwd)}`);
  if (restartFlag) console.error(`  ${renderKV('Auto-restart', pc.green('enabled'))}`);
  if (group) console.error(`  ${renderKV('Group', group)}`);
  if (debugMode) console.error(`  ${renderKV('Debug', pc.green(debugMode))}`);
  console.error(`  ${divider()}`);

  try {
    // Snapshot the environment at start time so this app keeps its
    // variables (DB URL, nvm PATH, NODE_ENV, ...) even when later
    // spawned/restarted from a different terminal or the supervisor.
    const startEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) startEnv[k] = v;
    }

    const currentChild = spawnDaemon({
      cmdParts,
      name: appName,
      cwd,
      logFilePath,
      env: buildSpawnEnv(startEnv),
      logMode: jsonlFlag ? 'jsonl' : 'text',
    });

    const pid = currentChild.pid ?? 0;

    // PID 0 means the spawn failed (ENOENT, permission denied, etc.).
    // The 'error' event will fire asynchronously; bail early to avoid
    // persisting an invalid entry and crashing on isProcessRunning(0).
    if (pid === 0) {
      console.error(
        `  ${pc.red('✗')} ${pc.bold(appName)} ${pc.dim('failed to start — command not found or permission denied')}`,
      );
      console.error(`  ${renderKV('Command', cmd)}`);
      if (cwd) console.error(`  ${renderKV('Directory', cwd)}`);
      console.error();
      process.exit(1);
    }

    addTracked({
      name: appName,
      pid,
      command: cmd,
      args: cmdParts,
      port,
      cwd,
      env: startEnv,
      startedAt: new Date().toISOString(),
      autoRestart: restartFlag,
      logMode: jsonlFlag ? 'jsonl' : 'text',
      group,
      debugMode:
        debugMode === 'log' || debugMode === 'breakpoint' || debugMode === 'auto'
          ? debugMode
          : undefined,
    });

    console.error(`  ${pc.green('✓')} ${pc.bold(appName)} ${pc.dim(`started (PID: ${pid})`)}`);

    // Verify the app actually came up before we hand back control.
    const spinner = createSpinner(
      port ? `Waiting for ${appName} on port ${port}...` : `Confirming ${appName} is running...`,
    );
    const ready = await waitForReady(pid, port);
    spinner.stop();
    process.stderr.write('\r\x1b[K');

    if (!ready.running) {
      // Crashed almost immediately (bad command, missing target, etc.)
      removeTracked(appName);
      console.error(
        `  ${pc.red('✗')} ${pc.bold(appName)} ${pc.dim('exited immediately after start')}`,
      );
      console.error(`  ${renderKV('Logs', pc.cyan(`fennec log ${appName}`))}`);
      console.error();
      process.exit(1);
    }

    if (port) {
      if (ready.portReady) {
        console.error(
          `  ${pc.green('✓')} ${pc.bold(appName)} ${pc.dim(`is listening on port ${port}`)}`,
        );
      } else {
        console.error(
          `  ${pc.yellow('⚠')} ${pc.bold(appName)} ${pc.dim(`is running but port ${port} is not accepting connections yet`)}`,
        );
      }
    }

    // If --restart is set, hand crash-watching to the detached supervisor
    // daemon so it survives this terminal closing (no foreground Ctrl+C).
    if (restartFlag) {
      const supPid = ensureSupervisorRunning();
      ensurePersistEnabled();
      console.error(
        `  ${pc.green('✓')} ${pc.bold('Auto-restart')} ${pc.dim(`managed by supervisor (PID ${supPid}) — survives terminal close`)}`,
      );
      console.error(`  ${renderKV('Supervisor', pc.cyan('fennec supervisor status'))}`);
    }

    // Show the process table and exit cleanly. Because the daemon logs
    // directly to its own file, we no longer hold any pipes — the event
    // loop drains and the CLI returns immediately without needing Ctrl+C.
    await psCommand([]);
  } catch (error) {
    console.error(renderError(`Failed to start ${appName}`, String(error)));
    process.exit(1);
  }
}

/**
 * like resurrect: Re-spawn tracked processes that died.
 * Called automatically during `fennec start` (server mode).
 * Reads tracked.json, checks each PID, re-spawns stopped ones.
 */
export async function resurrectTracked(): Promise<void> {
  const tracked = readTracked();
  if (tracked.length === 0) return;

  const dead = tracked.filter((t) => !isTrackedRunning(t) && !t.manualStop);
  if (dead.length === 0) return;

  const spinner = createSpinner(`Resurrecting ${dead.length} stopped process(es)...`);
  let resurrected = 0;
  let failed = 0;
  let needsSupervisor = false;

  for (const proc of dead) {
    // Only resurrect if the process has a command (not just a PID reference)
    if (!proc.command) {
      removeTracked(proc.name);
      continue;
    }

    try {
      const cmdParts = resolveArgs(proc);
      const logFilePath = logFilePathFor(proc.name);

      const child = spawnDaemon({
        cmdParts,
        name: proc.name,
        cwd: proc.cwd,
        logFilePath,
        env: buildSpawnEnv(proc.env),
        logMode: proc.logMode,
      });

      // PID 0 means the spawn failed — count as failed and skip.
      if ((child.pid ?? 0) === 0) {
        failed++;
        continue;
      }

      // Update PID in tracked.json — preserve autoRestart so the supervisor
      // keeps managing it, and carry restartCause forward.
      addTracked({
        name: proc.name,
        pid: child.pid ?? 0,
        command: proc.command,
        args: cmdParts,
        port: proc.port,
        cwd: proc.cwd,
        env: proc.env,
        startedAt: new Date().toISOString(),
        autoRestart: proc.autoRestart,
        restartCause: proc.restartCause,
        logMode: proc.logMode,
      });

      resurrected++;
      if (proc.autoRestart) {
        needsSupervisor = true;
      }
    } catch {
      failed++;
    }
  }

  if (needsSupervisor && resurrected > 0) {
    ensureSupervisorRunning();
  }

  spinner.stop();
  process.stderr.write('\r\x1b[K');

  if (resurrected > 0) {
    console.error(`  ${pc.green('●')} ${pc.bold(`Resurrected ${resurrected} process(es)`)}`);
  }
  if (failed > 0) {
    console.error(`  ${pc.red('●')} ${pc.bold(`${failed} process(es) failed to resurrect`)}`);
  }
}
