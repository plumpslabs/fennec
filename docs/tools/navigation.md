# Navigation Tools

Tools for page navigation and history management.

## Tools

| Tool                          | Description                        | Parameters                            |
| ----------------------------- | ---------------------------------- | ------------------------------------- |
| `browser_navigate`            | Navigate to a URL                  | url, waitUntil?, timeout?, sessionId? |
| `browser_go_back`             | Go back one page in history        | sessionId?                            |
| `browser_go_forward`          | Go forward one page in history     | sessionId?                            |
| `browser_reload`              | Reload current page                | hardReload?, sessionId?               |
| `browser_get_current_url`     | Get current URL, title, readyState | sessionId?                            |
| `browser_wait_for_navigation` | Wait for URL matching pattern      | urlPattern?, timeout?, sessionId?     |

## Examples

```typescript
// Navigate to a URL
const result = await toolRegistry.call('browser_navigate', {
  url: 'https://example.com',
  waitUntil: 'networkidle',
});
// Returns: { finalUrl, statusCode, loadTime }

// Get current page state
const state = await toolRegistry.call('browser_get_current_url', {});
// Returns: { url, title, readyState }
```
