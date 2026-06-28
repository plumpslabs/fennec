# Fennec Tool Reference

Fennec provides over 60 MCP tools organized into logical groups. Each tool is designed to be consumed by AI agents, with structured input/output and actionable error messages.

## Tool Groups

### [Navigation](navigation.md)
Navigate the browser: URLs, back/forward, reload, wait for navigation.

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate to a URL |
| `browser_go_back` | Go back in history |
| `browser_go_forward` | Go forward in history |
| `browser_reload` | Reload the page |
| `browser_get_current_url` | Get current URL and title |
| `browser_wait_for_navigation` | Wait for URL pattern |

### [Interaction](interaction.md)
Click, type, select, hover, scroll, and keyboard interactions.

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

### [DOM & Page](dom.md)
Query the DOM, get page content, wait for elements, take screenshots.

| Tool | Description |
|---|---|
| `browser_screenshot` | Take screenshot |
| `browser_get_dom_snapshot` | Get DOM HTML snapshot |
| `browser_get_accessibility_tree` | Get accessibility tree |
| `browser_find_elements` | Find elements by selector |
| `browser_get_element_info` | Get element details |
| `browser_wait_for_element` | Wait for element state |
| `browser_get_page_text` | Get page text content |
| `browser_get_page_title` | Get page title |

### [DevTools — Console](console.md)
Monitor and interact with browser console.

| Tool | Description |
|---|---|
| `devtools_get_console_logs` | Get console logs |
| `devtools_clear_console` | Clear console buffer |
| `devtools_evaluate` | Execute JavaScript |
| `devtools_get_js_errors` | Get JS errors |

### [DevTools — Network](network.md)
Monitor and mock network requests.

| Tool | Description |
|---|---|
| `network_get_logs` | Get network request logs |
| `network_get_failed_requests` | Get failed requests |
| `network_get_cors_issues` | Detect CORS issues |
| `network_clear_logs` | Clear network buffer |

### [DevTools — Performance](performance.md)
Measure page performance and simulate network conditions.

| Tool | Description |
|---|---|
| `devtools_get_performance_metrics` | Get Core Web Vitals |
| `devtools_get_memory_usage` | Get JS memory usage |
| `devtools_get_dom_counters` | Get DOM node counts |
| `devtools_simulate_network` | Simulate network condition |

### [Storage](storage.md)
Read/write localStorage, sessionStorage, cookies, and IndexedDB.

| Tool | Description |
|---|---|
| `storage_get_local` | Get localStorage |
| `storage_set_local` | Set localStorage |
| `storage_remove_local` | Remove localStorage key |
| `storage_clear_local` | Clear localStorage |
| `storage_get_session` | Get sessionStorage |
| `storage_set_session` | Set sessionStorage |
| `storage_get_cookies` | Get cookies |
| `storage_set_cookie` | Set cookie |
| `storage_delete_cookie` | Delete cookie |
| `storage_get_indexeddb` | Read IndexedDB |

### [Auth](auth.md)
Authentication session management.

| Tool | Description |
|---|---|
| `auth_fill_login_form` | Auto-fill login form |
| `auth_save_session` | Save auth session |
| `auth_load_session` | Load saved session |
| `auth_list_sessions` | List saved sessions |
| `auth_delete_session` | Delete session |
| `auth_check_logged_in` | Check login state |

### [Tabs & Contexts](tabs.md)
Multi-tab and multi-context management.

| Tool | Description |
|---|---|
| `tab_new` | Create new tab |
| `tab_close` | Close tab |
| `tab_list` | List open tabs |
| `tab_switch` | Switch to tab |
| `context_new` | Create new context |
| `context_close` | Close context |

### [Process](process.md)
Spawn and manage processes.

| Tool | Description |
|---|---|
| `process_spawn` | Spawn a process |
| `process_list` | List managed processes |
| `process_get_logs` | Get process logs |
| `process_get_status` | Get process status |
| `process_send_input` | Send input to process |
| `process_kill` | Kill a process |
| `process_wait_for_ready` | Wait for ready pattern |

### [Terminal / Log Watcher](terminal.md)
Watch log files and pipe streams.

| Tool | Description |
|---|---|
| `terminal_watch_file` | Watch a log file |
| `terminal_get_logs` | Get watched logs |
| `terminal_get_errors` | Get error logs |
| `terminal_list_watchers` | List active watchers |
| `terminal_stop_watcher` | Stop watcher |

### [Diagnostic](diagnostic.md) ⭐⭐
Full-stack diagnosis and correlation.

| Tool | Description |
|---|---|
| `diagnose_page` | Page diagnostics |
| `diagnose_element` | Element debugging |
| `diagnose_network` | Network diagnostics |
| `diagnose_auth` | Auth state check |
| `diagnose_fullstack` | **Full-stack correlation** |
| `diagnose_performance` | Performance diagnosis |
