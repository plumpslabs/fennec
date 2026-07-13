# Fennec Tool Reference

Fennec provides **119 MCP tools** organized into **15 categories**. Each tool is designed to be consumed by AI agents, with structured input/output and actionable error messages.

> 💡 **Token-Efficient**: MCP clients can request specific categories to reduce context window usage. Every tool response also carries a `_tokenTier` (low/medium/high) in `tools/list` so agents prefer cheap tools first. Screenshots default to compressed JPEG and `smart_navigate` returns structured JSON (no image) unless you ask for one.

---

## Tool Categories

### [Navigation](navigation.md) (6 tools)
Navigate the browser: URLs, back/forward, reload, wait for navigation.

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate to a URL |
| `browser_go_back` | Go back in history |
| `browser_go_forward` | Go forward in history |
| `browser_reload` | Reload the page |
| `browser_get_current_url` | Get current URL and title |
| `browser_wait_for_navigation` | Wait for URL pattern |

### [Interaction](interaction.md) (10 tools)
Click, type, select, hover, scroll, keyboard, file upload, and drag-and-drop.

| Tool | Description |
|---|---|
| `browser_click` | Click an element |
| `browser_type` | Type text into an input |
| `browser_select` | Select dropdown option |
| `browser_hover` | Hover over an element |
| `browser_scroll` | Scroll page or element |
| `browser_press_key` | Press a keyboard key |
| `browser_upload_file` | Upload a file |
| `browser_focus` | Focus an element |
| `browser_clear` | Clear input field |
| `browser_drag_drop` | Drag element to target |

### [DOM & Page](dom.md) (9 tools)
Query the DOM, get page content, wait for elements, take screenshots, inspect meta tags.

| Tool | Description |
|---|---|
| `browser_screenshot` | Take screenshot |
| `browser_get_dom_snapshot` | Get DOM HTML snapshot with Shadow DOM |
| `browser_get_accessibility_tree` | Get accessibility tree |
| `browser_find_elements` | Find elements with Shadow DOM piercing |
| `browser_get_element_info` | Get element details |
| `browser_wait_for_element` | Wait for element state |
| `browser_get_page_text` | Get page text content |
| `browser_get_page_title` | Get page title |
| `browser_get_meta` | Get SEO/meta tags |

### [DevTools — Console](console.md) (5 tools)
Monitor and interact with browser console.

| Tool | Description |
|---|---|
| `devtools_get_console_logs` | Get console logs (filterable) |
| `devtools_clear_console` | Clear console buffer |
| `devtools_evaluate` | Execute JavaScript in browser |
| `devtools_get_js_errors` | Get JS errors only |
| `devtools_watch_console` | Watch console for duration |

### [DevTools — Network](network.md) (9 tools)
Monitor, intercept, mock, and wait for network requests.

| Tool | Description |
|---|---|
| `network_get_logs` | Get network request logs |
| `network_get_failed_requests` | Get failed requests |
| `network_get_cors_issues` | Detect CORS issues |
| `network_clear_logs` | Clear network buffer |
| `network_wait_for_request` | Wait for request matching URL |
| `network_get_request_detail` | Get full request detail |
| `network_intercept` | Intercept requests |
| `network_remove_intercept` | Remove intercept |
| `network_mock_response` | Mock API response |

### [DevTools — Performance](performance.md) (6 tools)
Measure page performance, memory, profiling, and network simulation.

| Tool | Description |
|---|---|
| `devtools_get_performance_metrics` | Get Core Web Vitals |
| `devtools_get_memory_usage` | Get JS memory usage |
| `devtools_get_dom_counters` | Get DOM node counts |
| `devtools_start_profiling` | Start CPU profiling |
| `devtools_stop_profiling` | Stop profiling, get samples |
| `devtools_simulate_network` | Simulate network condition |

### [Storage](storage.md) (12 tools)
Read/write localStorage, sessionStorage, cookies, IndexedDB, and state export/import.

| Tool | Description |
|---|---|
| `storage_get_local` | Get localStorage |
| `storage_set_local` | Set localStorage |
| `storage_remove_local` | Remove localStorage key |
| `storage_clear_local` | Clear localStorage |
| `storage_get_session` | Get sessionStorage |
| `storage_set_session` | Set sessionStorage |
| `storage_get_cookies` | Get cookies (filterable) |
| `storage_set_cookie` | Set cookie with options |
| `storage_delete_cookie` | Delete cookie |
| `storage_get_indexeddb` | Read IndexedDB |
| `storage_export_state` | Export all state to JSON |
| `storage_import_state` | Import saved state |

### [Auth](auth.md) (6 tools)
Authentication: auto-fill login forms, save/load sessions, check auth state.

| Tool | Description |
|---|---|
| `auth_fill_login_form` | Auto-detect + fill login form |
| `auth_save_session` | Save auth session |
| `auth_load_session` | Load saved session |
| `auth_list_sessions` | List saved sessions |
| `auth_delete_session` | Delete session |
| `auth_check_logged_in` | Check login state |
| `auth_ensure_session` | Load matching session before testing (or signal needsAuth) |

### [Tabs & Contexts](tabs.md) (7 tools)
Multi-tab and multi-context (incognito) management.

| Tool | Description |
|---|---|
| `tab_new` | Create new tab |
| `tab_close` | Close tab |
| `tab_list` | List open tabs |
| `tab_switch` | Switch to tab |
| `tab_get_current` | Get current tab info |
| `context_new` | Create isolated context |
| `context_close` | Close context |

