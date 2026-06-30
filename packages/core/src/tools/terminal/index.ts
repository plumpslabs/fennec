import { z } from "zod";
import { createTool } from "../_registry.js";

export const terminalWatchFile = createTool({
  name: "terminal_watch_file",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> Watch a log file for new content (tail-like). Optionally name the watcher. watcherId, name.`",
  inputSchema: z.object({
    filePath: z.string().describe("Absolute path to the log file"),
    name: z.string().optional().describe("Name for this watcher"),
    follow: z.boolean().optional().default(true).describe("Follow file changes"),
  }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const watcherId = logWatcher.watchFile(input.filePath, input.name);
      return responseBuilder.success({ watcherId, name: input.name ?? watcherId });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "INVALID_INPUT", suggestions: ["Verify the file path exists", "Check file permissions"],
      });
    }
  },
});

export const terminalGetLogs = createTool({
  name: "terminal_get_logs",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> Get logs from a terminal watcher. Filterable by lines, since (ISO), keyword. logs[], count.`",
  inputSchema: z.object({
    watcherId: z.string().describe("Watcher ID"),
    lines: z.number().optional().default(50).describe("Recent lines to return"),
    since: z.string().optional().describe("ISO timestamp filter"),
    keyword: z.string().optional().describe("Filter by keyword"),
  }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const logs = logWatcher.getLogs(input.watcherId, { lines: input.lines, since: input.since, keyword: input.keyword });
      return responseBuilder.success({ logs, count: logs.length });
    } catch (error) {
      return responseBuilder.error(error, { code: "INVALID_INPUT", suggestions: ["Use terminal_list_watchers to see available watchers"] });
    }
  },
});

export const terminalGetErrors = createTool({
  name: "terminal_get_errors",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> Get only error-level logs from a terminal watcher. errors[], count.`",
  inputSchema: z.object({ watcherId: z.string().describe("Watcher ID"), since: z.string().optional().describe("ISO timestamp filter") }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const errors = logWatcher.getErrors(input.watcherId, input.since);
      return responseBuilder.success({ errors, count: errors.length });
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const terminalListWatchers = createTool({
  name: "terminal_list_watchers",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> List all active terminal watchers. watchers[], count.`",
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder, logWatcher }) => {
    return responseBuilder.success({ watchers: logWatcher.list(), count: logWatcher.list().length });
  },
});

export const terminalStopWatcher = createTool({
  name: "terminal_stop_watcher",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> Stop a terminal watcher by ID. stopped (bool).`",
  inputSchema: z.object({ watcherId: z.string().describe("Watcher ID to stop") }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    return responseBuilder.success({ stopped: logWatcher.stop(input.watcherId) });
  },
});

export const terminalWatchPipe = createTool({
  name: "terminal_watch_pipe",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> Watch a named pipe (FIFO) for incoming data. Useful for monitoring inter-process communication or log streams from piped output. watcherId, name.`",
  inputSchema: z.object({
    pipePath: z.string().describe("Path to the named pipe"),
    name: z.string().optional().describe("Name for this watcher"),
  }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      // Reuse watchFile logic since named pipes behave like files for reading
      const watcherId = logWatcher.watchFile(input.pipePath, input.name);
      return responseBuilder.success({ watcherId, name: input.name ?? watcherId });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "INVALID_INPUT",
        suggestions: ["Verify the pipe path exists", "Ensure the named pipe was created by the source process"],
      });
    }
  },
});

export const terminalClearBuffer = createTool({
  name: "terminal_clear_buffer",
  category: "terminal",
  description: "`<use_case>Log monitoring</use_case> Clear the log buffer for a terminal watcher. Useful for resetting state between operations. cleared (bool).`",
  inputSchema: z.object({ watcherId: z.string().describe("Watcher ID to clear buffer for") }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const cleared = logWatcher.clearBuffer(input.watcherId);
      return responseBuilder.success({ cleared });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "INVALID_INPUT",
        suggestions: ["Use terminal_list_watchers to see available watchers"],
      });
    }
  },
});
