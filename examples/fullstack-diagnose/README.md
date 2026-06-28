# Full-Stack Diagnosis Example

Demonstrates Fennec's **process + terminal + browser integration** — the complete workflow: spawn a dev server, watch its logs, control the browser, and correlate everything when something breaks.

This is Fennec's most powerful workflow — what sets it apart from any other MCP tool.

## Tools Used

| Tool | Purpose |
|---|---|
| `process_spawn` | Start a dev server |
| `process_wait_for_ready` | Wait for server readiness |
| `process_get_logs` | Read server logs |
| `process_get_status` | Check process health |
| `process_restart` | Restart with new config |
| `process_kill` | Stop a process |
| `terminal_watch_file` | Watch log files |
| `terminal_watch_pipe` | Watch piped output |
| `browser_navigate` | Open the app in browser |
| `browser_click` / `browser_type` | Interact with the app |
| `diagnose_fullstack` | Correlate browser + server |
| `devtools_get_console_logs` | Read browser JS errors |
| `network_get_failed_requests` | Check network failures |

---

## Setup: Two Approaches

### Approach A — Pipe Output (Recommended for Existing Servers)

The developer runs their server as usual, piping output to Fennec:

```bash
npm run dev 2>&1 | fennec pipe --name "dev-server"
```

This creates a watcher named `dev-server` that captures all stdout+stderr. The AI can then query it with `process_get_logs` or `terminal_get_logs`.

### Approach B — AI Spawns the Process (Fully Automated)

The AI spawns and manages the server directly using `process_spawn`.

---

## Scenario A: Spawn Server → Wait for Ready → Open Browser

### Step 1 — Spawn Dev Server

**Request:**
```json
{
  "name": "process_spawn",
  "arguments": {
    "command": "npm",
    "args": ["run", "dev"],
    "cwd": "/home/user/myapp",
    "name": "dev-server"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"processId\":\"dev-server\",\"pid\":12345,\"name\":\"dev-server\",\"startedAt\":\"2026-06-28T10:00:00.000Z\"}}"
  }]
}
```

### Step 2 — Wait for Server to Be Ready

**Request:**
```json
{
  "name": "process_wait_for_ready",
  "arguments": {
    "processId": "dev-server",
    "pattern": "listening on port|ready|started|compiled",
    "timeout": 30000
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"ready\":true,\"elapsed\":3240,\"matchedLine\":\"[INFO] Server listening on port 3000\"}}"
  }]
}
```

Server is ready in 3.24 seconds!

### Step 3 — Verify Process Health

**Request:**
```json
{
  "name": "process_get_status",
  "arguments": {
    "processId": "dev-server"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"running\":true,\"pid\":12345,\"uptime\":4}}"
  }]
}
```

### Step 4 — Open Browser and Navigate to the App

**Request:**
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "http://localhost:3000",
    "waitUntil": "networkidle"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"finalUrl\":\"http://localhost:3000\",\"statusCode\":200,\"loadTime\":450}}"
  }]
}
```

### Step 5 — View Recent Server Logs

**Request:**
```json
{
  "name": "process_get_logs",
  "arguments": {
    "processId": "dev-server",
    "lines": 10
  }
}
```

**Response (abbreviated):**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"logs\":[{\"line\":\"[INFO] Starting development server...\",\"level\":\"info\",\"timestamp\":\"2026-06-28T10:00:01.000Z\"},{\"line\":\"[INFO] Server listening on port 3000\",\"level\":\"info\",\"timestamp\":\"2026-06-28T10:00:03.000Z\"},{\"line\":\"[INFO] GET / 200 12ms\",\"level\":\"info\",\"timestamp\":\"2026-06-28T10:00:05.000Z\"}],\"count\":3,\"errorCount\":0}}"
  }]
}
```

---

## Scenario B: Something Breaks — Full-Stack Diagnosis

### Step 1 — Interact with the App

```json
{
  "name": "browser_click",
  "arguments": {
    "selector": "button:has-text('Submit')"
  }
}
```

### Step 2 — Capture Browser State

```json
{
  "name": "browser_screenshot",
  "arguments": {
    "format": "png",
    "fullPage": false
  }
}
```

### Step 3 — Get Browser Console Errors

```json
{
  "name": "devtools_get_console_logs",
  "arguments": {
    "level": "error",
    "limit": 10
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"logs\":[{\"level\":\"error\",\"message\":\"Uncaught TypeError: Cannot read properties of null (reading 'email')\",\"source\":\"app.js:145\",\"timestamp\":\"2026-06-28T10:01:00.000Z\"}],\"errorCount\":1,\"warnCount\":0,\"summary\":\"1 JS error(s) detected\"}}"
  }]
}
```

### Step 4 — Get Failed Network Requests

```json
{
  "name": "network_get_failed_requests",
  "arguments": {}
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"requests\":[{\"url\":\"http://localhost:3000/api/users/999\",\"method\":\"GET\",\"status\":500,\"duration\":312}],\"count\":1}}"
  }]
}
```

### Step 5 — Get Server Logs for the Same Timeframe

