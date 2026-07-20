# Fennec Debugger

> Fennec is a **development observation & debugging tool**. Never meant for production.

| Principle                       | Why                                          |
| ------------------------------- | -------------------------------------------- |
| Debug is **opt-in** per process | Zero overhead by default                     |
| No production monitoring        | Dev tool, not Datadog                        |
| Lazy adapters                   | Nothing loaded until first `debug_*` call    |
| Structured output               | JSON, not raw dumps — token-efficient for AI |

---

## 1. Architecture

```
AI Agent (MCP Client)
  debug_set_breakpoint  debug_continue  debug_get_variables
       │
       │ MCP Protocol
       ▼
┌───────────────────────────────────────────┐
│            Fennec Debug Engine              │
│                                             │
│  Level 1 (Log)     Level 2 (Breakpoint)    │
│  ┌─────────────┐   ┌───────────────────┐   │
│  │ error dedup  │   │  CDP  (browser)   │   │
│  │ source maps  │   │  DAP  (Python/Go  │   │
│  │ log reading  │   │        .NET/Ruby  │   │
│  │ crash snap   │   │        Rust/Dart) │   │
│  └─────────────┘   │  DBGp (PHP)        │   │
│                    │  JDWP (Java)       │   │
│  ┌────────────────┐└───────────────────┘   │
│  │ Adapter Layer  │                        │
│  │ V8 · DAP · DBGp│                        │
│  │ JDWP           │                        │
│  └────────────────┘                        │
└───────────────────────────────────────────┘
```

### Runtime Protocol Matrix

| Runtime      | Protocol           | Adapter           | Status        |
| ------------ | ------------------ | ----------------- | ------------- |
| Browser (JS) | CDP (V8 Inspector) | `v8-adapter.ts`   | ✅ Working    |
| Node.js      | CDP (V8 Inspector) | `v8-adapter.ts`   | ✅ Working    |
| Python       | DAP (debugpy)      | `dap-adapter.ts`  | ✅ Code ready |
| Go           | DAP (dlv dap)      | `dap-adapter.ts`  | ✅ Code ready |
| .NET         | DAP (netcoredbg)   | `dap-adapter.ts`  | ✅ Code ready |
| Ruby         | DAP (ruby/debug)   | `dap-adapter.ts`  | ✅ Code ready |
| Rust/C/C++   | DAP (lldb-dap)     | `dap-adapter.ts`  | ✅ Code ready |
| Dart/Flutter | DAP                | `dap-adapter.ts`  | ✅ Code ready |
| PHP          | DBGp (Xdebug)      | `dbgp-adapter.ts` | ✅ Code ready |
| Java/Kotlin  | JDWP               | `jdwp-adapter.ts` | ✅ Code ready |

---

## 2. Level 1: Log Mode (Passive)

No debugger attachment. Reads logs, dedup errors, maps stack traces.

```bash
fennec start make dev-be --name api-service --debug
fennec debug attach api-service              # default: log mode
fennec debug attach api-service --mode log   # explicit
```

### MCP Tools

| Tool                                 | Description                  | Cost    |
| ------------------------------------ | ---------------------------- | ------- |
| `debug_get_errors(name)`             | Errors grouped by stack hash | ~50t    |
| `debug_get_error_detail(name, hash)` | Full trace + source map      | ~200t   |
| `debug_investigate(name)`            | Root cause analysis          | ~150t   |
| `debug_logs_since(name, ts)`         | Logs after timestamp         | Bounded |
| `debug_summary(name)`                | Health + latest error        | ~30t    |

### Crash Capture (Auto, built-in)

When log mode is active, Fennec auto-captures crash/error context:

1. EventBus detects: `process:stderr`, `process:exit`, `browser:console:error`, `browser:network:5xx`
2. Snapshot: error message + recent logs + correlated groups
3. Dedup: same error within 30s increments counter
4. TTL: snapshots expire after 10 min

| Tool                                 | Description      | Cost      |
| ------------------------------------ | ---------------- | --------- |
| `debug_auto_report(name)`            | Latest snapshot  | ~100-300t |
| `debug_auto_history(name)`           | Recent snapshots | ~50t each |
| `debug_auto_configure(rule, on/off)` | Toggle rules     | ~10t      |

### Error Dedup

```
10x "TypeError: Cannot read property 'x' of undefined at user.ts:42"
→ 1 entry: { message: "...", count: 10, firstSeen, lastSeen }
```

---

## 3. Level 2: Breakpoint Mode (Active)

Attaches debugger to running process. Runtime is auto-detected.

```bash
fennec debug attach api-service --mode breakpoint

# MCP agent then calls:
# debug_set_breakpoint(name="api-service", file="src/main.py", line=42)
# debug_continue(name="api-service")
# debug_get_variables(name="api-service")
```

### MCP Tools

All breakpoint tools accept either `name` (tracked process — auto-detect runtime) or `sessionId` (browser — use CDP).

