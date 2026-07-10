import { z } from "zod";
import { createTool } from "../_registry.js";
import { PortDetector } from "../../process/PortDetector.js";
import { readTracked, addTracked, removeTracked, removeTrackedByPid, saveTracked } from "../../process/tracking.js";
import { isProcessRunning } from "../../utils/system-process.js";
import { existsSync, unlinkSync, renameSync, createWriteStream, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

export const processSpawn = createTool({
  name: "process_spawn",
  category: "process",
  description: "`<use_case>STARTING a new app</use_case> Spawn a NEW process (dev server, build tool, etc.). Use this for first-time starts. For re-spawning a previously stopped process, use process_spawn_tracked instead. Syncs to tracked.json so fennec ps sees it. Requires security.allowProcessSpawn. Returns: processId, pid, name, startedAt.`",
  inputSchema: z.object({
    command: z.string().describe("Command to run (e.g., 'npm', 'node')"),
    args: z.array(z.string()).optional().default([]).describe("Command arguments"),
    cwd: z.string().optional().describe("Working directory"),
    env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
    name: z.string().optional().describe("Process name for identification"),
  }),
  handler: async (input, { config, responseBuilder, processManager }) => {
    if (!config.security.allowProcessSpawn) {
      return responseBuilder.error(
        new Error("Process spawning is disabled by security settings"),
        { code: "INVALID_INPUT" },
      );
    }
    try {
      const proc = processManager.spawn(input.command, input.args ?? [], input.cwd, input.env, input.name);

      // Sync to tracked.json so CLI's `fennec ps` sees agent-spawned processes
      addTracked({
        name: proc.name,
        pid: proc.pid,
        command: `${input.command} ${(input.args ?? []).join(" ")}`,
        cwd: input.cwd,
        startedAt: proc.startedAt.toISOString(),
      });

      return responseBuilder.success({
        processId: proc.processId,
        pid: proc.pid,
        name: proc.name,
        startedAt: proc.startedAt.toISOString(),
      }, { elapsed: 0, sessionId: "", timestamp: new Date().toISOString() });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "SPAWN_FAILED",
        suggestions: ["Check if the command is in the spawn allowlist", "Verify the command exists in PATH"],
      });
    }
  },
});

export const processList = createTool({
  name: "process_list",
  category: "process",
  description: "`<use_case>CHECKING running processes</use_case> List ALL MCP-managed processes (those spawned via process_spawn). NOTE: This does NOT show CLI-started processes (from fennec start). To see ALL tracked processes including CLI-started ones, use process_get_tracked instead. Returns: processes[], count.`",
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder, processManager }) => {
    return responseBuilder.success({
      processes: processManager.list().map((p) => ({
        processId: p.processId, name: p.name, pid: p.pid, running: p.running,
        command: p.command, startedAt: p.startedAt.toISOString(),
      })),
      count: processManager.list().length,
    });
  },
});

export const processGetLogs = createTool({
  name: "process_get_logs",
  category: "process",
  description: "`<use_case>READING app logs</use_case> Get logs from an MCP-managed process. Filter by level (error/warn/info/debug), limit lines, or filter by timestamp (since). To clear/delete log files, use process_clear_logs. Returns: logs[], count, errorCount.`",
  inputSchema: z.object({
    processId: z.string().describe("Process ID to get logs from"),
    lines: z.number().optional().default(50).describe("Number of recent lines to return"),
    level: z.enum(["error", "warn", "info", "debug"]).optional().describe("Filter by log level"),
    since: z.string().optional().describe("ISO timestamp filter"),
  }),
  handler: async (input, { responseBuilder, processManager }) => {
    try {
      const logs = processManager.getLogs(input.processId, { lines: input.lines, level: input.level, since: input.since });
      return responseBuilder.success({ logs, count: logs.length, errorCount: logs.filter((l) => l.level === "error").length });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND", suggestions: ["Use process_list to see available processes"] });
    }
  },
});