```json
{
  "name": "process_get_logs",
  "arguments": {
    "processId": "dev-server",
    "level": "error",
    "limit": 10
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"logs\":[{\"line\":\"[ERROR] TypeError: Cannot read properties of null (reading 'email')\",\"level\":\"error\",\"timestamp\":\"2026-06-28T10:01:00.000Z\"},{\"line\":\"[ERROR] GET /api/users/999 - 500 (12ms)\",\"level\":\"error\",\"timestamp\":\"2026-06-28T10:01:00.000Z\"}],\"count\":2,\"errorCount\":2}}"
  }]
}
```

### Step 6 — Run diagnose_fullstack for Correlation

**Request:**
```json
{
  "name": "diagnose_fullstack",
  "arguments": {
    "processId": "dev-server"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"browser\":{\"url\":\"http://localhost:3000/users\",\"title\":\"User Profile\",\"consoleErrors\":[\"Uncaught TypeError: Cannot read properties of null (reading 'email')\"],\"networkFailures\":[{\"url\":\"http://localhost:3000/api/users/999\",\"method\":\"GET\",\"status\":500,\"duration\":312}]},\"server\":{\"recentErrors\":[\"[ERROR] TypeError: Cannot read properties of null (reading 'email')\",\"[ERROR] GET /api/users/999 - 500 (12ms)\"],\"processStatus\":{\"running\":true,\"uptime\":120,\"pid\":12345}},\"correlation\":{\"rootCause\":\"Server error caused network failure\",\"confidence\":0.9,\"fix\":\"Check server logs for unhandled exceptions\"}}}"
  }]
}
```

The correlation is clear:
- **Browser error** occurs because the API returns 500
- **Server error** shows the root cause: `TypeError: Cannot read properties of null (reading 'email')` — likely user ID `999` doesn't exist
- **Confidence: 0.9** — highly likely the server error caused the network failure

### Step 7 — Fix and Restart

Fix the code, then restart:

```json
{
  "name": "process_restart",
  "arguments": {
    "processId": "dev-server"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"processId\":\"dev-server\",\"pid\":12346,\"startedAt\":\"2026-06-28T10:02:00.000Z\"}}"
  }]
}
```

The old process (PID 12345) was killed and a new one (PID 12346) spawned with the same configuration.

---

## Scenario C: Monitor with Log Files

If your app writes to log files instead of stdout:

### Step 1 — Watch a Log File

```json
{
  "name": "terminal_watch_file",
  "arguments": {
    "filePath": "/home/user/myapp/logs/app.log",
    "name": "app-log",
    "follow": true
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"watcherId\":\"app-log\",\"name\":\"app-log\"}}"
  }]
}
```

### Step 2 — Get Error-Level Logs

```json
{
  "name": "terminal_get_errors",
  "arguments": {
    "watcherId": "app-log",
    "since": "2026-06-28T10:00:00.000Z"
  }
}
```

### Step 3 — Search for Specific Keywords

```json
{
  "name": "terminal_get_logs",
  "arguments": {
    "watcherId": "app-log",
    "keyword": "error",
    "lines": 20
  }
}
```

### Step 4 — Clear Buffer to Reset

```json
{
  "name": "terminal_clear_buffer",
  "arguments": {
    "watcherId": "app-log"
  }
}
```

---

## Process Lifecycle Diagram

```
SPAWN ──► WAIT_FOR_READY ──► RUNNING ──► KILL
  │                            │            │
  │                            ├── RESTART ─┤
  │                            │            │
  │                            ▼            │
  │                        GET_LOGS         │
  │                        GET_STATUS       │
  │                        SEND_INPUT       │
  │                                          │
  └──────────────────────────────────────────┘
```

| State | Description | Available Tools |
|---|---|---|
| **SPAWNED** | Process started, PID allocated | `process_get_status`, `process_get_logs` |
| **READY** | Matched ready pattern | All browser tools |
| **RUNNING** | Normal operation | `process_send_input`, `process_restart`, `process_kill` |
| **EXITED** | Process terminated | `process_list` shows `running: false` |

---

## Use Cases

| Use Case | Description |
|---|---|
| **CI/CD debugging** | Spawn the build, capture errors, diagnose why it failed |
| **Dev server management** | AI manages the full dev workflow — start, test, fix, restart |
| **Log analysis** | Watch log files, search for patterns, correlate with browser errors |
| **Remote debugging** | Attach to a process on a remote server by PID or port |
| **Automated testing** | Spawn test server → run tests → kill server — all through MCP |

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `SPAWN_FAILED` | Command not in spawn allowlist | Add the command to `security.spawnAllowlist` in config |
| `PROCESS_NOT_FOUND` | Wrong process ID | Use `process_list` to see all managed processes |
| Process never becomes ready | Pattern doesn't match | Try a broader pattern like `"started\|listening\|ready\|compiled\|running"` |
| `ELEMENT_NOT_FOUND` on page | Server not ready yet | Check `process_get_status` and wait for ready pattern |
| Process won't kill | Missing `allowProcessKill: true` | Set `security.allowProcessKill: true` in config (disabled by default) |