| Tool                                        | Description          | Cost      |
| ------------------------------------------- | -------------------- | --------- |
| `debug_set_breakpoint(name, file, line)`    | Set breakpoint       | ~20t      |
| `debug_continue(name)`                      | Resume execution     | ~10t      |
| `debug_step_over(name)`                     | Step over            | ~10t      |
| `debug_step_into(name)`                     | Step into            | ~10t      |
| `debug_list_breakpoints(name)`              | List active BPs      | ~20t      |
| `debug_remove_breakpoint(name, id)`         | Remove BP            | ~10t      |
| `debug_get_variables(name)`                 | Scope variables      | ~150t     |
| `debug_evaluate(name, expr)`                | Eval expression      | ~30t      |
| `debug_get_pause_state(name)`               | Is paused?           | ~50t      |
| `debug_set_logpoint(name, file, line)`      | Non-blocking log     | ~20t      |
| `debug_investigate_runtime(name, question)` | Guided investigation | ~200-500t |

### Variable Safety

- Max 20 variables per scope
- 3 levels deep, then `{...}`
- First 5 array items, then `+N more`
- String values truncated at 80 chars

### Security

| Concern                    | Mitigation                                         |
| -------------------------- | -------------------------------------------------- |
| Arbitrary memory read      | `debug.allowDebugEval: false` by default           |
| Variable modification      | `debug_set_variable` intentionally not implemented |
| Breakpoints in system libs | `debug.allowedDirs` restricts to project           |
| Remote debug attach        | Localhost only                                     |

```yaml
debug:
  allowDebug: true
  allowDebugEval: false
  allowedDirs:
    - /home/user/projects
  allowDependencies: false
```

---

## 4. Token Budget

| Tool                  | Max | Default | Configurable |
| --------------------- | --- | ------- | ------------ |
| `debug_summary`       | 50  | 30      | ✅           |
| `debug_get_errors`    | 200 | 100     | ✅           |
| `debug_investigate`   | 500 | 200     | ✅           |
| `debug_get_variables` | 300 | 150     | ✅           |
| `debug_auto_report`   | 500 | 200     | ✅           |

```yaml
tokenBudget:
  maxResponseTokens: 8000
  debugMaxTokens: 2000
  debugMaxVariables: 20
  debugMaxStackFrames: 10
```

---

## 5. CLI Reference

```bash
fennec debug attach <name> [--mode log|breakpoint]
fennec debug detach <name>
fennec debug status [name]
```

### Mode Column (fennec ps)

```
│ App          │ PID  │ Mode │ Command      │
│ api-service  │ 123  │ L    │ make dev-be  │
│ web-app      │ 456  │ B    │ make dev-fe  │
```

| Mode | Meaning                   |
| ---- | ------------------------- |
| `-`  | No debug                  |
| `L`  | Log mode (Level 1)        |
| `B`  | Breakpoint mode (Level 2) |

---

## 6. Debug Workflow Examples

### 1. Quick error triage (log mode)

```bash
fennec start make dev-be --name api-service
fennec debug attach api-service

# Agent calls:
debug_get_errors("api-service")
# → 2 error groups: [TypeError x5, Timeout x3]

debug_investigate("api-service")
# → rootCause: TypeError at user.ts:42 (5x)
# → suggestedFix: check for null/undefined values
```

### 2. Deep debug (breakpoint mode)

```bash
fennec debug attach api-service --mode breakpoint

# Agent calls:
debug_set_breakpoint(name="api-service", file="src/user.ts", line=42)
# → "Breakpoint set. Trigger the code path."

# (user performs action that triggers breakpoint)

debug_get_variables(name="api-service")
# → scopes: [{ type: "local", variables: [{ name: "user", value: "null" }] }]

debug_continue(name="api-service")
```

### 3. Multi-runtime (Python)

```bash
fennec start python app.py --name my-api
fennec debug attach my-api --mode breakpoint

# Agent calls (auto-detects Python, uses DAP/debugpy):
debug_set_breakpoint(name="my-api", file="app.py", line=42)
debug_continue(name="my-api")
debug_get_variables(name="my-api")
```

---

## 7. Cross-Platform

| Feature                                        | Linux | macOS | Windows |
| ---------------------------------------------- | ----- | ----- | ------- |
| Log mode (error dedup)                         | ✅    | ✅    | ✅      |
| CDP breakpoint (browser/Node)                  | ✅    | ✅    | ✅      |
| DAP breakpoint (Python/Go/.NET/Ruby/Rust/Dart) | ✅    | ✅    | ✅      |
| DBGp breakpoint (PHP)                          | ✅    | ✅    | ✅      |
| JDWP breakpoint (Java)                         | ✅    | ✅    | ✅      |
| Source map resolution                          | ✅    | ✅    | ✅      |
| Crash capture (EventBus)                       | ✅    | ✅    | ✅      |
