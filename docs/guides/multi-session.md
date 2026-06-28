# Multi-Session Testing

Fennec supports running multiple isolated browser sessions simultaneously. This enables powerful testing scenarios like cross-user interactions.

## Why Multi-Session?

- **Role-based testing**: Test admin vs. regular user permissions
- **Cross-user interactions**: Chat apps, collaborative tools, real-time features
- **Parallel testing**: Run different test scenarios concurrently
- **Session isolation**: Separate cookies, storage, and auth state per session

## Creating Sessions

By default, Fennec creates one session (`sess_xxxx`). You can create additional sessions:

```javascript
// Create a new session with custom name
context_new({
  options: {
    viewport: { width: 1024, height: 768 }
  }
})

// The new session has its own cookies, storage, and auth state
```

## Multi-User Testing Example

```javascript
// === Session 1: Admin User ===
auth_load_session({ name: "admin" })
browser_navigate({ url: "http://localhost:3000/admin" })
// Test admin features...

// === Session 2: Regular User ===
context_new()
auth_load_session({ name: "regular-user" })
browser_navigate({ url: "http://localhost:3000/dashboard" })
// Test regular user features...

// === Compare access ===
// AI can switch between sessions to compare what each user sees
```

## Testing Real-Time Features

For collaborative apps (chat, collaboration tools):

```javascript
// Session 1: User A sends a message
tab_list() // Note active tab
auth_load_session({ name: "user-a" })
browser_navigate({ url: "http://localhost:3000/chat" })
browser_type({ selector: "#message-input", text: "Hello from User A!" })
browser_click({ selector: "#send-button" })

// Session 2: User B receives the message
context_new()
auth_load_session({ name: "user-b" })
browser_navigate({ url: "http://localhost:3000/chat" })

// Check if User B sees User A's message
browser_get_page_text({ selector: "#messages" })
// → "Hello from User A!" found!
```

## Session Lifecycle

```javascript
// Create → use → save → destroy

context_new()                                // Create
browser_navigate({ url: "..." })
auth_save_session({ name: "test-session" })  // Save state
context_close({ sessionId: "sess_xxx" })     // Clean up

// Later — restore
auth_load_session({ name: "test-session" })  // Continue from saved state
```

## Best Practices

1. **Name your sessions**: Use meaningful names for `auth_save_session` to keep track
2. **Limit concurrent sessions**: Default max is 10 (configurable)
3. **Clean up idle sessions**: Fennec auto-cleans sessions after `idleTimeoutSecs` (default: 30 min)
4. **Use isolated contexts**: Each `context_new()` creates complete cookie/storage isolation
5. **Save before destroying**: Save auth state before closing a context to restore it later
