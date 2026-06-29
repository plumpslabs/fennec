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
</p>

---

## Overview

`@plumpslabs/fennec-core` is the core library powering the [Fennec MCP server](https://github.com/plumpslabs/fennec). It provides:

- **🌐 Browser automation** — Playwright-based session management, navigation, interaction, and DOM access
- **📋 DevTools integration** — Console log collection, network monitoring, performance metrics
- **🔐 Auth & sessions** — Login form detection, session persistence (cookies + localStorage)
- **⚙️ Process management** — Spawn, monitor, and attach to processes
- **📡 Terminal watching** — Log file and pipe watchers with level detection
- **🔗 Full-stack correlation** — Cross-layer root cause inference

### What's inside

| Module | Description |
|---|---|
| `session/` | Browser session manager — Playwright contexts, tabs, CDP integration |
| `tools/` | 90+ MCP tool definitions across 12 groups (auth, navigation, storage, etc.) |
| `process/` | Process spawner, log watcher, pipe watcher, port detector |
| `cdp/` | Chrome DevTools Protocol collectors (console, network, performance) |
| `correlation/` | Event bus, timeline builder, root cause inference engine |
| `response/` | Response builder and error enricher with screenshots + context |
| `config/` | Configuration loader with defaults and YAML support |

## Installation

```bash
npm install @plumpslabs/fennec-core
```

> **Note:** This package is designed to be used via the [Fennec CLI](https://www.npmjs.com/package/@plumpslabs/fennec-cli). You typically don't need to install it directly — the CLI pulls it in as a dependency.

## Quick Start (Programmatic Usage)

```ts
import { FennecServer, SessionStore } from "@plumpslabs/fennec-core";

const server = new FennecServer();
await server.start();
```

## Documentation

Full documentation is available in the [main Fennec repository](https://github.com/plumpslabs/fennec):

- [Getting Started Guide](https://github.com/plumpslabs/fennec/blob/main/docs/getting-started.md)
- [Full Tool Reference](https://github.com/plumpslabs/fennec/blob/main/docs/tools/README.md)
- [Configuration Reference](https://github.com/plumpslabs/fennec/blob/main/docs/configuration.md)
- [Security Model](https://github.com/plumpslabs/fennec/blob/main/docs/security-model.md)

## License

MIT — see [LICENSE](https://github.com/plumpslabs/fennec/blob/main/LICENSE) for details.
