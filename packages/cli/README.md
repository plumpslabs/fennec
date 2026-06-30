<p align="center">
  <img src="https://raw.githubusercontent.com/plumpslabs/fennec/main/public/fennec.png" alt="🦊 Fennec" width="170" />
</p>

<h1 align="center">@plumpslabs/fennec-cli</h1>

<p align="center">
  <strong>Ears everywhere in your stack.</strong>
  <br />
  <em>AI-native developer observability MCP server — browser, terminal, and processes, all in one.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@plumpslabs/fennec-cli"><img src="https://img.shields.io/npm/v/@plumpslabs/fennec-cli" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js" alt="Node.js" /></a>
  <a href="https://chromium.org"><img src="https://img.shields.io/badge/Browser-Chromium%20%7C%20Firefox%20%7C%20WebKit-blue?logo=googlechrome" alt="Cross-browser" /></a>
</p>

---

## What is Fennec?

**Fennec** is an MCP (Model Context Protocol) server that bridges the gap between AI agents and your development environment. It gives your AI full-stack visibility:

- 🔍 **Observe** browser console logs, network requests, and performance metrics in real-time
- 🖥️ **Watch** terminal output and server logs without changing your workflow
- 🎮 **Control** browser sessions — navigate, click, type, screenshot, annotate, diff
- 🔐 **Persist** authentication sessions across conversations
- 🔗 **Correlate** events across layers to identify root causes automatically
- 🌐 **Cross-browser** support: Chromium, Firefox, WebKit

## Installation

### Global Install (Recommended)

```bash
npm install -g @plumpslabs/fennec-cli
```

Then (optional) install browser engines if you need browser automation:

```bash
fennec install-browsers
```

> **Note:** Playwright is an **optional peer dependency**. Fennec works for terminal/process monitoring without it. Only install browser engines if you need browser automation features.

### From Source

```bash
git clone https://github.com/plumpslabs/fennec.git
cd fennec
pnpm install
pnpm build
```

Browser engines (optional for source install):
```bash
pnpm add playwright
npx playwright install chromium
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

### 3. Pipe your server output (optional)

```bash
npm run dev 2>&1 | fennec pipe --name "dev-server"
```

### 4. Ask your AI to diagnose issues

> *"Why is my app broken?"* — AI uses Fennec to check browser console, network, and server logs simultaneously.

## CLI Commands

| Command | Description |
|---------|-------------|
| `fennec start` | Start the Fennec MCP server (stdio transport) |
| `fennec start --transport sse` | Start with SSE transport (experimental) |
| `fennec pipe --name <name>` | Pipe process output to Fennec for log watching |
| `fennec attach-pid <pid>` | Attach to a running process by PID |
| `fennec attach-port <port>` | Discover and attach to a process by port |
| `fennec watch <path>` | Watch a log file for changes |
| `fennec sessions` | List saved authentication sessions |
| `fennec setup` | Guided setup for your MCP client |
| `fennec init` | Generate a configuration file |
| `fennec install-browsers` | Install Playwright browser engines |
| `fennec help` | Show help information |

## Usage Examples

### Pipe Mode (Recommended for Observing Server Logs)

```bash
# Start your dev server with Fennec watching
npm run dev 2>&1 | fennec pipe --name "my-app"
```

### Attach by PID

```bash
# Find your process PID
ps aux | grep "node"

# Attach Fennec to it
fennec attach-pid 12345 --name "my-app"
```

### Attach by Port

```bash
# Auto-detect process listening on port 3000
fennec attach-port 3000 --name "my-app"
```

### Multiple Sessions for Parallel Testing

```bash
# Terminal 1: Run admin user session
npm run dev 2>&1 | fennec pipe --name "admin-test"

# Terminal 2: Run regular user session (same Fennec server)
fennec start  # In another MCP client config
```

## Configuration

Fennec works with zero config, but supports customization:

```bash
fennec init  # Creates fennec.config.yaml
```

Key configuration options (see [full reference](docs/configuration.md)):

```yaml
browser:
  type: chromium          # chromium, firefox, or webkit
  headless: true
  viewport:
    width: 1280
    height: 720

security:
  sandbox: true
  allowProcessSpawn: true
  allowJSEvaluation: true

correlation:
  windowMs: 500
  enableRootCauseInference: true
  minConfidence: 0.7
```

Environment variables also supported: `FENNEC_BROWSER_TYPE`, `FENNEC_HEADLESS`, `FENNEC_PORT`, etc.

## Cross-Browser Support

Fennec supports all three major browser engines via Playwright:

```bash
# Set via config
fennec init  # then edit browser.type

# Or via env var
FENNEC_BROWSER_TYPE=firefox fennec start
FENNEC_BROWSER_TYPE=webkit fennec start
```

## Security

Fennec ships with **sandbox mode enabled by default**. Key security features:

- 🔒 Process spawn allowlist (only npm, node, pnpm, etc. allowed by default)
- 🔒 Domain allowlist/blocklist for browser navigation
- 🔒 Per-tool permissions (eval, kill, spawn)
- 🔒 Audit logging of all tool calls
- 🔒 Session data export path confinement

See [Security Model](docs/security-model.md) for details.

## Documentation

- [Getting Started Guide](https://github.com/plumpslabs/fennec/blob/main/docs/getting-started.md)
- [Full Tool Reference](https://github.com/plumpslabs/fennec/blob/main/docs/tools/README.md) — 123 tools across 16 categories (including Mobile)
- [Configuration Reference](https://github.com/plumpslabs/fennec/blob/main/docs/configuration.md)
- [Security Model](https://github.com/plumpslabs/fennec/blob/main/docs/security-model.md)
- [Auth Flows Guide](https://github.com/plumpslabs/fennec/blob/main/docs/guides/auth-flows.md)
- [Full-Stack Debugging Guide](https://github.com/plumpslabs/fennec/blob/main/docs/guides/fullstack-debugging.md)
- [GitHub Repository](https://github.com/plumpslabs/fennec)

## License

MIT — see [LICENSE](https://github.com/plumpslabs/fennec/blob/main/LICENSE) for details.