export const processGetStatus = createTool({
  name: "process_get_status",
  category: "process",
  description: "`<use_case>CHECKING process health</use_case> Get real-time status of an MCP-managed process. Returns running (bool), pid, uptime (ms), memoryMB, cpuPercent. For a comprehensive overview of ALL tracked processes, use observe or process_get_tracked.`",
  inputSchema: z.object({ processId: z.string().describe("Process ID") }),
  handler: async (input, { responseBuilder, processManager }) => {
    try {
      const status = processManager.getStatus(input.processId);
      return responseBuilder.success({
        running: status.running, pid: status.pid, uptime: status.uptime,
        memoryMB: null as number | null, cpuPercent: null as number | null,
      });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND" });
    }
  },
});

export const processSendInput = createTool({
  name: "process_send_input",
  category: "process",
  description: "`<use_case>INTERACTING with a process</use_case> Send text input to a running process's stdin (like typing in a terminal). Use this for CLI tools that wait for user input (confirmation prompts, password inputs, etc.). Returns: sent (bool).`",
  inputSchema: z.object({ processId: z.string().describe("Process ID"), input: z.string().describe("Input to send") }),
  handler: async (input, { responseBuilder, processManager }) => {
    try {
      return responseBuilder.success({ sent: processManager.sendInput(input.processId, input.input) });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND" });
    }
  },
});

export const processKill = createTool({
  name: "process_kill",
  category: "process",
  description: "`<use_case>PERMANENTLY removing an app</use_case> Kill an MCP-managed process and REMOVE it from tracked.json (permanent). Supports: SIGTERM (graceful), SIGKILL (force), SIGINT (interrupt). To temporarily stop a process while keeping it in tracked.json for later re-spawn, use process_stop_tracked instead. Requires security.allowProcessKill. Returns: killed (bool).`",
  inputSchema: z.object({
    processId: z.string().describe("Process ID to kill"),
    signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).optional().default("SIGTERM").describe("Signal to send"),
  }),
  handler: async (input, { config, responseBuilder, processManager }) => {
    if (!config.security.allowProcessKill) {
      return responseBuilder.error(new Error("Process killing is disabled"), { code: "INVALID_INPUT" });
    }
    try {
      const killed = processManager.kill(input.processId, input.signal);

      // Sync to tracked.json — remove by processId name
      if (killed) {
        removeTracked(input.processId);
      }

      return responseBuilder.success({ killed });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND" });
    }
  },
});

export const processGetTracked = createTool({
  name: "process_get_tracked",
  category: "process",
  description: "`<use_case>VIEWING all tracked apps</use_case> Get ALL tracked processes from tracked.json (same as fennec ps). This is the COMPLETE view — unlike process_list which only shows MCP-spawned processes, this includes everything started via CLI (fennec start) AND MCP (process_spawn). Best entry point for checking what apps are running. Returns: name, pid, status (running/stopped), port, command, cwd, uptime, runningCount, summary.`",
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder }) => {
    const tracked = readTracked();
    const processes = tracked.map((t) => {
      const running = isProcessRunning(t.pid);
      const uptime = running
        ? Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000)
        : null;
      return {
        name: t.name,
        pid: t.pid,
        status: running ? "running" : "stopped",
        port: t.port ?? null,
        command: t.command,
        cwd: t.cwd ?? null,
        startedAt: t.startedAt,
        uptime,
      };
    });

    const runningCount = processes.filter((p) => p.status === "running").length;

    return responseBuilder.success({
      processes,
      count: processes.length,
      runningCount,
      summary: `${runningCount}/${processes.length} processes running`,
    });
  },
});

// ─── Tracked Process Management (CLI parity) ─────────────────────
// These tools mirror CLI commands (fennec stop, spawn, cleanup, rename, etc.)
// so AI agents via MCP can do everything CLI users can do.

