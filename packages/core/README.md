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
- **⚙️ Process management** — Spawn (idempotent: adopts an existing process on the same port instead of double-starting), monitor, attach by PID/port, auto-restart, supervise, adopt external processes, health checks, and log rotation
- **📡 Terminal watching** — Log file and pipe watchers with level detection
- **🔗 Full-stack correlation** — Cross-layer root cause inference with configurable confidence thresholds
- **🛡️ Security middleware** — Sandbox mode, permission guards, domain allowlists, audit logging
- **📊 Self-observability** — Internal performance metrics tracking (tool durations, memory, error rates)
- **🪙 Token-efficient by default** — Screenshots return compressed JPEG (q50) unless requested as PNG; `browser_screenshot` supports `output:"base64"|"file_path"`; `smart_navigate` returns structured JSON (no image) with `compact`/`mode:"verify"` options; `tools/list` exposes a `_tokenTier` per tool so agents prefer cheap tools first; `tools_help` lists tools by category with parameter tiers

## What's inside

| Module                      | Description                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session/`                  | Browser session manager — CDP or Playwright engine, tabs, multi-session, CDP monitoring                                                                                                                                              |
| `store/`                    | **StoreManager** — single source of truth for persisted state: global `~/.fennec` (or `FENNEC_HOME`/`FENNEC_DATA_DIR`) vs per-project `--local`, perms lockdown, scan, `redactSession`                                               |
| `tools/`                    | 165+ MCP tool definitions across 18 categories (navigation, interaction, dom, devtools console/network/performance, storage, auth, tabs, process, terminal, diagnostic, scheduler, smart, planner, recorder, assert, mobile, **ai**) |
| `tools/ai/`                 | **AI-Native API** — `observe()`, `ai_diagnose()`, `correlate()`, `summarize()`, `explain()`, `investigate()`, `predict()`                                                                                                            |
| `tools/debug/`              | **Debug Engine** — 26 tools across 3 levels: log debug, breakpoint (V8/DAP/JDWP/DBGp), auto-debug (EventBus-driven), cassette record/replay                                                                                          |
| `incident/`                 | **Incident Engine** — formal incident type, lifecycle management, confidence scoring, auto-detection via EventBus                                                                                                                    |
| `modules/`                  | Modular system with `FennecModule` interface + `ModuleRegistry`. Modules: **browser**, **process**, **mobile** (Android/ADB: 11 tools)                                                                                               |
| `process/`                  | Process spawner (idempotent adopt-by-port), supervisor (auto-restart + flapping detection), log watcher, pipe watcher, **cross-platform** port detector (`/proc` on Linux, `lsof` on macOS, `netstat`/`wmic` on Windows)             |
| `browser/`                  | Browser engine abstraction — `BrowserSession` interface + 2 implementations: **Playwright** (full automation) + **CDP Observer** (zero-deps). Auto-switch via `EngineSelector` + `AdapterSelector`                                   |
| `cdp/`                      | Chrome DevTools Protocol collectors (console, network, performance)                                                                                                                                                                  |
| `correlation/`              | Event bus, timeline builder, root cause inference engine, **Event Normalizer**                                                                                                                                                       |
| `middleware/`               | Pipeline with telemetry, permission guard, retry handler, smart hook, audit log, **PulseContext** (Lazy Context L0), **LazyLevels L1-L3**, **EventBusMiddleware**                                                                    |
| `middleware/LazyContext.ts` | **Lazy Context** — Levels 1 (Summary), 2 (Detail), 3 (Raw). Config-driven conditional middleware                                                                                                                                     |
| `response/`                 | Response builder and error enricher with context (no auto-screenshots)                                                                                                                                                               |
| `config/`                   | Configuration loader with defaults, JSON/YAML support, and env var overrides                                                                                                                                                         |
| `state/`                    | State machine with context switch detection and session state tracking                                                                                                                                                               |
| `resource/`                 | Resource manager with health checks, auto-cleanup, and memory estimation                                                                                                                                                             |
| `capability/`               | Project framework detector (Next.js, React, Vue, Laravel, etc.)                                                                                                                                                                      |
| `recorder/`                 | Session recording and replay engine                                                                                                                                                                                                  |
| `planner/`                  | Action planning and execution                                                                                                                                                                                                        |
| `scheduler/`                | Workflow scheduler with auto-trigger rules                                                                                                                                                                                           |

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

Browserless features (terminal watching, process management, correlation engine) work without Playwright. Fennec's **CDP Observer** engine uses zero external dependencies (Node.js built-ins only).

## Quick Start (Programmatic Usage)

```ts
import { FennecServer, SessionStore } from '@plumpslabs/fennec-core';

