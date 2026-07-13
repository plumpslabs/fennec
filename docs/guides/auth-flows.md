# Authentication Flows

Fennec makes it easy to handle authentication in your AI-driven browser sessions. Here's how to use auth tools effectively.

## Basic Login Flow

```javascript
// 1. Navigate to login page
browser_navigate({ url: 'https://app.example.com/login' });

// 2. Wait for the login form
browser_wait_for_element({
  selector: 'input[type="email"]',
  state: 'visible',
});

// 3. Auto-fill login form
auth_fill_login_form({
  username: 'user@example.com',
  password: 'securepassword123',
  submitAfter: true,
});

// 4. Wait for successful login
browser_wait_for_navigation({
  urlPattern: '/dashboard',
  timeout: 10000,
});

// 5. Verify login state
auth_check_logged_in();
// → { loggedIn: true, confidence: 0.95 }
```

## Session Persistence

Save an authenticated session so you don't need to log in again:

```javascript
// After successful login:
auth_save_session({ name: 'myapp-prod' });

// Next conversation — skip login entirely:
auth_load_session({ name: 'myapp-prod' });
// → { cookiesLoaded: 8, storageLoaded: 12 }
```

## Multi-Session Testing

Test features that require different user roles:

```javascript
// Session 1: Admin user
auth_save_session({ name: 'admin-user' });

// Create a new context (isolated session)
context_new();
auth_load_session({ name: 'admin-user' });

// Session 2: Regular user
auth_save_session({ name: 'regular-user' });

// Switch contexts
context_new();
auth_load_session({ name: 'regular-user' });
```

## Login Detection

The `auth_check_logged_in` tool detects authentication state by:

1. Looking for auth-related cookies (`token`, `session`, `auth`, `jwt`, `sid`)
2. Detecting logout/profile links on the page
3. Detecting login/sign-in links

Confidence levels:

- **0.95**: Auth cookie + logout link found
- **0.70**: Either auth cookie or logout link found
- **0.30**: No auth indicators detected

## Troubleshooting

### Form Not Detected

If `auth_fill_login_form` can't find the login form:

1. Use `browser_get_dom_snapshot` to inspect the page structure
2. Manually find the selectors with `browser_find_elements`
3. Use `browser_type` to fill fields manually

```javascript
browser_type({
  selector: 'input[name="email"]',
  text: 'user@example.com',
  clear: true,
});
browser_type({
  selector: 'input[name="password"]',
  text: 'securepassword123',
});
browser_click({ selector: 'button[type="submit"]' });
```

### Session Not Loading

If `auth_load_session` fails:

1. Verify the session exists: `auth_list_sessions()`
2. The session may have expired — the cookies may no longer be valid
3. Some sites invalidate sessions based on IP or user-agent changes
