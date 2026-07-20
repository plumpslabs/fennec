<p align="center">
  <img src="https://raw.githubusercontent.com/plumpslabs/fennec/main/public/fennec.png" alt="🦊 Fennec" width="170" />
</p>

<h1 align="center">Fennec 🦊</h1>

<p align="center">
  <strong><em>Ears everywhere in your stack.</em></strong>
  <br />
  AI-native developer observability MCP — browser, terminal, and <strong>processes</strong>, all in one.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@plumpslabs/fennec-cli"><img src="https://img.shields.io/npm/v/@plumpslabs/fennec-cli" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js" alt="Node.js" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript" alt="TypeScript" /></a>
  <a href="https://pnpm.io"><img src="https://img.shields.io/badge/pnpm-8%2B-F69220?logo=pnpm" alt="pnpm" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" /></a>
  <a href="https://chromium.org"><img src="https://img.shields.io/badge/Browser-Chromium%20%7C%20Firefox%20%7C%20WebKit-blue?logo=googlechrome" alt="Cross-browser" /></a>
</p>

---

## What is Fennec?

**Fennec** is an MCP (Model Context Protocol) server that bridges the gap between AI agents and your development environment. Instead of you copy-pasting errors between terminal, browser, and AI, Fennec gives your AI agent **direct access** to all three simultaneously — and lets it **run and supervise** your apps, not just observe them.

### The Problem It Solves

When a developer asks an AI agent "why is my login broken?", the agent is essentially blind:

```
What agent sees:          What developer sees:
─────────────────         ──────────────────────────────────
"I can't access           Browser Console:
  your terminal"             ✗ TypeError: jwt.sign is undefined

"Please paste the         Terminal:
  error message"             ✗ Error: JWT_SECRET not set in env

"I don't have            Network Tab:
  browser access"            ✗ POST /api/login -> 500
```

The developer ends up being a **copy-paste bridge** between their tools and the AI. Fennec eliminates this bottleneck.

### With Fennec

```
Bug appears
    → AI checks browser console + network + server log simultaneously
    → AI correlates: "Server missing JWT_SECRET, set it in .env"
    → Fix. Done.
```

## Key Features

### 🌐 Full Cross-Browser Support

Fennec supports **Chromium, Firefox, and WebKit** — not just Chromium like many tools. Configure via:

```json
{ "browser": { "type": "firefox" | "webkit" | "chromium" } }
```

Or environment variable: `FENNEC_BROWSER_TYPE=firefox`

### 🏆 Full-Stack Correlation (Proven)

Fennec's signature feature correlates browser errors with server logs to identify root causes automatically. The correlation engine has been tested with **7 integration scenarios** covering real-world patterns:

| Pattern                     | Example                            | Confidence |
| --------------------------- | ---------------------------------- | ---------- |
| Server 500 + stderr Error   | POST /api/login → 500 + DB timeout | 0.90       |
| Auth token issue            | 401 + JWT verification failed      | 0.92       |
| Missing file/env            | ENOENT + .env not found            | 0.88       |
| Database timeout            | JDBC timeout + connection refused  | 0.85       |
| CORS blocked request        | status 0 + blocked by CORS policy  | 0.90       |
| Network failure + TypeError | request failed + JS TypeError      | 0.85       |

> ✅ **The confidence scores above are derived from actual inference rules with unit-tested pattern matching**, not fabricated illustrations.

### 🖥️ Process & App Management — the AI-Native Control Plane

This is what makes Fennec more than an observer. Your AI agent can **run, supervise, and recover** your apps exactly like a senior engineer would — without you pasting logs or running commands by hand:

- **`start` / `run`** — launch any app as a detached, supervised daemon. Logs stream to `~/.fennec/logs/<name>.log`.
- **`--restart`** — auto-restart on crash **or** when the app's port stops answering. The supervisor survives your terminal closing.
- **`dev up`** — idempotent stack orchestration from `fennec.config.yaml`: skips apps already running with unchanged config, restarts ones whose config changed, and **adopts** a process that's already holding a port instead of spawning a conflicting duplicate.
- **`adopt`** — take ownership of a process an AI agent (or you) launched via raw bash, so it's tracked instead of orphaned.
- **Health checks** — HTTP `/health` probes and port liveliness drive restarts; crash-looping apps are flagged as **flapping** instead of spinning forever.
- **`inspect` / `log`** — bounded, redacted, machine-readable views purpose-built for AI consumption.
- **`persist`** — auto-start your stack after reboot/login (systemd user service + linger on Linux, launchd on macOS, startup on Windows).
- **Periodic log rotation** so long-running daemons don't fill your disk.

