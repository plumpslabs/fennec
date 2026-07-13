/**
 * Command: kill — Kill process by PID, name, or kill all Fennec-tracked apps.
 * Supports: a single name/pid, MULTIPLE names (`kill a b c`), a group
 * (`--group <g>` or a bare group name), or `--all` / `all` (everything).
 */
import pc from 'picocolors';
import { renderError, createSpinner, selectPrompt, confirmPrompt } from '../utils/format.js';
import { killTree as sysKill, isProcessRunning } from '../utils/system-process.js';
import {
  readTracked,
  removeTrackedByPid,
  isTrackedRunning,
  resolveTargets,
  getGroups,
  type TrackedProcess,
} from './tracker.js';

export async function killCommand(args: string[]): Promise<void> {
  const signalIndex = args.indexOf('--signal');
  const signalRaw = signalIndex !== -1 ? args[signalIndex + 1] : 'SIGTERM';
  const signal = (signalRaw ?? 'SIGTERM') as NodeJS.Signals;
  const force = args.includes('-y') || args.includes('--yes');
  const target = resolveTargets(args);

  if (target.kind === 'single') {
    await killOne(target.value!, signal, force, false);
    return;
  }

  if (target.kind === 'names') {
    for (const name of target.values!) {
      await killOne(name, signal, force, true);
    }
    return;
  }

  if (target.kind === 'group') {
    await killGroup(target.group!, signal, force);
    return;
  }

  if (target.kind === 'all') {
    await killAll(signal, force);
    return;
  }

  console.error(
    renderError(
      'Missing target',
      'Usage: fennec kill <pid|name|all> [--signal SIGTERM|SIGKILL|SIGINT] [--group <group>] [-y]',
    ),
  );
  process.exit(1);
}

/**
 * Kill ONE target (resolved by tracked name or system PID). In `multi` mode,
 * resolution failures print an error and return (instead of exiting) so the
 * other names in the batch can still be processed.
 */
async function killOne(
  rawTarget: string,
  signal: NodeJS.Signals,
  force: boolean,
  multi: boolean,
): Promise<void> {
  let targetPid: number;
  let displayName: string;
  const pid = parseInt(rawTarget, 10);

  if (!isNaN(pid) && String(pid) === rawTarget) {
    if (!isProcessRunning(pid)) {
      const msg = `No process with PID ${pid} is running`;
      if (multi) {
        console.error(renderError('Process not found', msg));
        return;
      }
      console.error(renderError('Process not found', msg));
      process.exit(1);
    }
    targetPid = pid;
    displayName = `PID ${pid}`;
  } else {
    const tracked = readTracked();
    const trackedMatch = tracked.find((t) => t.name === rawTarget);
    if (trackedMatch) {
      if (!isTrackedRunning(trackedMatch)) {
        removeTrackedByPid(trackedMatch.pid);
        console.error(
          `\n  ${pc.green('✓')} ${pc.bold(rawTarget)} ${pc.dim('removed from tracked apps (was already stopped)')}`,
        );
        console.error();
        return;
      }
      targetPid = trackedMatch.pid;
      displayName = `${trackedMatch.name} (PID ${targetPid})`;
    } else {
      const msg = `No tracked process named "${rawTarget}".\nUse ${pc.cyan('fennec kill <pid>')} to kill a system process by its PID.`;
      if (multi) {
        console.error(renderError('Not tracked', msg));
        return;
      }
      console.error(renderError('Not tracked', msg));
      process.exit(1);
    }
  }

  const confirmed =
    force ||
    (await confirmPrompt(`Kill ${pc.bold(displayName)} with ${pc.yellow(signal)}?`, false));
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled')}`);
    return;
  }

  const spinner = createSpinner(`Sending ${signal} to ${displayName}...`);
  const success = sysKill(targetPid, signal);

  if (success) {
    await new Promise((r) => setTimeout(r, 200));
    const stillRunning = isProcessRunning(targetPid);
    if (stillRunning && signal !== 'SIGKILL') {
      spinner.warn(`${displayName} did not respond to ${signal}`);
      const forceKill =
        force || (await confirmPrompt(`Send ${pc.red('SIGKILL')} to force stop?`, true));
      if (forceKill) {
        const forceSpinner = createSpinner(`Sending SIGKILL to ${displayName}...`);
        sysKill(targetPid, 'SIGKILL');
        await new Promise((r) => setTimeout(r, 300));
        isProcessRunning(targetPid)
          ? forceSpinner.fail(`${displayName} could not be stopped (permission denied?)`)
          : forceSpinner.succeed(`${displayName} force stopped`);
      } else {
        console.error(`  ${pc.dim('Retrying with SIGTERM...')}`);
        sysKill(targetPid, 'SIGTERM');
        console.error(`  ${pc.yellow('⚠')} ${displayName} ${pc.dim('may still be running')}`);
      }
    } else {
      removeTrackedByPid(targetPid);
      spinner.succeed(`${displayName} stopped`);
    }
  } else {
    spinner.fail(`Failed to kill ${displayName}`);
    console.error(
      renderError('Permission denied', 'Try running with sudo or use a different signal.'),
    );
  }
}

