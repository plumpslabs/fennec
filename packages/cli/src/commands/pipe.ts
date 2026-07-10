import { PipeWatcher } from "@plumpslabs/fennec-core";

export async function pipeCommand(args: string[]): Promise<void> {
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : "pipe";

  if (!name) {
    console.error("Error: --name is required for pipe command");
    process.exit(1);
  }

  const watcher = new PipeWatcher();
  const { write } = watcher.createPipe(name);

  console.error(`Pipe watcher '${name}' active. Forwarding stdin...`);

  const onDrain = () => {
    process.stdin.resume();
  };
  process.stdout.on("drain", onDrain);

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (data: string) => {
    try {
      write(data);
      const canContinue = process.stdout.write(data);
      if (!canContinue) {
        process.stdin.pause();
      }
    } catch (error) {
      console.error("Pipe error:", error);
    }
  });

  process.stdin.on("error", (error) => {
    console.error("Pipe stdin error:", error);
  });

  process.stdin.on("end", () => {
    console.error(`Pipe watcher '${name}' ended.`);
    watcher.cleanup();
  });

  const shutdown = () => {
    watcher.cleanup();
    process.stdout.removeListener("drain", onDrain);
    process.stdin.removeAllListeners();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
