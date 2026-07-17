/**
 * Command: attach — Attach to a process by port.
 */
import { PortDetector } from '@plumpslabs/fennec-core';
import pc from 'picocolors';
import { renderError, renderKV, renderAppName, createSpinner } from '../utils/format.js';

export async function attachCommand(args: string[]): Promise<void> {
  const raw = args[0];
  if (!raw) {
    console.error(renderError('Missing port', 'Usage: fennec attach <port> --name <name>'));
    process.exit(1);
  }
  const port = parseInt(raw, 10);
  if (isNaN(port)) {
    console.error(renderError('Invalid port', 'Usage: fennec attach <port> --name <name>'));
    process.exit(1);
  }

  const nameIndex = args.indexOf('--name');
  const rawName = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const name = rawName ?? `port-${port}`;

  const spinner = createSpinner(`Attaching to :${port}...`);
  try {
    const detector = new PortDetector();
    const info = detector.detectByPort(port);
    if (info) {
      spinner.succeed(`Attached to :${port}`);
      console.error(`  ${renderKV('Name', renderAppName(name))}`);
      console.error(`  ${renderKV('PID', String(info.pid))}`);
      console.error(`  ${renderKV('Command', info.command || pc.dim('unknown'))}`);
    } else {
      spinner.fail(`No process found on port ${port}`);
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(`Failed to attach to :${port}`);
    console.error(renderError('Error', String(error)));
    process.exit(1);
  }
}
