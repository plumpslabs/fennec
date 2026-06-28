# Multi-User Test Example

Demonstrates Fennec's **multi-session parallel testing** — create two isolated browser contexts (like separate incognito windows), login as different users, and switch between them to test permission differences.

## Tools Used

| Tool | Purpose |
|---|---|
| `context_new` | Create isolated browser context (separate cookies/storage) |
| `browser_navigate` | Navigate in a specific session |
| `auth_fill_login_form` | Login as a specific user |
| `auth_save_session` | Save session for quick switching |
| `tab_switch` | Switch between sessions |
| `tab_get_current` | Check active session details |
| `tab_list` | List all open tabs/sessions |
| `context_close` | Clean up a session |
| `browser_screenshot` | Capture state for comparison |
| `storage_get_cookies` | Verify different auth cookies per session |

---

## Scenario: Admin vs Regular User Permission Testing

### Step 1 — Create Two Isolated Sessions

Start with the default session, then create a second isolated context:

**Request:** Create second context (for regular user)
```json
{
  "name": "context_new",
  "arguments": {}
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"contextId\":\"sess_2\"},\"meta\":{\"elapsed\":500,\"sessionId\":\"sess_2\",\"timestamp\":\"2026-06-28T10:00:00.000Z\"}}"
  }]
}
```

Now we have two sessions:

| Session | User | Cookies/Storage |
|---|---|---|
| `sess_default` | (to be admin) | Isolated |
| `sess_2` | (to be regular user) | Completely separate |

### Step 2 — Login as Admin in Session Default

**Request:**
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/login",
    "sessionId": "sess_default"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"finalUrl\":\"https://example.com/login\",\"statusCode\":200,\"loadTime\":1200},\"meta\":{\"elapsed\":1200,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:01.000Z\"}}"
  }]
}
```

**Request:** Fill login form as admin
```json
{
  "name": "auth_fill_login_form",
  "arguments": {
    "username": "admin@example.com",
    "password": "admin-pass-123",
    "submitAfter": true,
    "sessionId": "sess_default"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"formFound\":true,\"fieldsDetected\":{\"usernameField\":true,\"passwordField\":true,\"submitButton\":true},\"submitted\":true},\"meta\":{\"elapsed\":400,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:03.000Z\"}}"
  }]
}
```

**Request:** Save admin session
```json
{
  "name": "auth_save_session",
  "arguments": {
    "name": "admin-session",
    "sessionId": "sess_default"
  }
}
```

### Step 3 — Switch to Session 2 and Login as Regular User

**Request:** Navigate in session 2
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/login",
    "sessionId": "sess_2"
  }
}
```

**Request:** Fill login form as regular user
```json
{
  "name": "auth_fill_login_form",
  "arguments": {
    "username": "user@example.com",
    "password": "user-pass-456",
    "submitAfter": true,
    "sessionId": "sess_2"
  }
}
```

**Request:** Save user session
```json
{
  "name": "auth_save_session",
  "arguments": {
    "name": "user-session",
    "sessionId": "sess_2"
  }
}
```

### Step 4 — Verify Auth States Are Different

**Request:** Check admin session cookies
```json
{
  "name": "storage_get_cookies",
  "arguments": {
    "sessionId": "sess_default"
  }
}
```

**Response (abbreviated):**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"cookies\":[{\"name\":\"session_token\",\"value\":\"admin_jwt_token_abc\",\"domain\":\".example.com\",\"path\":\"/\",\"httpOnly\":true,\"secure\":true}],\"count\":1}}"
  }]
}
```

**Request:** Check user session cookies
```json
{
  "name": "storage_get_cookies",
  "arguments": {
    "sessionId": "sess_2"
  }
}
```

**Response (abbreviated):**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"cookies\":[{\"name\":\"session_token\",\"value\":\"user_jwt_token_xyz\",\"domain\":\".example.com\",\"path\":\"/\",\"httpOnly\":true,\"secure\":true}],\"count\":1}}"
  }]
}
```

