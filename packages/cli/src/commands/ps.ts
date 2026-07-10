/**
 * Command: ps, status — List tracked processes and system overview.
 */
import pc from "picocolors";
import { printBanner } from "../utils/banner.js";
import { symbols, renderTable, renderError, renderCommand, createSpinner, timestamp, type Column, type Row } from "../utils/format.js";
import { getSystemProcesses, isProcessRunning, formatProcessState } from "../utils/system-process.js";
import { readTracked, formatUptime } from "./tracker.js";

export async function psCommand(args: string[]): Promise<void> {
  const watchFlag = args.includes("-w") || args.includes("--watch");
  const systemFlag = args.includes("--system") || args.includes("-a") || args.includes("--all");
  const nameFilter = args.includes("--name") ? args[args.indexOf("--name") + 1] : undefined;
  const sortBy = args.includes("--sort")
    ? (args[args.indexOf("--sort") + 1] as "cpu" | "mem" | "pid" | "name")
    : "name";

  if (watchFlag && systemFlag) {
    await watchSystemProcesses(sortBy, 15);
    return;
  }

  if (systemFlag) {
    const spinner = createSpinner("Scanning system processes...");
    try {
      const processes = getSystemProcesses({ name: nameFilter, userOnly: true, sortBy, limit: 30 });
      spinner.stop();
      process.stdout.write("\r\x1b[K");
      if (processes.length === 0) {
        console.error(`\n  ${pc.dim("No system processes found.")}\n`);
        return;
      }
      const columns: Column[] = [
        { key: "pid", label: "PID", align: "right", format: (v) => pc.dim(String(v).padStart(6)) },
        { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
        { key: "cpu", label: "CPU%", align: "right", format: (v) => { const n = v as number; return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n)); } },
        { key: "mem", label: "MEM%", align: "right", format: (v) => { const n = v as number; return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n)); } },
        { key: "state", label: "State", format: (v) => { const s = String(v); if (s === "R" || s === "Running") return pc.green(s); if (s === "Z" || s === "Zombie") return pc.red(s); if (s === "S" || s === "Sleeping") return pc.cyan(s); return pc.dim(s); } },
      ];
      const rows: Row[] = processes.map((p) => ({ pid: p.pid, name: p.name, cpu: p.cpuPercent, mem: p.memPercent, state: formatProcessState(p.state) }));
      console.error(`\n  ${symbols.fox} ${pc.bold("System Processes")} ${pc.dim(`(top ${processes.length} by ${sortBy})`)}\n`);
      console.error(renderTable(columns, rows));
      console.error();
    } catch (error) {
      spinner.fail("Failed to scan processes");
      console.error(renderError("Process scan failed", String(error)));
    }
    return;
  }

  const tracked = readTracked();
  if (tracked.length === 0) {
    console.error(`\n  ${pc.dim("No tracked processes.")}`);
    console.error(`  ${pc.dim("Start an app with:")} ${pc.cyan("fennec start <command> --name <name>")}\n`);
    return;
  }

  const columns: Column[] = [
    { key: "name", label: "App", format: (v) => pc.bold(String(v)) },
    { key: "pid", label: "PID", align: "right" },
    { key: "status", label: "Status", format: (v) => { const s = v as string; return s === "running" ? pc.green("● running") : pc.red("○ stopped"); } },
    { key: "port", label: "Port", format: (v) => { const p = v as number | null; return p ? pc.yellow(`:${p}`) : pc.dim("-"); } },
    { key: "command", label: "Command", format: (v) => { const c = String(v); return c.length > 50 ? c.slice(0, 50) + "…" : c; } },
    { key: "uptime", label: "Uptime", format: (v) => pc.dim(String(v)) },
  ];

  const rows: Row[] = tracked.map((t) => {
    const running = isProcessRunning(t.pid);
    const uptime = running ? formatUptime(Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000)) : "-";
    return { name: t.name, pid: running ? String(t.pid) : pc.dim(String(t.pid)), status: running ? "running" : "stopped", port: t.port ?? null, command: t.command, uptime };
  });

  const runningCount = tracked.filter((t) => isProcessRunning(t.pid)).length;
  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Apps")} ${pc.dim(`(${runningCount}/${tracked.length} running)`)}\n`);
  console.error(renderTable(columns, rows));
  console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec start <command> --name <name> --port <port>")} ${pc.dim("to add more apps.")}`);
  console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec log <name>")} ${pc.dim("to view logs.")}`);
  console.error(`  ${pc.dim("Use")} ${pc.cyan("fennec kill <name>")} ${pc.dim("to stop an app.")}`);
  console.error();
}

