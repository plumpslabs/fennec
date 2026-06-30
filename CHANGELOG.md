# Changelog

All notable changes to Fennec will be documented in this file.

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
