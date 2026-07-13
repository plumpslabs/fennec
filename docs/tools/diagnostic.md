# Diagnostic Tools

Tools for page, element, network, auth, performance, and full-stack diagnosis with root cause analysis.

## Tools

| Tool                   | Description                                                                              | Parameters             |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `diagnose_page`        | Comprehensive page diagnostic: console errors, network failures, performance, page state | focus?, sessionId?     |
| `diagnose_element`     | Debug element: check existence, visibility, interactability                              | selector, sessionId?   |
| `diagnose_network`     | Network diagnostic: failed requests, slow requests, CORS issues                          | since?, sessionId?     |
| `diagnose_auth`        | Check auth state: auth cookies, token presence, expiry info                              | sessionId?             |
| `diagnose_fullstack`   | **Unified browser + server diagnostic** with correlated timeline and root cause analysis | processId?, sessionId? |
| `diagnose_performance` | Performance diagnostic: metrics (FCP, LCP, CLS), issues, recommendations, score          | sessionId?             |

## Full-Stack Correlation

`diagnose_fullstack` is Fennec's signature feature. It correlates browser errors with server logs:

| Pattern Detected                   | Root Cause                          | Confidence | Suggested Fix                              |
| ---------------------------------- | ----------------------------------- | ---------- | ------------------------------------------ |
| jwt/token in console + server logs | Authentication token issue          | 0.92       | Verify JWT_SECRET and token validity       |
| ENOENT / "not found" in logs       | Missing env variable or file        | 0.88       | Check required env vars and files exist    |
| 500 errors + server stderr         | Server error caused network failure | 0.90       | Check server logs for unhandled exceptions |
| Console errors + network failures  | Network failure caused JS error     | 0.85       | Ensure API endpoints are reachable         |

## Examples

```typescript
// Full page diagnostic
const pageDiag = await toolRegistry.call('diagnose_page', {
  focus: 'errors',
});
// Returns: { page: {...}, consoleErrors: [...], networkFailures: [...], summary: {...} }

// Element diagnosis
const elDiag = await toolRegistry.call('diagnose_element', {
  selector: '#login-btn',
});
// Returns: { exists, visible, enabled, interactable, reason, suggestions }

// Full-stack correlation
const stackDiag = await toolRegistry.call('diagnose_fullstack', {
  processId: 'my-api',
});
// Returns: { browser: {...}, server: {...}, correlation: { rootCause, confidence, fix } }

// Performance score
const perfDiag = await toolRegistry.call('diagnose_performance', {});
// Returns: { metrics: {...}, score: 75, issues: [...], recommendations: [...] }
```

## Performance Scoring

| Score | Meaning                                          |
| ----- | ------------------------------------------------ |
| 100   | All metrics healthy                              |
| 75    | 1 issue detected (e.g., slow FCP)                |
| 50    | 2 issues detected (e.g., slow FCP + high memory) |
| 25    | 3+ issues detected                               |