### [Process](process.md) (11 tools)
Spawn, monitor, attach, and manage processes. Works **without browser**.

| Tool | Description |
|---|---|
| `process_spawn` | Spawn a process |
| `process_list` | List managed processes |
| `process_get_logs` | Get process logs |
| `process_get_status` | Get process status |
| `process_send_input` | Send input to process |
| `process_kill` | Kill a process |
| `process_restart` | Restart a process |
| `process_wait_for_ready` | Wait for ready pattern |
| `process_run_and_wait` | Run a process and block until it exits |
| `process_attach_pid` | Attach by PID |
| `process_attach_port` | Attach by port |

### [Terminal / Log Watcher](terminal.md) (7 tools)
Watch log files, pipe streams, and monitor terminal output. Works **without browser**.

| Tool | Description |
|---|---|
| `terminal_watch_file` | Watch a log file |
| `terminal_get_logs` | Get watched logs |
| `terminal_get_errors` | Get error logs |
| `terminal_list_watchers` | List active watchers |
| `terminal_stop_watcher` | Stop watcher |
| `terminal_watch_pipe` | Watch a named pipe |
| `terminal_clear_buffer` | Clear log buffer |

### [Diagnostic](diagnostic.md) (6 tools) ⭐
Page, element, network, auth, performance, and full-stack correlation diagnostics.

| Tool | Description |
|---|---|
| `diagnose_page` | Page diagnostics |
| `diagnose_element` | Element debugging |
| `diagnose_network` | Network diagnostics |
| `diagnose_auth` | Auth state check |
| `diagnose_fullstack` | **Full-stack correlation** |
| `diagnose_performance` | Performance diagnosis |

### [Scheduler](scheduler.md) (7 tools)
Auto-triggered workflow rules for event-based diagnosis.

| Tool | Description |
|---|---|
| `scheduler_get_stats` | Get scheduler stats |
| `scheduler_get_last_result` | Get last execution result |
| `scheduler_trigger_rule` | Manually trigger a rule |
| `scheduler_list_rules` | List all rules |
| `scheduler_disable_rule` | Disable a rule |
| `scheduler_enable_rule` | Enable a rule |
| `scheduler_clear_history` | Clear trigger history |

### [Smart Tools](smart.md) (12 tools) 🔥
AI-powered interaction with auto-diagnosis, form filling, validation, visual testing, and token-efficient session workflows.

| Tool | Description |
|---|---|
| `smart_wait` | Wait with auto-diagnosis on timeout |
| `smart_navigate` | Navigate + collect DOM snapshot (supports `compact` and `mode:"verify"`) |
| `smart_fill_form` | Auto-detect + fill form fields |
| `smart_validate_form` | Validate fields + custom rules |
| `browser_screenshot_annotated` | Screenshot with numbered badges |
| `browser_screenshot_export` | Screenshot + HTML export |
| `browser_screenshot_baseline` | Capture a named baseline snapshot for later diffing |
| `browser_screenshot_diff` | Visual diff against baseline |
| `compare_sessions` | DOM/text diff between two saved sessions at a URL |
| `test_with_state` | Apply localStorage/cookies and load a URL to simulate auth/state |
| `browser_get_element_component` | Resolve the component (React/Vue) owning an element |
| `tools_help` | List tools by category with token tiers (discoverability) |

### [Planner](planner.md) (5 tools) 🆕
Multi-step execution planning from natural language goals.

| Tool | Description |
|---|---|
| `planner_execute_goal` | Plan + execute in one call |
| `planner_create_plan` | Preview plan without executing |
| `planner_list_plans` | List all plans |
| `planner_get_plan` | Get plan details |
| `planner_cancel_plan` | Cancel running plan |

---

## Quick Stats

| Category | Tools | Requires Browser |
|----------|-------|:----------------:|
| Navigation | 6 | ✅ |
| Interaction | 10 | ✅ |
| DOM & Page | 9 | ✅ |
| DevTools Console | 5 | ✅ |
| DevTools Network | 9 | ✅ |
| DevTools Performance | 6 | ✅ |
| Storage | 12 | ✅ |
| Auth | 7 | ⚠️ Partial |
| Tabs & Contexts | 7 | ✅ |
| Process | 11 | ❌ |
| Terminal | 7 | ❌ |
| Diagnostic | 6 | ⚠️ Partial |
| Scheduler | 7 | ❌ |
| Smart | 12 | ✅ |
| Planner | 5 | ❌ |
| **Total** | **119** | **43 without browser** |

> **43 tools work without Playwright/browser engines** — process, terminal, storage (basic), scheduler, planner, and partial auth + diagnostic.

---

## Usage Examples

Step-by-step walkthroughs with real MCP JSON-RPC tool call examples are available in the [`examples/`](../../examples/) directory:

| Example | Description | Key Tools |
|---|---|---|
| [Login Flow](../../examples/login-flow/) | Auth session persistence | `auth_fill_login_form`, `auth_save_session`, `auth_load_session` |
| [Debug API Error](../../examples/debug-api-error/) | Full-stack error diagnosis | `diagnose_fullstack`, `network_get_failed_requests`, `process_get_logs` |
| [Multi-User Test](../../examples/multi-user-test/) | Parallel session testing | `context_new`, `tab_switch`, `auth_check_logged_in` |
| [Full-Stack Diagnose](../../examples/fullstack-diagnose/) | Process lifecycle debugging | `process_spawn`, `process_wait_for_ready`, `diagnose_fullstack`, `terminal_watch_pipe` |
