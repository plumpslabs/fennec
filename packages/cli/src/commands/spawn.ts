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
import pc from 'picocolors';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  symbols,
  renderError,
  renderKV,
  renderAppName,
  createSpinner,
  selectPrompt,
} from '../utils/format.js';
import {
  readTracked,
  addTracked,
  spawnDaemon,
  resolveArgs,
  isTrackedRunning,
  buildSpawnEnv,
  resolveTargets,
  getGroups,
} from './tracker.js';
import type { TrackedProcess } from './tracker.js';
import { ensureSupervisorRunning } from './supervisor.js';
import { ensurePersistEnabled } from './persist.js';
import { psCommand } from './ps.js';
import { extractFlagValue } from './tracker.js';

export async function spawnCommand(args: string[]): Promise<void> {
  const target = resolveTargets(args);

  // --debug flag parsed from args for spawnOne calls
  if (target.kind === 'single') {
    await spawnOne(target.value!, false, args);
    return;
  }

  if (target.kind === 'names') {
    for (const name of target.values!) {
      await spawnOne(name, true, args);
    }
    return;
  }

  if (target.kind === 'group') {
    const group = target.group!;
    const tracked = readTracked();
    const inGroup = tracked.filter((t) => t.group === group && !isTrackedRunning(t) && t.command);
    if (inGroup.length === 0) {
      console.error(
        renderError(
          'Empty group',
          `No stopped entries with a saved command in group "${group}".\nKnown groups: ${pc.cyan(getGroups().join(', ') || '(none)')}`,
        ),
      );
      process.exit(1);
    }
    await spawnAllStopped(inGroup);
    return;
  }

  if (target.kind === 'all') {
    await spawnAllStopped(readTracked().filter((t) => !isTrackedRunning(t) && t.command));
    return;
  }

  // none: list stopped processes for selection
  await spawnList();
}

/**
 * Re-spawn ONE stopped tracked process by name (used for both single and
 * multi-name spawns). In `multi` mode, resolution failures print an
 * error and return (instead of exiting) so the rest of the batch proceeds.
 */
async function spawnOne(name: string, multi: boolean, args?: string[]): Promise<void> {
  const tracked = readTracked();
  const match = tracked.find((t) => t.name === name);

  if (!match) {
    const msg = `No tracked process named "${name}". Use ${pc.cyan('fennec spawn')} to see available processes, or ${pc.cyan('fennec start <command> --name <name>')} to create a new one.`;
    if (multi) {
      console.error(renderError('Not found', msg));
      return;
    }
    console.error(renderError('Not found', msg));
    process.exit(1);
  }

  if (isTrackedRunning(match)) {
    console.error(
      `\n  ${pc.yellow('⚠')} ${pc.bold(name)} ${pc.dim('is already running (PID:')} ${match.pid}${pc.dim(')')}`,
    );
    console.error(
      `  ${pc.dim('Use')} ${pc.cyan(`fennec stop ${name}`)} ${pc.dim('to stop it first.')}`,
    );
    console.error();
    if (!multi) process.exit(0);
    return;
  }

  if (!match.command) {
    const msg = `"${name}" has no saved command and cannot be re-spawned.`;
    if (multi) {
      console.error(renderError('No command saved', msg));
      return;
    }
    console.error(renderError('No command saved', msg));
    process.exit(1);
  }

  await respawnProcess(match, args);
}

/**
 * Re-spawn ALL stopped tracked processes that have saved commands.
 */
