/**
 * Command: log — Show logs for a tracked/managed process.
 * Supports --clear to delete log file, --level to filter by level, and -f for follow mode.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn, execSync } from "node:child_process";
import pc from "picocolors";
import { symbols, renderError, renderAppName, createSpinner, timestamp } from "../utils/format.js";
import { readTracked } from "./tracker.js";

/** Known log-level prefixes to color/highlight */
const LEVEL_PATTERNS: { level: string; pattern: RegExp }[] = [
  { level: "error",   pattern: /\b(ERROR?|FATAL?|CRITICAL?|EXCEPTION)\b/i },
  { level: "warn",    pattern: /\b(WARN(ING)?)\b/i },
  { level: "info",    pattern: /\b(INFO)\b/i },
  { level: "debug",   pattern: /\b(DEBUG)\b/i },
];

export async function logCommand(args: string[]): Promise<void> {
  const target = args[0];
  if (!target) { console.error(renderError("Missing process name/pid", "Usage: fennec log <name|pid> [--lines N] [-f] [--clear] [--level error|warn|info|debug]")); process.exit(1); }

  const clearFlag = args.includes("--clear");
  const linesIndex = args.indexOf("--lines");
  const lineCount = linesIndex !== -1 ? parseInt(args[linesIndex + 1]!, 10) : 30;
  const followFlag = args.includes("-f") || args.includes("--follow");
  const levelFilter = args.includes("--level") ? args[args.indexOf("--level") + 1]?.toLowerCase() : undefined;

  // Validate level filter
  if (levelFilter && !["error", "warn", "info", "debug"].includes(levelFilter)) {
    console.error(renderError("Invalid level", `"${levelFilter}" is not a valid level. Use: error, warn, info, debug`));
    process.exit(1);
  }

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

  // --clear flag: delete the log file
  if (clearFlag) {
    if (!logFilePath || !existsSync(logFilePath)) {
      console.error(`\n  ${pc.yellow("⚠")} ${pc.dim("No log file found for")} ${pc.bold(displayName)}\n`);
      process.exit(0);
    }
    try {
      unlinkSync(logFilePath);
      console.error(`\n  ${pc.green("✓")} ${pc.bold("Log cleared")} ${pc.dim(`— ${logFilePath}`)}\n`);
    } catch (err) {
      console.error(renderError("Failed to clear log", String(err)));
      process.exit(1);
    }
    return;
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

    // Apply level filter
    if (levelFilter) {
      const levelRegex = new RegExp(`\\b(${levelFilter.toUpperCase()})\\b`, "i");
      logLines = logLines.filter((line) => levelRegex.test(line));
    }

    spinner.stop();
    process.stdout.write("\r\x1b[K");
    console.error(`\n  ${symbols.fox} ${pc.bold("Logs")} ${renderAppName(displayName)} ${pc.dim(`(last ${logLines.length} line${logLines.length !== 1 ? "s" : ""})`)}`);

    const sliced = logLines.slice(-lineCount);
    for (const line of sliced) {
      const display = line.length > 300 ? line.slice(0, 300) + "…" : line;

      // Add timestamp prefix in follow mode
      const prefix = followFlag ? `${timestamp()} ` : "";

      // Color by level
      if (line.toLowerCase().includes("error") || line.toLowerCase().includes("fail") || line.toLowerCase().includes("fatal")) {
        console.error(`  ${pc.red(prefix + display)}`);
      } else if (line.toLowerCase().includes("warn")) {
        console.error(`  ${pc.yellow(prefix + display)}`);
      } else if (line.toLowerCase().includes("info") || line.includes("[")) {
        console.error(`  ${pc.cyan(prefix + display)}`);
      } else {
        console.error(`  ${prefix}${display}`);
      }
    }

    if (followFlag && logFilePath) {
      // Build tail args: show timestamps with --time-style
      const tailArgs = ["-n", "0", "-f"];
      if (levelFilter) {
        // For follow mode with level filter, we pipe through grep
        const tail = spawn("tail", ["-n", "0", "-f", logFilePath], { stdio: ["ignore", "pipe", "pipe"] });
        const grep = spawn("grep", ["--line-buffered", "-i", levelFilter], { stdio: ["pipe", "inherit", "inherit"] });
        if (tail.stdout) tail.stdout.pipe(grep.stdin);

        await new Promise<void>((resolve) => {
          tail.on("exit", () => resolve());
          process.once("SIGINT", () => {
            tail.kill("SIGTERM");
            grep.kill("SIGTERM");
            resolve();
          });
        });
      } else {
        console.error(`\n  ${pc.dim("Following... (Ctrl+C to stop)")}\n`);
        const tail = spawn("tail", tailArgs.concat([logFilePath]), { stdio: "inherit" });
        // Use SIGINT resolve pattern
        await new Promise<void>((resolve) => {
          tail.on("exit", () => resolve());
          process.once("SIGINT", () => {
            tail.kill("SIGTERM");
            resolve();
          });
        });
      }
    }
    console.error();
  } catch (error) {
    spinner.fail(`Failed to read logs for ${displayName}`);
    console.error(renderError("Log read failed", String(error)));
  }
}
