# Fennec Debugger — AI-Native Debug Engine

> Fennec is a **development observation & debugging tool**. It is never meant to run in production environments.

| Design Principle                                     | Rationale                                     |
| ---------------------------------------------------- | --------------------------------------------- |
| Debug features always **opt-in** via `--debug` flag  | No accidental overhead                        |
| No production monitoring features                    | Fennec is a **dev tool**, not Datadog/Grafana |
| `--debug` mode injects agents only in dev            | Safety guarantee — never attaches to prod     |
| Default mode remains unchanged                       | Backward compatible, zero overhead            |

### Target Users

- **Solo developers** debugging fullstack apps
- **AI coding agents** (Cursor, Claude Code, etc.) that need runtime introspection
- **QA/Test engineers** writing automated browser tests
- **CI pipelines** for debugging flaky tests

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent (MCP Client)                  │
│     debug_set_breakpoint  debug_get_trace  debug_step    │
└──────────────────────────┬──────────────────────────────┘
                           │ MCP Protocol
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Fennec Debug Engine                       │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ Level 1     │  │ Level 2      │  │ Level 3        │   │
│  │ Log Debug   │→│ Breakpoint   │→│ Auto-Debug    │   │
│  │ (passive)   │  │ (active)     │  │ (proactive)    │   │
│  └─────────────┘  └──────────────┘  └────────────────┘   │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │             Adapter Layer (multi-lang)               │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │  │
│  │  │ V8   │ │  JVM │ │Python│ │  LLDB│ │  DOT │ ...  │  │
│  │  │Insp. │ │ JPDA │ │pydevd│ │      │ │  NET │      │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │           CDP Bridge (existing infrastructure)       │  │
│  │  ┌──────────────────┐  ┌────────────────────────┐   │  │
│  │  │ Console Collector │  │ Network Collector      │   │  │
│  │  └──────────────────┘  └────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision                     | Why                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAP as unifying protocol** | Fennec uses DAP (Debug Adapter Protocol) as the standard adapter layer — languages with custom protocols (PHP/DBGp, V8/Inspector) get wrappers |
| **CDP as primary bridge**    | Fennec already uses CDP for browser debugging — extend for V8/Node.js debugging instead of adding new deps                                     |
| **All debug tools are lazy** | No debug adapter is loaded until the first `debug_*` tool call                                                                                 |
| **Structured, not raw**      | Debug output is always structured JSON — never raw log dumps (token efficient)                                                                 |

---

## 2. Level 1: Smart Log Debugging (Passive)

No debugger attachment needed. An augmented log watcher that:

- Parses structured log output (JSONL, stack traces, source maps)
- Groups related errors (dedup by stack hash)
- Maps stack traces to source code (via source maps)
- Summarizes errors for token-efficient AI consumption

### Usage

```bash
# Start app with debug log mode
fennec start make dev-be --name be-crm --debug

# Or attach debug to an already-running tracked app
fennec debug attach be-crm

# Or start Fennec server in debug mode
fennec start --sse --debug
```

### MCP Tools

| Tool                                 | Description                        | Token Cost  |
| ------------------------------------ | ---------------------------------- | ----------- |
| `debug_get_errors(name)`             | Grouped errors with stack hashes   | ~50 tokens  |
| `debug_get_error_detail(name, hash)` | Full stack trace + source mapping  | ~200 tokens |
| `debug_investigate(name)`            | Root cause analysis (latest error) | ~150 tokens |
| `debug_logs_since(name, ts)`         | Filtered logs since timestamp      | Bounded     |
| `debug_summary(name)`                | 1-line health + latest error       | ~30 tokens  |

### Token Efficiency

| Technique                                      | Savings                                       |
| ---------------------------------------------- | --------------------------------------------- |
| **Error dedup by stack hash**                  | Catches 10 identical errors → returns 1 entry |
| **Source-mapped links instead of full trace**  | ~50 tokens vs ~500 tokens                     |
| **Grouped by type** (TypeError, Timeout, etc.) | Agent picks category, not all                 |
| **Pre-computed root cause**                    | Saves agent from analyzing raw logs           |

### Multi-Language

