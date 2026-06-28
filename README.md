# Fennec 🦊

### _Ears everywhere in your stack._

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8%2B-F69220?logo=pnpm)](https://pnpm.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Fennec** is an AI-native developer observability MCP (Model Context Protocol) server that gives AI agents full-stack visibility into your development environment — browser, terminal, and processes — all in one unified interface.

---

## The Problem

When a developer asks an AI agent "why is my login broken?", the agent is essentially blind:

```text
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

## The Solution

With Fennec, your AI agent can:

- 🔍 **Observe** browser console logs, network requests, and performance metrics in real-time
- 🖥️ **Watch** terminal output and server logs without changing your workflow
- ⚙️ **Control** browser sessions — navigate, click, type, screenshot, and more
- 🔗 **Correlate** events across layers to identify root causes automatically
- 🔐 **Persist** authentication sessions across conversations
- 🧩 **Diagnose** full-stack issues with a single command

## Modes of Operation

Fennec supports three modes, which can be combined:

### 👀 Observe (Passive)
Developer runs their server normally, Fennec listens passively.

```bash
# Pipe server output to Fennec
npm run dev 2>&1 | fennec pipe --name "dev-server"

# Or attach to an existing process
fennec attach-pid 12345
fennec attach-port 3000
```

### 🎮 Control (Active)
AI spawns and manages processes directly.

```bash
# AI can:
# 1. Spawn npm run dev
# 2. Wait for server ready
# 3. Open browser
# 4. Execute tasks
# 5. Report results
```

### 🔀 Hybrid (Recommended)
Developer spawns server, AI controls browser + observes logs.

```bash
# Terminal A: Run server
npm run dev 2>&1 | fennec pipe --name "dev-server"

# Terminal B: AI agent has full visibility
```

## Features

### Browser Automation
- Navigation & interaction (click, type, scroll, drag-drop)
- DOM queries, accessibility tree, element inspection
- Multi-tab and multi-context support
- Screenshots (full page, element, viewport)

### DevTools Integration
- **Console**: Real-time log collection, filtering, error tracking
- **Network**: Full request/response monitoring, interception, mocking
- **Performance**: FCP, LCP, TBT, CLS metrics, memory profiling
- **Storage**: localStorage, sessionStorage, cookies, IndexedDB

### Authentication & Sessions
- Auto-detect and fill login forms
- Save/load authenticated sessions across conversations
- Multi-session parallel testing (e.g., admin + regular user)

### Process & Terminal
- Spawn, monitor, and interact with processes
- Attach to running processes by PID or port
- Watch log files and pipe streams
- Auto-detect log levels (error, warn, info, debug)

### 🏆 Full-Stack Correlation
Fennec's signature feature — correlate browser errors with server logs and process state to identify root causes automatically.

```json
{
  "correlation": {
    "rootCause": "JWT_SECRET environment variable missing on server",
    "confidence": 0.94,
    "fix": "Add JWT_SECRET to your .env file",
    "timeline": [
      { "t": "+0ms",   "layer": "browser",  "event": "POST /api/auth/login initiated" },
      { "t": "+12ms",  "layer": "server",   "event": "Request received at auth router" },
      { "t": "+13ms",  "layer": "server",   "event": "ERROR: JWT_SECRET not set" },
      { "t": "+15ms",  "layer": "browser",  "event": "Network failure received" },
      { "t": "+16ms",  "layer": "browser",  "event": "TypeError thrown in auth.js:67" }
    ]
  }
}
```

## Documentation

- [Getting Started Guide](docs/getting-started.md)
- [Full Tool Reference](docs/tools/README.md) — 90+ MCP tools across 12 groups
- [Guides](docs/guides/)
  - [Auth Flows](docs/guides/auth-flows.md) — login forms, session persistence, multi-user
  - [Debugging SPAs](docs/guides/debugging-spa.md) — React, Vue, Next.js debugging
  - [Full-Stack Debugging](docs/guides/fullstack-debugging.md) — correlate browser ↔ server errors
  - [Multi-Session Testing](docs/guides/multi-session.md) — parallel isolated sessions
- [Security Model](docs/security-model.md) — sandbox, allowlists, best practices
- [Configuration Reference](docs/configuration.md) — all config options + env vars
- [Usage Examples](examples/) — step-by-step JSON-RPC walkthroughs

## Installation & Setup

### Prerequisites

| Requirement | Version |
|---|---|
| **Node.js** | >= 20.0.0 |
| **npm** / **pnpm** / **yarn** | Latest stable |
| **OS** | macOS, Linux, Windows (WSL2 recommended) |

### Option 1: Quick Install (Recommended)

```bash
# 1. Install globally
npm install -g @plumpslabs/fennec-cli

# 2. Install browser engines (Playwright Chromium)
fennec install-browsers

# 3. Generate config file (optional)
fennec init

# 4. Start the MCP server
fennec start
```

### Option 2: From Source

```bash
git clone https://github.com/plumpslabs/fennec.git
cd fennec

# Install dependencies
pnpm install

# Build both packages (core + cli)
pnpm build

# Install browser engines
npx playwright install chromium --with-deps

# Start the server
node packages/cli/dist/index.js start
```

### Configure Your MCP Client

Add Fennec to your MCP client (Claude Desktop, etc.):

**Claude Desktop** — add to `claude_desktop_config.json`:
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

Or run the guided setup:
```bash
fennec setup
```

### Verify It Works

```bash
# Start the server
fennec start

# In another terminal, test with the MCP inspector
npx @modelcontextprotocol/inspector fennec start
```

## Quick Start: Your First Diagnosis

Once Fennec is running and connected to your AI agent, try this workflow:

```bash
# Terminal: Start your app with Fennec watching
npm run dev 2>&1 | fennec pipe --name "my-app"
```

Then ask your AI agent:
> "Check why my app is broken"

The AI will automatically use Fennec tools to:
1. Open the browser to your app
2. Check console errors
3. Inspect failed network requests
4. Correlate with server logs
5. Report the root cause

## What You Need to Set Up

| Step | What | Required? | Notes |
|---|---|---|---|
| 1 | Install Node.js >= 20 | ✅ Yes | [nodejs.org](https://nodejs.org) |
| 2 | Install `@plumpslabs/fennec-cli` | ✅ Yes | `npm install -g @plumpslabs/fennec-cli` |
| 3 | Install Playwright browsers | ✅ Yes | `fennec install-browsers` (Chromium only) |
| 4 | MCP client (Claude Desktop, etc.) | ✅ Yes | For AI agent integration |
| 5 | Config file | Optional | `fennec init` for customization |
| 6 | Pipe server output | Optional | `| fennec pipe --name "my-app"` for server logs |
| 7 | Set env vars | Optional | See [configuration docs](docs/configuration.md) |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <small>
    Fennec — <em>Ears everywhere in your stack.</em><br>
    Built with ❤️ for AI-native development
  </small>
</div>
