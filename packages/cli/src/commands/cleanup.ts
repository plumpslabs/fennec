/**
 * Command: cleanup — Remove dead tracked entries that have no saved command
 * and cannot be re-spawned.
 */
import pc from 'picocolors';
import { renderError, confirmPrompt } from '../utils/format.js';
import { readTracked, saveTracked } from './tracker.js';
import { isProcessRunning } from '../utils/system-process.js';

export async function cleanupCommand(): Promise<void> {
  const tracked = readTracked();
  if (tracked.length === 0) {
    console.error(`\n  ${pc.dim('No tracked processes to clean up.')}\n`);
    return;
  }

  const toRemove = tracked.filter((t) => !isProcessRunning(t.pid) && !t.command);
  if (toRemove.length === 0) {
    console.error(
      `\n  ${pc.green('✓')} ${pc.bold('All clean')} ${pc.dim('— no dead entries without saved commands.')}\n`,
    );
    return;
  }

  console.error(
    `\n  ${pc.yellow('⚠')} ${pc.bold(`Found ${toRemove.length} dead entr${toRemove.length > 1 ? 'ies' : 'y'} without saved commands`)}\n`,
  );
  for (const entry of toRemove) {
    console.error(`  ${pc.dim('·')} ${pc.bold(entry.name)} ${pc.dim(`(PID ${entry.pid})`)}`);
  }
  console.error();

  const confirmed = await confirmPrompt(
    `Remove ${toRemove.length} entr${toRemove.length > 1 ? 'ies' : 'y'}?`,
    false,
  );
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled')}\n`);
    return;
  }

  const remaining = tracked.filter((t) => !toRemove.includes(t));
  saveTracked(remaining);
  console.error(
    `\n  ${pc.green('✓')} ${pc.bold(`Removed ${toRemove.length} entr${toRemove.length > 1 ? 'ies' : 'y'}`)} ${pc.dim(`(${remaining.length} remaining)`)}\n`,
  );
}
