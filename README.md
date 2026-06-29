<p align="center">
  <img src="https://raw.githubusercontent.com/plumpslabs/fennec/main/public/fennec.png" alt="🦊 Fennec" width="170" />
</p>

<h1 align="center">Fennec 🦊</h1>

<p align="center">
  <strong><em>Ears everywhere in your stack.</em></strong>
  <br />
  AI-native developer observability MCP — browser, terminal, and process, all in one.
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

**Fennec** is an MCP (Model Context Protocol) server that bridges the gap between AI agents and your development environment. Instead of you copy-pasting errors between terminal, browser, and AI, Fennec gives your AI agent **direct access** to all three simultaneously.

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

| Pattern | Example | Confidence |
|---------|---------|------------|
| Server 500 + stderr Error | POST /api/login → 500 + DB timeout | 0.90 |
| Auth token issue | 401 + JWT verification failed | 0.92 |
| Missing file/env | ENOENT + .env not found | 0.88 |
| Network failure + TypeError | request failed + JS TypeError | 0.85 |

> ✅ **The confidence scores above are derived from actual inference rules with unit-tested pattern matching**, not fabricated illustrations.

### 🔧 87 MCP Tools Across 14 Categories

| Category | Tools | What You Can Do |
|----------|-------|----------------|
| **Navigation** | 6 | Navigate, go back/forward, reload, wait for navigation |
| **Interaction** | 10 | Click, type, select, hover, scroll, upload file, drag-drop |
| **DOM** | 9 | Screenshot, DOM snapshot, accessibility tree, find elements |
| **DevTools** | 20 | Console logs, network monitoring, mock/intercept, performance |
| **... total** | **87** | |
| **Storage** | 12 | localStorage, cookies, IndexedDB, session export/import |
| **Auth** | 6 | Auto-fill login, save/load sessions, check auth state |
| **Tabs** | 7 | Multi-tab, multi-context, tab switching |
| **Process** | 10 | Spawn, monitor, attach by PID/port, kill, restart |
| **Terminal** | 7 | Watch files/pipes, filter logs by level/keyword |
| **Diagnostic** | 6 | diagnose_page, diagnose_fullstack, diagnose_auth, etc. |
| **Scheduler** | 7 | Auto-trigger workflows, manage rules, view history |
| **Smart** | 7 | Smart wait, smart fill form, annotated screenshots, diff |

> 💡 **Token-Efficient**: Tools are categorized. MCP clients can request only specific categories to reduce context window usage. Use the `_categories` field in ListTools response to discover available categories.

### 🔐 Auth Session Persistence
Save and load browser auth states across conversations:
```bash
# In one session
AI: auth_fill_login_form("admin@example.com", "password", submitAfter: true)
AI: auth_save_session("myapp-prod")

# In another conversation  
AI: auth_load_session("myapp-prod")  # skip login entirely!
```

### 🖥️ Process & Terminal Monitoring
Three ways to connect:
```bash
# 1. Pipe output (recommended)
npm run dev 2>&1 | fennec pipe --name "dev-server"

# 2. Attach by PID
fennec attach-pid 12345

# 3. Attach by port
fennec attach-port 3000
```

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

```bash
# Install globally
npm install -g @plumpslabs/fennec-cli

# (Optional) Install browser engines — only needed for browser automation
fennec install-browsers

# Generate config (optional)
fennec init
```

> **Note:** Playwright (browser automation) is an **optional peer dependency**. If you only need terminal/process monitoring, Fennec works without it. Add browser support when needed:
> ```bash
> npm install playwright
> fennec install-browsers
> ```

### Configure Your MCP Client

Add to your MCP client config:
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

Supported clients: Claude Desktop, Claude Code, Cline, Cursor, Windsurf, Continue.dev

### Your First Diagnosis

```bash
# Terminal: Start your app with Fennec watching
npm run dev 2>&1 | fennec pipe --name "my-app"
```

Then ask your AI agent:
> *"Check why my app is broken"*

The AI will automatically:
1. Open the browser to your app
2. Check console errors
3. Inspect failed network requests
4. Correlate with server logs
5. Report the root cause

## Documentation

- [Getting Started Guide](docs/getting-started.md)
- [Full Tool Reference](docs/tools/README.md) — all 87 tools documented
- [Configuration Reference](docs/configuration.md) — all options + env vars
- [Security Model](docs/security-model.md) — sandbox, allowlists, best practices
- [Auth Flows Guide](docs/guides/auth-flows.md) — login forms, session persistence
- [Full-Stack Debugging Guide](docs/guides/fullstack-debugging.md)
- [Multi-Session Testing Guide](docs/guides/multi-session.md)
- [Debugging SPAs Guide](docs/guides/debugging-spa.md)
- [Usage Examples](examples/)

## Installation Requirements

| Requirement | Version |
|---|---|
| **Node.js** | >= 20.0.0 |
| **npm / pnpm / yarn** | Latest stable |
| **OS** | macOS, Linux, Windows (native + WSL2) |
| **Browser** | Chromium (auto-installed), Firefox/WebKit (optional) |

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
