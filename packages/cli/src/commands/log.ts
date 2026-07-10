/**
 * Command: log — Show logs for a tracked/managed process.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn, execSync } from "node:child_process";
import pc from "picocolors";
import { symbols, renderError, renderAppName, createSpinner } from "../utils/format.js";
import { readTracked } from "./tracker.js";

export async function logCommand(args: string[]): Promise<void> {
  const target = args[0];
  if (!target) { console.error(renderError("Missing process name/pid", "Usage: fennec log <name|pid> [--lines N] [-f]")); process.exit(1); }

  const linesIndex = args.indexOf("--lines");
  const lineCount = linesIndex !== -1 ? parseInt(args[linesIndex + 1]!, 10) : 30;
  const followFlag = args.includes("-f") || args.includes("--follow");

  let logFilePath: string | null = null;
  let displayName = target;
  const tracked = readTracked();
  const trackedMatch = tracked.find((t) => t.name === target || (parseInt(target, 10) === t.pid && !isNaN(parseInt(target, 10))));

  if (trackedMatch) {
    displayName = trackedMatch.name;
    logFilePath = resolve(homedir(), ".fennec", "logs", `${trackedMatch.name}.log`);
  } else {
    const pid = parseInt(target, 10);
    if (!isNaN(pid) && String(pid) === target) {
      const procPath = `/proc/${pid}/fd/1`;
      if (existsSync(procPath)) logFilePath = procPath;
    }
  }

  const spinner = createSpinner(`Reading logs for ${displayName}...`);
  try {
    let logLines: string[] = [];
    if (logFilePath && existsSync(logFilePath)) {
      const content = readFileSync(logFilePath, "utf-8");
      logLines = content.split("\n").filter(Boolean);
    } else {
      const pid = trackedMatch?.pid ?? parseInt(target, 10);
      if (!isNaN(pid)) {
        try {
          const output = execSync(`journalctl --no-pager -n ${lineCount} _PID=${pid} 2>/dev/null || echo ""`, { encoding: "utf-8", timeout: 3000 });
          logLines = output.trim().split("\n").filter(Boolean);
        } catch { logLines = ["(no logs available)"]; }
      } else { logLines = ["(no logs available)"]; }
    }

    spinner.stop();
    process.stdout.write("\r\x1b[K");
    console.error(`\n  ${symbols.fox} ${pc.bold("Logs")} ${renderAppName(displayName)} ${pc.dim(`(last ${logLines.length} lines)`)}\n`);

    const sliced = logLines.slice(-lineCount);
    for (const line of sliced) {
      const display = line.length > 300 ? line.slice(0, 300) + "…" : line;
      if (line.toLowerCase().includes("error") || line.toLowerCase().includes("fail")) console.error(`  ${pc.red(display)}`);
      else if (line.toLowerCase().includes("warn")) console.error(`  ${pc.yellow(display)}`);
      else if (line.toLowerCase().includes("info") || line.includes("[")) console.error(`  ${pc.cyan(display)}`);
      else console.error(`  ${display}`);
    }

    if (followFlag && logFilePath) {
      console.error(`\n  ${pc.dim("Following... (Ctrl+C to stop)")}\n`);
      const tail = spawn("tail", ["-n", "0", "-f", logFilePath], { stdio: "inherit" });
      tail.on("exit", () => process.exit(0));
      await new Promise(() => {});
    }
    console.error();
  } catch (error) {
    spinner.fail(`Failed to read logs for ${displayName}`);
    console.error(renderError("Log read failed", String(error)));
  }
}
