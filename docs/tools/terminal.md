# Terminal / Log Monitoring Tools

Tools for watching log files, pipe streams, and monitoring terminal output. These tools work **without a browser**.

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `terminal_watch_file` | Watch a log file for new content (tail-like) | filePath, name?, follow? |
| `terminal_get_logs` | Get logs from a terminal watcher, filterable by lines/since/keyword | watcherId, lines?, since?, keyword? |
| `terminal_get_errors` | Get only error-level logs from a watcher | watcherId, since? |
| `terminal_list_watchers` | List all active terminal watchers | — |
| `terminal_stop_watcher` | Stop a terminal watcher by ID | watcherId |
| `terminal_watch_pipe` | Watch a named pipe (FIFO) for incoming data | pipePath, name? |
| `terminal_clear_buffer` | Clear the log buffer for a watcher | watcherId |

## Examples

```typescript
// Watch a server log file
const watcher = await toolRegistry.call("terminal_watch_file", {
  filePath: "/var/log/app.log",
  name: "my-app"
});
// Returns: { watcherId: "...", name: "my-app" }

// Get recent logs with keyword filter
const logs = await toolRegistry.call("terminal_get_logs", {
  watcherId: "my-app",
  lines: 100,
  keyword: "error"
});
// Returns: { logs: [...], count: N }

// Pipe output from a running process
// Terminal: npm run dev 2>&1 | fennec pipe --name "dev-server"
// Then in AI:
const pipedLogs = await toolRegistry.call("terminal_get_logs", {
  watcherId: "dev-server"
});

// Clear buffer between operations
await toolRegistry.call("terminal_clear_buffer", {
  watcherId: "my-app"
});
// Returns: { cleared: true }
```

## Pipe Mode

The recommended way to connect Fennec to your terminal:

```bash
# Pipe your server output directly to Fennec
npm run dev 2>&1 | fennec pipe --name "my-app"
```

This creates a watcher that can be accessed via `terminal_get_logs` with the watcher ID or name. The pipe watcher captures stdout and stderr simultaneously.

## Log Entry Format

Each log entry contains:

```typescript
{
  line: string;        // Raw log line
  level: string;       // Auto-detected level: error | warn | info | debug | unknown
  timestamp: string;   // ISO timestamp when captured
  source: string;      // "stdout" | "stderr"
}
```
