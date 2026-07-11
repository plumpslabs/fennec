# Changelog

All notable changes to Fennec will be documented in this file.

## [1.13.9] - 2026-07-11

### Fixed
- **`fennec kill --all` now removes stopped tracked apps too.** It previously only deregistered *running* tracked apps, leaving `stopped` entries behind ("No running tracked apps to kill."). `kill` means "permanently remove", so `kill --all` now kills running apps and deregisters every tracked entry (running + stopped), matching the `kill <name>` behavior fixed in v1.13.8.

### Changed
- `kill --all` prompt now shows `Kill <n> running + remove <m> stopped tracked app(s)?`.

## [1.13.8] - 2026-07-11

### Fixed
- **`fennec kill <name>` now removes an already-stopped tracked app from the registry.** Previously it printed "already stopped" and exited, leaving a zombie entry the user could not delete (no `rm` command exists, and `cleanup` only drops entries without a saved command). `kill` means "permanently remove", so a stopped app is now deregistered immediately.

### Added
- Regression test: `kill` on a stopped tracked app removes it from `ps` (CLI E2E suite now 11 tests).

## [1.13.7] - 2026-07-11

### Fixed (process-scoping hardening — same class as the `kill -all` incident)
- **`fennec restart <name>` no longer hunts & SIGKILLs system processes by name.** It was calling `getSystemProcesses({ name, userOnly: true })` and killing the first system match with no re-spawn. `restart` is now **tracked-only** (resolves by tracked name or tracked PID and re-spawns from saved config). Unknown names error out instead of killing arbitrary processes.
- **`fennec kill <name>` no longer targets arbitrary user processes by name** (e.g. `fennec kill node` previously matched every node process). It now only matches Fennec-tracked apps; use an explicit PID to target a system process. Killing by explicit PID still works.
- **`fennec restart <pid>` of a tracked app now actually re-spawns** (previously lookup was name-only, so a PID restarted the process but never re-spawned it).
- **`-y` / `--yes` added to `restart`** for non-interactive use (consistent with `stop` / `kill`).
- **`help` for `kill`** corrected: `--all` now documented as "Kill ALL tracked apps" (was incorrectly "Kill all user processes").

### Added
- Regression tests: `kill`/`restart` by an unknown name must NOT kill an external untracked process; `restart <tracked>` re-spawns correctly (CLI E2E suite now 10 tests).

## [1.13.6] - 2026-07-11

### Fixed
- **CRITICAL: `fennec kill -all` / `kill all` no longer kills every process owned by the user.** It now scopes strictly to Fennec-tracked running apps (`tracked.json`), so unrelated processes (your terminal, editor, browser, other user processes) are never touched. Previously `killAll` called `getSystemProcesses({ userOnly: true })` and terminated the entire user session.
- **`fennec kill -all -y` / `--yes` is now honored** in `killAll`. The `-y` flag was only checked in the single-target path, so `kill all -y` silently fell through to the interactive confirm prompt (which cancels with no TTY) and killed nothing. It is now threaded into `killAll`.

### Added
- Regression test: `kill all` only stops Fennec-tracked apps — an external untracked process must survive (CLI E2E suite, 9 tests).

## [1.13.5] - 2026-07-11

### Added
- **Cross-platform process management** — CLI process introspection now works on macOS and Windows (was Linux-only `/proc`). `findPidOnPort` uses `lsof` (macOS) / `netstat` (Windows); `getProcessCmdline` uses `ps` (macOS) / `wmic` (Windows); `getProcessCwd` uses `lsof` (macOS); `ps` uses `tasklist` (Windows). `attach-*` already cross-platform via core `PortDetector`.
- **`-y` / `--yes` flag** for `stop` and `kill` — non-interactive / automation-friendly (no confirmation prompt).
- **Security env vars now honored** — `FENNEC_SECURITY_ALLOW_PROCESS_SPAWN`, `FENNEC_SECURITY_ALLOW_PROCESS_KILL`, and `FENNEC_SECURITY_ALLOW_JS_EVALUATION` are now read from the environment (previously no-ops).
- **CLI E2E test suite** (`packages/cli/tests/e2e`) — covers daemon lifecycle, adopt-by-port idempotency, supervisor auto-restart after kill, `dev up` idempotency, `dev restart`/`dev down`, `log`/`inspect`/`ps`, and command routing. 8 tests, stable.

### Fixed
- `inspect` log path now respects `FENNEC_DATA_DIR` (was hardcoded to `~/.fennec`).
- README accuracy (root / cli / core): real MCP client config (`stdio` and `--sse` + permission env vars), full command reference, AI-native process control-plane docs, env-var tables, and a cross-platform note.

### Changed
- Version bumped to **1.13.5**.

## [1.11.2] - 2026-07-10

