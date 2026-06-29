import { z } from "zod";
import { createTool } from "../_registry.js";
import { PortDetector } from "../../process/PortDetector.js";

export const processSpawn = createTool({
  name: "process_spawn",
  category: "process",
  description: "`<use_case>Process management</use_case> Spawn a new process (dev server, build tool, etc.). Requires security.allowProcessSpawn. processId, pid, name, startedAt.`",
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
  description: "`<use_case>Process management</use_case> List all managed processes with status. processes[], count.`",
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
  description: "`<use_case>Process management</use_case> Get logs from a managed process. Filterable by level, line count, since. logs[], count, errorCount.`",
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
  description: "`<use_case>Process management</use_case> Get process status: running, pid, uptime. running (bool), pid, uptime (ms), memoryMB, cpuPercent.`",
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
  description: "`<use_case>Process management</use_case> Send input to a running process's stdin. sent (bool).`",
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
  description: "`<use_case>Process management</use_case> Kill a managed process. Supports SIGTERM, SIGKILL, SIGINT. Requires security.allowProcessKill. killed (bool).`",
  inputSchema: z.object({
    processId: z.string().describe("Process ID to kill"),
    signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).optional().default("SIGTERM").describe("Signal to send"),
  }),
  handler: async (input, { config, responseBuilder, processManager }) => {
    if (!config.security.allowProcessKill) {
      return responseBuilder.error(new Error("Process killing is disabled"), { code: "INVALID_INPUT" });
    }
    try {
      return responseBuilder.success({ killed: processManager.kill(input.processId, input.signal) });
    } catch (error) {
      return responseBuilder.error(error, { code: "PROCESS_NOT_FOUND" });
    }
  },
});

export const processRestart = createTool({
  name: "process_restart",
  category: "process",
  description: "`<use_case>Process management</use_case> Restart a managed process by killing and re-spawning it with the same configuration. Returns the new process info. processId, pid, startedAt.`",
  inputSchema: z.object({
    processId: z.string().describe("Process ID to restart"),
  }),
  handler: async (input, { config, responseBuilder, processManager }) => {
    if (!config.security.allowProcessSpawn) {
      return responseBuilder.error(new Error("Process spawning is disabled"), { code: "INVALID_INPUT" });
    }
    try {
      const newProc = await processManager.restart(input.processId);
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
  description: "`<use_case>Process management</use_case> Wait for a process to output a ready pattern (e.g. 'listening on port'). ready (bool), elapsed (ms), matchedLine.`",
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
  description: "`<use_case>Process management</use_case> Look up a running process by PID. Returns process info for monitoring (not process control). processId, pid, command, port (if detected).`",
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
  description: "`<use_case>Process management</use_case> Look up a process by port number. Returns process info. processId, pid, command, port.`",
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
