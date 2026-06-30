# Process Management Tools

Tools for spawning, monitoring, and managing processes. These tools work **without a browser** — no Playwright required.

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `process_spawn` | Spawn a new process (dev server, build tool, etc.) | command, args?, cwd?, env?, name? |
| `process_list` | List all managed processes with status | — |
| `process_get_logs` | Get logs from a managed process, filterable by level/lines/since | processId, lines?, level?, since? |
| `process_get_status` | Get process status: running, pid, uptime | processId |
| `process_send_input` | Send input to a process's stdin | processId, input |
| `process_kill` | Kill a process (SIGTERM/SIGKILL/SIGINT) | processId, signal? |
| `process_restart` | Restart a process with same configuration | processId |
| `process_wait_for_ready` | Wait for process to output a ready pattern | processId, pattern?, timeout? |
| `process_attach_pid` | Look up a running process by PID | pid, name? |
| `process_attach_port` | Look up a process by port number | port, name? |

## Examples

```typescript
// Spawn a dev server
const proc = await toolRegistry.call("process_spawn", {
  command: "node",
  args: ["server.js"],
  name: "my-api"
});
// Returns: { processId: "...", pid: 12345, name: "my-api", startedAt: "..." }

// Wait for ready
const ready = await toolRegistry.call("process_wait_for_ready", {
  processId: "my-api",
  pattern: "listening on port",
  timeout: 30000
});
// Returns: { ready: true, elapsed: N, matchedLine: "..." }

// Get error logs
const logs = await toolRegistry.call("process_get_logs", {
  processId: "my-api",
  level: "error",
  lines: 50
});
// Returns: { logs: [...], count: N, errorCount: N }

// Attach to existing process by port
const attached = await toolRegistry.call("process_attach_port", {
  port: 3000,
  name: "existing-server"
});
// Returns: { processId: "existing-server", pid: N, command: "node", port: 3000 }
```

## Security

- `process_spawn` requires `config.security.allowProcessSpawn` (default: `true`)
- `process_kill` requires `config.security.allowProcessKill` (default: `false`)
- The spawn allowlist restricts which commands can be run (default: `["npm", "node", "pnpm"]`)

## Log Level Detection

Process logs are automatically classified into levels using pattern matching:

| Level | Patterns |
|-------|----------|
| `error` | `error`, `Error`, `ERROR`, `ERR!`, `fatal`, `trace`, `stack trace` |
| `warn` | `warning`, `WARN`, `WARNING`, `warn` |
| `info` | `info`, `INFO`, `log`, `info:`, `[INFO]` |
| `debug` | `debug`, `DEBUG`, `[DEBUG]`, `[debug]` |
| `unknown` | Default for unclassified lines |