export async function statusCommand(_args: string[]): Promise<void> {
  const watchFlag = _args.includes("-w") || _args.includes("--watch");
  const tracked = readTracked();
  const topSystem = getSystemProcesses({ userOnly: true, sortBy: "cpu", limit: 5 });
  const totalUserProcs = getSystemProcesses({ userOnly: true }).length;

  console.error(`\n  ${symbols.fox} ${pc.bold("Fennec Status")}\n`);

  if (tracked.length > 0) {
    const runningCount = tracked.filter((t) => isProcessRunning(t.pid)).length;
    console.error(`  ${pc.bold("Managed Apps")} ${pc.dim(`(${runningCount}/${tracked.length} running)`)}\n`);
    for (const t of tracked) {
      const running = isProcessRunning(t.pid);
      const statusIcon = running ? pc.green("●") : pc.red("○");
      const portStr = t.port ? ` ${pc.yellow(`:${t.port}`)}` : "";
      const uptime = running ? pc.dim(formatUptime(Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000))) : pc.red("stopped");
      console.error(`  ${statusIcon} ${pc.bold(t.name)}${portStr} ${pc.dim(`(PID ${t.pid})`)} — ${uptime}`);
    }
    console.error();
  } else {
    console.error(`  ${pc.dim("No managed apps.")} ${pc.cyan("fennec start <command> --name <name>")}\n`);
  }

  console.error(`  ${pc.bold("System")} ${pc.dim(`(${totalUserProcs} user processes)`)}`);
  for (const p of topSystem) {
    const cpuStr = p.cpuPercent > 10 ? pc.red(`${p.cpuPercent}%`) : p.cpuPercent > 5 ? pc.yellow(`${p.cpuPercent}%`) : pc.dim(`${p.cpuPercent}%`);
    const memStr = p.memPercent > 10 ? pc.red(`${p.memPercent}%`) : p.memPercent > 5 ? pc.yellow(`${p.memPercent}%`) : pc.dim(`${p.memPercent}%`);
    console.error(`  ${pc.dim(`PID ${p.pid}`)} ${pc.bold(p.name)} — CPU: ${cpuStr} MEM: ${memStr}`);
  }

  if (watchFlag) await watchSystemProcesses("cpu", 15);
  console.error();
}

async function watchSystemProcesses(sortBy: string, limit: number): Promise<void> {
  console.error(`\n  ${pc.bold("Watching system processes")} ${pc.dim("(Ctrl+C to stop, refreshes every 3s)")}\n`);

  const render = () => {
    const processes = getSystemProcesses({ userOnly: true, sortBy: sortBy as "cpu" | "mem" | "pid" | "name", limit });
    const columns: Column[] = [
      { key: "pid", label: "PID", align: "right", format: (v) => pc.dim(String(v).padStart(6)) },
      { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
      { key: "cpu", label: "CPU%", align: "right", format: (v) => { const n = v as number; return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n)); } },
      { key: "mem", label: "MEM%", align: "right", format: (v) => { const n = v as number; return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n)); } },
      { key: "state", label: "S", align: "center" },
    ];
    const rows: Row[] = processes.map((p) => ({ pid: p.pid, name: p.name, cpu: p.cpuPercent, mem: p.memPercent, state: p.state }));
    return `  ${timestamp()} ${pc.dim(`${processes.length} processes`)}\n${renderTable(columns, rows, { compact: true })}`;
  };

  console.error(render());
  const interval = setInterval(() => { process.stdout.write("\x1B[J"); console.error(render()); }, 3000);
  // Keep alive until SIGINT — resolves cleanly (no process.exit)
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      clearInterval(interval);
      process.stdout.write("\x1B[J");
      resolve();
    });
  });
}
