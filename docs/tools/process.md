# Process Management Tools

Tools for spawning, monitoring, and managing processes. These tools work **without a browser** — no Playwright required.

## Tools

| Tool                      | Description                                                                                                                                                                  | Parameters                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `process_spawn`           | Spawn a NEW process (dev server, build tool, etc.). Idempotent: adopts an existing process if the port is already served.                                                    | command, args?, cwd?, env?, name?, group?  |
| `process_spawn_tracked`   | Re-spawn STOPPED tracked app(s) from saved config (CLI `fennec spawn`). Skips already-running entries.                                                                       | name?, names[], group?, all?               |
| `process_get_tracked`     | Get ALL tracked processes (CLI **and** MCP) with live status, `group`, and cross-platform `memMB` (RSS). Optional `group` filter.                                            | group?                                     |
| `process_list`            | List MCP-managed processes with status                                                                                                                                       | —                                          |
| `process_get_status`      | Get process status: running, pid, uptime, cpu %, **memoryMB**                                                                                                                | processId                                  |
| `process_get_logs`        | Get logs from a managed process, filterable by level/lines/since. **Secrets are redacted** before returning.                                                                 | processId, lines?, level?, since?          |
| `process_clear_logs`      | Delete a process log file (free disk); process keeps running                                                                                                                 | name                                       |
| `process_send_input`      | Send input to a process's stdin                                                                                                                                              | processId, input                           |
| `process_stop_tracked`    | Stop tracked app(s) but KEEP them in the registry for later re-spawn (CLI `fennec stop`).                                                                                    | name?, names[], group?, all?               |
| `process_kill`            | Kill process(es) and remove from registry (CLI `fennec kill`). Kills the ENTIRE process tree. Supports a single name/PID, MULTIPLE names, `--group`, or `--all`.             | processId?, names[], group?, all?, signal? |
| `process_restart`         | Restart process(es) from saved config. Supports single / MULTIPLE names / `--group` / `--all`.                                                                               | name?, names[], group?, all?               |
| `process_set_group`       | Assign (or clear) a group on one or more tracked processes for scoped bulk ops.                                                                                              | names[], group?                            |
| `process_rename_tracked`  | Rename a tracked process + its log file                                                                                                                                      | oldName, newName                           |
| `process_cleanup_tracked` | Remove dead tracked entries that can't be re-spawned                                                                                                                         | —                                          |
| `process_adopt`           | Take control of an ALREADY-RUNNING process (no restart)                                                                                                                      | command?, pid?, port?, name?               |
| `process_wait_for_ready`  | Wait for process to output a ready pattern                                                                                                                                   | processId, pattern?, timeout?              |
| `process_attach_pid`      | Look up a running process by PID                                                                                                                                             | pid, name?                                 |
| `process_attach_port`     | Look up a process by port number                                                                                                                                             | port, name?                                |
| `inspect`                 | **AI-safe** bounded, redacted snapshot of one tracked app (status + port health + rss + recent logs + error scan). Best single call for observing BE/FE/worker/console apps. | name, tail?, since?                        |
| `supervisor_control`      | Control the detached supervisor daemon that keeps `--restart` apps alive and health-checks their ports.                                                                      | action: start\|stop\|status\|restart       |
| `persist_control`         | Manage boot persistence (survive reboots) — install/remove a boot unit that starts the supervisor at login.                                                                  | action: enable\|disable\|status            |

## Examples

```typescript
// Spawn a dev server
const proc = await toolRegistry.call('process_spawn', {
  command: 'node',
  args: ['server.js'],
  name: 'my-api',
});
// Returns: { processId: "...", pid: 12345, name: "my-api", startedAt: "..." }

// Wait for ready
const ready = await toolRegistry.call('process_wait_for_ready', {
  processId: 'my-api',
  pattern: 'listening on port',
  timeout: 30000,
});
// Returns: { ready: true, elapsed: N, matchedLine: "..." }

// Get error logs
const logs = await toolRegistry.call('process_get_logs', {
  processId: 'my-api',
  level: 'error',
  lines: 50,
});
// Returns: { logs: [...], count: N, errorCount: N }

// Attach to existing process by port
const attached = await toolRegistry.call('process_attach_port', {
  port: 3000,
  name: 'existing-server',
});
// Returns: { processId: "existing-server", pid: N, command: "node", port: 3000 }
```

## Bulk ops, groups & memory parity (CLI ↔ core)

The CLI (`fennec start/kill/stop/spawn/restart/ps`) and these MCP tools are kept in
sync — same behavior, same flags:

