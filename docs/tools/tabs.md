# Tabs & Contexts Tools

Tools for managing multiple browser tabs and isolated browser contexts (incognito-like sessions).

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `tab_new` | Create a new browser tab (optionally navigate to URL) | url?, sessionId? |
| `tab_close` | Close a tab by its URL (tabId) | tabId, sessionId? |
| `tab_list` | List all open tabs with URL, title, and active status | sessionId? |
| `tab_switch` | Switch to a tab by its URL | tabId, sessionId? |
| `tab_get_current` | Get current active tab info: URL, title, readyState | sessionId? |
| `context_new` | Create a new isolated browser context (separate cookies/storage) | options?, sessionId? |
| `context_close` | Close a browser context by sessionId | sessionId |

## Examples

```typescript
// Open a new tab
const newTab = await toolRegistry.call("tab_new", {
  url: "https://example.com"
});
// Returns: { tabId: "https://example.com", sessionId: "..." }

// List all open tabs
const tabs = await toolRegistry.call("tab_list", {});
// Returns: { tabs: [{url, title, active}], activeTabId: "..." }

// Switch to a tab
await toolRegistry.call("tab_switch", {
  tabId: "https://other-page.com"
});
// Returns: { url: "...", title: "..." }

// Create isolated context (separate cookies/session)
const ctx = await toolRegistry.call("context_new", {});
// Returns: { contextId: "sess_..." }
```

## Context Isolation

Each browser context provides isolated storage (cookies, localStorage, IndexedDB):

- **`context_new`**: Creates a new browser context with its own storage
- **`context_close`**: Destroys the context and all its tabs
- The default context cannot be closed

Use `tab_switch` to change the active tab within the same context. Use `context_new` + `tab_new` for multi-user testing.
