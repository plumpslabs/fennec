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

**Fennec** is an MCP (Model Context Protocol) server that bridges the gap between AI agents and your development environment. It gives your AI full-stack visibility — and, crucially, **full-stack control**:

- 🔍 **Observe** browser console logs, network requests, and performance metrics in real-time
- 🖥️ **Run & watch** your apps as supervised background daemons — logs, restart, health
- 🤝 **Adopt** processes an AI agent (or you) started via raw bash, so they're tracked instead of orphaned
- 🔐 **Persist** authentication sessions across conversations
- 🔗 **Correlate** events across layers to identify root causes automatically
- 🌐 **Cross-browser** support: Chromium, Firefox, WebKit
- 🪟 **Cross-platform**: Linux, macOS, and Windows

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

### 1. Configure your MCP client

Add this to your MCP client's config file (e.g. `claude_desktop_config.json`, `~/.config/opencode/opencode.json`, Cline/Cursor settings):

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

That's it — Fennec speaks **stdio** by default and needs no extra permissions to observe.

### 2. (Optional) Let the AI control processes

If you want your AI agent to **start, restart, and stop** apps for you, enable process
permissions. The recommended way is via environment variables in the MCP config:

```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"],
      "env": {
        "FENNEC_SECURITY_ALLOW_PROCESS_SPAWN": "true",
        "FENNEC_SECURITY_ALLOW_PROCESS_KILL": "true"
      }
    }
  }
}
```