| Language              | Source Map Support | Notes                                            |
| --------------------- | ------------------ | ------------------------------------------------ |
| JavaScript/TypeScript | ✅ Native          | V8 stack traces + source maps                    |
| Python                | ✅ traceback.parse | Python stack traces                              |
| PHP                   | ❌ No source maps  | Stack traces from Xdebug (parseable, structured) |
| Go                    | ⚠️ Partial         | Stack traces but no source maps                  |
| Rust                  | ⚠️ Partial         | Debug symbols only                               |
| Java                  | ✅                 | JVM stack traces (parseable)                     |
| C#/.NET               | ✅                 | .NET stack traces with file/line info            |
| Ruby                  | ⚠️ Partial         | Ruby stack traces (parseable)                    |

---

## 3. Level 2: Breakpoint Debug Mode (Active)

Attaches a debugger to the running process via platform-specific protocol:

- **Node.js → V8 Inspector Protocol** (via existing CDP infrastructure)
- **Python → Debug Adapter Protocol (DAP)** or pydevd
- **JVM → Java Debug Wire Protocol (JDWP)**
- **.NET → .NET Debugger**

The debugger attaches **on demand** (lazy) — not at process start.

### Usage

```bash
# Attach debugger to running app
fennec debug attach be-crm --breakpoint

# Mode column shows "debug" status
fennec ps
# App    PID     Status   Mode     Command
# be-crm 3101325 running  debug    make dev-be
```

### MCP Tools

| Tool                                     | Description             | Token Cost |
| ---------------------------------------- | ----------------------- | ---------- |
| `debug_set_breakpoint(name, file, line)` | Set breakpoint          | ~20 tokens |
| `debug_set_condition(name, expr)`        | Conditional breakpoint  | ~30 tokens |
| `debug_continue(name)`                   | Resume execution        | ~10 tokens |
| `debug_step_over(name)`                  | Step over next call     | ~10 tokens |
| `debug_step_into(name)`                  | Step into next call     | ~10 tokens |
| `debug_get_variables(name, scopes?)`     | Current scope variables | Bounded    |
| `debug_evaluate(name, expr)`             | Evaluate expression     | ~30 tokens |
| `debug_list_breakpoints(name)`           | List active breakpoints | ~20 tokens |
| `debug_remove_breakpoint(name, id)`      | Remove breakpoint       | ~10 tokens |

### Token Efficiency

| Technique                            | Savings                                    |
| ------------------------------------ | ------------------------------------------ |
| **Variable snapshots are bounded**   | Max 20 variables per scope                 |
| **Deep objects are truncated**       | 3 levels deep, then `{...}`                |
| **Array previews limited**           | First 5 items, then `+N more`              |
| **Expression results cached**        | Same expression in same scope → no re-eval |
| **Breakpoint events are structured** | Not raw log lines                          |

### Security