export const processStopTracked = createTool({
  name: "process_stop_tracked",
  category: "process",
  description: "`<use_case>PAUSING an app temporarily</use_case> Stop a tracked process but KEEP it in tracked.json (same as fennec stop). The process can be re-spawned later via process_spawn_tracked. Unlike process_kill which PERMANENTLY removes the entry, this is for temporary pauses. Use this when you want to keep the app config but stop it. Returns: name, status, pid.`",
  inputSchema: z.object({
    name: z.string().describe("Name of the tracked process to stop"),
  }),
  handler: async (input, { responseBuilder }) => {
    const tracked = readTracked();
    const match = tracked.find((t) => t.name === input.name);

    if (!match) {
      return responseBuilder.error(new Error(`No tracked process named "${input.name}"`), {
        code: "PROCESS_NOT_FOUND", suggestions: ["Use process_get_tracked to see all tracked processes"],
      });
    }

    if (!isProcessRunning(match.pid)) {
      return responseBuilder.success({ name: input.name, status: "already_stopped", pid: match.pid });
    }

    try {
      process.kill(match.pid, "SIGTERM");
      // Don't remove from tracked.json (unlike process_kill)
      return responseBuilder.success({ name: input.name, status: "stopped", pid: match.pid });
    } catch (err) {
      return responseBuilder.error(err, { code: "KILL_FAILED", suggestions: ["Try with a different signal", "Check permissions"] });
    }
  },
});

export const processSpawnTracked = createTool({
  name: "process_spawn_tracked",
  category: "process",
  description: "`<use_case>RESUMING a paused app</use_case> Re-spawn a stopped tracked process from its saved command (same as fennec spawn). Use this to RESUME a previously stopped process. For first-time starts, use process_spawn instead. Automatically pipes logs to ~/.fennec/logs/<name>.log. Returns: name, status (spawned), pid, command.`",
  inputSchema: z.object({
    name: z.string().describe("Name of the tracked process to re-spawn"),
  }),
  handler: async (input, { responseBuilder }) => {
    const tracked = readTracked();
    const match = tracked.find((t) => t.name === input.name);

    if (!match) {
      return responseBuilder.error(new Error(`No tracked process named "${input.name}"`), {
        code: "PROCESS_NOT_FOUND", suggestions: ["Use process_get_tracked to see available processes"],
      });
    }

    if (isProcessRunning(match.pid)) {
      return responseBuilder.success({ name: input.name, status: "already_running", pid: match.pid });
    }

    if (!match.command) {
      return responseBuilder.error(new Error(`"${input.name}" has no saved command and cannot be re-spawned`), {
        code: "NO_COMMAND", suggestions: ["Use process_spawn to create a new process instead"],
      });
    }

    const cmdParts = match.command.split(/\s+/);
    const logDir = resolve(homedir(), ".fennec", "logs");
    const logFilePath = resolve(logDir, `${match.name}.log`);

    try {
      const child = spawn(cmdParts[0]!, cmdParts.slice(1), {
        cwd: match.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      const newPid = child.pid ?? 0;

      // Pipe logs to file (same as CLI fennec spawn)
      mkdirSync(logDir, { recursive: true });
      const logStream = createWriteStream(logFilePath, { flags: "a" });
      if (child.stdout) child.stdout.pipe(logStream);
      if (child.stderr) child.stderr.pipe(logStream);

      child.unref();

      // Update tracked.json with new PID
      addTracked({
        name: match.name,
        pid: newPid,
        command: match.command,
        port: match.port,
        cwd: match.cwd,
        startedAt: new Date().toISOString(),
      });

      return responseBuilder.success({
        name: input.name,
        status: "spawned",
        pid: newPid,
        command: match.command,
      });
    } catch (err) {
      return responseBuilder.error(err, { code: "SPAWN_FAILED", suggestions: ["Verify the saved command is valid"] });
    }
  },
});

export const processRenameTracked = createTool({
  name: "process_rename_tracked",
  category: "process",
  description: "`<use_case>RENAMING an app</use_case> Change the name of a tracked process and its log file (same as fennec rename). Use this to fix typos or give better names. The old log file is automatically renamed. Requires: oldName (current name), newName (desired name). Returns: oldName, newName.`",
  inputSchema: z.object({
    oldName: z.string().describe("Current name of the tracked process"),
    newName: z.string().describe("New name for the tracked process"),
  }),
  handler: async (input, { responseBuilder }) => {
    const tracked = readTracked();
    const match = tracked.find((t) => t.name === input.oldName);

    if (!match) {
      return responseBuilder.error(new Error(`No tracked process named "${input.oldName}"`), {
        code: "PROCESS_NOT_FOUND",
      });
    }

    if (tracked.some((t) => t.name === input.newName)) {
      return responseBuilder.error(new Error(`A process named "${input.newName}" already exists`), {
        code: "NAME_TAKEN",
      });
    }

    // Rename log file if it exists
    const logDir = resolve(homedir(), ".fennec", "logs");
    const oldLog = resolve(logDir, `${input.oldName}.log`);
    const newLog = resolve(logDir, `${input.newName}.log`);
    if (existsSync(oldLog) && !existsSync(newLog)) {
      try { renameSync(oldLog, newLog); } catch { /* best-effort */ }
    }

    // Update tracked.json
    match.name = input.newName;
    saveTracked(tracked);

    return responseBuilder.success({ oldName: input.oldName, newName: input.newName });
  },
});

export const processCleanupTracked = createTool({
  name: "process_cleanup_tracked",
  category: "process",
  description: "`<use_case>CLEANING up dead entries</use_case> Remove dead tracked entries that have no saved command and CANNOT be re-spawned (same as fennec cleanup). These are orphaned entries from old sessions. Processes that HAVE a saved command are kept even if stopped. Returns: removedCount, remainingCount, removed[].`",
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder }) => {
    const tracked = readTracked();
    const toRemove = tracked.filter((t) => !isProcessRunning(t.pid) && !t.command);

    if (toRemove.length === 0) {
      return responseBuilder.success({ removedCount: 0, message: "No dead entries without commands found" });
    }

    const remaining = tracked.filter((t) => !toRemove.includes(t));
    saveTracked(remaining);

    return responseBuilder.success({
      removedCount: toRemove.length,
      remainingCount: remaining.length,
      removed: toRemove.map((t) => ({ name: t.name, pid: t.pid })),
    });
  },
});

