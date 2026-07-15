# Fennec Debugger — AI-Native Debug Engine

> **Status:** Proposal / Planning  
> **Target:** Fennec v2.0  
> **Design Principle:** Zero-overhead when unused, token-efficient when active, language-agnostic where possible.

---

## 1. Philosophy

### Fennec = Development Tool, NOT Production

Fennec is an **observation & debugging tool for development**. It is never meant to run in production environments.

| Design Decision                                     | Rationale                                     |
| --------------------------------------------------- | --------------------------------------------- |
| Debug features always **opt-in** via `--debug` flag | No accidental overhead                        |
| No production monitoring features                   | Fennec is a **dev tool**, not Datadog/Grafana |
| `--debug` mode injects agents only in dev           | Safety guarantee — never attaches to prod     |
| Default mode remains unchanged                      | Backward compatible, zero overhead            |

### Target Users

- **Solo developers** debugging fullstack apps
- **AI coding agents** (Cursor, Claude Code, etc.) that need runtime introspection
- **QA/Test engineers** writing automated browser tests
- **CI pipelines** for debugging flaky tests

---

## 2. Architecture Overview

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

## 3. Level 1: Smart Log Debugging (Passive)

### How It Works

No debugger attachment needed. An augmented log watcher that:

- Parses structured log output (JSONL, stack traces, source maps)
- Groups related errors (dedup by stack hash)
- Maps stack traces to source code (via source maps)
- Summarizes errors for token-efficient AI consumption

### User Experience

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

### Token Efficiency Strategy

| Technique                                      | Savings                                       |
| ---------------------------------------------- | --------------------------------------------- |
| **Error dedup by stack hash**                  | Catches 10 identical errors → returns 1 entry |
| **Source-mapped links instead of full trace**  | ~50 tokens vs ~500 tokens                     |
| **Grouped by type** (TypeError, Timeout, etc.) | Agent picks category, not all                 |
| **Pre-computed root cause**                    | Saves agent from analyzing raw logs           |

### Security

- `security.allowDebug: false` by default
- Debug logs are **also redacted** (same as existing log redaction)
- Source maps must be within project directory (no arbitrary file read)

### Cross-Platform

- Source map resolution: pure Node.js — works on Win/Mac/Linux
- Log parsing: filesystem-based — works everywhere
- JSONL/structured log format: language-agnostic

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

## 4. Level 2: Breakpoint Debug Mode (Active)

### How It Works

Attaches a debugger to the running process via platform-specific protocol:

- **Node.js → V8 Inspector Protocol** (via existing CDP infrastructure)
- **Python → Debug Adapter Protocol (DAP)** or pydevd
- **JVM → Java Debug Wire Protocol (JDWP)**
- **.NET → .NET Debugger**

The debugger is attached **on demand** (lazy) — not at process start.

### User Experience

```bash
# Attach debugger to running app
fennec debug attach be-crm --breakpoint

# Mode column now shows "debug" status
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

### Token Efficiency Strategy

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

Security config additions:

```yaml
security:
  allowDebug: true
  allowDebugEval: false # expression evaluation (high risk)
  debugAllowedDirs:
    - /home/user/projects # restrict breakpoints to this dir
  debugAllowDependencies: false # allow breakpoints in node_modules/.venv
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

### Cross-Platform

| OS      | V8 (CDP→DAP) | PHP (DBGp→DAP) | Python DAP | JVM (JDWP→DAP) | .NET DAP | Go (Delve) | Ruby DAP | Rust (LLDB-dap) |
| ------- | ------------ | -------------- | ---------- | -------------- | -------- | ---------- | -------- | --------------- |
| Linux   | ✅           | ✅             | ✅         | ✅             | ✅       | ✅         | ✅       | ✅              |
| macOS   | ✅           | ✅             | ✅         | ✅             | ✅       | ✅         | ✅       | ✅              |
| Windows | ✅           | ✅             | ✅         | ✅             | ✅       | ✅         | ✅       | ✅              |

All debug protocols use TCP sockets or stdio — inherently cross-platform.

### Multi-Language

