import { spawn, type ChildProcess } from "node:child_process";
import { getLogger } from "../utils/logger.js";
import { detectLogLevel, type LogLevel } from "../utils/levelDetector.js";

export interface ManagedProcess {
  processId: string;
  pid: number;
  name: string;
  command: string;
  cwd?: string;
  startedAt: Date;
  child: ChildProcess;
  logBuffer: Array<{ line: string; level: LogLevel; timestamp: string }>;
  running: boolean;
}

export interface ProcessConfig {
  maxProcesses: number;
  logBufferLines: number;
  spawnAllowlist: string[];
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private nextId = 0;
  private config: ProcessConfig;

  constructor(config: ProcessConfig) {
    this.config = config;
  }

  spawn(
    command: string,
    args: string[] = [],
    cwd?: string,
    env?: Record<string, string>,
    name?: string,
  ): ManagedProcess {
    const logger = getLogger();

    // Check allowlist
    if (
      this.config.spawnAllowlist.length > 0 &&
      !this.config.spawnAllowlist.includes(command)
    ) {
      throw new Error(
        `Command not in spawn allowlist: ${command}. Allowed: ${this.config.spawnAllowlist.join(", ")}`,
      );
    }

    // Check max processes
    const runningCount = this.getRunningCount();
    if (runningCount >= this.config.maxProcesses) {
      throw new Error(
        `Maximum processes (${this.config.maxProcesses}) reached. Kill a process first.`,
      );
    }

    const processId = name ?? `proc_${++this.nextId}`;

    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    const managed: ManagedProcess = {
      processId,
      pid: child.pid ?? 0,
      name: processId,
      command: `${command} ${args.join(" ")}`,
      cwd,
      startedAt: new Date(),
      child,
      logBuffer: [],
      running: true,
    };

    // Collect stdout
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter((l) => l.trim());
        for (const line of lines) {
          const level = detectLogLevel(line);
          managed.logBuffer.push({ line, level, timestamp: new Date().toISOString() });
          if (managed.logBuffer.length > this.config.logBufferLines) {
            managed.logBuffer.shift();
          }
        }
      });
    }

    // Collect stderr
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter((l) => l.trim());
        for (const line of lines) {
          managed.logBuffer.push({ line, level: "error", timestamp: new Date().toISOString() });
          if (managed.logBuffer.length > this.config.logBufferLines) {
            managed.logBuffer.shift();
          }
        }
      });
    }

    // Handle exit
    child.on("exit", (code, signal) => {
      managed.running = false;
      logger.info({ processId, code, signal }, "Process exited");
    });

    child.on("error", (err) => {
      managed.running = false;
      logger.error({ processId, err }, "Process error");
    });

    this.processes.set(processId, managed);
    logger.info({ processId, pid: managed.pid, command }, "Process spawned");

    return managed;
  }

  get(processId: string): ManagedProcess {
    const proc = this.processes.get(processId);
    if (!proc) {
      throw new Error(`Process not found: ${processId}`);
    }
    return proc;
  }

  list(): ManagedProcess[] {
    return Array.from(this.processes.values());
  }

  kill(processId: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
    const proc = this.processes.get(processId);
    if (!proc) return false;
    if (!proc.running) return true;

    try {
      proc.child.kill(signal);
      proc.running = false;
      return true;
    } catch {
      return false;
    }
  }

  getLogs(
    processId: string,
    options?: { lines?: number; level?: LogLevel; since?: string },
  ): Array<{ line: string; level: LogLevel; timestamp: string }> {
    const proc = this.get(processId);
    let logs = proc.logBuffer;

    if (options?.level) {
      logs = logs.filter((l) => l.level === options.level);
    }
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() > sinceTime);
    }
    if (options?.lines && options.lines > 0) {
      logs = logs.slice(-options.lines);
    }

    return logs;
  }

  getStatus(processId: string): { running: boolean; pid: number; uptime: number } {
    const proc = this.get(processId);
    return {
      running: proc.running,
      pid: proc.pid,
      uptime: proc.running
        ? Math.floor((Date.now() - proc.startedAt.getTime()) / 1000)
        : 0,
    };
  }

  sendInput(processId: string, input: string): boolean {
    const proc = this.get(processId);
    if (!proc.running || !proc.child.stdin) return false;
    proc.child.stdin.write(`${input}\n`);
    return true;
  }

  private getRunningCount(): number {
    let count = 0;
    for (const [, proc] of this.processes) {
      if (proc.running) count++;
    }
    return count;
  }

  cleanup(): void {
    for (const [id] of this.processes) {
      this.kill(id, "SIGKILL");
    }
    this.processes.clear();
  }
}