async function spawnAllStopped(procs: TrackedProcess[]): Promise<void> {
  const toSpawn = procs;

  if (toSpawn.length === 0) {
    console.error(`\n  ${pc.dim('No stopped processes with saved commands to spawn.')}\n`);
    return;
  }

  console.error(`\n  ${symbols.fox} ${pc.bold(`Spawning ${toSpawn.length} process(es)...`)}\n`);
  for (const t of toSpawn) {
    console.error(`  ${pc.dim('·')} ${pc.bold(t.name)} ${pc.dim(`(${t.command})`)}`);
  }
  console.error();

  const spinner = createSpinner('Spawning...');
  let spawned = 0;
  let failed = 0;

  for (const proc of toSpawn) {
    try {
      const cmdParts = resolveArgs(proc);
      const logDir = resolve(homedir(), '.fennec', 'logs');
      mkdirSync(logDir, { recursive: true });
      const logFilePath = resolve(logDir, `${proc.name}.log`);

      const child = spawnDaemon({
        cmdParts,
        name: proc.name,
        cwd: proc.cwd,
        logFilePath,
        env: buildSpawnEnv(proc.env),
        logMode: proc.logMode,
      });
      const pid = child.pid ?? 0;

      // PID 0 means the spawn failed — skip this entry.
      if (pid === 0) {
        failed++;
        continue;
      }

      addTracked({
        name: proc.name,
        pid,
        command: proc.command,
        args: cmdParts,
        port: proc.port,
        cwd: proc.cwd,
        env: proc.env,
        startedAt: new Date().toISOString(),
        autoRestart: proc.autoRestart,
        logMode: proc.logMode,
        debugMode: proc.debugMode ?? undefined,
        // Preserve the logical group across stop -> spawn (addTracked REPLACES
        // the entry by name, so group must be carried over explicitly).
        group: proc.group,
      });
      if (proc.autoRestart) {
        ensureSupervisorRunning();
        ensurePersistEnabled();
      }

      spawned++;
    } catch {
      failed++;
    }
  }

  spinner.stop();
  process.stderr.write('\r\x1b[K');

  if (spawned > 0) {
    console.error(`  ${pc.green('✓')} ${pc.bold(`Spawned ${spawned} process(es)`)}`);
  }
  if (failed > 0) {
    console.error(`  ${pc.red('✗')} ${pc.bold(`${failed} process(es) failed to spawn`)}`);
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
    console.error(`\n  ${pc.dim('No tracked processes found.')}`);
    console.error(
      `  ${pc.dim('Start an app first:')} ${pc.cyan('fennec start <command> --name <name>')}`,
    );
    console.error();
    return;
  }

  const stopped = tracked.filter((t) => !isTrackedRunning(t));
  const running = tracked.filter((t) => isTrackedRunning(t));

  if (stopped.length === 0) {
    console.error(`\n  ${pc.dim('All tracked processes are running. Nothing to spawn.')}`);
    console.error();
    return;
  }

  console.error(
    `\n  ${symbols.fox} ${pc.bold('Available to spawn')} ${pc.dim(`(${stopped.length}/${tracked.length} stopped)`)}`,
  );

  // Show running ones as info
  if (running.length > 0) {
    console.error(`  ${pc.dim('Running (use stop first):')}`);
    for (const r of running) {
      console.error(`    ${pc.green('●')} ${pc.bold(r.name)} ${pc.dim(`(PID ${r.pid})`)}`);
    }
    console.error();
  }

  // Show stopped ones as selectable
  const selected = await selectPrompt(
    'Select a process to spawn:',
    stopped.map((t) => ({
      value: t.name,
      label: t.name,
      description: t.command.length > 80 ? t.command.slice(0, 80) + '...' : t.command,
    })),
  );

  if (selected === null) {
    console.error(`  ${pc.dim('Cancelled')}`);
    return;
  }

  const match = stopped.find((t) => t.name === selected);
  if (match) {
    await respawnProcess(match, []);
  }
}

/**
 * Re-spawn a stopped tracked process from its saved command/cwd.
 */
async function respawnProcess(proc: TrackedProcess, args?: string[]): Promise<void> {
  const debugMode = args ? extractFlagValue(args, '--debug') : undefined;
  const cmdParts = resolveArgs(proc);
  const logDir = resolve(homedir(), '.fennec', 'logs');
  mkdirSync(logDir, { recursive: true });
  const logFilePath = resolve(logDir, `${proc.name}.log`);

  console.error(
    `\n  ${symbols.fox} ${pc.bold('Spawning')} ${renderAppName(proc.name)} ${pc.dim('(from saved config)')}\n`,
  );
  console.error(`  ${renderKV('Command', proc.command)}`);
  if (proc.cwd) console.error(`  ${renderKV('Directory', proc.cwd)}`);
  if (proc.port) console.error(`  ${renderKV('Port', String(proc.port))}`);
  if (debugMode) console.error(`  ${renderKV('Debug', pc.green(debugMode))}`);

  try {
    const child = spawnDaemon({
      cmdParts,
      name: proc.name,
      cwd: proc.cwd,
      logFilePath,
      env: buildSpawnEnv(proc.env),
      logMode: proc.logMode,
    });
    const pid = child.pid ?? 0;

    // PID 0 means the spawn failed (ENOENT, permission denied, etc.).
    if (pid === 0) {
      throw new Error(`Command not found or permission denied: ${proc.command}`);
    }

    // Update tracked.json with new PID (preserve group — addTracked REPLACES
    // the entry by name, so the logical group must be carried over explicitly).
    addTracked({
      name: proc.name,
      pid,
      command: proc.command,
      args: cmdParts,
      port: proc.port,
      cwd: proc.cwd,
      env: proc.env,
      startedAt: new Date().toISOString(),
      autoRestart: proc.autoRestart,
      logMode: proc.logMode,
      group: proc.group,
      debugMode:
        debugMode === 'log' || debugMode === 'breakpoint' || debugMode === 'auto'
          ? debugMode
          : (proc.debugMode ?? undefined),
    });

    if (proc.autoRestart) {
      ensureSupervisorRunning();
      ensurePersistEnabled();
    }

    console.error(`  ${pc.green('✓')} ${pc.bold(proc.name)} ${pc.dim(`spawned (PID: ${pid})`)}`);

    // Show the process table
    await psCommand([]);
  } catch (error) {
    console.error(renderError(`Failed to spawn ${proc.name}`, String(error)));
    process.exit(1);
  }
}