### Added
- **`fennec ps` — show app list** — Shows only Fennec-tracked apps (App, PID, Status, Port, Command, Uptime). Use `-a`/`--system` to see all system processes.
- **`fennec start <command>` — Dual-mode** — `fennec start` starts MCP server, `fennec start <command>` starts an app. Supports `--name`, `--port`, `--cwd`, `--restart`.
- **Process Tracking** (`~/.fennec/tracked.json`) — Started apps are auto-saved. Tracked in `ps`, `status`, `log`, `kill` commands. Auto-cleanup on exit.
- **`fennec kill all` / `fennec kill --all`** — Kill all user processes with confirmation. Shows killed/failed count. Auto-cleans tracked processes.
- **`fennec kill <name>` with multi-match picker** — If multiple processes match, shows interactive selection.
- **`fennec status` — Managed apps dashboard** — Shows tracked apps first (name, port, PID, uptime), then system summary (top 5 CPU processes).
- **`fennec log <name>` — Real journalctl logs** — Fetches logs via journalctl or /proc/pid/fd. Colorizes error/warn lines.

### Changed
- Version bumped to **1.11.2**.
- Port detection removed from `/proc` (was showing incorrect namespace-wide ports). Tracked port comes from `--port` flag.

## [1.11.1] - 2026-07-10

### Fixed
- **Runtime crash on globally installed CLI** (`pc.hex is not a function`) — Added feature detection in `hexColor()` and `format.hex()` to gracefully fall back when picocolors `hex()` is undefined due to CJS/ESM interop on Node.js v24. Fixes `TypeError: pc.hex is not a function` on `fennec start`.
- **Typecheck order** — Root `typecheck` script now builds core before running parallel `-r typecheck`, preventing TS7016 when `dist/` doesn't exist yet.
- **Test mocks** — `Pipeline.test.ts` mock `ToolContext` now includes `lazyContext` property. All 478 tests pass.

### Changed
- Version bumped to **1.11.1**.

## [1.11.0] - 2026-07-10

### Added
- **AI-Native API (7 tools)** — `observe()`, `ai_diagnose()`, `correlate()`, `summarize()`, `explain()`, `investigate()`, `predict()`. Observation-centric API designed for AI consumption first, 100x fewer tokens than browser-centric tools.
- **Lazy Context Levels 1-3** — Config-driven middleware layers: Level 1 (Summary, ~50 tokens, auto on errors), Level 2 (Detail, ~200 tokens, on expand), Level 3 (Raw, ~2000+ tokens, on explicit request). 200x token savings.
- **CDP Observer Engine** (`browser/cdp-engine.ts`) — Zero-dependency browser engine using Chrome DevTools Protocol directly. Navigate, screenshot, evaluate JS, monitor console/network without Playwright.
- **Engine Auto-Switch** (`browser/EngineSelector.ts`) — `createEngine()` dynamically selects CDP (zero-deps) or Playwright (full automation) based on config or runtime detection. Config via `browser.adapter: "auto" | "cdp" | "playwright"`.
- **EventBusMiddleware** — Auto-publishes `tool:executed` events to EventBus for every tool call, enabling real-time incident correlation.
- **Event Normalizer** (`correlation/EventNormalizer.ts`) — Standardizes event format across all sensors.
- **Formal Incident types** (`incident/types.ts`, `incident/IncidentEngine.ts`) — Full incident lifecycle management with confidence scoring, inference rules, and auto-detection.
- **PulseContext Middleware** (Lazy Context Level 0) — Health pulse (`~5 tokens`) attached to every response automatically.

### Changed
- **Token Efficiency** — DOM Summary replaces full HTML (500K → 2K tokens), Log Summarizer replaces raw dumps (10K → 200 tokens), SmartHook no longer auto-sends screenshots (25K → 0). Estimated 200x token savings.
- **SessionManager** — Now accepts external engine via `setEngine()`. Falls back to Playwright if no engine injected.
- **Pipeline** — Enhanced with Lazy Context middleware chain (L1 → L2 → L3 → PulseContext → EventBus). Correct onion-order: PulseContext registered last so `meta.pulse` is available to LazyLevels.
- **ToolContext** — Added `lazyContext: LazyContext` field for AI tools to access Lazy Context service.
- **server.ts** — Auto-detects browser adapter at startup, injects engine into SessionManager.
- **READMEs** — Updated root, CLI, core with AI-Native API, Lazy Context, CDP engine docs.
- **Tool count** — 123 → **130+ tools**, categories: 16 → **17 categories** (added AI-Native API).

### Fixed
- Pipeline middleware ordering: PulseContext registered after LazyLevels so `meta.pulse` is available when Level 1 middleware reads it.
- Test mocks: `server.test.ts` and `Pipeline.test.ts` now include missing `lazyContext` field.

## [1.10.0] - 2026-06-30

