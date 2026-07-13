# Storage Tools

Tools for reading, writing, and managing browser storage: localStorage, sessionStorage, cookies, and IndexedDB. Also supports full state export/import for session persistence.

## Tools

| Tool                    | Description                                                                | Parameters                                                             |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `storage_get_local`     | Get localStorage value by key, or all items                                | key?, sessionId?                                                       |
| `storage_set_local`     | Set a localStorage value (returns previousValue)                           | key, value, sessionId?                                                 |
| `storage_remove_local`  | Remove a localStorage key                                                  | key, sessionId?                                                        |
| `storage_clear_local`   | Clear all localStorage (returns clearedCount)                              | sessionId?                                                             |
| `storage_get_session`   | Get sessionStorage value by key, or all items                              | key?, sessionId?                                                       |
| `storage_set_session`   | Set a sessionStorage value                                                 | key, value, sessionId?                                                 |
| `storage_get_cookies`   | Get browser cookies, filterable by name/domain                             | name?, domain?, sessionId?                                             |
| `storage_set_cookie`    | Set a cookie with name, value, domain, path, httpOnly, secure, sameSite    | name, value, domain?, path?, httpOnly?, secure?, sameSite?, sessionId? |
| `storage_delete_cookie` | Delete a cookie by name                                                    | name, domain?, sessionId?                                              |
| `storage_get_indexeddb` | Get IndexedDB databases and optionally records from a store                | dbName?, storeName?, sessionId?                                        |
| `storage_export_state`  | Export all browser state (cookies + localStorage + sessionStorage) to JSON | filePath?, sessionId?                                                  |
| `storage_import_state`  | Import previously exported state from file or JSON string                  | filePath?, stateObject?, sessionId?                                    |

## Examples

```typescript
// Get all cookies
const cookies = await toolRegistry.call('storage_get_cookies', {});
// Returns: { cookies: [...], count: N }

// Set a cookie
await toolRegistry.call('storage_set_cookie', {
  name: 'session_id',
  value: 'abc123',
  domain: '.example.com',
  httpOnly: true,
  secure: true,
});

// Export full state to file
const state = await toolRegistry.call('storage_export_state', {
  filePath: 'myapp-state.json',
});
// Returns: { cookies: [...], localStorage: {...}, sessionStorage: {...}, savedTo: "..." }

// Import state from file
const restored = await toolRegistry.call('storage_import_state', {
  filePath: 'myapp-state.json',
});
// Returns: { cookiesRestored: N, itemsRestored: N }

// Read IndexedDB
const idb = await toolRegistry.call('storage_get_indexeddb', {
  dbName: 'MyAppDB',
  storeName: 'users',
});
// Returns: { databases: [...], records: [...] }
```

## State Export/Import

The `storage_export_state` and `storage_import_state` tools provide full session persistence:

- **Export**: Captures cookies, localStorage, sessionStorage, and current origin into a JSON object or file
- **Import**: Restores cookies, navigates to the saved origin, and replays localStorage/sessionStorage
- File paths are relative to `config.security.exportPath` (default: `./.fennec/exports`)