> 🤖 **Why this matters for agents:** when an agent runs `npm run dev` through raw bash, the process is invisible to Fennec and easy to orphan. With Fennec the agent uses `process_spawn` (idempotent — it adopts an existing process on the same port) or `process_adopt`, and gets structured status, logs, and health back. One tool call instead of five, with no double-starts.

### 🗄️ Database Observation

Connect to local databases (PostgreSQL, MySQL, SQLite), run read-only queries, inspect schema, check health, and get stats. Also supports `rm` (remove saved connection) and `ps` (list saved connections) CLI commands. An auto-start agent runs on connect to keep the sidecar alive. Reconnect without a URL uses the saved credential from OS keychain. Strict mode blocks non-localhost connections by default.

### 🔧 174+ MCP Tools Across 19 Categories

| Category                 | Tools | What You Can Do                                                                                                                   |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Debug**                | 26    | Set breakpoints, inspect variables, auto-debug, record/replay                                                                     |
| **Interaction**          | 10    | Click, type, select, hover, scroll, upload file, drag-drop                                                                        |
| **DOM**                  | 9     | Screenshot, DOM snapshot (token-efficient summary), accessibility tree, find elements                                             |
| **DevTools Console**     | 5     | Console logs, JS errors, watch console (level-based summaries)                                                                    |
| **DevTools Network**     | 9     | Network monitoring, intercept, mock, wait for request                                                                             |
| **DevTools Performance** | 6     | Performance metrics, memory, profiling, simulate network                                                                          |
| **Storage**              | 12    | localStorage, cookies, IndexedDB, session export/import                                                                           |
| **Auth**                 | 6     | Auto-fill login, save/load sessions, check auth state                                                                             |
| **Tabs**                 | 7     | Multi-tab, multi-context, tab switching                                                                                           |
| **Process**              | 25    | Spawn (idempotent/adopt), monitor, attach by PID/port, kill, restart, adopt, supervise, persist, inspect, rename, dev-orchestrate |
| **Terminal**             | 7     | Watch files/pipes, filter logs by level/keyword                                                                                   |
| **Database** 🆕          | 9     | Connect, query, schema, tables, ping, stats, explain, list, disconnect — PostgreSQL, MySQL, SQLite via dbTui sidecar              |
| **Diagnostic**           | 6     | diagnose_page, diagnose_fullstack, diagnose_auth, etc.                                                                            |
| **Scheduler**            | 7     | Auto-trigger workflows, manage rules, view history                                                                                |
| **Smart**                | 7     | Smart wait, smart fill form, annotated screenshots, diff                                                                          |
| **Planner**              | 5     | Execute multi-step goals, plan preview, plan management                                                                           |
| **Mobile**               | 11    | List devices, tap, type, swipe, logcat, screenshot, install APK, launch/stop apps via ADB                                         |
| **AI-Native API** 🆕     | 7     | `observe()`, `ai_diagnose()`, `correlate()`, `summarize()`, `explain()`, `investigate()`, `predict()`                             |
| **Debug** 🆕             | 26    | Breakpoint debugging, logpoints, auto-debug, cassette record/replay, multi-language DAP adapters                                  |

> 💡 **Token-Efficient**: Tools are categorized into 19 groups (including Mobile + AI-Native API + Debug). MCP clients can request only specific categories to reduce context window usage. Use the `_categories` field in ListTools response to discover available categories.

### 🧠 AI-Native API (Pillar 7)

Fennec's AI-Native API replaces browser-centric tools with observation-centric ones — designed for **AI consumption first**:

| Tool            | Purpose                                              | Token Cost       |
| --------------- | ---------------------------------------------------- | ---------------- |
| `observe()`     | Multi-sensor observation (browser, console, network) | ~5-500 tokens    |
| `ai_diagnose()` | Full-stack diagnosis + root cause inference          | ~50 tokens       |
| `correlate()`   | Cross-layer event correlation with timeline          | ~200 tokens      |
| `summarize()`   | Compress logs/events/DOM into insight                | ~100 tokens      |
| `explain()`     | Plain-language explanation of incidents/state        | ~50 tokens       |
| `investigate()` | Deep dive into incidents with Lazy Context Level 2-3 | ~200-2000 tokens |
| `predict()`     | Pattern-based failure prediction                     | ~100 tokens      |

**1 tool call instead of 5. 100x less tokens.**

### 🦊 Lazy Context System — 200x Token Savings

Fennec's Lazy Context system delivers information in levels — AI never receives everything at once:

```
Level 0 (Pulse):  "healthy | 3 warnings | 1 critical"      ~5 tokens    ✅ Always sent
Level 1 (Summary): "Critical: DB timeout"                   ~50 tokens   ⚡ On error/request
Level 2 (Detail):  "POST /login → 500, DB connect failed"   ~200 tokens  🔍 On expand
Level 3 (Raw):     "Raw SQL, raw logs, raw DOM"             ~2000 tokens 📄 On explicit request
```

