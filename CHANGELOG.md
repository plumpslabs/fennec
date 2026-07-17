# Changelog

All notable changes to Fennec will be documented in this file.

## [1.15.3] - 2026-07-17

### Added
- **Bulk session rm.** `store session rm <name...>` and `sessions rm <name...>` accept multiple names for mass deletion with single confirmation prompt.
- **Nested `--help` for subcommands.** `store session --help`, `sessions rm --help`, `sessions info --help` now show specific docs instead of parent command help.
- **`adopt` and `doctor` command docs.** Both commands were missing from the help system entirely — now visible in `fennec --help` with full descriptions, options, and examples.
- **`workflow` visible in help.** Was defined but not referenced in any group — now appears under Apps & Processes.
- **`process_spawn` group preservation.** Re-spawn/adoption path now preserves the existing entry's group via `effectiveGroup`.

### Changed
- **Comprehensive help docs overhaul.** All 40 COMMANDS entries now have `description`, `options`, and `examples`:
  - 13 skeleton entries (info, rename, attach-pid, attach-port, import, cleanup, init, setup, install-browsers, sessions, health, help, version) gained full descriptions
  - 7 entries missing description (status, restart, run, attach, pipe, watch, export) gained detailed explanations

## [1.15.2] - 2026-07-16

### Added
- **Element index selector.** `index` param on `browser_click`, `browser_type`, `browser_hover`, `browser_focus`, `browser_get_element_info` — resolves strict mode violations when selector matches N elements (#47).
- **`fennec_flow` composite tool.** Single-call `debug-element`, `page-health`, `form-fill` flows replacing 3-5 separate tool calls (#54).
- **Token budget awareness.** `compact:true` mode on `browser_get_accessibility_tree` (flat list + child counts vs full nested tree). Estimated response sizes in tool descriptions (#58).
- **`url` param on `auth_load_session`.** Navigate to a specific page after restoring session instead of the saved origin (#59).
- **`compact` mode on `browser_screenshot_annotated`.** Return elements-only without base64 screenshot (#48).
- **`maxDepth` option on `browser_get_dom_snapshot`.** Default 10, max 50, with `truncated:true` flag when hit (#50).
- **`inheritSession` option on `tab_new`.** Copies cookies + localStorage to new tab (#52).

### Changed
- **Error recovery improvements.** Strict mode violation detected in catch blocks — suggests `index` param. Element-not-found errors include `context.url` with current page URL (#56).
- **`smart_fill_form` field matching.** Prioritizes type-exact matches (`type="email"` for query "email") before partial string matching — fixes field mis-identification (#59).
- **`process_wait_for_ready` error message.** Shows stopped tracked processes with actionable `process_spawn_tracked` suggestion (#59).
- **Tool naming audit.** Verified all 164+ tool names use snake_case consistently (#53).

### Fixed
- **browser_get_dom_snapshot SVG crash.** `className.slice` on SVG elements fixed via `String()` coercion (#45).
- **Browser click latency ~35s.** Per-strategy 2s timeout + per-session selector cache (#43).
- **browser_find_elements false negatives.** Vanilla DOM fallback via `querySelectorAll` when unified engine returns 0 (#44).
- **Network log gaps (Axios/XHR).** CDP monitoring starts on default session, not only on rotation. `since` filter on `network_get_logs` (#46).
- **Empty JS error messages.** Fallback to CDP `exception.description` when `text` is empty. `window.onerror` injection (#55).
- **observe stale incidents.** URL tracking + console/network buffer flush on navigation + `fresh:true` flag (#51).
- **Session ID opacity.** New `session_list` tool, `listSessions()`, `getDefaultSessionId()` (#57).

## [1.15.0] - 2026-07-15

### Added
- **🐛 Debug Engine (26 tools, 3 levels).** Multi-language debugger:
  - **Level 1 — Log Debug:** Smart error dedup by stack hash, source map resolution, grouped summaries. 10 identical errors → 1 entry.
  - **Level 2 — Breakpoint Debugging:** V8/CDP, Python DAP, PHP DBGp→DAP, Java JDWP→DAP, Go/Ruby/.NET/Rust/Dart native DAP. Set/remove/list breakpoints, step over/into, inspect variables, evaluate expressions, logpoints.
  - **Level 3 — Auto-Debug:** EventBus-driven triggers (process crash, stderr error, browser error, 5xx). Auto-attach debugger + structured snapshots with suggested fixes.
  - **Cassette Record/Replay:** Record MCP tool call sessions, replay for regression testing, diff between sessions.
  - **Lazy-load adapters:** V8/DAP/JDWP/DBGp adapters loaded only when used.
- **🛡️ Redaction default-on for tool responses.** Sensitive data (Authorization, Cookie, Set-Cookie, *token*, *secret*, *password*, *api_key*) auto-masked with `***REDACTED***` before reaching the LLM context. Reuses existing `redactLogLine()` engine.
- **⏱️ Time-series self-observability.** Ring buffer (120 snapshots = 1 hour), `analyzeTrend()` degradation detection, `diagnose_fennec_health` diagnostic tool.
- **🔒 ProcessManager concurrency safety.** `spawnLock` (per-name mutex prevents concurrent spawn of same name) + `portClaims` (prevents two processes claiming same port).
- **📊 IncidentEngine rate-limiting.** `NOISY_EVENT_TYPES` suppression, cooldown, hard-stop max counter, auto-decay (resets after 5 min inactivity), `suppressedCount` exposed in stats + pulse.
- **🔍 Expose active engine in responses.** Every browser tool response now includes `_engine: "cdp" | "playwright"` so agents know which engine produced the result.
- **📋 MCP Client transport compatibility.** Documented which clients need SSE vs stdio (OpenCode SSE-required, Continue.dev SSE-recommended).

### Changed
- **Batch 1 cleanup:** `console.error()` → `getLogger()` in tracking.ts + module/index.ts. Removed `CorrelationEngine`/`RootCauseInferrer` from public exports. Removed `devtools/index.ts` re-export hop.
- **docs/index.html redesign:** Full-width layout, Lucide CDN icons, version auto-sync via bump script. MCP Client Setup section with 2-column transport layout.
- **Documentation sync:** All READMEs updated with Debug Engine, concurrency safety, IncidentEngine rate-limiting, MCP client transport info. `docs/debugger.md` status changed from Proposal to Implemented.
- **IncidentEngine:** Explicit NO-pattern-matched fallback (raw data returned instead of silent empty).
- **Health check:** Multi-layer readiness (TCP liveness → HTTP /health → custom readiness checks).

### Fixed
- **PerformanceMetrics:** Added time-series ring buffer + `analyzeTrend()`. Dead data no longer — now queryable via `diagnose_fennec_health`.
- **Dead code removal:** 4 methods + 1 field removed from ProcessManager (`acquireSpawnLock`, `releaseSpawnLock`, `_currentRelease`, `claimPort`, `releasePort`, `tryClaimPort`).
- **IncidentEngine flooding:** Rate-limited with NOISY suppression, cooldown, hard-stop, auto-decay.

## [1.14.12] - 2026-07-14

### Fixed
- **Zombie PID 0 entries from failed spawns (Critical).** Fixed several interlocking bugs that occurred when `fennec start <command>` was run with a non-existent command (ENOENT):
  - `isProcessRunning(pid)` and `killTree(pid)` in both CLI and Core utilities now guard against `pid ≤ 0` — `process.kill(0, 0)` previously returned a false-positive (it checks the calling process, not PID 0) and `process.kill(0, SIGTERM)` would kill the calling process group (i.e. fennec itself).
  - `isTrackedRunning()` now returns `false` for `pid ≤ 0`, preventing PID 0 from appearing as a running process in `fennec ps`.
  - `spawnDaemon()` now listens for the `'error'` event on the spawned child (preventing unhandled ENOENT crashes) and writes the error to the log file.
  - `fennec start`, `fennec spawn`, and `resurrectTracked()` now check for `pid === 0` immediately after spawning and bail early with an error instead of persisting an invalid entry to `tracked.json`.
- **`fennec doctor` now detects zombie PID 0 entries.** The `doctor` command scans `tracked.json` for entries with `pid: 0` and reports them; `fennec doctor --fix` removes them automatically.
- **MCP tools `process_spawn_tracked` and `process_restart`** now skip entries with `pid: 0` (spawn failure) instead of persisting them.

## [1.14.11] - 2026-07-14

### Fixed
- **Doctor false positive: editor language servers.** Fixed the duplicate server detection filter in `fennec doctor` to require `start`/`server` as whole words (`\b` word boundary), naturally excluding `tsserver`, `volar`, and other language servers. Added explicit exclusion list (`tsserver|typescript|eslint|volar`) as a safety net. Previously, any process with "fennec" in its project path and "server" in its name (e.g. TypeScript Language Server running in the fennec project) was falsely flagged as a duplicate MCP server.

### Changed
- **`fennec ps` now shows total process tree memory.** Memory column (MEM) now sums the RSS of the tracked process AND all its descendants (children, grandchildren, etc.) via `/proc/[pid]/task/[tid]/children`. This is especially useful for apps spawned through wrappers like `make` or `npm run` where the tracked parent uses minimal memory (~2MB) but the actual app (child process) consumes significantly more. Falls back to parent-only RSS on non-Linux platforms.

## [1.14.10] - 2026-07-14

### Changed
- **SSE transport noise reduction.** SSE client connect/disconnect log messages changed from `info` to `debug` level to reduce log noise during normal operation. Duplicate SSE connections are now rejected with HTTP 409 (instead of closing the active connection), preventing the connect → close → reconnect loop that occurred when MCP clients periodically refreshed their capability list.

## [1.14.9] - 2026-07-14

### Security
- **PermissionGuard hardening.** The `doctor` MCP tool is now protected by `PermissionGuard` — added to `DANGEROUS_TOOLS` (sandbox mode) and `READ_ONLY_BLOCKED` (read-only mode). In sandbox mode, `doctor` is gated behind `allowProcessKill`, so `fennec doctor --fix` cannot kill processes when `allowProcessKill: false`. `supervisor_control` and `persist_control` are also added to `READ_ONLY_BLOCKED` to prevent state mutation in read-only mode.

### Fixed
- **MCP `process_stop_tracked` missing `manualStop` flag.** The MCP tool now calls `setManualStop(name, true)` — matching the CLI's `fennec stop` behavior. Previously, processes stopped via MCP were NOT marked as manually stopped, causing `resurrectTracked()` to re-spawn them on the next `fennec start --sse` server restart. Added `manualStop` field to core `TrackedEntry` and a new `setManualStop()` function in the tracking module. `addTracked()` now also clears `manualStop` on fresh spawn (matching CLI parity).

## [1.14.8] - 2026-07-14

### Added
- **Fennec Doctor Self-Healing (`--fix`).** Extended the `doctor` command to identify duplicate servers, orphaned supervisors, and leaked Chrome/Chromium browser processes, and added a `--fix` option to automatically terminate them.

### Fixed
- **SSE Connection Race Condition.** Resolved a critical race condition where closing a previous connection request (`GET /sse`) incorrectly terminated the active transport of a newly connected client, preventing infinite reconnection loops.
- **Supervisor Singleton (Self-Heal).** Implemented authoritative PID checks inside the supervisor loop to gracefully terminate duplicate supervisor daemons if their PID no longer matches the active pidfile.
- **Resurrect Supervisor.** Automatically spawn the supervisor daemon on `resurrectTracked` if any resurrected process has auto-restart enabled.
- **Resurrect Stopped Processes.** Track manually stopped processes via a new `manualStop` field in `tracked.json`, preventing Fennec from auto-resurrecting them upon server restarts.

## [1.14.7] - 2026-07-14

### Fixed
- **SSE Client Reconnection Error.** Safely close the existing transport connection state before registering a new connection attempt via SSE (`GET /sse`), preventing the "Already connected to a transport" exception on client reconnection or IDE restarts.

## [1.14.6] - 2026-07-14

### Added
- **API Client tool (`network_api_call`).** An ad-hoc HTTP client tool to hit API endpoints (GET, POST, PUT, DELETE, PATCH, etc.) with custom headers and bodies, returning status, headers, and parsed JSON, preventing external shell dropouts.
- **URL & Param assertions.** Added `url-matches` and `url-param-equals` assertion types to `browser_assert` to verify routing and query parameter states.
- **Text-first assertion.** Added `text-present` assertion to `browser_assert` to verify page text content without loading visual elements or dumping the DOM.

### Fixed
- **Process stop ghost-restart bug.** `process_stop_tracked` now sets `autoRestart: false` in `tracked.json`, preventing the background supervisor daemon from immediately resurrecting stopped applications.
- **PID recycling safety.** Replaced plain PID signal checking with robust ownership checks (`isTrackedRunning`) via environment markers and command line matching to prevent recycled PIDs from registering as "running".
- **Documentation generator.** Fixed a cell-padding parsing bug in `update-tool-docs.mjs` that incorrectly counted total tools in docs markdown tables.

## [1.14.5] - 2026-07-13

### Fixed
- **Republish with corrected CLI banner.** `v1.14.4`'s npm artifacts were built from a stale banner (`VERSION = '1.14.3'`); this rebuilds and republishes `@plumpslabs/fennec-core` and `@plumpslabs/fennec-cli` with the banner reporting `1.14.5`. No functional changes vs `1.14.4`.

## [1.14.4] - 2026-07-13

### Added
- **Recorder tools.** `recorder_start` / `recorder_stop` / `recorder_export` / `recorder_list` / `recorder_capture` capture session interactions and export them as runnable **Playwright** or **Puppeteer** test scripts (`Recorder.exportAsScript`).
- **`browser_assert`.** Token-efficient structured assertions (page-url, url-contains, element-exists, element-text-equals, element-value-equals, count-equals, exists-with-attr) returning `{ passed, reason, actual, expected }` instead of requiring screenshots.
- **Console ignore patterns.** `console.ignorePatterns` (with sensible Vite HMR/web-socket defaults) drop dev noise at the source so it never reaches the buffer, pulse, or incident engine.

### Changed
- **SPA-friendly navigation defaults.** `browser_navigate` / `smart_navigate` now default to `waitUntil: "domcontentloaded"` (was `networkidle`) to avoid hanging on chatty SPAs.
- **Richer navigation errors.** Failures now return a `code` + `suggestions` taxonomy (TIMEOUT, URL_UNREACHABLE/DNS, CONNECTION_REFUSED, MIXED_CONTENT_OR_CORS, SESSION_DEAD, NAVIGATION_FAILED).
- **Tab auto-focus.** `tab_new` and `tab_switch` now bring the target tab to the foreground and update the active page.
- **Calmer slow-request threshold.** `network.slowRequestThresholdMs` raised 1000 → 2000 ms.
- **Honest incident root-cause.** Generic `browser:network:0` incidents are now low-confidence ("cause ambiguous"); a CORS/blocked console error is required to escalate to high-confidence.

### Fixed
- **Duplicate supervisor daemons.** `spawn --restart` no longer spawns multiple `__supervisor` processes — guarded by an atomic lockfile with stale-lock self-heal.
- **Network response bodies.** Network tools now capture and surface response bodies for failed requests.

## [1.14.1] - 2026-07-13

### Added (MCP tool improvements — feedback items 12–23)
- **`smart_navigate` `compact: true`.** Returns a trimmed snapshot (fewer tokens) for quick checks; full HTML kept available via the standard snapshot tool.
- **`auth_save_session` `metadata`.** Persist `user` / `role` / `workspace` with a session; surfaced in `auth_list_sessions` (and kept in the session file) for human-readable filtering.
- **`smart_navigate` `mode: "verify"`.** Returns a structured pass/fail (`success`, detected checks, elementCount) **without any screenshot** — for fast "did it load?" assertions.
- **`tools_help(category?)`.** Lists tools by category with each tool's `_tokenTier` and parameter tiers for discoverability, so agents can self-select cheap tools before calling `tools/list`.
- **`browser_navigate` `maxRetries` + `retryOn`.** Auto-retry navigation on network/timeout errors or non-2xx status, with bounded attempts.
- **`devtools_watch_console` `stopOnNavigation`.** Auto-stops the watcher when a navigation occurs (default true), preventing runaway background watchers.
- **`process_run_and_wait`.** Run a command and block until it exits, returning `exitCode` + `logs` (via `ProcessManager.waitForExit`).
- **`browser_screenshot_baseline(name)`.** Capture a named baseline (elements + screenshot) stored for later diffing — no need to re-pass elements each time.
- **`browser_screenshot_diff` `baselineId`.** Diff against a previously saved baseline by id.
- **`compare_sessions(sessionA, sessionB, url?)`.** DOM/text diff between two saved sessions at a URL (no screenshot needed) — generic multi-session comparison.
- **`test_with_state(apply, url)`.** Apply `localStorage` / `cookies` then load a URL to simulate any auth/state (e.g. admin vs user) without bespoke hacks.
- **`browser_get_element_component(selector)`.** Resolve the component (React/Vue) owning a DOM element, with `sourceFile` when resolvable via the framework's dev metadata.

### Changed
- **PulseContext severity weighting.** CORS issues now surface as `warning` (not `error`), so non-blocking CORS noise stops inflating critical counts.

## [1.14.0] - 2026-07-13

### Added (MCP tool improvements — token burn & UX)
- **Screenshot compression by default.** `browser_screenshot` now defaults to **JPEG quality 50** instead of raw PNG, cutting inline base64 ~10x. New `quality` (1-100) and `fullResolution` (forces lossless PNG) inputs.
- **Screenshot `output: "file_path"`.** Write the image to disk and return only the path — no base64 dumped into the model context. (`browser_screenshot`, `output`, `outputDir`.)
- **`browser_get_element_text(selector)`.** Cheap text extraction for one element (e.g. a price/status label) via `innerText`; far smaller than a screenshot or DOM dump.
- **Auth `filePath` + path visibility.** `auth_save_session` now returns `filePath` (`./.fennec/sessions/<name>.json`) and accepts a custom `filePath`; `auth_load_session` accepts `filePath`; `auth_list_sessions` returns each session's `filePath`.
- **Session auto-discovery.** `auth_list_sessions` also scans `./.fennec/sessions`; `auth_load_session` resolves a name from that dir even if not in the default store.
- **`network_wait_for_api_response`.** Blocks until the API *response* comes back (not just the request leaving), returning status, headers, parsed body, duration, and size.
- **Tool token tiers + budget hint.** `tools/list` now tags each tool with `_tokenTier` (low/medium/high) and a `_hint` describing the per-response token budget, so agents prefer cheap state/text tools before screenshots.

### Changed
- **`network_get_cors_issues`** now excludes OPTIONS preflight noise by default (`excludePreflight`, default true).
- **`smart_navigate`** returns a structured JSON result (url, title, textPreview, elementCount, availableElements) and only attaches a screenshot when `screenshot: true` is set — no image by default.
- **`devtools_evaluate`** returns `ok: false` with the explicit error `message`, `name`, and full `stack` on failure (instead of a generic error), so you can see exactly where the script broke.

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
