<p align="center">
  <img src="https://raw.githubusercontent.com/plumpslabs/fennec/main/public/fennec.png" alt="🦊 Fennec" width="170" />
</p>

<h1 align="center">@plumpslabs/fennec-core</h1>

<p align="center">
  <strong>AI-native browser, terminal, and process observability — the engine behind Fennec.</strong>
  <br />
  <em>Part of the <a href="https://github.com/plumpslabs/fennec">Fennec</a> ecosystem.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@plumpslabs/fennec-core"><img src="https://img.shields.io/npm/v/@plumpslabs/fennec-core" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js" alt="Node.js" /></a>
  <a href="https://chromium.org"><img src="https://img.shields.io/badge/Browser-Chromium%20%7C%20Firefox%20%7C%20WebKit-blue?logo=googlechrome" alt="Cross-browser" /></a>
</p>

---

## Overview

`@plumpslabs/fennec-core` is the core library powering the [Fennec MCP server](https://github.com/plumpslabs/fennec). It provides:

- **🌐 Browser automation** — Playwright-based session management with Chromium, Firefox, and WebKit
- **📋 DevTools integration** — Console log collection, network monitoring, performance metrics, storage access
- **🔐 Auth & sessions** — Login form auto-detection, session persistence (cookies + localStorage), multi-session
- **⚙️ Process management** — Spawn, monitor, attach to processes by PID or port
- **📡 Terminal watching** — Log file and pipe watchers with level detection
- **🔗 Full-stack correlation** — Cross-layer root cause inference with configurable confidence thresholds
- **🛡️ Security middleware** — Sandbox mode, permission guards, domain allowlists, audit logging
- **📊 Self-observability** — Internal performance metrics tracking (tool durations, memory, error rates)

## What's inside

| Module | Description |
|--------|-------------|
| `session/` | Browser session manager — Playwright contexts, tabs, CDP integration, multi-browser (Chromium, Firefox, WebKit) |
| `tools/` | 112 MCP tool definitions across 15 categories (navigation, interaction, dom, devtools console/network/performance, storage, auth, tabs, process, terminal, diagnostic, scheduler, smart, planner) |
| `process/` | Process spawner, log watcher, pipe watcher, port detector |
| `cdp/` | Chrome DevTools Protocol collectors (console, network, performance) |
| `correlation/` | Event bus, timeline builder, root cause inference engine with 6+ pattern rules |
| `middleware/` | Pipeline with telemetry, permission guard, retry handler, smart hook, audit log |
| `response/` | Response builder and error enricher with screenshots + context |
| `config/` | Configuration loader with defaults, JSON/YAML support, and env var overrides |
| `state/` | State machine with context switch detection and session state tracking |
| `resource/` | Resource manager with health checks, auto-cleanup, and memory estimation |
| `capability/` | Project framework detector (Next.js, React, Vue, Laravel, etc.) |
| `recorder/` | Session recording and replay engine |
| `planner/` | Action planning and execution |

## Installation

```bash
npm install @plumpslabs/fennec-core
```

> **Note:** This package is designed to be used via the [Fennec CLI](https://www.npmjs.com/package/@plumpslabs/fennec-cli). You typically don't need to install it directly.

### Peer Dependencies

Playwright is an **optional peer dependency** — only needed if you use browser automation features:

```bash
npm install playwright
```

Browserless features (terminal watching, process management, correlation engine) work without Playwright.

## Quick Start (Programmatic Usage)

```ts
import { FennecServer, SessionStore } from "@plumpslabs/fennec-core";

const server = new FennecServer();
await server.start();
```

## Architecture

```
┌───────────────────────────────────────────────┐
│                AI Agent / LLM                  │
└───────────────────────┬───────────────────────┘
                        │ MCP Protocol (stdio/SSE)
                        ▼
┌───────────────────────────────────────────────┐
│              Fennec MCP Server                 │
├───────────────────────────────────────────────┤
│  Tool Registry (112 tools, 15 categories)     │
│  Input Validation (Zod schemas)               │
│  Middleware Pipeline: Telemetry → Audit →     │
│    PermissionGuard → SmartHook → RetryHandler │
│  Performance Metrics (self-observability)      │
├───────────────────────────────────────────────┤
│         Cross-Layer Correlation Engine         │
└──────────┬──────────────────┬─────────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌──────────────────┐
│  Browser Layer   │  │  Process Layer   │
│  (Playwright +   │  │  (child_process, │
│   CDPSession)    │  │   attach, pipe)  │
└──────────────────┘  └──────────────────┘
```

## Features

### Token-Efficient Tool Registry
Tools are grouped into 15 categories. MCP clients can request specific categories to reduce context window usage.

### Self-Observability
Track Fennec's own performance metrics: tool call durations, memory usage, error rates. Access via the PerformanceMetrics API.

### Audit Logging
Every tool call is recorded with timestamp, session ID, input, result, and duration for security auditing and debugging.

### Cross-Browser Support
Full support for Chromium, Firefox, and WebKit via Playwright. Configure via `browser.type` in config or `FENNEC_BROWSER_TYPE` env var.

## Security Features

- Sandbox mode enabled by default
- Process spawn allowlist
- Domain allowlist/blocklist
- Per-tool permission flags (eval, kill, spawn)
- File protocol blocking
- Audit logging of all tool calls
- Session data export path confinement
- Max export size limits

## Documentation

Full documentation is available in the [main Fennec repository](https://github.com/plumpslabs/fennec):

- [Getting Started Guide](https://github.com/plumpslabs/fennec/blob/main/docs/getting-started.md)
- [Full Tool Reference](https://github.com/plumpslabs/fennec/blob/main/docs/tools/README.md)
- [Configuration Reference](https://github.com/plumpslabs/fennec/blob/main/docs/configuration.md)
- [Security Model](https://github.com/plumpslabs/fennec/blob/main/docs/security-model.md)

## License

MIT — see [LICENSE](https://github.com/plumpslabs/fennec/blob/main/LICENSE) for details.