Different tokens — confirmed! ✅

### Step 5 — Test Admin-Only Features

Navigate to admin panel in both sessions:

**Request:** Admin can access
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/admin/users",
    "sessionId": "sess_default"
  }
}
```

**Response:** ✅ Page loads with user list (status 200)

**Request:** Regular user tries admin page
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/admin/users",
    "sessionId": "sess_2"
  }
}
```

**Response:** ❌ 403 Forbidden or redirect to access denied

```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"finalUrl\":\"https://example.com/access-denied\",\"statusCode\":403,\"loadTime\":500},\"meta\":{\"elapsed\":500,\"sessionId\":\"sess_2\",\"timestamp\":\"2026-06-28T10:01:00.000Z\"}}"
  }]
}
```

### Step 6 — Compare Screen States

Take screenshots of both sessions for visual comparison:

```json
{
  "name": "browser_screenshot",
  "arguments": {
    "format": "png",
    "sessionId": "sess_default"
  }
}
```

```json
{
  "name": "browser_screenshot",
  "arguments": {
    "format": "png",
    "sessionId": "sess_2"
  }
}
```

---

## Scenario: Cross-User Interaction Testing

Test if two users can interact (e.g., chat, comments):

### Step 1 — Admin Creates a Post

```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/posts/new",
    "sessionId": "sess_default"
  }
}
```

```json
{
  "name": "browser_type",
  "arguments": {
    "selector": "textarea[name='content']",
    "text": "Important announcement from admin!",
    "sessionId": "sess_default"
  }
}
```

```json
{
  "name": "browser_click",
  "arguments": {
    "selector": "button:has-text('Publish')",
    "sessionId": "sess_default"
  }
}
```

### Step 2 — Regular User Sees the Post and Comments

```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/posts",
    "sessionId": "sess_2"
  }
}
```

```json
{
  "name": "browser_type",
  "arguments": {
    "selector": "textarea[name='comment']",
    "text": "Thanks for the update!",
    "sessionId": "sess_2"
  }
}
```

---

## Managing Multiple Sessions

### List All Sessions

```json
{
  "name": "tab_list",
  "arguments": {}
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"tabs\":[{\"url\":\"https://example.com/admin/users\",\"title\":\"User Management — Admin\",\"active\":true},{\"url\":\"https://example.com/access-denied\",\"title\":\"Access Denied\",\"active\":false}],\"activeTabId\":\"https://example.com/admin/users\"}}"
  }]
}
```

### Get Current Session Details

```json
{
  "name": "tab_get_current",
  "arguments": {
    "sessionId": "sess_default"
  }
}
```

**Response:**
```json
{
  "content": [{
    "text": "{\"success\":true,\"data\":{\"url\":\"https://example.com/admin/users\",\"title\":\"User Management — Admin\",\"readyState\":\"complete\"}}"
  }]
}
```

### Clean Up a Session

```json
{
  "name": "context_close",
  "arguments": {
    "sessionId": "sess_2"
  }
}
```

> **Note:** The default session (`sess_default`) cannot be closed.

---

## Use Cases

| Use Case | How Fennec Helps |
|---|---|
| **RBAC testing** | Test role-based access control with minimal setup |
| **Multi-tenant apps** | Verify tenant data isolation |
| **Chat/comment systems** | Test user-to-user interactions |
| **Admin approval flows** | Admin creates content, regular user verifies they can see it |
| **Concurrent editing** | Test that two users editing the same resource handle conflicts correctly |

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Sessions share cookies | You're using the same session | Use `context_new` to create isolated contexts |
| `ELEMENT_NOT_FOUND` in session 2 | Page not navigated yet | Call `browser_navigate` in the session first |
| `session ID not found` | Session was closed or expired | Check `tab_list` for active sessions |
| Auth state lost between calls | Session uses short-lived tokens | Save session immediately after login, load before each test block |
