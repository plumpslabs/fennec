/**
 * Command: health — Check Fennec system health
 * Returns system status, tracked processes, and resource info.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import pc from "picocolors";
import { printBanner } from "../utils/banner.js";
import { symbols, renderKV, renderError } from "../utils/format.js";
import { readTracked } from "./tracker.js";
import { isProcessRunning } from "../utils/system-process.js";

export async function healthCommand(): Promise<void> {
  printBanner();
  console.error(`  ${pc.bold("Fennec Health Check")}\n`);

  // 1. ADB availability (if needed)
  let adbStatus = "unknown";
  try {
    const result = execSync("adb --version", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const version = result.split("\n")[0]?.trim() ?? "installed";
    adbStatus = pc.green(version);
  } catch {
    adbStatus = pc.dim("not found") + " (optional)";
  }

  // 2. Tracked processes
  const tracked = readTracked();
  const runningCount = tracked.filter((t) => isProcessRunning(t.pid)).length;

  // 3. Disk usage for logs
  const logDir = resolve(homedir(), ".fennec", "logs");
  let logSize = "0 B";
  try {
    if (existsSync(logDir)) {
      const files = readdirSync(logDir);
      let totalBytes = 0;
      for (const f of files) {
        const fStat = statSync(resolve(logDir, f));
        totalBytes += fStat.size;
      }
      logSize = totalBytes > 1024 * 1024
        ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
        : `${(totalBytes / 1024).toFixed(1)} KB`;
    }
  } catch { /* best-effort */ }

  // 4. Memory info
  let memoryInfo = "unknown";
  try {
    const mem = process.memoryUsage();
    memoryInfo = `${(mem.rss / (1024 * 1024)).toFixed(0)} MB RSS / ${(mem.heapUsed / (1024 * 1024)).toFixed(0)} MB heap`;
  } catch { /* best-effort */ }

  console.error(`  ${symbols.fox} ${pc.bold("System")}\n`);
  console.error(`  ${renderKV("Node.js", process.version)}`);
  console.error(`  ${renderKV("Platform", `${process.platform} ${process.arch}`)}`);
  console.error(`  ${renderKV("Memory", memoryInfo)}`);
  console.error(`  ${renderKV("ADB", adbStatus)}`);
  console.error(`  ${renderKV("PID", String(process.pid))}`);
  console.error();
  console.error(`  ${symbols.fox} ${pc.bold("Processes")}\n`);
  console.error(`  ${renderKV("Tracked", String(tracked.length))}`);
  console.error(`  ${renderKV("Running", String(runningCount))}`);
  console.error(`  ${renderKV("Logs", logSize)}`);
  console.error();

  const allHealthy = runningCount === tracked.length || tracked.length === 0;
  if (allHealthy) {
    console.error(`  ${pc.green("✓")} ${pc.bold("All systems healthy")}\n`);
  } else {
    const stopped = tracked.length - runningCount;
    console.error(`  ${pc.yellow("⚠")} ${pc.bold(`${stopped} process(es) stopped`)}  ${pc.dim("fennec ps")}\n`);
  }
}
