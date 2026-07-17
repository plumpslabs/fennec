/**
 * Command: rename — Rename a tracked process and its log file.
 */
import pc from 'picocolors';
import { existsSync, renameSync } from 'node:fs';
import {
  renderError,
  renderKVColor,
  createSpinner,
  confirmPrompt,
  symbols,
} from '../utils/format.js';
import { readTracked, saveTracked, logFilePathFor } from './tracker.js';
import { isProcessRunning } from '../utils/system-process.js';

export async function renameCommand(args: string[]): Promise<void> {
  const [oldName, newName] = args;

  if (!oldName || !newName) {
    console.error(renderError('Missing arguments', 'Usage: fennec rename <old-name> <new-name>'));
    process.exit(1);
  }

  if (oldName === newName) {
    console.error(`\n  ${pc.yellow('⚠')} ${pc.dim('Old and new names are the same.')}\n`);
    process.exit(0);
  }

  const tracked = readTracked();
  const match = tracked.find((t) => t.name === oldName);

  if (!match) {
    console.error(renderError('Not found', `No tracked process named "${oldName}".`));
    process.exit(1);
  }

  if (tracked.some((t) => t.name === newName)) {
    console.error(renderError('Name taken', `A process named "${newName}" already exists.`));
    process.exit(1);
  }

  console.error(`\n  ${symbols.fox} ${pc.bold('Rename Process')}\n`);
  console.error(`  ${renderKVColor('From', oldName)}`);
  console.error(`  ${renderKVColor('To', newName)}`);
  if (isProcessRunning(match.pid)) {
    console.error(
      `  ${pc.yellow('⚠')} ${pc.dim('Process is still running — log entries will go to the old file until stopped.')}`,
    );
  }
  console.error();

  const confirmed = await confirmPrompt(
    `Rename ${pc.bold(oldName)} ${pc.dim('→')} ${pc.bold(newName)}?`,
    true,
  );
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled')}\n`);
    return;
  }

  const spinner = createSpinner(`Renaming ${oldName} → ${newName}...`);

  // Rename log file if it exists
  const oldLog = logFilePathFor(oldName);
  const newLog = logFilePathFor(newName);

  if (existsSync(oldLog) && !existsSync(newLog)) {
    try {
      renameSync(oldLog, newLog);
    } catch {
      /* best-effort */
    }
  }

  // Update tracked.json
  match.name = newName;
  saveTracked(tracked);

  spinner.succeed(`${pc.bold(oldName)} ${pc.dim('→')} ${pc.bold(newName)}`);
  console.error();
}