- **Multiple names at once** — pass `names: ["be-crm","fe-crm"]` (or space-separated
  positionals on the CLI) for one-shot bulk ops. Already-running entries are skipped
  ("already running"); already-stopped ones too ("skipped").
- **Logical groups** — tag apps with `process_spawn({ group })` / `fennec start --group`,
  or retroactively with `process_set_group` / `fennec group <name> <g>`. Then scope bulk
  ops to just that group: `process_kill({ group })`, `process_stop_tracked({ group })`,
  `process_spawn_tracked({ group })`, `process_restart({ group })`, `fennec ps --group <g>`.
- **`--all` is GLOBAL** — `process_kill({ all: true })` / `fennec kill --all` hits **every**
  tracked app across all groups. Grouped `stop --all` is intentionally not supported.
- **Memory (MEM)** — `process_get_tracked` and `process_get_status` return a cross-platform
  `memMB` (resident RSS), and `fennec ps` shows a live **MEM** column, so you can spot
  leaks from long-lived apps. Process-tree kills (POSIX `kill(-pid)` / Windows `taskkill /T /F`)
  mean no orphaned children are left "nyampah".

## AI-safe observability

These tools are designed so an AI agent can observe real apps (BE, FE, worker,
console) cheaply and predictably, without leaking secrets into its context window
and **without wasting tokens**:

- **Bounded output (hard caps).** `inspect` returns at most **200** log lines;
  `process_get_logs` at most **500**. Both are tightened further when the AI
  context exposes a token budget (`ToolContext.tokenBudget`), so a tool call can
  never fill the context window. Requesting a larger count is silently clamped.
- **No overlap / no duplicates.** Both tools support a **watermark** (`sinceOffset`
  byte offset). In watch mode they return ONLY lines written after the watermark
  — so repeated polling streams new lines without re-sending old ones. Stick to
  ONE tool per app (prefer `inspect` for observation) to keep watermarks consistent.
- **Secrets redacted.** `process_get_logs` and `inspect` redact secrets (API keys,
  bearer tokens, JWTs, DB connection strings, PEM private keys) before returning.
  The redacted shape is preserved (e.g. `mongodb://a…[REDACTED]host`) so logs stay
  debuggable.
- `supervisor_control` lets the agent ensure resilience: the supervisor keeps
  `--restart` apps alive even after the MCP server exits, and restarts apps that
  are alive but not listening on their port.
- `persist_control` makes that resilience survive reboots.

```typescript
// Cheap, safe observation of one app (capped ≤200 lines, secrets redacted)
const snap = await toolRegistry.call('inspect', { name: 'my-api', tail: 40 });
// Returns: { running, pid, port, portHealthy, uptimeSec, rssMb,
//            logTail: [...], watermark, errorCount, errors: [...], redacted: true,
//            capped: boolean }

// Real-time watching WITHOUT re-downloading the whole file (token-efficient):
// poll with the watermark from the previous response.
const w1 = await toolRegistry.call('inspect', { name: 'my-api', watch: true });
// w1.newLines = only lines written so far, w1.watermark = byte offset
const w2 = await toolRegistry.call('inspect', {
  name: 'my-api',
  watch: true,
  sinceOffset: w1.watermark,
});
// w2.newLines = ONLY lines written since w1 (no duplicates, no full re-read)

// Ensure auto-restart resilience is active
await toolRegistry.call('supervisor_control', { action: 'start' });
const sup = await toolRegistry.call('supervisor_control', { action: 'status' });
// Returns: { running, pid, managedApps: [{ name, running, pid }] }

// Survive reboot
await toolRegistry.call('persist_control', { action: 'enable' });
```

## Security

- `process_spawn` requires `config.security.allowProcessSpawn` (default: `true`)
- `process_kill` requires `config.security.allowProcessKill` (default: `false`)
- The spawn allowlist restricts which commands can be run (default: `["npm", "node", "pnpm"]`)
- `process_get_logs` and `inspect` redact secrets by default (best-effort) to keep
  AI context windows safe. Use the CLI (`--no-redact`) only for trusted, local debugging.

## Log Level Detection

Process logs are automatically classified into levels using pattern matching:

| Level     | Patterns                                                           |
| --------- | ------------------------------------------------------------------ |
| `error`   | `error`, `Error`, `ERROR`, `ERR!`, `fatal`, `trace`, `stack trace` |
| `warn`    | `warning`, `WARN`, `WARNING`, `warn`                               |
| `info`    | `info`, `INFO`, `log`, `info:`, `[INFO]`                           |
| `debug`   | `debug`, `DEBUG`, `[DEBUG]`, `[debug]`                             |
| `unknown` | Default for unclassified lines                                     |
