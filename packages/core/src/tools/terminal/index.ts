import { z } from 'zod';
import { createTool } from '../_registry.js';

export const terminalWatchFile = createTool({
  name: 'terminal_watch_file',
  category: 'terminal',
  description:
    "`<use_case>Terminal/Logs</use_case> 📋 Watch a log file for new content (like tail -f). Provide absolute file path. Optionally name the watcher for easy reference. Returns watcherId. Use to monitor server logs, app output, or any file that's being written to. After starting, use terminal_get_logs to read the captured content. Stop with terminal_stop_watcher. For named pipes (FIFO), use terminal_watch_pipe instead.`",
  inputSchema: z.object({
    filePath: z.string().describe('Absolute path to the log file'),
    name: z.string().optional().describe('Name for this watcher'),
    follow: z.boolean().optional().default(true).describe('Follow file changes'),
  }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const watcherId = logWatcher.watchFile(input.filePath, input.name);
      return responseBuilder.success({ watcherId, name: input.name ?? watcherId });
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'INVALID_INPUT',
        suggestions: ['Verify the file path exists', 'Check file permissions'],
      });
    }
  },
});

export const terminalGetLogs = createTool({
  name: 'terminal_get_logs',
  category: 'terminal',
  description:
    '`<use_case>Terminal/Logs</use_case> 📖 Get captured logs from a terminal watcher (started with terminal_watch_file). Filter by: lines (recent count), since (ISO timestamp), keyword (search). Returns logs[] with count. Use to read server output, check for specific errors, or monitor real-time app behavior. For error-only filtering, use terminal_get_errors instead.`',
  inputSchema: z.object({
    watcherId: z.string().describe('Watcher ID'),
    lines: z.number().optional().default(50).describe('Recent lines to return'),
    since: z.string().optional().describe('ISO timestamp filter'),
    keyword: z.string().optional().describe('Filter by keyword'),
  }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const logs = logWatcher.getLogs(input.watcherId, {
        lines: input.lines,
        since: input.since,
        keyword: input.keyword,
      });
      return responseBuilder.success({ logs, count: logs.length });
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'INVALID_INPUT',
        suggestions: ['Use terminal_list_watchers to see available watchers'],
      });
    }
  },
});

export const terminalGetErrors = createTool({
  name: 'terminal_get_errors',
  category: 'terminal',
  description:
    '`<use_case>Terminal/Logs</use_case> ❌ Get ONLY error-level logs from a terminal watcher. Filters for lines matching common error patterns. Returns errors[] and count. Faster than terminal_get_logs when you only care about errors. Use for quick error checking — like after a server restart or form submission where you expect possible errors.`',
  inputSchema: z.object({
    watcherId: z.string().describe('Watcher ID'),
    since: z.string().optional().describe('ISO timestamp filter'),
  }),
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
  name: 'terminal_list_watchers',
  category: 'terminal',
  description:
    "`<use_case>Terminal/Logs</use_case> 📋 List all active terminal watchers with their IDs and file paths. Returns watchers[] and count. Use to discover what watchers are running, get a watcherId for reading logs, or check if a specific file is being watched. Essential first step before terminal_get_logs if you don't have the watcherId.`",
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder, logWatcher }) => {
    return responseBuilder.success({
      watchers: logWatcher.list(),
      count: logWatcher.list().length,
    });
  },
});

export const terminalStopWatcher = createTool({
  name: 'terminal_stop_watcher',
  category: 'terminal',
  description:
    "`<use_case>Terminal/Logs</use_case> ⏹️ Stop a terminal watcher by its ID. Returns stopped=true/false. Use to stop monitoring a file when you're done. Also clears the buffer. Get watcher IDs from terminal_list_watchers. Resources are automatically freed when stopped.`",
  inputSchema: z.object({ watcherId: z.string().describe('Watcher ID to stop') }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    return responseBuilder.success({ stopped: logWatcher.stop(input.watcherId) });
  },
});

export const terminalWatchPipe = createTool({
  name: 'terminal_watch_pipe',
  category: 'terminal',
  description:
    '`<use_case>Terminal/Logs</use_case> 🔗 Watch a named pipe (FIFO) for incoming data — like monitoring inter-process communication or log streams from piped output. Returns watcherId. Similar to terminal_watch_file but for pipes. Use for monitoring live log streams, docker logs, or any process output piped to a FIFO. After starting, use terminal_get_logs to read captured data.`',
  inputSchema: z.object({
    pipePath: z.string().describe('Path to the named pipe'),
    name: z.string().optional().describe('Name for this watcher'),
  }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      // Reuse watchFile logic since named pipes behave like files for reading
      const watcherId = logWatcher.watchFile(input.pipePath, input.name);
      return responseBuilder.success({ watcherId, name: input.name ?? watcherId });
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'INVALID_INPUT',
        suggestions: [
          'Verify the pipe path exists',
          'Ensure the named pipe was created by the source process',
        ],
      });
    }
  },
});

export const terminalClearBuffer = createTool({
  name: 'terminal_clear_buffer',
  category: 'terminal',
  description:
    '`<use_case>Terminal/Logs</use_case> 🧹 Clear the log buffer for a terminal watcher — removes all captured data but keeps the watcher active. Returns cleared=true/false. Use to reset state between operations (e.g., clear before clicking a button so you only see new logs). Unlike terminal_stop_watcher, this keeps the watcher running for continued monitoring.`',
  inputSchema: z.object({ watcherId: z.string().describe('Watcher ID to clear buffer for') }),
  handler: async (input, { responseBuilder, logWatcher }) => {
    try {
      const cleared = logWatcher.clearBuffer(input.watcherId);
      return responseBuilder.success({ cleared });
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'INVALID_INPUT',
        suggestions: ['Use terminal_list_watchers to see available watchers'],
      });
    }
  },
});
