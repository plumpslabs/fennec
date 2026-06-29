# Getting Started with Fennec

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0 (or npm/yarn as alternative)

## Installation

### Global Install (Recommended)

```bash
npm install -g @plumpslabs/fennec-cli

# Start the MCP server (works without browser engines for terminal/process monitoring)
fennec start
```

> **Optional:** Install Playwright if you need browser automation:
> ```bash
> fennec install-browsers
> ```

### From Source

```bash
git clone https://github.com/plumpslabs/fennec.git
cd fennec
pnpm install
pnpm build

# Start the server
node packages/cli/dist/index.js start
```

### Peer Dependency Note

Playwright is an **optional peer dependency**. Features that don't require a browser (terminal watching, process management, log correlation) work without it. Install Playwright only when you need browser automation:

```bash
npm install playwright
fennec install-browsers
```

## Quick Start

### 1. Start the MCP Server

```bash
fennec start
```

This starts the Fennec MCP server with stdio transport. Your AI agent (Claude Desktop, etc.) will communicate with Fennec via this server.

### 2. Configure Your MCP Client

Add Fennec to any MCP client:

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

The config file location depends on your client. Run `fennec setup` for guided configuration.

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

### Smart Tools — AI-Powered Interaction

```
// Smart wait with auto-diagnosis on timeout
smart_wait({ selector: "button:has-text(\"Login\")", timeout: 5000 })

// Smart fill form — auto-detect fields by label
smart_fill_form({ fields: { "email": "user@test.com", "password": "secret" }, submitAfter: true })

// Validate form before submit
smart_validate_form({ customRules: { "email": { type: "email", required: true } } })

// Annotated screenshot — numbered badges on elements
browser_screenshot_annotated({ format: "png" })

// Export screenshot as standalone HTML with bounding boxes
browser_screenshot_export({ format: "png" })

// Compare page changes — diff against previous state
browser_screenshot_diff({ baseline: { elements, screenshot } })
```

## Next Steps

- Explore the full [Tool Reference](tools/README.md) — 90+ MCP tools across 13 groups
- Learn about [Auth Flows](guides/auth-flows.md)
- Try [Full-Stack Debugging](guides/fullstack-debugging.md)
- Configure Fennec with `fennec init`
