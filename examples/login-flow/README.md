# Login Flow Example

Demonstrates Fennec's **auth session persistence** — login once, save the session, reload it in a future conversation. No more copy-pasting credentials every time.

## Tools Used

| Tool                       | Purpose                              |
| -------------------------- | ------------------------------------ |
| `browser_navigate`         | Go to login page                     |
| `auth_fill_login_form`     | Auto-detect + fill username/password |
| `network_wait_for_request` | Wait for auth API response           |
| `auth_check_logged_in`     | Verify login succeeded               |
| `auth_save_session`        | Persist cookies + storage to disk    |
| `auth_load_session`        | Restore saved auth state             |
| `auth_list_sessions`       | List all saved sessions              |
| `auth_delete_session`      | Remove a saved session               |

---

## Scenario A: First-Time Login

### Step 1 — Navigate to Login Page

**Request:**

```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com/login",
    "waitUntil": "networkidle"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"finalUrl\":\"https://example.com/login\",\"statusCode\":200,\"loadTime\":1234},\"meta\":{\"elapsed\":1234,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:00.000Z\"}}"
    }
  ]
}
```

### Step 2 — Auto-Detect and Fill Login Form

**Request:**

```json
{
  "name": "auth_fill_login_form",
  "arguments": {
    "username": "admin@example.com",
    "password": "supersecret123",
    "submitAfter": true
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"formFound\":true,\"fieldsDetected\":{\"usernameField\":true,\"passwordField\":true,\"submitButton\":true},\"submitted\":true},\"meta\":{\"elapsed\":345,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:05.000Z\"}}"
    }
  ]
}
```

### Step 3 — Wait for Auth API Response

**Request:**

```json
{
  "name": "network_wait_for_request",
  "arguments": {
    "urlPattern": "/api/auth/token",
    "method": "POST",
    "timeout": 10000
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"request\":{\"url\":\"https://api.example.com/api/auth/token\",\"method\":\"POST\",\"headers\":{\"content-type\":\"application/json\"},\"postData\":\"{\\\"email\\\":\\\"admin@example.com\\\",\\\"password\\\":\\\"***\\\"}\",\"resourceType\":\"xhr\"},\"response\":{\"status\":200,\"statusText\":\"OK\",\"headers\":{\"content-type\":\"application/json\",\"set-cookie\":\"session_token=abc123; HttpOnly; Secure\"},\"url\":\"https://api.example.com/api/auth/token\"},\"elapsed\":234},\"meta\":{\"elapsed\":234,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:06.000Z\"}}"
    }
  ]
}
```

### Step 4 — Verify Login State

**Request:**

```json
{
  "name": "auth_check_logged_in",
  "arguments": {}
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"loggedIn\":true,\"confidence\":0.95,\"detectedIndicators\":[\"Logout/profile link found\",\"Auth cookie found\"]},\"meta\":{\"elapsed\":50,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:07.000Z\"}}"
    }
  ]
}
```

### Step 5 — Save Session for Later

**Request:**

```json
{
  "name": "auth_save_session",
  "arguments": {
    "name": "demo-app-prod"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"sessionId\":\"sess_default\",\"savedAt\":\"2026-06-28T10:00:08.000Z\"},\"meta\":{\"elapsed\":100,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:08.000Z\"}}"
    }
  ]
}
```

> **What gets saved?** Cookies (including HttpOnly), localStorage, and the origin URL. The session is stored in `.fennec/sessions/demo-app-prod.json`.

---

## Scenario B: Restore Session in a New Conversation

When you start a new AI conversation, you can skip the entire login flow:

### Step 1 — List Available Sessions

**Request:**

```json
{
  "name": "auth_list_sessions",
  "arguments": {}
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"sessions\":[{\"name\":\"demo-app-prod\",\"savedAt\":\"2026-06-28T10:00:08.000Z\",\"origin\":\"https://example.com\"}],\"count\":1}}"
    }
  ]
}
```

### Step 2 — Load Session

**Request:**

```json
{
  "name": "auth_load_session",
  "arguments": {
    "name": "demo-app-prod"
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"cookiesLoaded\":3,\"storageLoaded\":2},\"meta\":{\"elapsed\":200,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:05:00.000Z\"}}"
    }
  ]
}
```

### Step 3 — Verify You're Logged In

**Request:**

```json
{
  "name": "auth_check_logged_in",
  "arguments": {}
}
```

**Response:**

```json
{
  "content": [
    {
      "text": "{\"success\":true,\"data\":{\"loggedIn\":true,\"confidence\":0.95,\"detectedIndicators\":[\"Logout/profile link found\",\"Auth cookie found\"]},\"meta\":{\"elapsed\":50,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:05:01.000Z\"}}"
    }
  ]
}
```

You're now authenticated without entering credentials!

---

## Error Handling Examples

### Login Form Not Found

If `auth_fill_login_form` can't detect the login fields:

```json
{
  "content": [
    {
      "text": "{\"success\":false,\"error\":{\"code\":\"ELEMENT_NOT_FOUND\",\"message\":\"Could not detect login form fields\",\"suggestions\":[\"Use browser_get_dom_snapshot to see the page structure\",\"Manually use browser_type to fill in the fields\"]},\"meta\":{\"elapsed\":500,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:00:04.000Z\"}}"
    }
  ]
}
```

**Recovery:** Use `browser_get_dom_snapshot` to inspect the page, then manually use `browser_type`:

```json
{
  "name": "browser_type",
  "arguments": {
    "selector": "input[name='email']",
    "text": "admin@example.com"
  }
}
```

### Session Not Found

If you try to load a session that doesn't exist:

```json
{
  "content": [
    {
      "text": "{\"success\":false,\"error\":{\"code\":\"SESSION_NOT_FOUND\",\"message\":\"Session not found: nonexistent-session\",\"suggestions\":[\"Use auth_list_sessions to see available sessions\"]},\"meta\":{\"elapsed\":10,\"sessionId\":\"sess_default\",\"timestamp\":\"2026-06-28T10:05:00.000Z\"}}"
    }
  ]
}
```

---

## Use Cases

| Use Case                  | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| **QA Testing**            | Login once, reuse session across multiple test scenarios                         |
| **CI/CD Debugging**       | Save session from a successful test run, debug failures without re-auth          |
| **Multi-Session Testing** | Save admin + user sessions, switch between them (see `examples/multi-user-test`) |
| **Demo Recordings**       | Capture auth state once, demo features without showing credentials               |

---

## Troubleshooting

| Issue                             | Likely Cause                                              | Fix                                                           |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `formFound: false`                | Custom login form with non-standard selectors             | Use `browser_type` + `browser_click` manually                 |
| `submitted: false`                | Submit button not detected; form filled but not submitted | Call `browser_click` on the submit button                     |
| `loggedIn: false` after save/load | Session expired, or cookies are session-only              | Re-login and save again. Some apps use short-lived tokens     |
| `storageLoaded: 0`                | App uses sessionStorage instead of localStorage           | Still works — `auth_load_session` navigates to the origin URL |
