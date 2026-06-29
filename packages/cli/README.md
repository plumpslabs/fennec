<p align="center">
  <img src="https://raw.githubusercontent.com/plumpslabs/fennec/main/public/fennec.png" alt="🦊 Fennec" width="170" />
</p>

<h1 align="center">@plumpslabs/fennec-cli</h1>

<p align="center">
  <strong>Ears everywhere in your stack.</strong>
  <br />
  <em>AI-native developer observability — browser, terminal, and processes, all in one MCP server.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@plumpslabs/fennec-cli"><img src="https://img.shields.io/npm/v/@plumpslabs/fennec-cli" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js" alt="Node.js" /></a>
</p>

---

## What is Fennec?

**Fennec** is an MCP (Model Context Protocol) server that bridges the gap between AI agents and your development environment. It gives your AI full-stack visibility:

- 🔍 **Observe** browser console logs, network requests, and performance metrics
- 🖥️ **Watch** terminal output and server logs
- 🎮 **Control** browser sessions — navigate, click, type, screenshot
- 🔐 **Persist** authentication sessions across conversations
- 🔗 **Correlate** events across layers to identify root causes automatically

## Installation

```bash
npm install -g @plumpslabs/fennec-cli
```

Then install browser engines:

```bash
fennec install-browsers
```

## Quick Start

### 1. Start the MCP server

```bash
fennec start
```

### 2. Configure your MCP client

Add this to your MCP client's config file:

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

## CLI Commands

| Command | Description |
|---|---|
| `fennec start` | Start the Fennec MCP server |
| `fennec pipe --name <name>` | Pipe process output to Fennec for log watching |
| `fennec attach-pid <pid>` | Attach to a running process by PID |
| `fennec attach-port <port>` | Discover and attach to a process by port |
| `fennec watch <path>` | Watch a log file for changes |
| `fennec sessions` | List saved authentication sessions |
| `fennec setup` | Guided setup for your MCP client |
| `fennec init` | Generate a configuration file |
| `fennec install-browsers` | Install Playwright browser engines |
| `fennec help` | Show help information |

## Documentation

- [Getting Started Guide](https://github.com/plumpslabs/fennec/blob/main/docs/getting-started.md)
- [Full Tool Reference](https://github.com/plumpslabs/fennec/blob/main/docs/tools/README.md)
- [Configuration Reference](https://github.com/plumpslabs/fennec/blob/main/docs/configuration.md)
- [Security Model](https://github.com/plumpslabs/fennec/blob/main/docs/security-model.md)
- [GitHub Repository](https://github.com/plumpslabs/fennec)

## License

MIT — see [LICENSE](https://github.com/plumpslabs/fennec/blob/main/LICENSE) for details.