Config-driven: enable/disable each level via `lazyContext.level1/level2/level3`.

| Scenario         | Before         | After            | Savings  |
| ---------------- | -------------- | ---------------- | -------- |
| Normal operation | 2,000 tokens   | **50 tokens**    | **40x**  |
| Error handling   | 50,000 tokens  | **500 tokens**   | **100x** |
| Full debugging   | 500,000 tokens | **2,500 tokens** | **200x** |

### 🚀 Zero-Dependency Browser Observation

Fennec supports two browser engines — choose based on your needs:

| Engine              | Dependency                         | Best For                                            |
| ------------------- | ---------------------------------- | --------------------------------------------------- |
| **CDP Observer** 🆕 | Zero deps (Node.js built-ins only) | Observation: navigate, screenshot, console, network |
| **Playwright**      | Requires `npm install playwright`  | Full automation: click, type, upload, drag-drop     |

Auto-detection: Fennec tries CDP first (zero-deps). Falls back to Playwright when automation is needed.

Configure via:

```json
{ "browser": { "adapter": "auto" | "cdp" | "playwright" } }
```

### 🔐 Auth Session Persistence

Save and load browser auth states across conversations:

```bash
# In one session
AI: auth_fill_login_form("admin@example.com", "password", submitAfter: true)
AI: auth_save_session("demo-app-prod")

# In another conversation
AI: auth_load_session("demo-app-prod")  # skip login entirely!
```

Sessions persist to a single global store (`~/.fennec`, overridable via `FENNEC_HOME`) and are manageable from **any directory** with the **`fennec store`** command. Run **`fennec doctor`** to catch secret leakage — world-readable permissions, stores living under synced directories (chezmoi/Dropbox/OneDrive), or secrets embedded in tracked launch commands.

### 🔍 Self-Observability

Fennec monitors its own performance — track tool call durations, memory usage, error rates. Use the `PerformanceMetrics` API to check Fennec's health:

```
Total tool calls: 1,234 | Avg duration: 45ms | Error rate: 2.3% | Memory: 128MB
```

### 🛡️ Security Model

- **Sandbox mode ON by default** — blocks dangerous operations
- **Permission per tool** — process spawn, kill, JS evaluation independently configurable
- **Domain allowlist/blocklist** — restrict browser navigation
- **Spawn allowlist** — only allow specific commands (npm, node, etc.)
- **Audit log** — every tool call is logged with timestamp, session, and result
- See [Security Model](docs/security-model.md) for details

## Quick Start

### Installation

<p align="center">
  <a href="https://www.npmjs.com/package/@plumpslabs/fennec-cli">
    <img src="https://img.shields.io/npm/v/@plumpslabs/fennec-cli?label=npm&logo=npm&color=cb3837" alt="npm" />
  </a>
  <a href="https://www.npmjs.com/package/@plumpslabs/fennec-cli">
    <img src="https://img.shields.io/npm/dm/@plumpslabs/fennec-cli?label=downloads&logo=npm&color=cb3837" alt="npm downloads" />
  </a>
</p>

```bash
# Install globally
npm install -g @plumpslabs/fennec-cli

# (Optional) Install browser engines — only needed for browser automation
fennec install-browsers

# Generate config (optional)
fennec init
```

> **Note:** Playwright (browser automation) is an **optional peer dependency**. If you only need terminal/process monitoring, Fennec works without it. Add browser support when needed:
>
> ```bash
> npm install playwright
> fennec install-browsers
> ```

### Configure Your MCP Client

Config format depends on your client:

**OpenCode** (`~/.config/opencode/opencode.json`):

```json
{
  "mcpServers": {
    "fennec": {
      "type": "local",
      "command": ["fennec", "start"],
      "enabled": true
    }
  }
}
```

**Claude Desktop / Cline / Cursor / Windsurf** (standard format):

```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"]
    }
  }
}
```

**For AI-driven process control**, add the permission env vars:

```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"],
      "env": {
        "FENNEC_SECURITY_ALLOW_PROCESS_SPAWN": "true",
        "FENNEC_SECURITY_ALLOW_PROCESS_KILL": "true"
      }
    }
  }
}
```

> For OpenCode, add `"env"` inside the server entry with `"type": "local"` / `"command"` array format.

For **SSE transport** instead of stdio:

```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start", "--sse"]
    }
  }
}
```

OpenCode SSE config:

```json
{
  "mcpServers": {
    "fennec": {
      "type": "remote",
      "url": "http://localhost:3333/sse",
      "enabled": true
    }
  }
}
```

### MCP Client Compatibility

| Client             | stdio | SSE | Notes                                                              |
| ------------------ | :---: | :-: | ------------------------------------------------------------------ |
| **Claude Desktop** |  ✅   | ✅  | stdio default, SSE for remote                                      |
| **Claude Code**    |  ✅   | ✅  | stdio default                                                      |
| **Cline**          |  ✅   | ✅  | stdio default                                                      |
| **Cursor**         |  ✅   | ✅  | stdio default                                                      |
| **Windsurf**       |  ✅   | ✅  | stdio default                                                      |
| **Continue.dev**   |  ⚠️   | ✅  | **Recommended: SSE** — uses `experimental.mcpServers` array format |
| **OpenCode**       |  ✅   | ✅  | stdio (`type: local`), SSE (`type: remote`)                        |

### Your First Diagnosis

```bash
# Terminal: Start your app with Fennec watching
npm run dev 2>&1 | fennec pipe --name "my-app"
```

Then ask your AI agent:

> _"Check why my app is broken"_

The AI will automatically:

1. Open the browser to your app
2. Check console errors
3. Inspect failed network requests
4. Correlate with server logs
5. Report the root cause

### Run an app under Fennec supervision

```bash
# Launch as a supervised daemon (logs to ~/.fennec/logs/api.log)
fennec start node server.js --name api --port 8080 --restart

# Or bring up a whole stack from fennec.config.yaml (idempotent)
fennec dev up
fennec dev status
```

## Documentation

- [Getting Started Guide](docs/getting-started.md) — includes mobile development (wireless ADB)
- [Full Tool Reference](docs/tools/README.md) — all 165+ tools documented
- [Configuration Reference](docs/configuration.md) — all options + env vars
- [Security Model](docs/security-model.md) — sandbox, allowlists, best practices
- [Auth Flows Guide](docs/guides/auth-flows.md) — login forms, session persistence
- [Full-Stack Debugging Guide](docs/guides/fullstack-debugging.md)
- [Multi-Session Testing Guide](docs/guides/multi-session.md)
- [Debugging SPAs Guide](docs/guides/debugging-spa.md)
- [Usage Examples](examples/)

## Installation Requirements

| Requirement           | Version                                              |
| --------------------- | ---------------------------------------------------- |
| **Node.js**           | >= 20.0.0                                            |
| **npm / pnpm / yarn** | Latest stable                                        |
| **OS**                | macOS, Linux, Windows (native + WSL2)                |
| **Browser**           | Chromium (auto-installed), Firefox/WebKit (optional) |

> **Cross-platform note:** Process management (start, ps, adopt, supervisor, `dev up`,
> port discovery) works on Linux, macOS, and Windows. Linux reads `/proc`; macOS uses
> `lsof`/`ps`; Windows uses `netstat`/`tasklist`/`wmic`. On Windows an app's `cwd` isn't
> readable via built-ins, so it shows as empty.

## Environment Variables

| Variable                                           | Effect                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `FENNEC_DATA_DIR`                                  | Override Fennec state/log directory (default `~/.fennec`). |
| `FENNEC_SANDBOX`                                   | `false` disables the sandbox.                              |
| `FENNEC_SECURITY_ALLOW_PROCESS_SPAWN`              | `true` lets the AI spawn processes.                        |
| `FENNEC_SECURITY_ALLOW_PROCESS_KILL`               | `true` lets the AI kill processes (off by default).        |
| `FENNEC_SECURITY_ALLOW_JS_EVALUATION`              | `true` allows in-page JS evaluation.                       |
| `FENNEC_TRANSPORT_TYPE`                            | `stdio` (default) or `sse`.                                |
| `FENNEC_PORT`                                      | SSE port (default `3333`).                                 |
| `FENNEC_BROWSER_TYPE`                              | `chromium` \| `firefox` \| `webkit`.                       |
| `FENNEC_HEADLESS`                                  | `false` to run headed.                                     |
| `FENNEC_DEFAULT_TIMEOUT`                           | Browser default timeout (ms).                              |
| `FENNEC_VIEWPORT_WIDTH` / `FENNEC_VIEWPORT_HEIGHT` | Viewport size.                                             |
| `FENNEC_LOG_LEVEL`                                 | `debug` \| `info` \| `warn` \| `error`.                    |
| `DATABASE_URL`                                     | Database URL fallback for `fennec db connect`              | —   |

See the [CLI README](packages/cli/README.md) for the full command reference.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <small>
    Fennec — <em>Ears everywhere in your stack.</em><br />
    Built with ❤️ for AI-native development
  </small>
</div>
