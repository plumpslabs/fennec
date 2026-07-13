# Recorder Tools

Capture real user interactions in a browser session and export them as runnable test scripts — turn manual QA clicks into Playwright or Puppeteer tests with one call.

## Tools

| Tool               | Description                                                     | Parameters                                  |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------- |
| `recorder_start`   | Start recording interactions in the session                     | name?                                       |
| `recorder_stop`    | Stop the active recording                                       | —                                           |
| `recorder_export`  | Export the last recording as a Playwright/Puppeteer test script | framework? (`playwright` \| `puppeteer`)    |
| `recorder_list`    | List saved recordings                                           | —                                           |
| `recorder_capture` | Manually capture a step into the active recording               | type, description, params?, url?, duration? |

## How It Works

```
User clicks around the app
  │
  ▼  recorder_start(name: "checkout")
recorder.begin("checkout")
  │  — every browser_ click/type/navigate is appended automatically
  ▼  recorder_capture(...) for manual/AI steps
  │
  ▼  recorder_stop()
  │
  ▼  recorder_export(framework: "playwright")
→ import { chromium } from 'playwright';
  ... ready-to-run test script
```

## Examples

```typescript
// Start recording, do some work, then export a Playwright script
await toolRegistry.call('recorder_start', { name: 'login-flow' });
// ... interact with the page via browser_click / browser_type / browser_navigate ...
await toolRegistry.call('recorder_stop', {});
const out = await toolRegistry.call('recorder_export', { framework: 'playwright' });
// out.script contains an importable Playwright test

// Mix in a manual step the recorder can't auto-capture
await toolRegistry.call('recorder_capture', {
  type: 'navigate',
  description: 'authorize with OAuth popup',
  params: { url: 'https://auth.example.com/authorize' },
  duration: 1250,
});
```
