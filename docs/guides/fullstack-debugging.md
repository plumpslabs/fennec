# Full-Stack Debugging

Fennec's signature feature is the ability to correlate events across browser, server, and terminal layers. This guide shows how to use it effectively.

## The Problem

When debugging "why is my login broken?", developers typically:

1. Open browser devtools → copy console error
2. Switch to terminal → copy server log
3. Check network tab → copy failed request
4. Paste all to AI agent

With Fennec, this becomes a single command.

## Setup: Connect Server Logs

### Option A: Pipe (Recommended)

```bash
# Start server with Fennec watching
npm run dev 2>&1 | fennec pipe --name "dev-server"
```

### Option B: Attach by Port

```bash
# Attach to running server
fennec attach-port 3000 --name "dev-server"
```

## Single-Command Diagnosis

```javascript
// The crown jewel of Fennec
diagnose_fullstack({ processId: "dev-server" })

// Output:
{
  "browser": {
    "consoleErrors": [
      "TypeError: Cannot read properties of undefined (reading 'token')"
    ],
    "networkFailures": [
      { "url": "/api/auth/login", "status": 500 }
    ]
  },
  "server": {
    "recentErrors": [
      "[ERROR] JWT_SECRET environment variable is not set"
    ],
    "processStatus": { "running": true }
  },
  "correlation": {
    "timeline": [
      { "t": "+0ms",   "layer": "browser",  "event": "POST /api/auth/login initiated" },
      { "t": "+12ms",  "layer": "server",   "event": "Request received" },
      { "t": "+13ms",  "layer": "server",   "event": "ERROR: JWT_SECRET not set" },
      { "t": "+15ms",  "layer": "browser",  "event": "500 response received" },
      { "t": "+16ms",  "layer": "browser",  "event": "TypeError: token undefined" }
    ],
    "rootCause": "JWT_SECRET environment variable missing on server",
    "confidence": 0.94,
    "fix": "Add JWT_SECRET to your .env file"
  }
}
```

## Step-by-Step Debugging

### Step 1: Diagnose Page State

```javascript
diagnose_page({ focus: "errors" })
// Get current URL, console errors, network failures
```

### Step 2: Deep-Dive Console

```javascript
devtools_get_console_logs({ level: "error" })
devtools_get_js_errors({ limit: 5 })
```

### Step 3: Deep-Dive Network

```javascript
network_get_failed_requests()
network_get_logs({ status: 500 })
network_get_cors_issues()
```

### Step 4: Check Server

```javascript
process_get_status({ processId: "dev-server" })
process_get_logs({ processId: "dev-server", level: "error" })
```

### Step 5: Full Correlation

```javascript
diagnose_fullstack({ processId: "dev-server" })
```

## Common Bug Patterns

### Pattern 1: Server Error -> Browser Error

```
diagnose_fullstack:
  browser: TypeError in auth.js
  server:  Error: Database connection failed
  root cause: "Server error caused network failure (confidence: 0.90)"
  fix: "Check server logs for unhandled exceptions"
```

### Pattern 2: Missing Env Var

```
diagnose_fullstack:
  browser: 500 on API call
  server:  Error: JWT_SECRET not set
  root cause: "Missing environment variable (confidence: 0.88)"
  fix: "Add JWT_SECRET to .env file"
```

### Pattern 3: Network Failure -> JS Error

```
diagnose_fullstack:
  browser: TypeError: cannot read 'data'
  network: POST /api/users failed (503)
  root cause: "Network failure caused JS error (confidence: 0.85)"
  fix: "Ensure API is reachable and returning valid data"
```

## Best Practices

1. **Always pipe server output**: Use `| fennec pipe --name "dev-server"` when starting your dev server
2. **Start with `diagnose_fullstack`**: It gives you the full picture in one call
3. **Use `diagnose_page` for quick checks**: When you just need browser state
4. **Correlate timestamps**: The timeline shows exact ordering of events
5. **Check confidence scores**: High confidence (>0.85) root causes are usually accurate