const server = new FennecServer();
await server.start();
```

## Architecture

```
                    ┌─────────────┐
                    │     AI      │
                    │   (LLM)     │
                    └──────┬──────┘
                           │ MCP Protocol
                    ┌──────▼──────┐
                    │  Fennec     │
                    │  MCP Server │
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │  Lazy       │ ← Context Compression (L0-L3)
                    │  Context    │
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │  Incident   │ ← Correlated, scored, explained
                    │   Engine    │
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │ Correlation │ ← Cross-layer dot connector
                    │   Engine    │
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │   Event     │ ← Normalize, enrich, route
                    │  Bus + MW   │
                    └──────┬──────┘
          ┌─────────────────┼─────────────────┐
          │                 │                  │
  ┌───────▼───────┐ ┌──────▼──────┐ ┌─────────▼────────┐
  │   Browser     │ │  Terminal   │ │    Process       │
  │   Adapter     │ │  Adapter    │ │    Adapter        │
  └───────┬───────┘ └──────┬──────┘ └──────────┬────────┘
          │                │                    │
    ┌─────▼─────┐    ┌────▼────┐         ┌─────▼──────┐
    │ CDP / PW  │    │  tail   │         │ child_proc │
    │ (auto)    │    │ / pipe  │         │ / attach   │
    └───────────┘    └─────────┘         └────────────┘
```

## Features

### 🦊 Lazy Context — 200x Token Savings

Information delivered in levels, config-driven:

- **Level 0** (Pulse): Always sent — `"healthy | 3 warnings | 1 critical"`
- **Level 1** (Summary): Auto-attached on errors — `"Critical: DB timeout"`
- **Level 2** (Detail): On expand — timeline + correlation
- **Level 3** (Raw): On explicit request — raw logs + DOM

### 🧠 AI-Native API (7 Tools)

`observe()`, `ai_diagnose()`, `correlate()`, `summarize()`, `explain()`, `investigate()`, `predict()` — designed for **AI consumption first**.

### 🐛 Debug Engine (NEW)

Multi-language debugger with 26 tools across 3 levels:

- **Level 1** — Smart Log Debugging: error dedup by stack hash, source map resolution, grouped summaries
- **Level 2** — Breakpoint Debugging: V8/CDP, Python DAP, PHP DBGp→DAP, Java JDWP→DAP, Go/Ruby/.NET/Rust/Dart native DAP
- **Level 3** — Auto-Debug: EventBus-driven triggers (process crash, stderr error, browser error, 5xx)
- **Cassette Recorder**: Record/replay/diff MCP tool call sessions for regression testing

### 🚀 Dual Browser Engine

- **CDP Observer** (default, zero deps) — lightweight observation via Chrome DevTools Protocol
- **Playwright** (optional) — full automation (click, type, upload, drag-drop)
- **Auto-switch**: Config-driven via `browser.adapter: "auto" | "cdp" | "playwright"`

### 🔗 Event Bus Centralization

All tool executions publish `tool:executed` events to the EventBus. The Incident Engine auto-subscribes for real-time pattern matching and root cause inference.

### 📊 Token-Efficient Tool Registry

Tools are grouped into 18 categories. MCP clients can request specific categories to reduce context window usage.

### Self-Observability

Track Fennec's own performance metrics: tool call durations, memory usage, error rates. Access via the PerformanceMetrics API.

### Audit Logging

Every tool call is recorded with timestamp, session ID, input, result, and duration for security auditing and debugging.

### MCP Client Compatibility

Fennec works with all major MCP clients. Some clients require **SSE transport**
(`fennec start --sse`) instead of the default stdio:

| Client         | stdio | SSE | Notes                                                         |
| -------------- | :---: | :-: | ------------------------------------------------------------- |
| Claude Desktop |  ✅   | ✅  | stdio default                                                 |
| Claude Code    |  ✅   | ✅  | stdio default                                                 |
| Cline          |  ✅   | ✅  | stdio default                                                 |
| Cursor         |  ✅   | ✅  | stdio default                                                 |
| Windsurf       |  ✅   | ✅  | stdio default                                                 |
| Continue.dev   |  ⚠️   | ✅  | SSE recommended                                               |
| OpenCode       |  ✅   | ✅  | stdio default (local build wrapper recommended), SSE optional |

> **SSE mode:** `fennec start --sse` starts an HTTP+SSE endpoint on `http://127.0.0.1:3333/sse`.

### Cross-Browser Support (Playwright Mode)

Full support for Chromium, Firefox, and WebKit via Playwright. Configure via `browser.type` in config or `FENNEC_BROWSER_TYPE` env var.

### Cross-Platform Process Management

Process introspection and port discovery are platform-aware: Linux uses `/proc`, macOS uses `lsof`/`ps`, and Windows uses `netstat`/`tasklist`/`wmic`. `fennec start` adopts an existing process already holding the requested port (idempotent), so agents never spawn conflicting duplicates. On Windows an app's `cwd` isn't readable via built-ins and shows as empty.

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