| Concern                    | Mitigation                                                  |
| -------------------------- | ----------------------------------------------------------- |
| Arbitrary memory read      | V8 expression evaluation gated by `allowDebugEval`          |
| Source code exposure       | Only within project directory                               |
| Breakpoint in node_modules | Blocked by default, opt-in via `debug.allowDependencyDebug` |
| Remote debug attach        | Only localhost (inherits from Fennec's transport config)    |

Security config:

```yaml
security:
  allowDebug: true
  allowDebugEval: false # expression evaluation (high risk)
  debugAllowedDirs:
    - /home/user/projects
  debugAllowDependencies: false
```

### DAP as Unifying Protocol

Fennec uses **DAP (Debug Adapter Protocol)** as its core abstraction layer. Languages with custom debug protocols get a DAP adapter wrapper, making the interface uniform across all languages.

```
┌──────────────────────────────────────────────────────────┐
│                   Fennec Debug Engine                      │
│       (DAP Client — speaks only DAP to all adapters)       │
├──────────────────────────────────────────────────────────┤
│                     DAP Adapter Layer                       │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐   │
│  │ V8→DAP   │ │PHP DBGp│ │Python  │ │Java    │ │DAP   │   │
│  │(CDP→DAP) │ │→DAP    │ │debugpy │ │JDWP→DAP│ │Native│   │
│  └──────────┘ └────────┘ └────────┘ └────────┘ └──────┘   │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │
│  │Go Delve  │ │Ruby    │ │.NET    │ │LLDB    │            │
│  │(native ) │ │debug   │ │DAP     │ │lldb-dap│            │
│  └──────────┘ └────────┘ └────────┘ └────────┘            │
└──────────────────────────────────────────────────────────┘
```

### Multi-Language

| Runtime           | Protocol            | Adapter Strategy     | Notes                                                                                                                                                                                |
| ----------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js           | V8 Inspector (CDP)  | **CDP→DAP bridge**   | Reuse existing `cdp-engine.ts`; translate CDP debug events to DAP                                                                                                                    |
| **PHP**           | **Xdebug (DBGp)**   | **DBGp→DAP proxy**   | PHP runs Xdebug, which uses the DBGp protocol (TCP). Uses `vscode-php-debug`'s approach — a DAP-to-DBGp translator. Agent sets breakpoints via DAP, adapter forwards as DBGp commands |
| Python (CPython)  | DAP (debugpy)       | **Native DAP**       | `debugpy` is already DAP-compliant. Fennec launches `debugpy --connect` and speaks DAP directly                                                                                      |
| JVM (Java/Kotlin) | JDWP                | **JDWP→DAP bridge**  | JDWP is a raw JVM wire protocol. Lightweight JDWP-to-DAP adapter (similar to `vscode-java-debug`)                                                                                    |
| .NET (C#, F#, VB) | .NET Debugger       | **NetCoreDbg (DAP)** | `netcoredbg` is an open-source DAP implementation for .NET. Fennec launches it as a subprocess                                                                                       |
| Go                | Delve (DAP)         | **Native DAP**       | `dlv dap` natively speaks DAP. Fennec launches `dlv dap --listen=:port`                                                                                                              |
| Ruby              | ruby/debug          | **DAP integration**  | `ruby/debug` gem includes DAP support. Launch with `rdbg --open --port`                                                                                                              |
| Rust              | LLDB (lldb-dap)     | **lldb-dap**         | `lldb-dap` translates LLDB to DAP. Requires `lldb` installed                                                                                                                         |
| C/C++             | LLDB/GDB (lldb-dap) | **lldb-dap**         | Same as Rust — both use LLVM toolchain                                                                                                                                               |
| Dart/Flutter      | Dart Debugger       | **DAP adapter**      | Dart VM debug protocol, with DAP wrappers available                                                                                                                                  |

---

## 4. Level 3: Auto-Debug (Proactive)

Combines Level 1 + Level 2 with event-driven triggers:

1. **Event Bus detects error** (existing: `browser:console:error`, `process:stderr`, `process:exit`)
2. **Auto-attach debugger** to the failed process
3. **Snapshot**: stack trace, local variables, heap state
4. **Correlate**: browser console + network log at time of error
5. **Generate summary**: structured, token-efficient error report for the AI agent

### Trigger Rules

| Rule                 | Event                                           | Action                                |
| -------------------- | ----------------------------------------------- | ------------------------------------- |
| `auto-debug-crash`   | `process:exit` (non-zero)                       | Attach debugger to restart + snapshot |
| `auto-debug-error`   | `process:stderr` matching error pattern         | Quick stack snapshot                  |
| `auto-debug-browser` | `browser:console:error` + `browser:network:5xx` | Fullstack correlation                 |
| `auto-debug-hang`    | Port down but process alive                     | Hang snapshot + stack dump            |
| `auto-debug-timeout` | Request > threshold                             | Request trace + variables             |

### MCP Tools

| Tool                                 | Description                        | Token Cost      |
| ------------------------------------ | ---------------------------------- | --------------- |
| `debug_auto_report(name)`            | Latest auto-debug report           | ~100-300 tokens |
| `debug_auto_history(name, limit)`    | Recent auto-debug history          | ~50 tokens each |
| `debug_auto_configure(rule, on/off)` | Enable/disable specific auto-rules | ~10 tokens      |

### Token Efficiency

| Technique                            | Savings                                              |
| ------------------------------------ | ---------------------------------------------------- |
| **Reports are structured, not raw**  | No raw log dumps                                     |
| **Summary first, details on demand** | Agent reads summary (~100 tokens), expands if needed |
| **Dedup by error signature**         | Same error 5x → 1 report with `count: 5`             |
| **Auto-ignore noise**                | Known patterns (e.g., Vite HMR errors) are filtered  |
| **TTL on snapshots**                 | Reports expire after 10 minutes (or configurable)    |

### Fullstack Correlation Example

When browser error occurs **AND** backend error is detected:

```
Agent: browser_get_console_logs() → error: "API /users failed"
Agent: debug_auto_report("be-crm") → crash at user.ts:42 caused by DB timeout
Agent: debug_investigate("be-crm") → stack trace + variables at crash
Agent: debug_evaluate("be-crm", "db.connectionString") → connection pool exhausted
```

Instead of 20+ raw log reads → 4 targeted MCP calls.

---

## 5. Mode Column

### `fennec ps` Output

```
│ App    │ PID     │ Status    │ Mode    │ Group │ Port │ MEM(total) │ Command      │ Uptime  │
│ be-crm │ 3101325 │ ● running │ debug   │ crm   │ -    │ 286MB      │ make dev-be  │ 3h 14m  │
│ fe-crm │ 2943401 │ ● running │ watch   │ crm   │ -    │ 312MB      │ make dev-fe  │ 8h 3m   │
│ bot    │ 3240388 │ ● running │ -       │ anoa  │ -    │ 2MB        │ make run-bot │ 1h 2m   │
```

| Mode    | Meaning                       |
| ------- | ----------------------------- |
| `-`     | Normal (no debug)             |
| `watch` | Log watching (Level 0)        |
| `debug` | Breakpoint attached (Level 2) |
| `auto`  | Auto-debug active (Level 3)   |

`process_get_tracked()` returns a `mode` field:

```json
{
  "processes": [
    { "name": "be-crm", "mode": "debug" }
  ]
}
```

---

## 6. Token Efficiency Guarantees

### Per-Tool Budget

| Tool                  | Max Tokens | Default | Configurable |
| --------------------- | ---------- | ------- | ------------ |
| `debug_summary`       | 50         | 30      | ✅           |
| `debug_get_errors`    | 200        | 100     | ✅           |
| `debug_investigate`   | 500        | 200     | ✅           |
| `debug_get_variables` | 300        | 150     | ✅           |
| `debug_auto_report`   | 500        | 200     | ✅           |

All debug tools respect Fennec's existing `tokenBudget` configuration:

```yaml
tokenBudget:
  maxResponseTokens: 8000
  debugMaxTokens: 2000
  debugMaxVariables: 20
  debugMaxStackFrames: 10
```

### Automatic Truncation

| Scenario              | Behavior                                      |
| --------------------- | --------------------------------------------- |
| Too many variables    | Return top N by memory size                   |
| Too many stack frames | Drop frames outside project dir first         |
| Source map not found  | Return raw stack trace (no source links)      |
| Debugger not attached | Return helpful error with attach instructions |

---

## 7. Security Model

### Permission Levels

| Level                    | Tools                                                    | Default                 |
| ------------------------ | -------------------------------------------------------- | ----------------------- |
| **L0 — Debug Logs**      | `debug_get_errors`, `debug_investigate`, `debug_summary` | `allowDebug: true`      |
| **L1 — Breakpoint**      | `debug_set_breakpoint`, `debug_continue`, `debug_step_*` | `allowDebug: true`      |
| **L2 — Read Variables**  | `debug_get_variables`                                    | `allowDebug: true`      |
| **L3 — Eval Expression** | `debug_evaluate`                                         | `allowDebugEval: false` |

### Threat Model

| Threat                                          | Mitigation                                            |
| ----------------------------------------------- | ----------------------------------------------------- |
| Agent reads arbitrary memory via debug_evaluate | `allowDebugEval: false` by default                    |
| Agent modifies variables mid-execution          | `debug_set_variable` is NOT implemented (intentional) |
| Agent sets breakpoints in system libraries      | `debugAllowedDirs` restricts to project               |
| Debug port exposed to network                   | Fennec only binds to `127.0.0.1`                      |
| Race condition: debug attach + process crash    | `debug_attach` validates PID before use               |

---

## 8. Cross-Platform Support

| Feature                         | Linux | macOS                 | Windows             |
| ------------------------------- | ----- | --------------------- | ------------------- |
| Source map resolution           | ✅    | ✅                    | ✅                  |
| JSONL log parsing               | ✅    | ✅                    | ✅                  |
| V8 Inspector (CDP→DAP)          | ✅    | ✅                    | ✅                  |
| PHP Xdebug (DBGp→DAP)           | ✅    | ✅                    | ✅                  |
| Python DAP (debugpy)            | ✅    | ✅                    | ✅                  |
| JVM JDWP→DAP                    | ✅    | ✅                    | ✅                  |
| .NET (NetCoreDbg) DAP           | ✅    | ✅                    | ✅                  |
| Go Delve (native DAP)           | ✅    | ✅                    | ✅                  |
| Ruby ruby/debug (DAP)           | ✅    | ✅                    | ✅                  |
| Rust/C/C++ (lldb-dap)           | ✅    | ✅                    | ✅                  |
| Dart/Flutter DAP                | ✅    | ✅                    | ✅                  |
| File watcher                    | ✅    | ✅                    | ✅ (via `fs.watch`) |
