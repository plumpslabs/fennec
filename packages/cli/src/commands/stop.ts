/**
 * Command: stop — Stop a tracked process but keep it in tracked.json.
 * Unlike `kill`, the process entry remains in tracked.json so it can
 * be re-spawned later via `fennec spawn <name>`.
 */
import pc from 'picocolors';
import { renderError, createSpinner, confirmPrompt } from '../utils/format.js';
import { killTree as sysKill, isProcessRunning } from '../utils/system-process.js';
import {
  readTracked,
  isTrackedRunning,
  setAutoRestart,
  setManualStop,
  resolveTargets,
} from './tracker.js';
import { psCommand } from './ps.js';

export async function stopCommand(args: string[]): Promise<void> {
  const target = resolveTargets(args);

  if (target.kind === 'group') {
    await stopAllTracked(args, target.group!);
    return;
  }

  if (target.kind === 'all') {
    await stopAllTracked(args);
    return;
  }

  if (target.kind === 'single') {
    await stopOne(target.value!, args);
    return;
  }

  if (target.kind === 'names') {
    for (const name of target.values!) {
      await stopOne(name, args, true);
    }
    return;
  }

  console.error(
    renderError('Missing name', 'Usage: fennec stop <name|--all> [--group <group>] [-y]'),
  );
  process.exit(1);
}

/**
 * Stop ONE tracked process by name (used for both single and multi-name stops).
 * In `multi` mode, resolution failures print an error and return (instead of
 * exiting) so the rest of the batch can still be processed.
 */
async function stopOne(rawTarget: string, args: string[], multi: boolean = false): Promise<void> {
  // Only works on tracked processes
  const tracked = readTracked();
  const trackedMatch = tracked.find((t) => t.name === rawTarget);

  if (!trackedMatch) {
    const msg = `No tracked process named "${rawTarget}". Use ${pc.cyan('fennec kill <pid>')} to kill a system process.`;
    if (multi) {
      console.error(renderError('Not found', msg));
      return;
    }
    console.error(renderError('Not found', msg));
    process.exit(1);
  }

  if (!isTrackedRunning(trackedMatch)) {
    console.error(`\n  ${pc.yellow('⚠')} ${pc.bold(rawTarget)} ${pc.dim('is already stopped')}`);
    console.error();
    if (!multi) process.exit(0);
    return;
  }

  const displayName = `${trackedMatch.name} (PID ${trackedMatch.pid})`;
  const force = args.includes('-y') || args.includes('--yes');
  const confirmed =
    force ||
    (await confirmPrompt(
      `Stop ${pc.bold(displayName)}? ${pc.dim('It can be re-spawned later via fennec spawn')}`,
      false,
    ));
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled')}`);
    return;
  }

  // Disable auto-restart first so the supervisor doesn't immediately revive it.
  setAutoRestart(trackedMatch.name, false);
  setManualStop(trackedMatch.name, true);
  await stopSingleProcess(trackedMatch.pid, trackedMatch.name);
}

/**
 * Stop running tracked processes (keep them in tracked.json). Optionally
 * scoped to a single group via `group`.
 */
async function stopAllTracked(args: string[], group?: string): Promise<void> {
  const tracked = readTracked();
  const running = tracked.filter((t) => isTrackedRunning(t) && (!group || t.group === group));

  if (running.length === 0) {
    console.error(
      `\n  ${pc.dim(group ? `No running tracked processes in group "${group}".` : 'No running tracked processes to stop.')}\n`,
    );
    return;
  }

  const scope = group ? ` group ${pc.cyan(group)}` : '';
  console.error(
    `\n  ${pc.yellow('⚠')} ${pc.bold(`Stop all ${running.length} running process(es)${scope}?`)} ${pc.dim('(They can be re-spawned later)')}\n`,
  );
  for (const t of running) {
    console.error(`  ${pc.green('●')} ${pc.bold(t.name)} ${pc.dim(`(PID ${t.pid})`)}`);
  }
  console.error();

  const forceAll = args.includes('-y') || args.includes('--yes');
  const confirmed = forceAll || (await confirmPrompt('Stop all?', false));
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled')}\n`);
    return;
  }

  const spinner = createSpinner(`Stopping ${running.length} process(es)...`);
  let stopped = 0;
  let failed = 0;

  for (const t of running) {
    setAutoRestart(t.name, false);
    setManualStop(t.name, true);
    if (sysKill(t.pid, 'SIGTERM')) {
      stopped++;
    } else {
      failed++;
    }
  }

  await new Promise((r) => setTimeout(r, 300));
  spinner.stop();
  process.stdout.write('\r\x1b[K');

  if (stopped > 0) {
    console.error(
      `  ${pc.green('✓')} ${pc.bold(`Stopped ${stopped} process(es)`)} ${pc.dim('(kept in tracked.json)')}`,
    );
  }
  if (failed > 0) {
    console.error(`  ${pc.red('✗')} ${pc.bold(`${failed} process(es) failed to stop`)}`);
  }

  console.error();
  await psCommand([]);
}

async function stopSingleProcess(pid: number, name: string): Promise<void> {
  const displayName = `${name} (PID ${pid})`;
  const spinner = createSpinner(`Stopping ${displayName}...`);
  const success = sysKill(pid, 'SIGTERM');

  if (success) {
    await new Promise((r) => setTimeout(r, 200));
    const stillRunning = isProcessRunning(pid);
    if (stillRunning) {
      spinner.warn(`${displayName} did not respond to SIGTERM`);
      const forceKill = await confirmPrompt(`Send ${pc.red('SIGKILL')} to force stop?`, true);
      if (forceKill) {
        const forceSpinner = createSpinner(`Sending SIGKILL to ${displayName}...`);
        sysKill(pid, 'SIGKILL');
        await new Promise((r) => setTimeout(r, 300));
        isProcessRunning(pid)
          ? forceSpinner.fail(`${displayName} could not be stopped (permission denied?)`)
          : forceSpinner.succeed(`${displayName} force stopped`);
      } else {
        console.error(`  ${pc.yellow('⚠')} ${displayName} ${pc.dim('may still be running')}`);
      }
    } else {
      spinner.succeed(`${displayName} stopped`);
    }

    console.error();
    await psCommand([]);
  } else {
    spinner.fail(`Failed to stop ${displayName}`);
    console.error(renderError('Permission denied', 'Try running with sudo or use fennec kill.'));
  }
}