### Added
- **Mobile Module** — 11 ADB-based Android tools: `mobile_list_devices`, `mobile_tap`, `mobile_type`, `mobile_swipe`, `mobile_keyevent`, `mobile_screenshot`, `mobile_logcat`, `mobile_install_apk`, `mobile_launch_app`, `mobile_stop_app`, `mobile_device_info`
- **Module System** — `FennecModule` interface + `ModuleRegistry` for plug-and-play module registration
- **BrowserEngine Abstraction** — `BrowserSession` interface separates tools from Playwright; future engine swaps (Puppeteer, CDP Direct) without touching tool handlers
- Tool count: 112 → **123 tools**, categories: 15 → **16 categories** (added Mobile)

### Changed
- **SessionManager** — Uses `BrowserSession` instead of Playwright `Page` directly
- **All 90+ tool handlers** — Migrated from `session.page.*` to `session.browser.*`
- **CDP Collectors** — Updated to use `BrowserCDPSession` instead of Playwright `CDPSession`
- **StateMachine** — Uses `session.browser` for state detection
- **Project structure** — Added `modules/` directory for domain modules, `module/` for module infrastructure

### Removed
- Direct Playwright imports from all tool files (accessible only via `browser/playwright-engine.ts`)

## [1.9.0] - 2026-06-30

### Added
- SmartHook auto-recovery: 11 fallback selectors + tool action recovery on ELEMENT_NOT_FOUND
- StateMachine middleware: auto-state transitions on every tool call with detectState()
- Planner-WorkflowEngine integration: `planToWorkflow()`, `executePlan()`, 5 planner tools
- Selector refactoring: `findSubmitButton()` + `fillField()` use `resolveSelector()` for ARIA/text-aware matching
- 18 unit tests for smart tools (findSubmitButton + fillField with mocked Page)
- Planner tools: `planner_execute_goal`, `planner_create_plan`, `planner_list_plans`, `planner_get_plan`, `planner_cancel_plan`

### Changed
- Tool count updated: 87 → **112 tools**, categories expanded: 14 → **15 categories**
- Version consistency: all `0.1.0` and `1.8.0` references bumped to `1.9.0`
- README files updated with accurate tool counts and Planner documentation

### Fixed
- `zod` hoisting issue: added to root `package.json` for proper workspace resolution
- `server.test.ts` mock: added missing `setToolExecutor`, `planToWorkflow`, `executePlan` methods

## [1.8.0] - 2026-06-29

### Added
- SSE Transport support (`FENNEC_TRANSPORT_TYPE=sse` or `fennec.config.json` transport.type)
- Tool categories for token efficiency (14 categories, client-side filtering via `getByCategories()`)
- Self-observability with PerformanceMetrics (tool call duration, memory snapshots, error rate)
- Audit Log middleware (all tool calls recorded with timestamp, session, input/output)
- HAR export support via `HarExporter.exportAsHar()`
- Shadow DOM support for `browser_get_dom_snapshot` and `browser_find_elements`
- Unit tests for SessionManager (initialization, lifecycle, buffer management, error handling)
- Unit tests for FennecServer (initialization, tool registration, pipeline setup)
- E2E test scaffold for browser tool validation
- Window CI matrix support

### Changed
- All tool definitions now include `category` field for grouping
- ListTools response includes `_category` per tool and `_categories` list
- MiddlewareContext now includes `category` field propagated from ToolDefinition
- EventBus supports time-based pruning (`startPruning(maxAgeMs)`)
- SessionManager has automatic buffer pruning (5-min TTL for console/network events)
- Windows scripts: `rm -rf dist` → cross-platform `node -e` commands
- READMEs (root, core, CLI) rewritten with comprehensive feature documentation
- `security-model.md` updated with audit log documentation

### Fixed
- Version consistency: root `package.json` now matches packages at 1.8.0
- Pipeline field placement in server.ts constructor
- SmartHook: error handling for closed pages

## [1.7.0] - 2026-06-20

### Added
- Smart tools: `smart_wait`, `smart_navigate`, `smart_fill_form`, `smart_validate_form`
- `browser_screenshot_annotated` with numbered element overlays
- `browser_screenshot_export` as standalone HTML with interactive overlays
- `browser_screenshot_diff` with visual diff report generation
- Workflow Scheduler for auto-triggered diagnosis
- ErrorEnricher for automatic screenshot + console log capture on errors
- StateManager for multi-session context tracking

### Changed
- Pipeline middleware architecture with retries, permissions, telemetry
- Full MCP protocol compliance for all tool responses

## [1.6.0] - 2026-06-15

### Added
- Initial MCP server implementation
- Browser automation tools (navigation, interaction, DOM, devtools)
- Process management tools (spawn, kill, attach, pipe)
- Storage management tools (cookies, localStorage, IndexedDB)
- Auth tools (login form filling, session save/load)
- Diagnostic tools (page, element, network, auth, fullstack, performance)
- Correlation engine with EventBus and RootCauseInferrer
- Session management with multi-session support
- CDP monitoring for console and network events
- Full-stack correlation between browser events and server logs

[Initial releases before 1.6.0 are not tracked in this changelog.]
