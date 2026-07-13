# Debug API Error Example

Demonstrates Fennec's **cross-layer correlation** — when an API call fails, Fennec can simultaneously check the browser console, network tab, and server logs to identify the root cause in one shot.

## Tools Used

| Tool                             | Purpose                                 |
| -------------------------------- | --------------------------------------- |
| `browser_navigate`               | Open the app                            |
| `browser_click` / `browser_type` | Interact with the page                  |
| `network_get_failed_requests`    | Check failed API calls                  |
| `devtools_get_console_logs`      | Read browser JS errors                  |
| `diagnose_page`                  | Unified page diagnostic                 |
| `diagnose_fullstack`             | Browser + server correlation (flagship) |
| `process_get_logs`               | Check server-side errors                |
| `browser_screenshot`             | Capture error state visually            |

---

## Scenario: Diagnose a 500 API Error

### Setup — Observe the App

First, ensure Fennec's process layer is watching the server logs:

```bash
# Terminal A: Start dev server piped to Fennec
npm run dev 2>&1 | fennec pipe --name "dev-server"

# Terminal B: AI agent with Fennec MCP
# Now the AI can see both browser AND server logs
```

### Step 1 — Interact with the App

**Request:**

```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "http://localhost:3000/login"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"finalUrl\":\"http://localhost:3000/login\",\"statusCode\":200,\"loadTime\":856}}"
    }
  ]
}
```

### Step 2 — Click Login and Get an Error

**Request:**

```json
{
  "name": "browser_click",
  "arguments": {
    "selector": "button[type='submit']"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"elementFound\":true,\"coordinates\":{\"x\":640,\"y\":400}}}"
    }
  ]
}
```

### Step 3 — Diagnose Page-Level Issues

**Request:**

```json
{
  "name": "diagnose_page",
  "arguments": {
    "focus": "errors"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"page\":{\"url\":\"http://localhost:3000/login\",\"title\":\"Login Page\",\"readyState\":\"complete\"},\"consoleErrors\":[\"TypeError: Cannot read properties of undefined (reading 'token')\",\"Uncaught (in promise) Error: Login failed\"],\"networkFailures\":[{\"url\":\"http://localhost:3000/api/auth/login\",\"method\":\"POST\",\"status\":500,\"duration\":234,\"requestHeaders\":{\"content-type\":\"application/json\"},\"timestamp\":\"2026-06-28T10:00:05.000Z\"}],\"performance\":null,\"summary\":{\"errorCount\":2,\"failedRequests\":1}},\"meta\":{\"elapsed\":150,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:06.000Z\"}}"
    }
  ]
}
```

**What we know so far:**

- ❌ Network: `POST /api/auth/login` → **500**
- ❌ Console: `TypeError: Cannot read properties of undefined (reading 'token')`
- ❌ Console: `Uncaught (in promise) Error: Login failed`

### Step 4 — Full-Stack Diagnosis (Flagship)

Now correlate browser errors with server logs:

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
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"browser\":{\"url\":\"http://localhost:3000/login\",\"title\":\"Login Page\",\"consoleErrors\":[\"TypeError: Cannot read properties of undefined (reading 'token')\",\"Uncaught (in promise) Error: Login failed\"],\"networkFailures\":[{\"url\":\"http://localhost:3000/api/auth/login\",\"method\":\"POST\",\"status\":500,\"duration\":234}]},\"server\":{\"recentErrors\":[\"[ERROR] JWT_SECRET environment variable is not set (server.js:23)\",\"[ERROR] /api/auth/login - 500 Internal Server Error\"],\"processStatus\":{\"running\":true,\"uptime\":340,\"pid\":12345}},\"correlation\":{\"rootCause\":\"Missing environment variable or file\",\"confidence\":0.88,\"fix\":\"Check if required env vars and files exist\"}},\"meta\":{\"elapsed\":200,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:07.000Z\"}}"
    }
  ]
}
```

**Deeper analysis:** The correlation engine matched the pattern `env` + `500` from both layers:

| Timestamp | Layer   | Event                                                |
| --------- | ------- | ---------------------------------------------------- |
| +0ms      | Browser | `POST /api/auth/login` initiated                     |
| +12ms     | Server  | Request received at auth router                      |
| +13ms     | Server  | `[ERROR] JWT_SECRET environment variable is not set` |
| +14ms     | Server  | `500` response sent                                  |
| +15ms     | Browser | Network failure (500) received                       |
| +16ms     | Browser | `TypeError` thrown in auth.js                        |

**Root cause found!** 🔍 The server is missing the `JWT_SECRET` environment variable.

### Step 5 — Fix and Verify

Set the environment variable, restart, and verify:

**Request:**

```json
{
  "name": "process_send_input",
  "arguments": {
    "processId": "dev-server",
    "input": "JWT_SECRET=my-secret-key npm run dev"
  }
}
```

Actually, it's easier to restart the process with the env var set:

**Request:**

```json
{
  "name": "process_kill",
  "arguments": {
    "processId": "dev-server",
    "signal": "SIGTERM"
  }
}
```

Then re-spawn with the env var:

```json
{
  "name": "process_spawn",
  "arguments": {
    "command": "npm",
    "args": ["run", "dev"],
    "env": { "JWT_SECRET": "my-secret-key" },
    "name": "dev-server"
  }
}
```

### Step 6 — Verify the Fix

**Request:**

```json
{
  "name": "process_wait_for_ready",
  "arguments": {
    "processId": "dev-server",
    "pattern": "listening on port",
    "timeout": 15000
  }
}
```

Then navigate and try again:

```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "http://localhost:3000/login"
  }
}
```

---

## Advanced: Network Mocking for Testing

You can mock API responses to test error handling without a running server:

**Request:**

```json
{
  "name": "network_mock_response",
  "arguments": {
    "urlPattern": "/api/auth/login",
    "statusCode": 500,
    "body": "{\"error\":\"Server maintenance\"}",
    "contentType": "application/json"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"mockId\":\"mock_1719500000_a1b2c3\",\"active\":true}}"
    }
  ]
}
```

Now every request to `/api/auth/login` returns the mock 500 response. Remove it with:

```json
{
  "name": "network_remove_intercept",
  "arguments": {
    "interceptorId": "mock_1719500000_a1b2c3"
  }
}
```

---

## Diagnostic Tool Comparison

| Tool                   | What It Checks                                  | Best For                          |
| ---------------------- | ----------------------------------------------- | --------------------------------- |
| `diagnose_page`        | Console errors + network failures + performance | Quick page health check           |
| `diagnose_network`     | Failed, slow, and CORS-blocked requests         | Network-specific debugging        |
| `diagnose_auth`        | Auth cookies, token presence, expiry            | Login state verification          |
| `diagnose_element`     | Element visibility, interactability             | Why can't I click this?           |
| `diagnose_fullstack`   | Browser + server + correlation **combined**     | Finding root causes across layers |
| `diagnose_performance` | FCP, LCP, CLS metrics + recommendations         | Performance optimization          |

---

## Troubleshooting

| Issue                       | Cause                      | Fix                                                                                       |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `processStatus: null`       | `processId` not linked     | Use `process_list` to find the correct ID, or pipe output with `fennec pipe --name X`     |
| No console errors           | Console buffer cleared     | Check `devtools_get_console_logs` with `since` parameter                                  |
| Correlation `confidence: 0` | No matching patterns found | Manual correlation — compare timestamps between `network_get_logs` and `process_get_logs` |
| Network buffer empty        | Intercept not enabled      | Network logs are collected automatically when CDP session is active                       |
