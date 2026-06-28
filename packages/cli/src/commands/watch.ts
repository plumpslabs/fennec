import { existsSync } from "node:fs";
import { resolve } from "node:path";

export async function watchCommand(args: string[]): Promise<void> {
  const fileIndex = args.indexOf("--file");
  const filePath = fileIndex !== -1 ? args[fileIndex + 1] : undefined;
  if (!filePath) {
    console.error("Error: --file is required for watch command");
    process.exit(1);
  }
  const nameIndex = args.indexOf("--name");
  const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }
  const { LogWatcher } = await import("@plumpslabs/fennec-core");
  const watcher = new LogWatcher();
  const watcherId = watcher.watchFile(resolvedPath, name);
  console.log(`Watching file: ${resolvedPath}`);
  console.log(`Watcher ID: ${watcherId}`);
  process.stdin.resume();
}
