# Getting Started with Fennec

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0 (or npm/yarn as alternative)

## Installation

### Global Install (Recommended)

```bash
npm install -g @plumpslabs/fennec-cli

# Install browser engines
fennec install-browsers

# Start the MCP server
fennec start
```

### From Source

```bash
git clone https://github.com/plumpslabs/fennec.git
cd fennec
pnpm install
pnpm build

# Start the server
node packages/cli/dist/index.js start
```

## Quick Start

### 1. Start the MCP Server

```bash
fennec start
```

This starts the Fennec MCP server with stdio transport. Your AI agent (Claude Desktop, etc.) will communicate with Fennec via this server.

### 2. Configure Your MCP Client

For **Claude Desktop**, add to your `claude_desktop_config.json`:

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

Run `fennec setup` for guided configuration.

### 3. Use Fennec Tools

Once connected, your AI agent can use all Fennec tools. Here's a typical workflow:

```
User: "Check why my login page is broken"
Agent: [uses Fennec tools to investigate]

1. browser_navigate("http://localhost:3000/login")
2. devtools_get_console_logs()
3. network_get_failed_requests()
4. diagnose_fullstack()
```

## Basic Usage Examples

### Browse a Website

```
browser_navigate({ url: "https://example.com" })
browser_screenshot({ fullPage: true })
browser_get_page_text()
```

### Debug JavaScript Errors

```
devtools_get_console_logs({ level: "error" })
devtools_get_js_errors()
```

### Monitor Network Requests

```
network_get_logs({ status: 500 })
network_get_failed_requests()
```

### Authenticate & Save Session

```
auth_fill_login_form({ username: "user@example.com", password: "mypassword", submitAfter: true })
auth_save_session({ name: "myapp-prod" })
```

### Full-Stack Diagnosis

```
diagnose_fullstack({ processId: "dev-server" })
```

## Next Steps

- Explore the full [Tool Reference](tools/README.md)
- Learn about [Auth Flows](guides/auth-flows.md)
- Try [Full-Stack Debugging](guides/fullstack-debugging.md)
- Configure Fennec with `fennec init`
