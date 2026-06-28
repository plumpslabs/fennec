export async function attachPortCommand(args: string[]): Promise<void> {
  const port = parseInt(args[0]!, 10);
  if (isNaN(port)) {
    console.error("Error: valid port number is required");
    process.exit(1);
  }
  const { PortDetector } = await import("@plumpslabs/fennec-core");
  const detector = new PortDetector();
  const info = detector.detectByPort(port);
  if (info) {
    console.log(`Found process on port ${port}: PID ${info.pid}${info.command ? ` (${info.command})` : ""}`);
  } else {
    console.error(`No process found listening on port ${port}`);
    process.exit(1);
  }
}
