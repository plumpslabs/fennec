/**
 * Command: info — Show detailed info about a tracked process.
 */
import pc from 'picocolors';
import { renderError, renderKVColor, symbols } from '../utils/format.js';
import { readTracked, formatUptime, logFilePathFor } from './tracker.js';
import { isProcessRunning } from '../utils/system-process.js';

export async function infoCommand(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(renderError('Missing name', 'Usage: fennec info <name>'));
    process.exit(1);
  }

  const tracked = readTracked();
  const match = tracked.find((t) => t.name === name);

  if (!match) {
    console.error(renderError('Not found', `No tracked process named "${name}".`));
    process.exit(1);
  }

  const running = isProcessRunning(match.pid);
  const statusIcon = running ? pc.green('●') : pc.red('○');
  const statusText = running ? pc.green('running') : pc.red('stopped');
  const uptime = running
    ? formatUptime(Math.floor((Date.now() - new Date(match.startedAt).getTime()) / 1000))
    : '-';
  const logPath = logFilePathFor(match.name);

  console.error(`\n  ${symbols.fox} ${pc.bold(match.name)} ${pc.dim('— Process Info')}\n`);
  console.error(`  ${renderKVColor('Name', match.name, pc.bold)}`);
  console.error(`  ${renderKVColor('Status', `${statusIcon} ${statusText}`)}`);
  console.error(`  ${renderKVColor('PID', String(match.pid))}`);
  console.error(`  ${renderKVColor('Port', match.port ? String(match.port) : '-')}`);
  console.error(`  ${renderKVColor('Command', match.command || pc.dim('(none)'))}`);
  if (match.cwd) console.error(`  ${renderKVColor('CWD', match.cwd)}`);
  console.error(`  ${renderKVColor('Started', new Date(match.startedAt).toLocaleString())}`);
  console.error(`  ${renderKVColor('Uptime', uptime)}`);
  console.error(`  ${renderKVColor('Log Path', logPath)}`);

  if (!running && match.command) {
    console.error(`\n  ${pc.dim('Re-spawn with:')} ${pc.cyan(`fennec spawn ${match.name}`)}`);
  }
  console.error();
}
