# 🦊 Fennec Vision

> **Ears everywhere in your stack.**  
> _AI-Native Observability Engine — Browser, Terminal, Process, and beyond._

---

## 🌳 Table of Contents

1. [Identity Crisis → Identity](#1-identity-crisis--identity)
2. [The 7 Pillars](#2-the-7-pillars)
3. [Architecture](#3-architecture)
4. [Token Efficiency — The Core Problem](#4-token-efficiency--the-core-problem)
5. [Lazy Context System](#5-lazy-context-system)
6. [Adapter Architecture](#6-adapter-architecture)
7. [AI-Native API Design](#7-ai-native-api-design)
8. [Current State Assessment](#8-current-state-assessment)
9. [Roadmap](#9-roadmap)
10. [Core Values](#10-core-values)

---

## 1. Identity Crisis → Identity

### What Fennec Is NOT

❌ _"An MCP browser tool based on Playwright"_  
❌ _"Playwright wrapper for AI agents"_  
❌ _"A browser automation framework"_

### What Fennec IS

✅ **AI-Native Observability Engine** — the sensory layer between AI agents and your entire development stack.  
✅ **Event-driven correlation platform** — connects events across browser, server, terminal, and network automatically.  
✅ **Context compression system** — delivers only relevant information to AI, saving 100x+ tokens.

### The Core Shift

```
Before (v1.x):      "AI → Tool → Browser → DOM → AI"
After  (v2.x+):     "AI → Incident → Correlation → Events → Sensors → AI"

The first is a remote control.
The second is a sensory nervous system.
```

---

## 2. The 7 Pillars

### 🦊 Pillar 1 — Observation First

> **Never send raw data to AI if it can be observed first.**

All data sources are treated as **sensors**, not tools:

```
Browser      → BrowserEvent
Terminal     → TerminalEvent
Process      → ProcessEvent
Filesystem   → FileChangedEvent
Git          → GitEvent
Docker       → ContainerEvent
ADB          → DeviceEvent
Network      → HttpEvent
Database     → QueryEvent
```

Each sensor produces **Events**, not Tool Responses.

---

### 🦊 Pillar 2 — Event Driven Architecture

Everything that happens becomes an event:

```
Browser Console                  Network Request
      ↓                                ↓
ConsoleErrorEvent              HttpRequestEvent
      ↓                                ↓
      └────────────┬───────────────────┘
                   ↓
            Event Bus
                   ↓
            Normalizer
                   ↓
            Correlation
```

No collector speaks directly to AI. Everything flows through the Event Bus.

---

### 🦊 Pillar 3 — Correlation Engine

The heart of Fennec. It connects dots automatically:

```
Browser                          Server                        Console
POST /login 500               JWT_SECRET missing              jwt undefined
      ↓                                ↓                            ↓
      └────────────────────────────┬───────────────────────────────┘
                                   ↓
                    Authentication Incident
                    Confidence: 97%
                    Root Cause: JWT_SECRET not set
                    Fix: Add JWT_SECRET to .env
```

AI doesn't connect dots — **Fennec does**.

---

### 🦊 Pillar 4 — Incident Based Reasoning

AI never reads raw logs. AI reads **Incidents**:

```
Incident
├── Type: Authentication Failure
├── Confidence: 96%
├── Evidence:
│   ├── Browser → POST /api/login → 500
│   ├── Server  → JWT_SECRET missing
│   └── Console → jwt undefined
└── Suggested Fix: Set JWT_SECRET in .env
```

If AI needs more detail, it drills down:

```
Expand Incident
  └── Raw Events
       └── Raw Logs
```

Context stays small. Always.

---

### 🦊 Pillar 5 — Lazy Context (Killer Feature)

AI never receives everything at once. Information is delivered in levels:

```
Level 0 (Health):     "Project healthy. 3 warnings, 1 critical."      ~5 tokens
Level 1 (Summary):    "Critical: Database connection failed."          ~10 tokens
Level 2 (Detail):     "Database timeout after 5s. 5 requests failed."  ~30 tokens
Level 3 (Raw):        "Raw SQL: SELECT * FROM users WHERE..."
                       "Raw Log: 2024-01-01 ERROR db timeout"          ~500+ tokens
```

**All on demand. Nothing pushed.**

---

### 🦊 Pillar 6 — Adapter Architecture

Fennec never depends on a single technology:

```
Browser Adapter Layer
├── Chrome Adapter     (CDP native — lightweight, zero deps)
├── Playwright Adapter (full automation — optional, heavy)
├── Firefox Adapter    (future)
├── Safari Adapter     (future)
└── Puppeteer Adapter  (future, community)

Terminal Adapter Layer
├── Node    Adapter
├── Bash    Adapter
├── Python  Adapter
└── PowerShell Adapter (future)

Container Adapter Layer (future)
├── Docker  Adapter
└── Podman  Adapter

Mobile Adapter Layer
├── ADB (Android) — done
└── iOS (future)

Database Adapter Layer
└── 🗄️ Database (dbTui) — PostgreSQL, MySQL, SQLite observation

Git Adapter Layer (future)
VSCode Adapter Layer (future)
```

All adapters implement the same interface. Core Fennec never changes.

---

### 🦊 Pillar 7 — AI Native API

Playwright has: `click()`, `type()`, `fill()`, `locator()`.  
Fennec has:

| Function        | Purpose                                 |
| --------------- | --------------------------------------- |
| `observe()`     | Watch a source and collect events       |
| `diagnose()`    | Full-stack diagnosis with correlation   |
| `explain()`     | Explain what happened in plain language |
| `correlate()`   | Connect events across layers            |
| `summarize()`   | Compress raw data into insight          |
| `investigate()` | Deep dive into a specific incident      |
| `predict()`     | Predict failure based on patterns       |

The API is designed for **AI consumption first**, human readability second.

---

## 3. Architecture

```
                    ┌─────────────┐
                    │     AI      │
                    │   (LLM)     │
                    └──────┬──────┘
                           │ MCP Protocol
                    ┌──────▼──────┐
                    │    MCP      │ ← Just an interface, not the core
                    │  Interface  │
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │  Context    │ ← Compression Layer (Lazy Context)
                    │ Compression │
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
                    │ Normalizer  │
                    └──────┬──────┘
                    ┌──────▼──────┐
                    │  Event Bus  │ ← Central nervous system
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
    │  / Puppet │    │ / pipe  │         │ / attach   │
    └───────────┘    └─────────┘         └────────────┘
```

**Notice:** MCP is just an interface. The core is the Event Bus → Correlation → Incident pipeline.

---

## 4. Token Efficiency — The Core Problem

### Current State (v1.x)

| Source              | What's Sent               | Token Cost    |
| ------------------- | ------------------------- | ------------- |
| DOM Snapshot        | Full `document.outerHTML` | **~500,000**  |
| Console Logs        | 1000 raw lines            | **~10,000**   |
| Network Logs        | 500 raw requests          | **~15,000**   |
| Screenshot          | Base64 image              | **~25,000**   |
| Error Enrichment    | All of the above          | **~30,000+**  |
| **Total per debug** |                           | **~500,000+** |

### Why So Expensive?

1. **Full DOM** — We serialize the entire HTML tree when AI only needs structure
2. **Raw Logs** — We dump all log lines when AI only needs errors and patterns
3. **Base64 Screenshots** — We send images when AI only needs descriptions
4. **No Compression** — Everything is sent at once, no layering

### Not Playwright's Fault

Playwright is just the tool that fetches data. The waste is in **what we ask for** and **how we send it**:

```
Playwright (innocent):  "Here's the DOM you asked for"
                    ↓
Fennec (culprit):       "Thanks! Sending full 2MB DOM to AI now!"
                    ↓
                 AI:     "I only needed to know if the button exists..."
```

---

## 5. Lazy Context System

### Levels

```
Level 0 — Pulse
───────────────
Project: healthy | 3 warnings | 1 critical
Context: ~5 tokens
When:    Always sent with every response

Level 1 — Summary
──────────────────
Critical: Database connection timeout after 5s
Affected: POST /api/login, GET /api/users
Root Cause: DB_HOST unreachable
Context: ~50 tokens
When:    On error, or AI requests "summarize"

Level 2 — Detail
─────────────────
Events:
  [browser] POST /api/login → 500 (120ms)
  [server]  Error: connect ECONNREFUSED 10.0.0.1:5432
  [console] TypeError: Cannot read properties of undefined
Context: ~200 tokens
When:    AI requests "expand" or "detail"

Level 3 — Raw
──────────────
Raw SQL: SELECT * FROM users WHERE id = $1
Raw Log: 2024-06-15T10:30:00.000Z ERROR db: connection refused
Raw DOM: <html>...</html>
Context: ~2000+ tokens
When:    AI explicitly requests "raw" or "full"
```

### Implementation

```typescript
interface LazyContext {
  level: 0 | 1 | 2 | 3;
  getPulse(): PulseResponse; // Always available
  getSummary(incidentId): Summary; // On request
  getDetail(incidentId): Detail; // On "expand"
  getRaw(incidentId): RawData; // On "show raw"
}

// Middleware auto-attaches Level 0 to every response
// AI must explicitly ask for higher levels
```

### Token Savings

| Scenario         | Before  | After     | Savings  |
| ---------------- | ------- | --------- | -------- |
| Normal operation | 2,000   | **50**    | **40x**  |
| Error handling   | 50,000  | **500**   | **100x** |
| Full debugging   | 500,000 | **2,500** | **200x** |

---

## 6. Adapter Architecture

### Interface

```typescript
interface SensorAdapter {
  readonly name: string;
  readonly type: 'browser' | 'terminal' | 'process' | 'mobile' | 'git' | 'docker';

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Events — the adapter's only job is producing events
  subscribe(eventType: string, handler: (event: SensorEvent) => void): void;

  // Optional: direct actions (for automation adapters like Playwright)
  actions?: Record<string, (input: any) => Promise<any>>;
}
```

### Browser Adapters

```
BrowserAdapter (interface)
│
├── CDPObserverAdapter  ← DEFAULT (lightweight, zero deps)
│   │  Uses Chrome DevTools Protocol directly
│   │  For: observation, console, network, DOM summary, screenshots
│   │  Requires: Chrome/Chromium installed
│   │  Deps: None (Node.js built-in fetch + WebSocket)
│   │
├── PlaywrightAdapter   ← OPTIONAL (full automation)
│   │  Uses Playwright
│   │  For: click, type, upload files, drag-drop, Shadow DOM
│   │  Requires: playwright package (100MB)
│   │  Deps: playwright
│   │
└── PuppeteerAdapter    ← FUTURE (community)
     Uses Puppeteer
```

### Adapter Selection Logic

```typescript
// Config-driven
{
  "browser": {
    "adapter": "cdp",     // default: lightweight
    "fallback": "playwright" // if CDP fails
  }
}

// Runtime detection
if (user needs click/type/upload) → use Playwright
if (user only needs observe/diagnose) → use CDP
```

### What CDP Observer Can/Cannot Do

| Feature            | CDP              | Playwright |
| ------------------ | ---------------- | ---------- |
| Navigate to URL    | ✅               | ✅         |
| Console monitoring | ✅               | ✅         |
| Network monitoring | ✅               | ✅         |
| Screenshot         | ✅               | ✅         |
| Run JavaScript     | ✅               | ✅         |
| DOM summary        | ✅ (custom)      | ✅         |
| Click element      | ❌               | ✅         |
| Type text          | ❌               | ✅         |
| File upload        | ❌               | ✅         |
| Drag & drop        | ❌               | ✅         |
| Shadow DOM         | ❌               | ✅         |
| Frame management   | ❌               | ✅         |
| Cross-browser      | ❌ (Chrome only) | ✅         |

---

## 7. AI-Native API Design

### Current Tools (Browser-centric)

```
browser_navigate()
browser_click()
browser_type()
browser_screenshot()
network_get_logs()
devtools_get_console_logs()
```

### Future Tools (Observation-centric)

```
observe_start()          ← Begin observing a source (browser, terminal, process)
observe_stop()           ← Stop observing
observe_get_events()     ← Get events since last check

diagnose()               ← Full-stack diagnosis
diagnose_element()       ← Diagnose specific element
diagnose_network()       ← Diagnose network issues
diagnose_performance()   ← Diagnose performance

explain()                ← Explain current state in plain language
explain_error()          ← Explain an error with context

correlate()              ← Correlate events across layers
correlate_with()         ← Correlate with specific sources

summarize()              ← Summarize logs/events
summarize_session()      ← Summarize entire session

investigate()            ← Deep dive into an incident
investigate_follow()     ← Follow chain of events

incident_list()          ← List all incidents
incident_get()           ← Get incident detail
incident_resolve()       ← Mark incident as resolved
```

### Why This Matters

```
Before (v1.x):
  AI: "I need to check the console... let me call devtools_get_console_logs()
       Now I need to check the network... let me call network_get_failed_requests()
       Now I need to check the server... let me call process_get_logs()"

After (v2.x+):
  AI: "diagnose()" → gets a single Incident with correlated evidence
```

**1 tool call instead of 5. 100x less tokens. Faster debugging.**

---

## 8. Current State Assessment

### ✅ Already Built (Aligned with Vision)

| Component                | File                                             | Notes                             |
| ------------------------ | ------------------------------------------------ | --------------------------------- |
| EventBus                 | `correlation/EventBus.ts`                        | pub/sub, history, pruning — solid |
| CorrelationEngine        | `correlation/CorrelationEngine.ts`               | Timeline builder, multi-layer     |
| RootCauseInferrer        | `correlation/RootCauseInferrer.ts`               | 6+ pattern rules, confidence      |
| BrowserSession interface | `browser/types.ts`                               | Clean abstraction                 |
| Module/Adapter system    | `module/index.ts`                                | `FennecModule` + `ModuleRegistry` |
| Plugin system            | `plugin/PluginSystem.ts`                         | Hooks: before/after tool, onError |
| Pipeline/Middleware      | `middleware/Pipeline.ts`                         | Chain of responsibility           |
| StateMachine             | `state/StateMachine.ts`                          | Context switch detection          |
| KnowledgeGraph           | `knowledge/KnowledgeGraph.ts`                    | Project analysis                  |
| Recorder                 | `recorder/Recorder.ts`                           | Session recording/replay          |
| WorkflowEngine           | `workflow/WorkflowEngine.ts`                     | Debug + login workflows           |
| WorkflowScheduler        | `scheduler/WorkflowScheduler.ts`                 | Auto-trigger rules                |
| CDP Collectors           | `cdp/ConsoleCollector.ts`, `NetworkCollector.ts` | Direct CDP                        |
| Mobile (ADB)             | `modules/mobile/`                                | 11 tools                          |

### ✅ Phase 1 — Quick Wins (Token Efficiency) — ✅ DONE

| Component                       | File                         | Status                                        |
| ------------------------------- | ---------------------------- | --------------------------------------------- |
| DOM Summary (replaces full DOM) | `tools/dom/index.ts`         | ✅ Tree walker summary (~2K tokens vs 500K)   |
| Log Summarizer                  | `tools/devtools/console.ts`  | ✅ Level-based summaries instead of raw logs  |
| Smart Error Enrichment          | `middleware/SmartHook.ts`    | ✅ No auto-screenshot, text summaries only    |
| Lazy Context Level 0 (Pulse)    | `middleware/PulseContext.ts` | ✅ Health pulse on every response (~5 tokens) |

### ✅ Phase 2 — Event Bus Centralization — ✅ DONE

| Component            | File                             | Status                                              |
| -------------------- | -------------------------------- | --------------------------------------------------- |
| Event Normalizer     | `correlation/EventNormalizer.ts` | ✅ NormalizedEvent format for all sensors           |
| Formal Incident type | `incident/types.ts`              | ✅ `Incident`, `IncidentSeverity`, `IncidentStatus` |
| Incident Engine      | `incident/IncidentEngine.ts`     | ✅ Full lifecycle: create, resolve, close, clear    |
| EventBus integration | `server.ts`                      | ✅ IncidentEngine auto-subscribes to EventBus       |

### ✅ Phase 3 — CDP Observer Adapter — ✅ DONE

| Component           | File                    | Status                                         |
| ------------------- | ----------------------- | ---------------------------------------------- |
| CDP Observer Engine | `browser/cdp-engine.ts` | ✅ Full BrowserSession impl via CDP, zero deps |
| WebSocket framing   | `browser/cdp-engine.ts` | ✅ Proper masked frames, upgrade, ping/pong    |
| Chrome lifecycle    | `browser/cdp-engine.ts` | ✅ Auto-launch, reuse existing, cleanup        |

### ✅ Phase 4 — AI-Native API — ✅ DONE

| Component       | File                | Status                                         |
| --------------- | ------------------- | ---------------------------------------------- |
| `observe()`     | `tools/ai/index.ts` | ✅ Multi-sensor observation with levels        |
| `ai_diagnose()` | `tools/ai/index.ts` | ✅ Full-stack diagnosis + root cause inference |
| `correlate()`   | `tools/ai/index.ts` | ✅ Cross-layer event correlation with timeline |
| `summarize()`   | `tools/ai/index.ts` | ✅ Token-efficient log/event/DOM summarization |

### ✅ Completed (Current Session)

| Component                                       | File                                                              | Status                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Route tools through EventBus                    | `middleware/EventBusMiddleware.ts` + `correlation/EventBus.ts`    | ✅ Auto-publishes `tool:executed` events, integrated in pipeline                                                            |
| Lazy Context Level 1-3 (Service)                | `middleware/LazyContext.ts`                                       | ✅ `LazyContext` service with `getSummary()`, `getDetail()`, `getRaw()` methods                                             |
| Lazy Context Level 1-3 (Middleware)             | `middleware/LazyLevels.ts` **NEW**                                | ✅ Config-driven middleware layers: level1 (auto on error), level2 (on detail=full), level3 (on includeRaw=true)            |
| `explain()`, `investigate()`, `predict()` tools | `tools/ai/index.ts`                                               | ✅ 7/7 Pillar 7 tools implemented                                                                                           |
| CDP auto-switch (detection)                     | `browser/AdapterSelector.ts` + `config/defaults.ts`               | ✅ Auto-detect Chrome/Playwright, logged at startup                                                                         |
| CDP ↔ Playwright engine switch                  | `browser/EngineSelector.ts` **NEW** + `session/SessionManager.ts` | ✅ `createEngine()` factory pilih CDP/Playwright, `setEngine()` inject ke SessionManager, fallback ke Playwright jika gagal |
| **🗄️ Database Observation (Phase 1)**           | `sidecar/dbTui/` (Go binary)                                      | ✅ 9 MCP tools (`db_connect`, `db_query`, `db_schema`, etc.), 11 CLI commands, OS keychain credential mgmt, strict read-only mode, auto-download + SHA256 verification |

### 🟡 Future Scope

| Component                             | Priority | Notes                                                        |
| ------------------------------------- | -------- | ------------------------------------------------------------ |
| Adapter auto-fallback on error        | 🟢 Low   | If CDP fails, automatically retry with Playwright            |
| Full EventBus routing for all sensors | 🟢 Low   | Tools now publish events but sensors still have direct paths |

---

## 9. Roadmap

### Phase 1: Quick Wins (Token Efficiency) — Now

**Goal**: Reduce token consumption 100x with minimal code changes.

1. **DOM Summary** — Replace `document.outerHTML` with tree walker + summarize
   - Current: 500K tokens → Target: 2K tokens

2. **Log Summarizer** — Replace raw log dumps with level-based summaries
   - Current: "1000 log lines" → "5 errors, 12 warnings, 983 info"

3. **Smart Error Enrichment** — Stop auto-sending screenshots with every error
   - Current: Always sends screenshot → Only send on explicit request

4. **Lazy Context Level 0** — Add pulse to every response
   - "Project healthy | 3 warnings | 1 critical"

**Estimated impact**: 80% reduction in token usage

---

### Phase 2: Event Bus Centralization — Short Term

**Goal**: Make Event Bus the central nervous system.

1. **Route all tools through EventBus** — Tools publish events, don't return raw data
2. **Event Normalizer** — Standardize event format across all sensors
3. **Formal Incident type** — `Incident { type, evidence, confidence, fix }`
4. **Incident Engine** — Replace simple RootCauseInferrer with full incident lifecycle

**Estimated impact**: Foundation for all future phases

---

### Phase 3: CDP Observer Adapter — Medium Term

**Goal**: Remove Playwright as a hard dependency for observation.

1. **CDP Observer** — Lightweight browser adapter using CDP directly
2. **Make default** — CDP becomes default, Playwright becomes optional
3. **Auto-switch** — Use CDP for observation, fall back to Playwright for automation
4. **DOM Summary via CDP** — Custom CDP-based DOM tree summarization

**Estimated impact**: Zero-dependency observation mode

---

### Phase 4: AI-Native API — Long Term

**Goal**: Complete API redesign for AI consumption.

1. **Add observation tools** — `observe()`, `diagnose()`, `correlate()`, `summarize()`
2. **Deprecate browser-action tools** — Mark `click()`, `type()` as legacy
3. **Lazy Context Level 1-3** — Full multi-level context system
4. **Predictive analysis** — Pattern-based failure prediction

**Estimated impact**: Fennec becomes uniquely positioned

---

## 10. Core Values

These principles must never be violated:

1. **Observation over Automation**  
   _Understand the system first. Clicking is secondary._

2. **Events over Logs**  
   _Logs are just one source of events. Events are the universal language._

3. **Incidents over Raw Data**  
   _AI works with correlated incidents, not raw telemetry._

4. **Correlation over Collection**  
   _Fennec's value is connecting dots, not gathering data._

5. **Compression over Context**  
   _Send minimum viable information. Let AI ask for more._

6. **Adapters over Dependencies**  
   _Never lock into Playwright, Docker, Chrome, or any technology._

7. **AI First, Human Friendly**  
   _API optimized for AI agents. Humans benefit from the simplicity._

---

## Appendix: Why This Matters

### For AI Agents

```
Without Fennec:
  "I can't access your terminal. Please paste the error."

With Fennec:
  "I found 3 issues: server error (500), missing env var, and a client-side
   TypeError. The root cause is JWT_SECRET not set. Fix: add to .env"
```

### For Token Budget

```
Without Fennec:
  DOM snapshot:    500,000 tokens
  Console logs:     10,000 tokens
  Network logs:     15,000 tokens
  Screenshots:      25,000 tokens
  Total:           550,000 tokens  → $0.80+ per debug session

With Fennec (Lazy Context):
  Level 0 pulse:        5 tokens
  Level 1 summary:     50 tokens
  Level 2 detail:      200 tokens
  Level 3 raw:       2,000 tokens (only on demand)
  Total:                ~250 tokens avg  → $0.0004 per interaction
```

**That's 2,000x more efficient.**

### For Developer Experience

```
Before:
  Developer: "Why is my app broken?"
  AI: "I can't help without access. Please paste errors from:
       1. Browser console
       2. Network tab
       3. Terminal
       4. Your .env file"
  Developer: *copy-paste hell*

After:
  Developer: "Why is my app broken?"
  AI: "Let me check." (calls diagnose())
  AI: "Found it. Your JWT_SECRET is missing from .env.
       Set it and restart your dev server."
  Developer: *fixes in 5 seconds*
```

---

> **Fennec is not a browser automation tool.**  
> **Fennec is the sensory nervous system for AI agents.**
>
> _Ears everywhere in your stack._ 🦊
