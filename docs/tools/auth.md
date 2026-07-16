# Auth Tools

Tools for authentication session management — auto-fill login forms, save/load sessions, and check auth state.

## Tools

| Tool                   | Description                                                                                    | Parameters                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `auth_fill_login_form` | Auto-detect and fill login form (username + password). Optionally submit and auto-save session | username, password, submitAfter?, saveAfterLogin?, sessionId? |
| `auth_save_session`    | Save current auth state (cookies + localStorage) to a named session                            | name, sessionId?                                              |
| `auth_load_session`    | Load a saved auth session into the browser                                                     | name, sessionId?                                              |
| `auth_list_sessions`   | List all saved authentication sessions                                                         | —                                                             |
| `auth_delete_session`  | Delete a saved auth session by name                                                            | name                                                          |
| `auth_check_logged_in` | Check login state via auth indicators (cookies, logout/profile links)                          | indicators?, sessionId?                                       |

## Examples

```typescript
// Auto-fill and submit login form
const login = await toolRegistry.call('auth_fill_login_form', {
  username: 'admin@example.com',
  password: 'secret123',
  submitAfter: true,
  saveAfterLogin: true,
});
// Returns: { formFound: true, fieldsDetected: {...}, submitted: true, sessionSaved: true, sessionName: "auto-example.com" }

// Save session manually after login
await toolRegistry.call('auth_save_session', { name: 'demo-app-prod' });
// Returns: { sessionId: "...", savedAt: "..." }

// In another conversation — load saved session
const loaded = await toolRegistry.call('auth_load_session', { name: 'demo-app-prod' });
// Returns: { cookiesLoaded: N, storageLoaded: N }

// Check if logged in
const auth = await toolRegistry.call('auth_check_logged_in', {});
// Returns: { loggedIn: bool, confidence: 0-1, detectedIndicators: [...] }
```

## Auth Detection

`auth_check_logged_in` detects login state using multiple signals:

| Signal                                   | Confidence               |
| ---------------------------------------- | ------------------------ |
| Logout/profile link found + auth cookie  | 0.95 (high confidence)   |
| Logout/profile link found OR auth cookie | 0.70 (medium confidence) |
| Login link found, no auth cookie         | 0.30 (not logged in)     |

Auth cookies are detected by name patterns: `token`, `session`, `auth`, `jwt`, `sid`, `connect`.

## Smart Form Detection

`auth_fill_login_form` uses the smart form detection pipeline:

1. **Phase 1**: Smart-detect all form fields via `detectFormFields()` (label, name, id, placeholder, aria-label, data-testid)
2. **Phase 2**: Match username/email and password fields
3. **Phase 3**: Fill via `fillField()` using `resolveSelector()` (Path A) or legacy CSS fallback (Path B)
4. **Phase 4**: Auto-save session if `saveAfterLogin: true` + auth cookie detected