async function killGroup(group: string, signal: NodeJS.Signals, force: boolean): Promise<void> {
  const tracked = readTracked();
  const inGroup = tracked.filter((t) => t.group === group);
  if (inGroup.length === 0) {
    console.error(
      renderError(
        'Empty group',
        `No tracked entries in group "${group}".\nKnown groups: ${pc.cyan(getGroups().join(', ') || '(none)')}`,
      ),
    );
    process.exit(1);
  }

  const running = inGroup.filter((t) => isTrackedRunning(t));
  const stopped = inGroup.filter((t) => !isTrackedRunning(t));

  console.error(
    `\n  ${pc.bold(`Kill group ${pc.cyan(group)}: ${running.length} running + remove ${stopped.length} stopped?`)}`,
  );
  console.error(
    `  ${pc.dim('Permanently removes only apps in this group — other groups are untouched.')}\n`,
  );

  const confirmed =
    force ||
    (await confirmPrompt(`${pc.red('Are you sure?')} ${pc.dim('This cannot be undone')}`, false));
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled.')}`);
    return;
  }

  const spinner = createSpinner(
    `Killing ${running.length} + removing ${stopped.length} tracked app(s) in ${group}...`,
  );
  let killed = 0,
    failed = 0;
  for (const t of running) {
    if (sysKill(t.pid, signal)) {
      killed++;
    } else {
      failed++;
    }
    removeTrackedByPid(t.pid);
  }
  for (const t of stopped) {
    removeTrackedByPid(t.pid);
  }
  await new Promise((r) => setTimeout(r, 300));
  const total = running.length + stopped.length;
  total > 0
    ? spinner.succeed(
        `${killed} killed, ${stopped.length} stopped entries removed from group ${group}`,
      )
    : spinner.fail('Failed to kill apps');
  if (failed > 0) console.error(`  ${pc.yellow(`${failed} running app(s) could not be killed`)}`);
}

async function killAll(signal: NodeJS.Signals, force: boolean): Promise<void> {
  // Scope strictly to Fennec-tracked apps — NEVER all user processes.
  const tracked = readTracked();
  if (tracked.length === 0) {
    console.error(`  ${pc.dim('No tracked apps to kill.')}`);
    return;
  }

  const running = tracked.filter((t) => isTrackedRunning(t));
  const stopped = tracked.filter((t) => !isTrackedRunning(t));

  console.error(
    `\n  ${pc.bold(`Kill ${running.length} running + remove ${stopped.length} stopped tracked app(s)?`)}`,
  );
  console.error(
    `  ${pc.dim('Permanently removes every Fennec-tracked app — other processes are untouched.')}\n`,
  );

  const confirmed =
    force ||
    (await confirmPrompt(`${pc.red('Are you sure?')} ${pc.dim('This cannot be undone')}`, false));
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled.')}`);
    return;
  }

  const spinner = createSpinner(
    `Killing ${running.length} + removing ${stopped.length} tracked app(s)...`,
  );
  let killed = 0,
    failed = 0;
  for (const t of running) {
    if (sysKill(t.pid, signal)) {
      killed++;
    } else {
      failed++;
    }
    removeTrackedByPid(t.pid);
  }
  // Stopped entries have nothing to signal — just deregister them.
  for (const t of stopped) {
    removeTrackedByPid(t.pid);
  }
  await new Promise((r) => setTimeout(r, 300));
  const total = running.length + stopped.length;
  total > 0
    ? spinner.succeed(`${killed} killed, ${stopped.length} stopped entries removed`)
    : spinner.fail('Failed to kill apps');
  if (failed > 0) console.error(`  ${pc.yellow(`${failed} running app(s) could not be killed`)}`);
}
