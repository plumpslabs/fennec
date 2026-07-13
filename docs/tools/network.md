# DevTools — Network Tools

Tools for monitoring, intercepting, and mocking network requests.

## Tools

| Tool                          | Description                                                           | Parameters                                                                |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `network_get_logs`            | Get network request logs, filterable by status, method, URL pattern   | status?, method?, urlPattern?, limit?, includeResponseBodies?, sessionId? |
| `network_get_failed_requests` | Get all failed requests (status >= 400)                               | since?, sessionId?                                                        |
| `network_get_cors_issues`     | Detect CORS-related issues from network logs                          | sessionId?                                                                |
| `network_clear_logs`          | Clear all network request logs from buffer                            | sessionId?                                                                |
| `network_wait_for_request`    | Wait for a network request matching URL pattern + method              | urlPattern, method?, timeout?, sessionId?                                 |
| `network_get_request_detail`  | Get full detail of a request by URL or requestId (incl. responseBody) | url?, requestId?, fullBody?, sessionId?                                   |
| `network_intercept`           | Intercept requests matching URL pattern (returns interceptorId)       | urlPattern, sessionId?                                                    |
| `network_remove_intercept`    | Remove a previously set network intercept by interceptorId            | interceptorId, sessionId?                                                 |
| `network_mock_response`       | Mock a response for a URL pattern (custom status, body, headers)      | urlPattern, statusCode?, body?, contentType?, headers?, sessionId?        |

## Return Data

Network tools return request objects with:

```typescript
{
  url: string;
  method: string;
  status: number;
  duration: number; // ms
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
   requestBody?: string;
   responseBody?: string; // captured lazily via CDP Network.getResponseBody (base64-decoded)
   timestamp: string;
   requestId?: string;
}
```

`responseBody` is now populated for completed requests (fetched via `Network.getResponseBody`, decoding base64 payloads). In `network_get_request_detail` it is **truncated to ~4 KB by default** — pass `fullBody: true` for the complete body. `network_get_logs` omits `responseBody` by default to keep output lean; pass `includeResponseBodies: true` to include it. `network_wait_for_api_response` returns the full `responseBody` directly.

## Examples

```typescript
// Get all 500 errors
const failed = await toolRegistry.call('network_get_failed_requests', {});
// Returns: { requests: [...], count: N }

// Mock an API response
const mock = await toolRegistry.call('network_mock_response', {
  urlPattern: '**/api/users',
  statusCode: 200,
  body: JSON.stringify({ users: [] }),
  contentType: 'application/json',
});
// Returns: { mockId: "mock_...", active: true }

// Wait for login request
const login = await toolRegistry.call('network_wait_for_request', {
  urlPattern: '/api/login',
  method: 'POST',
  timeout: 10000,
});
// Returns: { request: {...}, response: {...}, elapsed: N }
```

## Intercept/Mock Lifecycle

Intercepts and mocks are stored per session. Use `network_remove_intercept` with the returned `interceptorId` or `mockId` to clean up. Intercepts survive page navigations unless removed.
