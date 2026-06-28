# Fennec
### *Ears everywhere in your stack.*

> **Tagline:** The AI-native developer observability MCP — browser, terminal, and process, all in one.  
> **Version:** 0.1.0-draft  
> **Status:** Blueprint  
> **License:** MIT (planned)

---

## Table of Contents

1. [Identity & Philosophy](#1-identity--philosophy)
2. [Problem Statement](#2-problem-statement)
3. [What Fennec Is (and Is Not)](#3-what-fennec-is-and-is-not)
4. [Tech Stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [Mode of Operation](#6-mode-of-operation)
7. [Tool Groups & Full Specification](#7-tool-groups--full-specification)
8. [Session Management](#8-session-management)
9. [Process & Terminal Layer](#9-process--terminal-layer)
10. [Cross-Layer Correlation Engine](#10-cross-layer-correlation-engine)
11. [Error Handling Strategy](#11-error-handling-strategy)
12. [Security Model](#12-security-model)
13. [Project Structure](#13-project-structure)
14. [Differentiator Matrix](#14-differentiator-matrix)
15. [Developer Experience Design](#15-developer-experience-design)
16. [Roadmap](#16-roadmap)
17. [OSS Contribution Guide](#17-oss-contribution-guide)
18. [Full Configuration Reference](#18-full-configuration-reference)

---

## 1. Identity & Philosophy

### Name
**Fennec** — the fennec fox. Tiny, fast, and famous for its oversized ears that can hear prey moving underground. That's exactly what this tool does: hear everything happening beneath your stack — browser, terminal, server process — and surface it to your AI agent in real-time.

### Logo Concept
Small fennec fox silhouette, ears up, minimal line art. Works well as npm icon, GitHub avatar, and CLI ASCII banner.

```
  /\   /\
 (  o o  )    fennec v0.1.0
 =( Y )=      ears everywhere in your stack.
   )   (
```

### Core Philosophy

**1. AI-Native First**  
Every tool, every response, every error message is designed to be consumed by an AI agent — not a human reading logs. This means bundled context, structured output, actionable suggestions, not raw stack traces.

**2. Zero Workflow Change**  
Developer runs their server the way they always do. Fennec listens. No mandatory wrappers, no forced changes to how you work. Optional enhancements available, never required.

**3. Observe Everything, Control What You Want**  
Fennec can observe passively (watch logs, monitor browser) or act actively (spawn process, drive browser, fill forms). Developer chooses the level of AI autonomy per session.

**4. Modular but Unified**  
Browser layer, terminal layer, process layer — each works independently. But when used together, Fennec correlates across all of them for insights no single-layer tool can provide.

---

## 2. Problem Statement

### What AI Agents Can't Do Today

When a developer asks an AI agent "why is my login broken?", the agent is essentially blind:

```
What agent sees:          What developer sees:
─────────────────         ──────────────────────────────────
"I can't access           Browser Console:
 your terminal"             ✗ TypeError: jwt.sign is undefined
                          
"Please paste the         Terminal:
 error message"             ✗ Error: JWT_SECRET not set in env
                          
"I don't have            Network Tab:
 browser access"            ✗ POST /api/login → 500
```

The developer ends up being a **copy-paste bridge** between their tools and the AI. This is the problem Fennec solves.

### The Real Developer Loop (Broken)

```
Bug appears
    → Open browser devtools
    → Check console (copy error)
    → Paste to AI
    → Check network tab (copy request)
    → Paste to AI
    → Switch to terminal (copy server log)
    → Paste to AI
    → AI gives suggestion
    → Try fix
    → Repeat
```

### With Fennec

```
Bug appears
    → "Fennec, why is login broken?"
    → AI checks browser console + network + server log simultaneously
    → AI correlates: "Server missing JWT_SECRET, set it in .env"
    → Fix. Done.
```

---

## 3. What Fennec Is (and Is Not)

### Is
- MCP server that gives AI agents **full-stack observability**
- Browser automation + DevTools access (via Playwright + CDP)
- Terminal process spawning + log streaming
- Cross-layer correlation engine
- Session persistence for auth flows
- AI-native error enrichment

### Is Not
- A replacement for Playwright (uses it as engine)
- An E2E testing framework (no test runner, no assertions DSL)
- A monitoring/APM tool for production (dev-time only)
- A code editor integration (no LSP, no VS Code extension — yet)
- A security scanner or CI/CD pipeline tool

---

## 4. Tech Stack

### ✅ Chosen

| Layer | Technology | Reason |
|---|---|---|
| Runtime | **Node.js 20+ LTS** | Best ecosystem for browser automation |
| Language | **TypeScript 5+** | Type safety, contributor-friendly, great DX |
| Browser Engine | **Playwright** | First-class CDP, multi-browser, official support |
| MCP SDK | **@modelcontextprotocol/sdk** | Official Anthropic SDK |
| CDP Access | **Playwright CDPSession** | Native, no extra library |
| Process Management | **node:child_process** | Native Node.js, no dependencies |
| Log Streaming | **node:fs (FSWatcher) + chokidar** | Reliable cross-platform file watching |
| IPC | **Named pipes + Unix sockets** | Fast, low-latency process communication |
| Schema Validation | **Zod** | Runtime input validation per tool |
| Logging | **pino** | Structured, low-overhead |
| Testing | **Vitest** | Fast, TypeScript-native |
| Build | **tsup** | Zero-config TS bundler |
| Package Manager | **pnpm** | Efficient, fast |
| CLI | **@clack/prompts** | Beautiful CLI prompts for setup |

### ❌ Rejected

| Technology | Reason |
|---|---|
| Go | playwright-go unofficial, CDP access limited, MCP SDK not official |
| Puppeteer | Playwright superset in every dimension |
| Selenium | Legacy, no native CDP |
| Official Playwright MCP | Doesn't expose DevTools, storage, network layer |
| Python | MCP ecosystem smaller, deployment friction for end-users |
| Bun | Compatibility risks for OSS tool, too early |
| Express/Fastify | No HTTP server needed, MCP via stdio/SSE |
| PM2 | Overkill for process management at this layer |

### Runtime Requirements
```
Node.js    >= 20.0.0
pnpm       >= 8.0.0
OS         Linux, macOS, Windows (WSL2 recommended)
Browser    Chromium (auto-installed via Playwright)
           Firefox, WebKit (optional)
```

---

## 5. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                     AI Agent / LLM                            │
│           (Claude, GPT-4, or any MCP-compatible client)       │
└───────────────────────────┬───────────────────────────────────┘
                            │ MCP Protocol (stdio / SSE)
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                      Fennec MCP Server                        │
│                                                               │
│  ┌────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │ Tool Registry  │  │ Input Validator  │  │Response Builder│ │
│  │ (auto-discover)│  │  (Zod schemas)   │  │(AI-friendly)  │  │
│  └────────────────┘  └─────────────────┘  └───────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Cross-Layer Correlation Engine              │  │
│  │     (browser events ↔ terminal logs ↔ process state)    │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────┬────────────────────┬──────────────────┬────────────┘
           │                    │                  │
           ▼                    ▼                  ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Browser Layer  │  │  Process Layer   │  │  Terminal Layer  │
│                 │  │                  │  │                  │
│  Playwright     │  │  child_process   │  │  Log Watcher     │
│  + CDPSession   │  │  spawn/attach    │  │  (file/pipe/sock)│
└────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                    │                      │
         └────────────────────┴──────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Event Bus        │
                    │ (internal pub/sub) │
                    └────────────────────┘
```

### Transport Layer
```
stdio    → default, development, local agent CLI
SSE      → remote access, web-based agents
Future   → WebSocket
```

### Internal Event Bus
Semua layer publish events ke internal bus. Correlation engine subscribe ke semua dan build unified timeline:

```typescript
// Events yang di-publish
"browser:console"      → { level, message, source, timestamp }
"browser:network"      → { method, url, status, duration }
"browser:error"        → { message, stackTrace }
"process:stdout"       → { processId, line, timestamp }
"process:stderr"       → { processId, line, timestamp }
"process:exit"         → { processId, code, signal }
"terminal:log"         → { source, line, timestamp }
```

---

## 6. Mode of Operation

Fennec mendukung dua mode yang bisa dikombinasikan:

### Mode 1 — Observe (Passive)
AI hanya mendengarkan. Developer jalankan server seperti biasa.

```
Developer:
  Terminal A: npm run dev          ← developer yang jalanin
  Terminal B: claude (agent)       ← AI observe saja

Setup:
  Option A: pipe output ke Fennec
    npm run dev 2>&1 | fennec watch --name "dev-server"

  Option B: attach ke process yang sudah jalan
    fennec attach --pid 12345
    fennec attach --port 3000      ← auto-detect process by port

  Option C: watch log file
    fennec watch --file ./logs/app.log
```

### Mode 2 — Control (Active)
AI yang spawn dan manage process.

```
Developer:
  Terminal A: claude (agent)       ← AI yang handle segalanya
  
AI akan:
  1. spawn npm run dev
  2. tunggu server ready
  3. buka browser
  4. jalankan task yang diminta
  5. report hasilnya
```

### Mode 3 — Hybrid (Recommended Default)
Developer spawn server, AI kontrol browser + observe logs.

```
Developer:
  Terminal A: npm run dev | fennec watch --name "dev-server"
  Terminal B: claude (agent)

AI bisa:
  ✅ Baca server logs real-time
  ✅ Kontrol browser penuh
  ✅ Korelasi browser error dengan server log
  ❌ Tidak bisa kill/restart server (developer yang kontrol)
```

---

## 7. Tool Groups & Full Specification

Semua tool mengikuti konvensi response:

```typescript
// Success
{
  success: true,
  data: { ... },
  meta: { elapsed: number, sessionId: string, timestamp: string }
}

// Error
{
  success: false,
  error: {
    code: string,
    message: string,
    suggestions: string[],
    context: { screenshot?, currentUrl?, serverLogs?, consoleLogs? }
  }
}
```

---

### 7.1 Navigation Tools

| Tool | Input | Output |
|---|---|---|
| `browser_navigate` | `url, waitUntil?, timeout?` | `{ success, finalUrl, statusCode, loadTime }` |
| `browser_go_back` | `sessionId?` | `{ success, currentUrl }` |
| `browser_go_forward` | `sessionId?` | `{ success, currentUrl }` |
| `browser_reload` | `hardReload?, sessionId?` | `{ success, loadTime }` |
| `browser_get_current_url` | `sessionId?` | `{ url, title, readyState }` |
| `browser_wait_for_navigation` | `urlPattern?, timeout?` | `{ success, finalUrl, elapsed }` |

---

### 7.2 Interaction Tools

| Tool | Input | Output |
|---|---|---|
| `browser_click` | `selector, button?, clickCount?` | `{ success, elementFound, coordinates }` |
| `browser_type` | `selector, text, delay?, clear?` | `{ success, elementFound, valueAfter }` |
| `browser_select` | `selector, value` | `{ success, selectedValue, allOptions }` |
| `browser_hover` | `selector` | `{ success, coordinates }` |
| `browser_scroll` | `x?, y?, selector?, direction?` | `{ success, scrollPosition }` |
| `browser_press_key` | `key, modifiers?` | `{ success }` |
| `browser_upload_file` | `selector, filePath` | `{ success, fileName, fileSize }` |
| `browser_drag_drop` | `sourceSelector, targetSelector` | `{ success }` |
| `browser_focus` | `selector` | `{ success }` |
| `browser_clear` | `selector` | `{ success, previousValue }` |

**Selector Strategy (ARIA-first, auto-fallback):**
```
1. ARIA role + accessible name   ← paling robust untuk AI
2. data-testid / data-fennec-id
3. text content match
4. CSS selector
5. XPath                         ← last resort
```

---

### 7.3 DOM & Page Tools

| Tool | Input | Output |
|---|---|---|
| `browser_screenshot` | `fullPage?, selector?, format?` | `{ base64, width, height, timestamp }` |
| `browser_get_dom_snapshot` | `selector?, includeStyles?` | `{ html, elementCount, depth }` |
| `browser_get_accessibility_tree` | `selector?` | `{ tree, interactableElements[] }` |
| `browser_find_elements` | `selector, returnAttributes?` | `{ elements[], count, firstVisible }` |
| `browser_get_element_info` | `selector` | `{ exists, visible, enabled, text, attributes, boundingBox }` |
| `browser_wait_for_element` | `selector, state?, timeout?` | `{ success, elapsed, finalState }` |
| `browser_get_page_text` | `selector?` | `{ text, wordCount }` |
| `browser_get_page_title` | — | `{ title }` |
| `browser_get_meta` | — | `{ title, description, ogTags, canonical }` |

---

### 7.4 DevTools — Console ⭐

| Tool | Input | Output |
|---|---|---|
| `devtools_get_console_logs` | `level?, limit?, since?, keyword?` | `{ logs[], errorCount, warnCount, summary }` |
| `devtools_clear_console` | — | `{ cleared, previousCount }` |
| `devtools_evaluate` | `expression, awaitResult?` | `{ result, type, error?, consoleOutput? }` |
| `devtools_get_js_errors` | `since?, limit?` | `{ errors[], count, lastError }` |
| `devtools_watch_console` | `durationMs, level?` | `{ logs[], summary }` |

**Example output `devtools_get_console_logs`:**
```json
{
  "logs": [
    {
      "level": "error",
      "message": "Uncaught TypeError: Cannot read properties of undefined (reading 'token')",
      "source": "auth.js:67:12",
      "timestamp": "2024-01-15T10:23:45.123Z",
      "stackTrace": [
        "at getToken (auth.js:67)",
        "at login (Login.jsx:34)"
      ]
    }
  ],
  "errorCount": 1,
  "warnCount": 2,
  "summary": "1 JS error detected — likely auth token handling issue at auth.js:67"
}
```

---

### 7.5 DevTools — Network ⭐

| Tool | Input | Output |
|---|---|---|
| `network_get_logs` | `status?, method?, urlPattern?, limit?` | `{ requests[], failedCount, slowCount }` |
| `network_get_failed_requests` | `since?` | `{ requests[], count }` |
| `network_wait_for_request` | `urlPattern, method?, timeout?` | `{ request, response, elapsed }` |
| `network_intercept` | `urlPattern, response` | `{ interceptorId, active }` |
| `network_remove_intercept` | `interceptorId` | `{ success }` |
| `network_mock_response` | `urlPattern, statusCode, body, headers?` | `{ mockId }` |
| `network_get_request_detail` | `requestId` | `{ request, response, timing, size }` |
| `network_get_cors_issues` | — | `{ issues[], count }` |
| `network_clear_logs` | — | `{ cleared }` |

---

### 7.6 DevTools — Performance

| Tool | Input | Output |
|---|---|---|
| `devtools_get_performance_metrics` | — | `{ FCP, LCP, TBT, CLS, TTI, memoryUsage }` |
| `devtools_get_memory_usage` | — | `{ jsHeapSize, totalSize, limit, domNodes }` |
| `devtools_start_profiling` | `categories?` | `{ profileId }` |
| `devtools_stop_profiling` | `profileId` | `{ profile, topFunctions[], duration }` |
| `devtools_get_dom_counters` | — | `{ nodes, documents, frames }` |
| `devtools_simulate_network` | `condition` | `{ applied }` |

**Network conditions:** `offline`, `slow-3g`, `fast-3g`, `4g`, `reset`

---

### 7.7 Storage Tools ⭐

| Tool | Input | Output |
|---|---|---|
| `storage_get_local` | `key?` | `{ value \| allItems, size }` |
| `storage_set_local` | `key, value` | `{ success, previousValue }` |
| `storage_remove_local` | `key` | `{ success }` |
| `storage_clear_local` | — | `{ success, clearedCount }` |
| `storage_get_session` | `key?` | `{ value \| allItems }` |
| `storage_set_session` | `key, value` | `{ success }` |
| `storage_get_cookies` | `name?, domain?` | `{ cookies[], count }` |
| `storage_set_cookie` | `name, value, options?` | `{ success }` |
| `storage_delete_cookie` | `name, domain?` | `{ success }` |
| `storage_export_state` | `filePath?` | `{ cookies, localStorage, sessionStorage, savedAt }` |
| `storage_import_state` | `filePath \| stateObject` | `{ success, cookiesRestored, itemsRestored }` |
| `storage_get_indexeddb` | `dbName, storeName?` | `{ databases[], records? }` |

---

### 7.8 Auth Tools ⭐

| Tool | Input | Output |
|---|---|---|
| `auth_fill_login_form` | `username, password, submitAfter?` | `{ success, formFound, fieldsDetected }` |
| `auth_save_session` | `name, filePath?` | `{ sessionId, savedAt, expiresHint? }` |
| `auth_load_session` | `name \| filePath` | `{ success, cookiesLoaded, storageLoaded }` |
| `auth_list_sessions` | — | `{ sessions[], count }` |
| `auth_delete_session` | `name` | `{ success }` |
| `auth_check_logged_in` | `indicators?` | `{ loggedIn, confidence, detectedIndicators }` |

**Auth flow example:**
```
→ browser_navigate(loginUrl)
→ auth_fill_login_form(username, password, submitAfter=true)
→ network_wait_for_request("/api/auth/token")
→ auth_check_logged_in()           { loggedIn: true }
→ auth_save_session("myapp-prod")

--- next conversation ---
→ auth_load_session("myapp-prod")  ← skip login entirely
```

---

### 7.9 Tab & Context Tools

| Tool | Input | Output |
|---|---|---|
| `tab_new` | `url?` | `{ tabId, sessionId }` |
| `tab_close` | `tabId` | `{ success }` |
| `tab_list` | — | `{ tabs[], activeTabId }` |
| `tab_switch` | `tabId` | `{ success, url, title }` |
| `tab_get_current` | — | `{ tabId, url, title }` |
| `context_new` | `options?` | `{ contextId }` |
| `context_close` | `contextId` | `{ success }` |

---

### 7.10 Process Tools ⭐

| Tool | Input | Output |
|---|---|---|
| `process_spawn` | `command, args?, cwd?, env?, name?` | `{ processId, pid, name, startedAt }` |
| `process_attach_pid` | `pid, name?` | `{ processId, name, cmdline }` |
| `process_attach_port` | `port, name?` | `{ processId, pid, name }` |
| `process_list` | — | `{ processes[], count }` |
| `process_get_logs` | `processId, lines?, level?, since?` | `{ logs[], errorCount }` |
| `process_get_status` | `processId` | `{ running, pid, uptime, memoryMB, cpuPercent }` |
| `process_send_input` | `processId, input` | `{ success }` |
| `process_restart` | `processId` | `{ success, newPid, startedAt }` |
| `process_kill` | `processId, signal?` | `{ success }` |
| `process_wait_for_ready` | `processId, pattern?, timeout?` | `{ ready, elapsed, matchedLine }` |

**Example — AI spawning dev server:**
```json
// process_spawn
{
  "command": "npm",
  "args": ["run", "dev"],
  "cwd": "/home/user/myapp",
  "name": "dev-server"
}

// process_wait_for_ready
{
  "processId": "dev-server",
  "pattern": "listening on port",
  "timeout": 30000
}
// → { ready: true, elapsed: 3240, matchedLine: "Server listening on port 3000" }
```

---

### 7.11 Terminal/Log Watcher Tools ⭐

| Tool | Input | Output |
|---|---|---|
| `terminal_watch_file` | `filePath, name?, follow?` | `{ watcherId, name }` |
| `terminal_watch_pipe` | `pipePath, name?` | `{ watcherId, name }` |
| `terminal_get_logs` | `watcherId, lines?, since?, keyword?` | `{ logs[], count }` |
| `terminal_get_errors` | `watcherId, since?` | `{ errors[], count }` |
| `terminal_list_watchers` | — | `{ watchers[], count }` |
| `terminal_stop_watcher` | `watcherId` | `{ success }` |
| `terminal_clear_buffer` | `watcherId` | `{ cleared }` |

**Cara attach ke server yang sudah jalan:**
```bash
# Developer jalankan server seperti biasa
npm run dev 2>&1 | fennec pipe --name "dev-server"

# Atau attach by port
fennec attach-port 3000 --name "dev-server"

# AI agent bisa langsung query
terminal_get_logs({ watcherId: "dev-server", lines: 50 })
```

---

### 7.12 Diagnostic Tools ⭐⭐ (Signature Feature)

| Tool | Input | Output |
|---|---|---|
| `diagnose_page` | `focus?` | Full bundled context (see below) |
| `diagnose_element` | `selector` | `{ exists, visible, interactable, reason?, suggestions[] }` |
| `diagnose_network` | `since?` | `{ failedRequests, slowRequests, corsIssues, summary }` |
| `diagnose_auth` | — | `{ isAuthenticated, tokenFound, cookiesPresent, expiryInfo }` |
| `diagnose_fullstack` | `processId?` | Browser + server logs + process state bundled |
| `diagnose_performance` | — | `{ score, issues[], recommendations[] }` |

**`diagnose_fullstack` — Fennec's crown jewel:**
```json
{
  "browser": {
    "consoleErrors": [
      "TypeError: Cannot read properties of undefined (reading 'token')"
    ],
    "networkFailures": [
      { "url": "/api/auth/login", "status": 500, "duration": 234 }
    ],
    "screenshot": "<base64>"
  },
  "server": {
    "recentErrors": [
      "[ERROR] JWT_SECRET environment variable is not set (server.js:23)"
    ],
    "processStatus": { "running": true, "memoryMB": 145, "uptime": 340 }
  },
  "correlation": {
    "timeline": [
      { "t": "+0ms",   "layer": "browser",  "event": "POST /api/auth/login initiated" },
      { "t": "+12ms",  "layer": "server",   "event": "Request received at auth router" },
      { "t": "+13ms",  "layer": "server",   "event": "ERROR: JWT_SECRET not set" },
      { "t": "+14ms",  "layer": "server",   "event": "500 response sent" },
      { "t": "+15ms",  "layer": "browser",  "event": "Network failure received" },
      { "t": "+16ms",  "layer": "browser",  "event": "TypeError thrown in auth.js:67" }
    ],
    "rootCause": "JWT_SECRET environment variable missing on server",
    "confidence": 0.94,
    "fix": "Add JWT_SECRET to your .env file"
  }
}
```

---

## 8. Session Management

```typescript
interface FennecSession {
  id: string
  name?: string
  createdAt: Date
  lastUsedAt: Date
  browser: Browser
  context: BrowserContext
  page: Page
  cdpSession: CDPSession
  consoleBuffer: ConsoleEvent[]
  networkBuffer: NetworkEvent[]
  metadata: {
    tags?: string[]
    savedStatePath?: string
    linkedProcessId?: string    // correlate dengan process log
  }
}
```

### Multi-Session Use Case
```
session "user-admin"   → login sebagai admin, test admin features
session "user-regular" → login sebagai user biasa, test permissions
→ AI bisa switch antar session, test cross-user interactions
```

### Session Lifecycle
```
fennec_session_create
  → [use tools]
    → auth_save_session (optional, persist auth state)
      → fennec_session_destroy

next time:
fennec_session_create
  → auth_load_session   ← skip login
    → [continue work]
```

---

## 9. Process & Terminal Layer

### Attach Strategies

**Strategy A — Pipe (recommended):**
```bash
npm run dev 2>&1 | fennec pipe --name dev-server
```

**Strategy B — Attach by PID:**
```bash
fennec attach-pid 12345 --name dev-server
```

**Strategy C — Attach by Port:**
```bash
fennec attach-port 3000 --name dev-server
# auto-detect process listening on port 3000
```

**Strategy D — Spawn (AI-controlled):**
```
process_spawn({ command: "npm", args: ["run", "dev"], name: "dev-server" })
process_wait_for_ready({ processId: "dev-server", pattern: "listening on" })
```

### Log Buffer
- Per-process ring buffer, default 2000 lines
- Metadata: timestamp, level (auto-detect ERROR/WARN/INFO dari pattern), raw line
- Auto-detect common log formats: pino, winston, morgan, console.log, Next.js, Vite, NestJS

### Level Auto-Detection
```typescript
// Fennec auto-tag log levels dari pattern
const patterns = {
  error: /error|Error|ERROR|exception|Exception|fatal|FATAL|✗|×/,
  warn:  /warn|Warn|WARN|warning|⚠/,
  info:  /info|Info|INFO|ready|Ready|listening|started|✓|✔/,
  debug: /debug|Debug|DEBUG|verbose/,
}
```

---

## 10. Cross-Layer Correlation Engine

### Cara Kerja

Semua layer publish ke internal EventBus dengan timestamp presisi:

```typescript
class CorrelationEngine {
  // Window dalam ms untuk menganggap event "berkaitan"
  private correlationWindowMs = 500

  correlate(trigger: Event): CorrelatedTimeline {
    // Ambil semua events dalam window sekitar trigger
    const window = this.getEventsInWindow(
      trigger.timestamp - this.correlationWindowMs,
      trigger.timestamp + this.correlationWindowMs
    )

    return {
      trigger,
      relatedEvents: window,
      timeline: this.buildTimeline(window),
      rootCause: this.inferRootCause(window),
      confidence: this.calculateConfidence(window)
    }
  }
}
```

### Root Cause Inference Rules

```typescript
const inferencRules = [
  {
    pattern: "browser:network:500 + server:stderr:Error",
    rootCause: "Server error caused network failure",
    confidence: 0.9
  },
  {
    pattern: "browser:network:401 + server:stderr:JWT",
    rootCause: "Authentication token issue",
    confidence: 0.92
  },
  {
    pattern: "browser:console:TypeError + browser:network:failed",
    rootCause: "Network failure caused JS error",
    confidence: 0.85
  },
  {
    pattern: "server:stderr:ENOENT + process:env:missing",
    rootCause: "Missing environment variable or file",
    confidence: 0.88
  }
]
```

---

## 11. Error Handling Strategy

### Prinsip
- **Tidak ada unhandled exception** yang sampai ke MCP layer
- **Setiap error adalah structured response** dengan `success: false`
- **Setiap error punya suggestions** yang actionable untuk AI agent
- **Error penting auto-attach screenshot** dari browser state saat itu

### Error Codes

```
# Browser
ELEMENT_NOT_FOUND          → selector tidak ditemukan
ELEMENT_NOT_INTERACTABLE   → ada tapi tidak bisa di-interact (hidden, disabled)
NAVIGATION_FAILED          → halaman gagal load
NAVIGATION_TIMEOUT         → load melebihi batas waktu
FRAME_DETACHED             → iframe hilang saat operasi

# Network
NETWORK_INTERCEPT_FAILED   → gagal setup intercept
REQUEST_TIMEOUT            → request tidak datang dalam timeout
CORS_BLOCKED               → request diblok CORS

# Process
PROCESS_NOT_FOUND          → processId tidak valid
PROCESS_ALREADY_DEAD       → process sudah tidak jalan
SPAWN_FAILED               → gagal spawn command
ATTACH_FAILED              → gagal attach ke PID/port

# Storage
STORAGE_ACCESS_DENIED      → cross-origin atau private mode
SESSION_NOT_FOUND          → sessionId tidak valid
STATE_FILE_NOT_FOUND       → file state untuk import tidak ada

# General
INVALID_INPUT              → Zod validation gagal
CDP_ERROR                  → Chrome DevTools Protocol error
TIMEOUT                    → generic timeout
UNKNOWN                    → unexpected error (always logged)
```

### Error Response Example
```json
{
  "success": false,
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "Selector '#submit-btn' not found after 5000ms",
    "suggestions": [
      "Try increasing the timeout with the timeout parameter",
      "Check if element is inside an iframe — use tab_list to see frames",
      "Run devtools_evaluate('document.querySelector(\"#submit-btn\")') to debug",
      "Check if the page is still loading with browser_get_current_url"
    ],
    "context": {
      "currentUrl": "https://example.com/login",
      "pageTitle": "Login Page",
      "readyState": "complete",
      "screenshot": "<base64>"
    }
  },
  "meta": {
    "elapsed": 5012,
    "sessionId": "sess_abc123",
    "timestamp": "2024-01-15T10:23:50.135Z"
  }
}
```

---

## 12. Security Model

### Threat Model
Fennec memberikan akses yang sangat powerful: browser control, process spawn, file system (terbatas), network. Harus ada boundary yang jelas.

### Default Security Posture (Sandbox ON)

```yaml
security:
  sandbox: true

  # Process
  allowProcessSpawn: true           # AI bisa spawn process
  allowProcessKill: false           # AI tidak bisa kill process yang bukan dia spawn
  allowProcessAttach: true          # AI bisa attach ke process yang sudah jalan
  spawnAllowlist:                   # command yang boleh di-spawn (kosong = semua)
    - "npm"
    - "node"
    - "pnpm"
    - "yarn"
    - "bun"

  # Browser
  allowedDomains: []                # kosong = semua domain
  blockedDomains: []
  allowFileProtocol: false          # file:// URL

  # Storage
  exportPath: "./.fennec/exports"   # hanya bisa export ke sini
  maxExportSizeMB: 10

  # CDP
  allowCDPRawAccess: false          # raw CDP tool (advanced)
  allowJSEvaluation: true           # devtools_evaluate
```

### Yang Tidak Pernah Diekspos
- Akses ke file di luar `exportPath`
- Credential dari OS password manager
- Akses ke session browser pengguna lain di OS
- Kemampuan install browser extension
- Raw OS command execution (hanya via allowlist)

---

## 13. Project Structure

```
fennec/
├── packages/
│   ├── core/                          # MCP server utama
│   │   ├── src/
│   │   │   ├── index.ts               # Entry point
│   │   │   ├── server.ts              # MCP server setup
│   │   │   │
│   │   │   ├── session/
│   │   │   │   ├── SessionManager.ts
│   │   │   │   ├── SessionStore.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── tools/
│   │   │   │   ├── _registry.ts       # Auto-discover semua tools
│   │   │   │   ├── navigation/
│   │   │   │   ├── interaction/
│   │   │   │   ├── dom/
│   │   │   │   ├── devtools/
│   │   │   │   │   ├── console.ts
│   │   │   │   │   ├── network.ts
│   │   │   │   │   └── performance.ts
│   │   │   │   ├── storage/
│   │   │   │   ├── auth/
│   │   │   │   ├── tabs/
│   │   │   │   ├── process/
│   │   │   │   ├── terminal/
│   │   │   │   └── diagnostic/
│   │   │   │
│   │   │   ├── cdp/
│   │   │   │   ├── CDPManager.ts
│   │   │   │   ├── ConsoleCollector.ts
│   │   │   │   ├── NetworkCollector.ts
│   │   │   │   └── PerformanceCollector.ts
│   │   │   │
│   │   │   ├── process/
│   │   │   │   ├── ProcessManager.ts
│   │   │   │   ├── LogWatcher.ts
│   │   │   │   ├── PipeWatcher.ts
│   │   │   │   └── PortDetector.ts
│   │   │   │
│   │   │   ├── correlation/
│   │   │   │   ├── EventBus.ts
│   │   │   │   ├── CorrelationEngine.ts
│   │   │   │   ├── RootCauseInferrer.ts
│   │   │   │   └── Timeline.ts
│   │   │   │
│   │   │   ├── response/
│   │   │   │   ├── ResponseBuilder.ts
│   │   │   │   └── ErrorEnricher.ts
│   │   │   │
│   │   │   ├── config/
│   │   │   │   ├── ConfigLoader.ts
│   │   │   │   └── defaults.ts
│   │   │   │
│   │   │   └── utils/
│   │   │       ├── selector.ts
│   │   │       ├── screenshot.ts
│   │   │       ├── levelDetector.ts
│   │   │       └── logger.ts
│   │   │
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── e2e/
│   │   │
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                           # fennec CLI (pipe, attach, watch)
│       ├── src/
│       │   ├── index.ts
│       │   ├── commands/
│       │   │   ├── pipe.ts            # fennec pipe --name X
│       │   │   ├── attach-pid.ts      # fennec attach-pid 1234
│       │   │   ├── attach-port.ts     # fennec attach-port 3000
│       │   │   └── watch.ts           # fennec watch --file ./app.log
│       │   └── utils/
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── getting-started.md
│   ├── tools/                         # Satu file per tool group
│   ├── guides/
│   │   ├── auth-flows.md
│   │   ├── debugging-spa.md
│   │   ├── fullstack-debugging.md
│   │   └── multi-session.md
│   └── examples/
│
├── examples/
│   ├── login-flow/
│   ├── debug-api-error/
│   ├── multi-user-test/
│   └── fullstack-diagnose/
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── publish.yml
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

---

## 14. Differentiator Matrix

| Feature | **Fennec** | Playwright MCP | Puppeteer MCP | Browser-use | Browserbase |
|---|---|---|---|---|---|
| Basic browser automation | ✅ | ✅ | ✅ | ✅ | ✅ |
| Screenshot | ✅ | ✅ | ✅ | ✅ | ✅ |
| Console logs (deep) | ✅ | ❌ | ❌ | ❌ | Partial |
| Network monitoring | ✅ Full | ❌ | ❌ | Partial | Partial |
| Network mock/intercept | ✅ | ❌ | ❌ | ❌ | ❌ |
| localStorage R/W | ✅ | ❌ | ❌ | ❌ | ❌ |
| IndexedDB access | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cookie management | ✅ Full | ❌ | Partial | Partial | Partial |
| Auth session persist | ✅ Named | ❌ | ❌ | Partial | ❌ |
| CDP raw access | ✅ | ❌ | ❌ | ❌ | ❌ |
| Performance metrics | ✅ | ❌ | ❌ | ❌ | ❌ |
| Process spawn | ✅ | ❌ | ❌ | ❌ | ❌ |
| Terminal log watch | ✅ | ❌ | ❌ | ❌ | ❌ |
| Full-stack correlation | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI-friendly error ctx | ✅ Bundled | ❌ | ❌ | Partial | Partial |
| diagnose_fullstack | ✅ | ❌ | ❌ | ❌ | ❌ |
| Multi-session parallel | ✅ | ❌ | ❌ | Partial | ✅ |
| ARIA-first selector | ✅ | Partial | ❌ | Partial | Partial |
| Open source | ✅ MIT | ✅ Apache | ✅ MIT | ✅ MIT | ❌ |

---

## 15. Developer Experience Design

### Install (Target: < 2 minutes)

```bash
# Install
npm install -g @fennec/cli

# Install browsers
fennec install-browsers

# Add to your MCP client (Claude Desktop, etc.)
fennec setup
```

### Claude Desktop Config (auto-generated by `fennec setup`)
```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"],
      "env": {
        "FENNEC_CONFIG": "./fennec.config.yaml"
      }
    }
  }
}
```

### Zero Config Default
Tanpa config file, Fennec berjalan dengan safe defaults:
- Headless Chromium
- stdio transport
- Sandbox mode ON
- 1 default session

### With Config
```bash
fennec init    # generate fennec.config.yaml
```

### CLI Commands
```bash
fennec start                        # start MCP server
fennec start --transport sse        # SSE mode
fennec pipe --name dev-server       # pipe stdin to log watcher
fennec attach-pid 12345             # attach to process
fennec attach-port 3000             # attach by port
fennec watch --file ./logs/app.log  # watch log file
fennec sessions                     # list saved sessions
fennec setup                        # configure MCP client
fennec install-browsers             # install Playwright browsers
```

---

## 16. Roadmap

### v0.1 — Foundation
- [ ] MCP server boilerplate (stdio)
- [ ] Navigation + Interaction tools
- [ ] Screenshot tool
- [ ] Basic console log collection
- [ ] Default session management
- [ ] Standard error format + enrichment

### v0.2 — DevTools Layer
- [ ] Full console collector (buffer, filter, watch)
- [ ] Network log collector + mock/intercept
- [ ] Performance metrics
- [ ] `diagnose_page` tool
- [ ] `diagnose_network` tool

### v0.3 — Storage & Auth
- [ ] localStorage / sessionStorage CRUD
- [ ] Cookie management
- [ ] IndexedDB read
- [ ] Session export/import
- [ ] Named session persistence
- [ ] `auth_fill_login_form` auto-detect
- [ ] `auth_check_logged_in`

### v0.4 — Process & Terminal Layer
- [ ] `process_spawn` + `process_wait_for_ready`
- [ ] `process_attach_pid` + `process_attach_port`
- [ ] Log watcher (file, pipe)
- [ ] Log level auto-detection
- [ ] `terminal_*` tools
- [ ] `fennec pipe` CLI command

### v0.5 — Correlation Engine
- [ ] Internal EventBus
- [ ] Cross-layer timeline builder
- [ ] Root cause inferrer (rule-based)
- [ ] `diagnose_fullstack` tool
- [ ] Confidence scoring

### v0.6 — Advanced
- [ ] Multi-tab management
- [ ] CDP raw access tool
- [ ] Network throttling simulation
- [ ] File upload support
- [ ] SSE transport
- [ ] Multi-session parallel support

### v0.7 — OSS Polish
- [ ] Full docs per tool
- [ ] Example guides
- [ ] Configuration reference
- [ ] Security sandbox hardening
- [ ] Docker image
- [ ] GitHub Actions CI/CD

### v1.0 — Stable
- [ ] All v0.x features stable
- [ ] 80%+ test coverage
- [ ] Performance benchmarks
- [ ] Semantic versioning
- [ ] Published: `npm install -g @fennec/cli`

---

## 17. OSS Contribution Guide

### Principles
- Every new tool: implementation + Zod schema + unit test + docs
- All responses follow standard format (`success/error`)
- No unhandled exceptions reaching MCP layer
- Selector strategy must be ARIA-first
- AI-friendly: every error has `suggestions[]`

### Adding a New Tool

```typescript
// packages/core/src/tools/mygroup/my-tool.ts

import { z } from "zod"
import { createTool } from "../../_registry"

export const myTool = createTool({
  name: "mygroup_myaction",
  description: `
    One-line description for AI agent.
    When to use: describe the use case.
    Returns: describe what AI agent will get.
  `,
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID, uses default if omitted"),
    myParam: z.string().describe("What this param does for the AI agent")
  }),
  handler: async (input, { sessionManager, logger }) => {
    const session = await sessionManager.getOrDefault(input.sessionId)
    try {
      // implementation
      return {
        success: true,
        data: { /* ... */ },
        meta: sessionManager.buildMeta(session)
      }
    } catch (error) {
      return sessionManager.buildError(error, session, {
        suggestions: [
          "Actionable hint for AI agent",
          "Another hint"
        ]
      })
    }
  }
})
```

### Branch & Commit Convention
```
main          → stable
dev           → integration
feat/*        → new feature
fix/*         → bugfix
docs/*        → docs only
perf/*        → performance

feat(storage): add indexeddb read access
fix(network): handle CORS preflight correctly
docs(auth): add session persistence guide
test(console): add filter by keyword coverage
perf(cdp): reduce CDP session overhead
```

---

## 18. Full Configuration Reference

```yaml
# fennec.config.yaml

browser:
  type: chromium              # chromium | firefox | webkit
  headless: true
  slowMo: 0                   # ms delay between actions (useful for debugging)
  defaultTimeout: 30000       # ms
  viewport:
    width: 1280
    height: 720
  userAgent: null             # null = browser default
  locale: "en-US"
  timezone: "Asia/Jakarta"
  ignoreHTTPSErrors: false

session:
  maxSessions: 10
  idleTimeoutSecs: 1800       # auto-cleanup after idle
  persistPath: "./.fennec/sessions"

process:
  maxProcesses: 10
  logBufferLines: 2000        # ring buffer size per process
  spawnAllowlist:             # empty = allow all
    - "npm"
    - "node"
    - "pnpm"
    - "yarn"
    - "bun"
    - "python"
    - "python3"

terminal:
  logBufferLines: 2000
  watchDebounceMs: 50

network:
  bufferSize: 1000            # max requests buffered per session
  captureRequestBody: true
  captureResponseBody: true
  captureHeaders: true
  slowRequestThresholdMs: 1000

console:
  bufferSize: 500
  levels:
    - log
    - info
    - warn
    - error
    - debug

correlation:
  windowMs: 500               # events within this window are correlated
  enableRootCauseInference: true
  minConfidence: 0.7          # minimum confidence to report root cause

security:
  sandbox: true
  allowProcessSpawn: true
  allowProcessKill: false
  allowedDomains: []
  blockedDomains: []
  allowFileProtocol: false
  allowCDPRawAccess: false
  exportPath: "./.fennec/exports"
  maxExportSizeMB: 10

transport:
  type: stdio                 # stdio | sse
  port: 3333                  # SSE only
  host: "127.0.0.1"          # SSE only

logging:
  level: info                 # debug | info | warn | error
  format: pretty              # pretty | json
  file: null                  # null = stdout only
```

---

*Fennec — ears everywhere in your stack.*  
*Blueprint v0.1.0-draft. Living document, updated as development progresses.*
