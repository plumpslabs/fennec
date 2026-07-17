import { PortDetector } from '@plumpslabs/fennec-core';

export async function attachPidCommand(args: string[]): Promise<void> {
  const raw = args[0];
  if (!raw) {
    console.error('Error: PID is required. Usage: fennec attach-pid <pid>');
    process.exit(1);
  }
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) {
    console.error('Error: valid PID is required');
    process.exit(1);
  }
  const detector = new PortDetector();
  const info = detector.detectByPid(pid);
  if (info) {
    console.error(`Attached to PID ${pid}${info.command ? ` (${info.command})` : ''}`);
    if (info.port) console.error(`   Port: ${info.port}`);
  } else {
    console.error(`Could not find process with PID ${pid}`);
    process.exit(1);
  }
}
