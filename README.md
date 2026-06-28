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

## Quick Start

```bash
# Install globally
npm install -g @fennec/cli

# Install browser engines
fennec install-browsers

# Start the MCP server
fennec start

# Add to your MCP client (Claude Desktop, etc.)
fennec setup
```

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

## Project Structure

```
fennec/
├── packages/
│   ├── core/              # MCP server — the heart of Fennec
│   │   ├── src/
│   │   │   ├── server.ts           # MCP server setup
│   │   │   ├── session/            # Session management
│   │   │   ├── tools/              # Tool implementations
│   │   │   │   ├── navigation/     # Browser navigation tools
│   │   │   │   ├── interaction/    # Click, type, scroll, etc.
│   │   │   │   ├── dom/            # DOM query tools
│   │   │   │   ├── devtools/       # Console, network, performance
│   │   │   │   ├── storage/        # localStorage, cookies, IndexedDB
│   │   │   │   ├── auth/           # Auth session management
│   │   │   │   ├── tabs/           # Tab & context management
│   │   │   │   ├── process/        # Process spawn & management
│   │   │   │   ├── terminal/       # Log watching
│   │   │   │   └── diagnostic/     # Full-stack diagnosis
│   │   │   ├── cdp/                # Chrome DevTools Protocol
│   │   │   ├── process/            # Process management
│   │   │   ├── correlation/        # Cross-layer correlation
│   │   │   ├── response/           # Response formatting
│   │   │   ├── config/             # Configuration
│   │   │   └── utils/              # Shared utilities
│   │   └── tests/
│   └── cli/               # CLI — pipe, attach, watch commands
│       ├── src/
│       │   ├── index.ts            # CLI entry point
│       │   ├── commands/           # Command implementations
│       │   └── utils/              # CLI utilities
│       └── package.json
├── docs/                  # Documentation
├── examples/              # Usage examples
└── .github/               # CI/CD and templates
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Tool Reference](docs/tools/README.md)
- [Guides](docs/guides/)
  - [Auth Flows](docs/guides/auth-flows.md)
  - [Debugging SPAs](docs/guides/debugging-spa.md)
  - [Full-Stack Debugging](docs/guides/fullstack-debugging.md)
  - [Multi-Session Testing](docs/guides/multi-session.md)
- [Security Model](docs/security-model.md)
- [Configuration Reference](docs/configuration.md)

## Comparison

| Feature | **Fennec** | Playwright MCP | Puppeteer MCP | Browser-use |
|---|---|---|---|---|
| Browser automation | ✅ | ✅ | ✅ | ✅ |
| Console logs (deep) | ✅ | ❌ | ❌ | ❌ |
| Network monitoring | ✅ Full | ❌ | ❌ | Partial |
| Network mock/intercept | ✅ | ❌ | ❌ | ❌ |
| localStorage / cookies | ✅ Full | ❌ | ❌ | ❌ |
| Auth session persist | ✅ Named | ❌ | ❌ | ❌ |
| Performance metrics | ✅ | ❌ | ❌ | ❌ |
| Process spawn | ✅ | ❌ | ❌ | ❌ |
| Terminal log watch | ✅ | ❌ | ❌ | ❌ |
| Full-stack correlation | ✅ | ❌ | ❌ | ❌ |
| AI-friendly errors | ✅ Bundled | ❌ | ❌ | Partial |
| diagnose_fullstack | ✅ | ❌ | ❌ | ❌ |
| Multi-session parallel | ✅ | ❌ | ❌ | ✅ |
| Open source | ✅ MIT | ✅ Apache | ✅ MIT | ✅ MIT |

## Roadmap

- **v0.1** — MCP server foundation, navigation, interaction, console
- **v0.2** — Full DevTools (network, performance), diagnostic tools
- **v0.3** — Storage & auth (cookies, sessions, login form auto-fill)
- **v0.4** — Process & terminal layer (spawn, attach, log watch)
- **v0.5** — Correlation engine & full-stack diagnosis
- **v0.6** — Multi-tab, CDP raw access, SSE transport
- **v0.7** — OSS polish: docs, examples, CI/CD, Docker
- **v1.0** — Stable release, 80%+ test coverage, published to npm

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