> Spawn is enabled by default; kill is off by default (safer). Set both to `true`
> only in trusted, local dev environments. See [Security & Environment Variables](#security--environment-variables).

### 3. (Optional) Run the server over SSE instead of stdio

Some MCP clients (especially **OpenCode**) **require SSE transport** — they cannot
connect via stdio. For these clients, start Fennec with `--sse`:

```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start", "--sse"],
      "env": {
        "FENNEC_SECURITY_ALLOW_PROCESS_SPAWN": "true",
        "FENNEC_SECURITY_ALLOW_PROCESS_KILL": "true"
      }
    }
  }
}
```

With `--sse`, Fennec starts an HTTP+SSE endpoint (default `http://127.0.0.1:3333/sse`).
Connect remote MCP clients with `{ "type": "remote", "url": "http://127.0.0.1:3333/sse" }`.

### Client-Specific Config Examples

**For stdio clients** (Claude Desktop, Claude Code, Cline, Cursor, Windsurf):

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

**For OpenCode** (SSE required):

```json
// ~/.config/opencode/opencode.json
{
  "mcpServers": [
    {
      "name": "fennec",
      "type": "remote",
      "url": "http://localhost:3333/sse"
    }
  ]
}
```

**For Continue.dev** (SSE recommended):

```json
// config.json
{
  "experimental": {
    "mcpServers": [
      {
        "name": "fennec",
        "transport": "sse",
        "url": "http://localhost:3333/sse"
      }
    ]
  }
}
```

> **Tip:** When using SSE, Fennec outputs the exact MCP config snippet on startup so you can copy-paste it directly into your client config. Run `fennec start --sse` and look for the `MCP Config` line.

### 4. Ask your AI to diagnose issues

> _"Why is my app broken?"_ — AI uses Fennec to check browser console, network, and server logs simultaneously.

## CLI Commands

Fennec is both an MCP server **and** a CLI you can use directly in your terminal.

### Server

| Command                        | Description                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `fennec start`                 | Start the MCP server (stdio transport). Default when no app command is given. |
| `fennec start --sse`           | Start the MCP server over HTTP+SSE (experimental).                            |
| `fennec start --transport sse` | Alias of `--sse`.                                                             |

### Apps & Processes

| Command                                              | Description                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fennec start <command> --name <name> [options]`     | Launch an app as a supervised background daemon. Alias: `run`.                                                                                                  |
| `fennec ps [options]`                                | List Fennec-tracked apps with live status.                                                                                                                      |
| `fennec status [name]`                               | System overview + top processes (tracked and system).                                                                                                           |
| `fennec log <name\|pid> [options]`                   | Show (and follow) logs for a tracked app.                                                                                                                       |
| `fennec spawn [name] [name...] [--all]`              | Re-spawn a stopped tracked app from its saved config. Accepts MULTIPLE names at once.                                                                           |
| `fennec stop <name\|--all> [name...]`                | Stop (pause) a tracked app but keep it in the registry. Accepts MULTIPLE names. Add `-y/--yes` to skip the confirmation prompt.                                 |
| `fennec restart <name\|pid> [name...]`               | Stop and re-spawn a tracked app from its saved config. Accepts MULTIPLE names at once.                                                                          |
| `fennec kill <pid\|name\|all> [name...]`             | Kill a process and remove it from the registry. Accepts MULTIPLE names at once. Add `-y/--yes` to skip the confirmation prompt.                                 |
| `fennec group [name] [group]`                        | Assign a logical group to tracked apps (or list them). Bulk: `fennec group <group> <name...>`. `--unset` to clear. Group is preserved across `spawn`/`restart`. |
| `fennec adopt <pid> [--name <name>] [--port <port>]` | Adopt an externally-started process into Fennec tracking.                                                                                                       |
| `fennec supervisor <start\|stop\|restart\|status>`   | Manage the background supervisor that keeps `--restart` apps alive.                                                                                             |
| `fennec persist <enable\|disable\|status>`           | Survive reboots — auto-start tracked apps after login (systemd/launchd/Windows).                                                                                |
| `fennec dev <up\|down\|status\|restart <app>>`       | Orchestrate a whole dev stack from `fennec.config.yaml`.                                                                                                        |
| `fennec inspect <name\|pid>`                         | Compact, AI-safe snapshot (status + recent logs + error scan).                                                                                                  |
| `fennec info <name>`                                 | Detailed info for a tracked app.                                                                                                                                |
| `fennec rename <old> <new>`                          | Rename a tracked app.                                                                                                                                           |

**`start` / `run` options:** `--name <name>` (recommended), `--port <port>` (Fennec waits until it accepts connections), `--cwd <dir>`, `--restart` (auto-restart on crash / port-down, survives terminal close), `--group <group>` (tag for scoped bulk ops), `--jsonl` (structured JSON-lines logs).

**`ps` options:** `-w/--watch` (live refresh), `--system/-a/--all` (include non-Fennec system processes), `--json`, `--name <filter>`, `--group <g>` (show only apps in group `<g>`), `--sort <cpu|mem|pid|name>`. The `MEM` column shows each running app's resident memory (RSS) cross-platform, so you can spot leaks from long-lived apps.

**Logical groups + bulk (multiple names):** tag apps with `fennec start <cmd> --name <n> --group <g>`, or retroactively with `fennec group <name> <g>` (existing entries too — `fennec group <name> --unset` clears). You can ALSO assign a group to MANY apps at once (bulk): `fennec group <group> <name1> <name2> ...` — e.g. `fennec group crm be-crm fe-crm` tags all three as `crm` in one shot (alternatively `fennec group --group crm be-crm fe-crm`). Then scope bulk ops to just that group: `fennec kill --group <g>`, `fennec stop --group <g>`, `fennec spawn --group <g>`, `fennec restart --group <g>`, `fennec ps --group <g>`. A bare group name as the positional (e.g. `fennec kill <g>`) is also accepted as shorthand. You can ALSO pass MULTIPLE names at once for one-shot bulk ops: `fennec stop be-crm fe-crm`, `fennec kill be-crm fe-crm -y`, `fennec restart be-crm fe-crm -y`, `fennec spawn be-crm fe-crm`. The group is PRESERVED across `spawn`/`restart` (stop→resume keeps the tag). Already-running entries in scope are reported as "already running" (never double-spawned); `--all` still targets **every** tracked app across all groups.

**`log` options:** `-f/--follow`, `--lines N`, `--since 10m|1h|2d`, `--level error|warn|info|debug`, `--json` (bounded, redacted, machine-readable for AI), `--no-redact`, `--clear`.

**`inspect` options:** `--plain` (short human summary), `--tail N`, `--since 10m`.

### Observation

| Command                      | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `fennec attach <port>`       | Observe a running process by the port it listens on. |
| `fennec attach-pid <pid>`    | Attach to and observe a process by its PID.          |
| `fennec attach-port <port>`  | Attach to and observe a process by its port.         |
| `fennec pipe --name <name>`  | Pipe stdin into a Fennec log watcher.                |
| `fennec watch --file <path>` | Watch an existing log file.                          |

### Data

| Command                       | Description                                          |
| ----------------------------- | ---------------------------------------------------- |
| `fennec export --file <path>` | Export tracked apps to a file.                       |
| `fennec import <file>`        | Import tracked apps from a file.                     |
| `fennec cleanup`              | Remove dead/stale entries from the tracked registry. |

### Store & Doctor

Fennec persists everything — auth sessions, tracked processes, exports, plugin/workflow state — under **one global store**, by default `~/.fennec` (honors `FENNEC_HOME` / `FENNEC_DATA_DIR`), manageable from **any directory**. `--local` targets the per-project `.fennec` instead.

| Command                            | Description                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fennec store`                     | Overview of everything in the global store (counts, size, age).                                              |
| `fennec store --local`             | Same, for the project `.fennec`.                                                                             |
| `fennec store session`             | List saved auth sessions.                                                                                    |
| `fennec store session info <name>` | Show a session — cookie/localStorage **values are masked**; add `--show-secrets` to reveal.                  |
| `fennec store session rm <name>`   | Delete a session (confirm prompt).                                                                           |
| `fennec doctor`                    | Health + secret-surface checks: store permissions, synced-home leakage, embedded secrets in launch commands. |

### Configuration & Misc

| Command                   | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `fennec init`             | Generate a `fennec.config.yaml` in the current directory.                  |
| `fennec setup`            | Interactively configure your MCP client for Fennec.                        |
| `fennec install-browsers` | Install Playwright browser engines.                                        |
| `fennec sessions`         | List saved browser auth sessions (alias of `fennec store session`).        |
| `fennec store`            | Unified view of everything Fennec persists (sessions, processes, exports). |
| `fennec doctor`           | Health + secret-surface checks for the store.                              |
| `fennec health`           | Health check of the Fennec environment.                                    |
| `fennec help [command]`   | Show help, or detailed help for a command.                                 |

## Usage Examples

### Run an app as a supervised daemon

```bash
# Launch and immediately return to your shell — logs go to ~/.fennec/logs/web.log
fennec start "npm run dev" --name web --port 3000

# Auto-restart if it crashes or its port stops answering (survives terminal close)
fennec start node server.js --name api --cwd ./backend --restart

# Watch it
fennec ps
fennec log web -f
```

### Idiot-proof `dev up` (idempotent)

`fennec dev up` reads `fennec.config.yaml` and brings the whole stack up. It is
**idempotent**: already-running apps with unchanged config are skipped, apps whose
config changed are restarted, and an app whose port is already taken by _another_
process is **adopted** instead of spawning a conflicting duplicate.

```bash
fennec dev up                 # bring the stack up (skips what's already running)
fennec dev status             # see every app's health
fennec dev restart web        # restart just one app
fennec dev down               # stop everything (keeps it in the registry)
```

### Bulk operations & groups

```bash
# Tag apps into groups when starting (or retroactively with `fennec group`)
fennec start "npm run dev-be" --name be-crm --group crm
fennec start "npm run dev-fe" --name fe-crm --group crm

# One-shot bulk: pass MULTIPLE names at once
fennec stop  be-crm fe-crm          # pause both, keep them in the registry
fennec spawn be-crm fe-crm          # re-spawn both paused apps
fennec kill  be-crm fe-crm -y        # kill + forget both
fennec restart be-crm fe-crm -y     # restart both from saved config

# Group-scoped bulk: only that group is touched (other groups safe)
fennec kill  --group crm -y
fennec stop  --group crm
fennec ps --group crm               # MEM column shows each app's live RSS

# Global: --all still hits EVERY tracked app across all groups
fennec stop --all
```

### Adopt a process an AI agent started via raw bash

An AI agent (or you) sometimes launches a server with plain bash. Fennec can take
ownership instead of leaving it orphaned:

```bash
# Fennec finds whatever is listening on :8130 and tracks it as "svc"
fennec adopt $(lsof -ti :8130) --name svc --port 8130

# Or let Fennec discover the PID by port:
fennec start node server.js --name svc --port 8130   # adopts the existing one
```

Adopted processes appear in `fennec ps` and gain supervised logging. (Fennec-spawned
processes auto-restart on crash; adopted external processes are tracked but not
respawned, since Fennec doesn't know their original command.)

### Inspect & observe

```bash
fennec inspect web --plain          # one-line human summary
fennec inspect web --since 10m      # recent logs + error scan (AI-friendly)
fennec log web --json --since 10m   # bounded, redacted, machine-readable for AI
```

### Survive reboots (persist)

```bash
fennec persist enable    # auto-start tracked apps after login (uses systemd user
                         # service / launchd / Windows startup; enables linger on Linux)
fennec persist status
```

## Configuration

Fennec works with zero config, but supports customization:

```bash
fennec init  # Creates fennec.config.yaml
```

Key configuration options (see [full reference](../../docs/configuration.md)):

```yaml
browser:
  adapter: auto # auto, cdp, or playwright
  type: chromium # chromium, firefox, or webkit
  headless: true
  viewport:
    width: 1280
    height: 720

process:
  maxProcesses: 10
  spawnAllowlist: # only these commands may be spawned
    - npm
    - node
    - pnpm
    - yarn
    - bun
    - python
    - python3

security:
  sandbox: true
  allowProcessSpawn: true
  allowProcessKill: false # off by default — opt in explicitly
  allowJSEvaluation: true

lazyContext:
  level1: true # Auto-attach summary on errors
  level2: false # Attach detail on expand
  level3: false # Attach raw data on request

correlation:
  windowMs: 500
  enableRootCauseInference: true
  minConfidence: 0.7

debug:
  allowDebug: true # Enable debug features globally
  allowDebugEval: false # Expression evaluation (high risk)
  allowedDirs: [] # Restrict breakpoints to these dirs
  allowDependencies: false # Allow breakpoints in node_modules/.venv
```

## Security & Environment Variables

Fennec ships with **sandbox mode enabled by default** and conservative process
permissions. Environment variables override the config file:

| Variable                                           | Effect                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `FENNEC_DATA_DIR`                                  | Override where Fennec stores tracked state & logs (default `~/.fennec`). |
| `FENNEC_SANDBOX`                                   | `false` disables the sandbox (permits more operations).                  |
| `FENNEC_SECURITY_ALLOW_PROCESS_SPAWN`              | `true` allows the AI to spawn new processes.                             |
| `FENNEC_SECURITY_ALLOW_PROCESS_KILL`               | `true` allows the AI to kill processes.                                  |
| `FENNEC_SECURITY_ALLOW_JS_EVALUATION`              | `true` allows in-page JS evaluation.                                     |
| `FENNEC_TRANSPORT_TYPE`                            | `stdio` (default) or `sse`.                                              |
| `FENNEC_PORT`                                      | Port for SSE transport (default `3333`).                                 |
| `FENNEC_BROWSER_TYPE`                              | `chromium` \| `firefox` \| `webkit`.                                     |
| `FENNEC_HEADLESS`                                  | `false` to run headed.                                                   |
| `FENNEC_DEFAULT_TIMEOUT`                           | Browser default timeout (ms).                                            |
| `FENNEC_VIEWPORT_WIDTH` / `FENNEC_VIEWPORT_HEIGHT` | Viewport size.                                                           |
| `FENNEC_LOG_LEVEL`                                 | `debug` \| `info` \| `warn` \| `error`.                                  |

Security features:

- 🔒 Process spawn allowlist (only npm, node, pnpm, etc. allowed by default)
- 🔒 Domain allowlist/blocklist for browser navigation
- 🔒 Per-tool permissions (eval, kill, spawn)
- 🔒 Audit logging of all tool calls
- 🔒 Session data export path confinement

See [Security Model](../../docs/security-model.md) for details.

## Cross-Platform

Fennec runs on **Linux, macOS, and Windows**:

- Process discovery (`findPidOnPort`, command-line/cwd resolution, `ps`) is
  platform-aware: Linux uses `/proc`, macOS uses `lsof`/`ps`, Windows uses
  `netstat`/`tasklist`/`wmic`.
- `attach`/`attach-port` rely on `lsof` on macOS/Linux (install it if missing).
- On Windows, an app's `cwd` isn't readable via built-ins, so it shows as empty.

## Cross-Browser Support

Fennec supports all three major browser engines via Playwright:

```bash
FENNEC_BROWSER_TYPE=firefox fennec start
FENNEC_BROWSER_TYPE=webkit fennec start
```

## Documentation

- [Getting Started Guide](https://github.com/plumpslabs/fennec/blob/main/docs/getting-started.md)
- [Full Tool Reference](https://github.com/plumpslabs/fennec/blob/main/docs/tools/README.md)
- [Configuration Reference](https://github.com/plumpslabs/fennec/blob/main/docs/configuration.md)
- [Security Model](https://github.com/plumpslabs/fennec/blob/main/docs/security-model.md)
- [GitHub Repository](https://github.com/plumpslabs/fennec)

## Memory & Garbage Safety

Fennec is built to **not** leak memory or orphan processes on your machine:

- 🌳 **Process-tree kills** — `stop`/`kill`/`spawn`/`restart` tear down the _entire_ process tree (npm → vite → esbuild on POSIX; `taskkill /T /F` on Windows), so no orphaned children are left "nyampah".
- 🧹 **Browser contexts are fully torn down** on session destroy (page **and** its `BrowserContext` — cookies, cache, service workers), not just the page.
- ⏳ **Idle-session GC** runs on a timer (not only when the session cap is hit): idle sessions and over-TTL sessions are destroyed automatically.
- 📑 **Tab caps** — opening many tabs (`tab_new` / `context_new`) auto-closes the oldest non-active page so contexts can't accumulate.
- ♻️ **Context rotation** — long-lived contexts are periodically recycled (`config.session.rotationIntervalSecs`, default 0 = off). The old `BrowserContext` is closed and a fresh one built with your cookies/localStorage preserved (via storageState) and the current URL reloaded, so a session that's open for hours can't grow unbounded in DOM/listeners/workers. Trigger on demand with the `context_rotate` tool too.
- 🪵 **Bounded logs** — app logs are rotated (10 MB × 3 files) so disk never fills.
- 🔌 **Graceful shutdown** — `SIGTERM`/`SIGINT` closes the browser and all tracked daemons; `ps` even shows a live **MEM** (RSS) column so you can spot leaks.

## License

MIT — see [LICENSE](https://github.com/plumpslabs/fennec/blob/main/LICENSE) for details.