| Runtime           | Protocol            | Adapter Strategy     | Notes                                                                                                                                                                                |
| ----------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js           | V8 Inspector (CDP)  | **CDP→DAP bridge**   | Reuse existing `cdp-engine.ts`; translate CDP debug events to DAP                                                                                                                    |
| **PHP**           | **Xdebug (DBGp)**   | **DBGp→DAP proxy**   | PHP runs Xdebug, which uses the DBGp protocol (TCP). Use `vscode-php-debug`'s approach — a DAP-to-DBGp translator. Agent sets breakpoints via DAP, adapter forwards as DBGp commands |
| Python (CPython)  | DAP (debugpy)       | **Native DAP**       | `debugpy` is already DAP-compliant. Fennec launches `debugpy --connect` and speaks DAP directly                                                                                      |
| Python (PyPy)     | DAP                 | ⚠️ Partial           | Limited DAP support via PyPy's debugger interface                                                                                                                                    |
| JVM (Java/Kotlin) | JDWP                | **JDWP→DAP bridge**  | JDWP is a raw JVM wire protocol. Build a lightweight JDWP-to-DAP adapter (similar to `vscode-java-debug`)                                                                            |
| JVM (Scala)       | JDWP                | **JDWP→DAP bridge**  | Same as JVM — Scala runs on JVM, uses same JDWP                                                                                                                                      |
| .NET (C#, F#, VB) | .NET Debugger       | **NetCoreDbg (DAP)** | `netcoredbg` is an open-source DAP implementation for .NET. Fennec launches it as a subprocess                                                                                       |
| Go                | Delve (DAP)         | **Native DAP**       | `dlv dap` natively speaks DAP. Fennec launches `dlv dap --listen=:port`                                                                                                              |
| Ruby              | ruby/debug          | **DAP integration**  | `ruby/debug` gem includes DAP support. Launch with `rdbg --open --port`                                                                                                              |
| Rust              | LLDB (lldb-dap)     | **lldb-dap**         | `lldb-dap` (formerly `lldb-vscode`) translates LLDB to DAP. Requires `lldb` installed                                                                                                |
| C/C++             | LLDB/GDB (lldb-dap) | **lldb-dap**         | Same as Rust — both use LLVM toolchain                                                                                                                                               |
| Zig               | LLDB (lldb-dap)     | **lldb-dap**         | Zig uses LLVM toolchain, debuggable via `lldb-dap`                                                                                                                                   |
| Swift             | LLDB (lldb-dap)     | **lldb-dap**         | Official Swift toolchain includes `lldb-dap`                                                                                                                                         |
| Dart/Flutter      | Dart Debugger       | **DAP adapter**      | Dart VM debug protocol, with DAP wrappers available                                                                                                                                  |
| Elixir/Erlang     | :debugger           | 🔧 Research          | Custom Erlang debug protocol, limited DAP support                                                                                                                                    |

---

## 5. Level 3: Auto-Debug (Proactive)

### How It Works

Combines Level 1 + Level 2 with event-driven triggers:

1. **Event Bus detects error** (existing: `browser:console:error`, `process:stderr`, `process:exit`)
2. **Auto-attach debugger** to the failed process
3. **Snapshot**: stack trace, local variables, heap state
4. **Correlate**: browser console + network log at time of error
5. **Generate summary**: structured, token-efficient error report for the AI agent

### Trigger Rules (auto-debug)

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

### Token Efficiency Strategy

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

## 6. PS Mode Column

### Current `fennec ps` Output

```
│ App    │ PID     │ Status    │ Group │ Port │ MEM(total) │ Command      │ Uptime  │
│ be-crm │ 3101325 │ ● running │ crm   │ -    │ 256MB      │ make dev-be  │ 3h 14m  │
```

### With Debug Mode Column

```
│ App    │ PID     │ Status    │ Mode    │ Group │ Port │ MEM(total) │ Command      │ Uptime  │
│ be-crm │ 3101325 │ ● running │ debug   │ crm   │ -    │ 286MB      │ make dev-be  │ 3h 14m  │
│ fe-crm │ 2943401 │ ● running │ watch   │ crm   │ -    │ 312MB      │ make dev-fe  │ 8h 3m   │
│ bot    │ 3240388 │ ● running │ -       │ anoa  │ -    │ 2MB        │ make run-bot │ 1h 2m   │
```

### Mode Values

| Mode    | Meaning                       | Color          |
| ------- | ----------------------------- | -------------- |
| `-`     | Normal (no debug)             | dim            |
| `watch` | Log watching (Level 0)        | cyan           |
| `debug` | Breakpoint attached (Level 2) | yellow         |
| `auto`  | Auto-debug active (Level 3)   | red (flashing) |

### MCP Equivalent

`process_get_tracked()` now returns `mode` field:

```json
{
  "processes": [
    { "name": "be-crm", "mode": "debug", ... }
  ]
}
```

---

## 7. Implementation Phases

### Phase 1 (v1.15 — 1 week)

**Scope:** Level 1 — Smart Log Debugging

| Task                                | Effort  | Priority |
| ----------------------------------- | ------- | -------- |
| Source map resolver utility         | 1 day   | P0       |
| Error dedup by stack hash           | 1 day   | P0       |
| `debug_get_errors` tool             | 1 day   | P0       |
| `debug_investigate` tool            | 1 day   | P0       |
| `debug_summary` tool                | 0.5 day | P1       |
| `--debug` flag parser               | 0.5 day | P1       |
| Update `fennec ps` with mode column | 0.5 day | P2       |

**Token efficiency baseline:** Level 1 saves ~70% tokens vs raw log reading.

### Phase 2 (v1.16 — 2 weeks)

**Scope:** Level 2 — Breakpoint Debug Mode

| Task                                             | Effort | Priority |
| ------------------------------------------------ | ------ | -------- |
| V8 Inspector adapter (reuse CDP)                 | 2 days | P0       |
| `debug_set_breakpoint` tool                      | 1 day  | P0       |
| `debug_continue` / `step_*` tools                | 1 day  | P0       |
| `debug_get_variables` tool                       | 1 day  | P0       |
| `debug_evaluate` tool                            | 1 day  | P0       |
| Security config (`allowDebug`, `allowDebugEval`) | 1 day  | P0       |
| Python DAP adapter                               | 2 days | P1       |
| PHP Xdebug (DBGp→DAP) adapter                    | 2 days | P1       |
| JVM JDWP→DAP adapter                             | 3 days | P2       |
| Documentation + examples                         | 1 day  | P1       |

**Token efficiency baseline:** Level 2 saves ~90% tokens vs manual debugging workflows.

### Phase 3 (v1.17 — 3 weeks)

**Scope:** Level 3 — Auto-Debug + Adapter Expansion

| Task                                      | Effort | Priority |
| ----------------------------------------- | ------ | -------- |
| Auto-debug trigger engine                 | 2 days | P0       |
| `debug_auto_report` tool                  | 1 day  | P0       |
| Fullstack correlation (browser ↔ backend) | 2 days | P0       |
| .NET (NetCoreDbg) DAP adapter             | 2 days | P1       |
| Go (Delve native DAP) adapter             | 2 days | P1       |
| Ruby (ruby/debug) DAP adapter             | 1 day  | P2       |
| Rust (lldb-dap) adapter                   | 3 days | P2       |
| Dart/Flutter DAP adapter                  | 2 days | P3       |
| C/C++ (lldb-dap) adapter                  | 2 days | P3       |
| Zig/Swift (lldb-dap) adapter              | 2 days | P3       |
| Auto-debug rule configuration             | 1 day  | P1       |
| Token budget integration                  | 1 day  | P1       |
| CI test suite for debug features          | 2 days | P1       |

**Token efficiency baseline:** Level 3 saves ~95% tokens vs manual fullstack debugging.

---

## 8. Token Efficiency Guarantees

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
  debugMaxTokens: 2000 # new — max tokens for debug tools
  debugMaxVariables: 20 # new — max variables per scope snapshot
  debugMaxStackFrames: 10 # new — max stack frames per trace
```

### Automatic Truncation

| Scenario              | Behavior                                      |
| --------------------- | --------------------------------------------- |
| Too many variables    | Return top N by memory size                   |
| Too many stack frames | Drop frames outside project dir first         |
| Source map not found  | Return raw stack trace (no source links)      |
| Debugger not attached | Return helpful error with attach instructions |

---

## 9. Security Model

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

## 10. Cross-Platform Support

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
| Rust/C/C++/Zig/Swift (lldb-dap) | ✅    | ✅                    | ✅                  |
| Dart/Flutter DAP                | ✅    | ✅                    | ✅                  |
| /proc/pid/task/children         | ✅    | ❌ (fallback to `ps`) | ❌                  |
| File watcher                    | ✅    | ✅                    | ✅ (via `fs.watch`) |

---

## 11. Resource Impact

| Aspect      | Without Debug | With Debug (L1)           | With Debug (L2)         | With Debug (L3)               |
| ----------- | ------------- | ------------------------- | ----------------------- | ----------------------------- |
| **Memory**  | Baseline      | +2MB (source map cache)   | +10MB (debug adapter)   | +15MB (full + event bus)      |
| **CPU**     | Baseline      | +0.5% (log parsing)       | +2% (debugger polling)  | +3% (auto-trigger evaluation) |
| **Latency** | Baseline      | +0ms (async log parsing)  | +5ms per breakpoint hit | +10ms per auto-debug trigger  |
| **Disk**    | Baseline      | +100KB (source map cache) | +1MB (debug symbols)    | +5MB (debug snapshots)        |

_All impacts are estimates. Debug mode is opt-in — zero impact when not used._

---

## 12. Future Considerations

- **LLM Integration:** Auto-debug reports could feed into local LLM for fix suggestions
- **Time Travel Debug:** Record and replay execution (requires `rr` or similar)
- **Collaborative Debug:** Share debug sessions between AI agents
- **Visual Debug UI:** Web UI built into Fennec's SSE server for human-friendly debugging
- **Hot Reload Integration:** Combine breakpoint → edit → continue without restart
- **Memory Leak Detection:** Auto-detect growing heap in debug mode
- **Performance Profiling:** Add CPU profiling alongside debug (via existing CDP performance tools)
- **Snapshot Diff:** Compare variable values between two breakpoint hits

---

## 13. Success Metrics

| Metric                           | Target                           |
| -------------------------------- | -------------------------------- |
| Token savings vs manual tools    | ≥70% (L1), ≥90% (L2), ≥95% (L3)  |
| Time to debug a typical error    | ≤3 tool calls (instead of 10-20) |
| False positive rate (auto-debug) | ≤5%                              |
| Integration test coverage        | ≥90% of debug tools              |
| Cross-platform test pass rate    | 100% on Linux/macOS/Windows      |