export const processClearLogs = createTool({
  name: "process_clear_logs",
  category: "process",
  description: "`<use_case>DELETING log files</use_case> Delete the log file for a tracked process to free up disk space (same as fennec log --clear). Use this when logs are too large or you want a fresh start. The process continues running — only the log file is deleted. A new log file will be created automatically when the process writes new output. Returns: name, logCleared (bool), path.`",
  inputSchema: z.object({
    name: z.string().describe("Name of the tracked process whose log to clear"),
  }),
  handler: async (input, { responseBuilder }) => {
    const logDir = resolve(homedir(), ".fennec", "logs");
    const logPath = resolve(logDir, `${input.name}.log`);

    if (!existsSync(logPath)) {
      return responseBuilder.error(new Error(`No log file found for "${input.name}"`), {
        code: "LOG_NOT_FOUND", suggestions: ["Verify the process name", "Log for this process may not exist yet"],
      });
    }

    try {
      unlinkSync(logPath);
      return responseBuilder.success({ name: input.name, logCleared: true, path: logPath });
    } catch (err) {
      return responseBuilder.error(err, { code: "CLEAR_FAILED", suggestions: ["Check file permissions"] });
    }
  },
});

export const processRestart = createTool({
  name: "process_restart",
  category: "process",
  description: "`<use_case>RESTARTING an app</use_case> Restart an MCP-managed process by killing and re-spawning it with the same config. Use this to apply changes or recover from errors. For tracked processes (CLI-started), use process_stop_tracked + process_spawn_tracked instead. Returns: processId, pid, startedAt.`",
  inputSchema: z.object({
    processId: z.string().describe("Process ID to restart"),
  }),
  handler: async (input, { config, responseBuilder, processManager }) => {
    if (!config.security.allowProcessSpawn) {
      return responseBuilder.error(new Error("Process spawning is disabled"), { code: "INVALID_INPUT" });
    }
    try {
      const newProc = await processManager.restart(input.processId);

      // Sync to tracked.json — update with new PID
      addTracked({
        name: newProc.name,
        pid: newProc.pid,
        command: newProc.command,
        cwd: newProc.cwd,
        startedAt: newProc.startedAt.toISOString(),
      });

      return responseBuilder.success({
        processId: newProc.processId,
        pid: newProc.pid,
        startedAt: newProc.startedAt.toISOString(),
      }, { elapsed: 0, sessionId: "", timestamp: new Date().toISOString() });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND", suggestions: ["Use process_list to see available processes"] });
    }
  },
});

