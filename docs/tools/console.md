# DevTools — Console Tools

Tools for monitoring and interacting with browser console.

## Tools

| Tool                        | Description                                                                       | Parameters                                   |
| --------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| `devtools_get_console_logs` | Get browser console logs, filterable by level, keyword, recency                   | level?, limit?, since?, keyword?, sessionId? |
| `devtools_clear_console`    | Clear all console logs from the buffer                                            | sessionId?                                   |
| `devtools_evaluate`         | Execute JavaScript in the browser context (requires `security.allowJSEvaluation`) | expression, awaitResult?, sessionId?         |
| `devtools_get_js_errors`    | Get only JavaScript errors from console buffer                                    | since?, limit?, sessionId?                   |
| `devtools_watch_console`    | Watch console logs for a duration (ms), collect all logs emitted during window    | durationMs, level?, sessionId?               |

## Return Data

All console tools return console log entries with the following structure:

```typescript
{
  message: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  timestamp: string;
  stack?: string;
}
```

## Examples

```typescript
// Get all error logs
const errors = await toolRegistry.call('devtools_get_console_logs', {
  level: 'error',
  limit: 20,
});
// Returns: { logs: [...], errorCount: N, warnCount: N, summary: "..." }

// Execute JS in browser
const result = await toolRegistry.call('devtools_evaluate', {
  expression: 'document.title',
});
// Returns: { result: "Page Title", type: "string" }

// Watch console for 5 seconds
const watched = await toolRegistry.call('devtools_watch_console', {
  durationMs: 5000,
  level: 'error',
});
// Returns: { logs: [...], errorCount: N, summary: "..." }
```

## Security Note

`devtools_evaluate` is guarded by `config.security.allowJSEvaluation`. If disabled, the tool returns an error with code `INVALID_INPUT`.
