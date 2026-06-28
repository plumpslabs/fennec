export async function attachPidCommand(args: string[]): Promise<void> {
  const pid = parseInt(args[0]!, 10);
  if (isNaN(pid)) {
    console.error("Error: valid PID is required");
    process.exit(1);
  }
  const { PortDetector } = await import("@plumpslabs/fennec-core");
  const detector = new PortDetector();
  const info = detector.detectByPid(pid);
  if (info) {
    console.log(`Attached to PID ${pid}${info.command ? ` (${info.command})` : ""}`);
    if (info.port) console.log(`   Port: ${info.port}`);
  } else {
    console.error(`Could not find process with PID ${pid}`);
    process.exit(1);
  }
}