export const processWaitForReady = createTool({
  name: "process_wait_for_ready",
  category: "process",
  description: "`<use_case>WAITING for an app to be ready</use_case> Poll an MCP-managed process's logs until it outputs a ready pattern (e.g. 'listening on port', 'ready', 'started', 'compiled'). Use this AFTER process_spawn to wait for the server to be fully up before navigating to it. Configurable pattern and timeout. Returns: ready (bool), elapsed (ms), matchedLine.`",
  inputSchema: z.object({
    processId: z.string().describe("Process ID to wait for"),
    pattern: z.string().optional().default("listening on port|ready|started|compiled").describe("Pattern to match for readiness"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
  }),
  handler: async (input, { responseBuilder, processManager }) => {
    const startTime = Date.now();
    try {
      processManager.get(input.processId); // Validate exists
      const patterns = input.pattern!.split("|");

      return await new Promise((resolve) => {
        const check = () => {
          const logs = processManager.getLogs(input.processId, { lines: 100 });
          for (const log of logs) {
            for (const pattern of patterns) {
              if (new RegExp(pattern, "i").test(log.line)) {
                resolve(responseBuilder.success({ ready: true, elapsed: Date.now() - startTime, matchedLine: log.line }));
                return;
              }
            }
          }
          if (Date.now() - startTime > input.timeout!) {
            resolve(responseBuilder.error(new Error(`Process did not become ready within ${input.timeout}ms`), {
              code: "TIMEOUT", suggestions: ["Increase timeout", "Check process status"],
            }));
            return;
          }
          setTimeout(check, 200);
        };
        check();
      });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND" });
    }
  },
});

// ─── Attach to existing processes ─────────────────────────────────

export const processAttachPid = createTool({
  name: "process_attach_pid",
  category: "process",
  description: "`<use_case>FINDING a process by PID</use_case> Look up a running system process by its PID. Returns basic info for monitoring (not process control). Unlike process_get_tracked which shows only fennec-tracked processes, this can find ANY process on the system by PID. Returns: processId, pid, command, port (if detected).`",
  inputSchema: z.object({
    pid: z.number().describe("Process ID to attach to"),
    name: z.string().optional().describe("Name for this process reference"),
  }),
  handler: async (input, { responseBuilder }) => {
    try {
      const detector = new PortDetector();
      const info = detector.detectByPid(input.pid);
      if (!info) {
        return responseBuilder.error(
          new Error(`Could not find process with PID ${input.pid}`),
          { code: "PROCESS_NOT_FOUND", suggestions: ["Verify the PID is correct and the process is running"] },
        );
      }
      return responseBuilder.success({
        processId: input.name ?? `pid_${input.pid}`,
        pid: input.pid,
        command: info.command,
        port: info.port ?? null,
      }, { elapsed: 0, sessionId: "", timestamp: new Date().toISOString() });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ATTACH_FAILED",
        suggestions: ["Verify the PID is correct", "Ensure the process is running"],
      });
    }
  },
});

export const processAttachPort = createTool({
  name: "process_attach_port",
  category: "process",
  description: "`<use_case>FINDING which app uses a port</use_case> Find which process is listening on a specific port. Use this to check if a server is running on its expected port, or to find what's occupying a port. Returns: processId, pid, command, port. For a full list of tracked processes, use process_get_tracked instead.`",
  inputSchema: z.object({
    port: z.number().describe("Port number to find process on"),
    name: z.string().optional().describe("Name for this process reference"),
  }),
  handler: async (input, { responseBuilder }) => {
    try {
      const detector = new PortDetector();
      const info = detector.detectByPort(input.port);
      if (!info) {
        return responseBuilder.error(
          new Error(`No process found listening on port ${input.port}`),
          { code: "PROCESS_NOT_FOUND", suggestions: ["Verify the port is in use", "Check if the server is running"] },
        );
      }
      return responseBuilder.success({
        processId: input.name ?? `port_${input.port}`,
        pid: info.pid,
        command: info.command,
        port: input.port,
      }, { elapsed: 0, sessionId: "", timestamp: new Date().toISOString() });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ATTACH_FAILED",
        suggestions: ["Verify the port number is correct", "Ensure a process is listening on this port"],
      });
    }
  },
});
