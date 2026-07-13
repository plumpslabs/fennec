# Scheduler Tools

Tools for managing auto-triggered workflow rules. The Workflow Scheduler monitors events (errors, navigations) and automatically triggers diagnostic workflows.

## Tools

| Tool                        | Description                                                            | Parameters       |
| --------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `scheduler_get_stats`       | Get scheduler stats: rules count, total triggers, recent history       | —                |
| `scheduler_get_last_result` | Get the most recent auto-triggered workflow execution result           | —                |
| `scheduler_trigger_rule`    | Manually trigger a scheduler rule by ID (execute workflow immediately) | ruleId, context? |
| `scheduler_list_rules`      | List all registered scheduler trigger rules with status                | —                |
| `scheduler_disable_rule`    | Disable a scheduler rule by ID                                         | ruleId           |
| `scheduler_enable_rule`     | Enable a previously disabled rule by ID                                | ruleId           |
| `scheduler_clear_history`   | Clear scheduler trigger history and reset stats                        | —                |

## Default Rules

When Fennec starts, it registers default auto-trigger rules for diagnostics. These rules listen for events from the SmartHook middleware:

| Rule                            | Event                 | Workflow        | Description                                    |
| ------------------------------- | --------------------- | --------------- | ---------------------------------------------- |
| Auto-diagnose on console error  | `console.error`       | `auto-diagnose` | Triggered when JS errors appear in the console |
| Auto-diagnose on failed network | `network.error`       | `auto-diagnose` | Triggered when network requests fail (>= 400)  |
| Auto-diagnose on page change    | `navigation.complete` | `auto-diagnose` | Triggered after successful page navigation     |

## Examples

```typescript
// Check scheduler stats
const stats = await toolRegistry.call('scheduler_get_stats', {});
// Returns: { totalRules, enabledRules, totalTriggered, recentTriggers: [...] }

// View last auto-diagnosis result
const lastResult = await toolRegistry.call('scheduler_get_last_result', {});
// Returns: { found: true, executionId, status, stepResults: [...], contextSnapshot: {...} }

// List all rules
const rules = await toolRegistry.call('scheduler_list_rules', {});
// Returns: { count: N, rules: [{id, name, enabled, eventType, priority, cooldownMs}] }

// Disable a noisy rule
await toolRegistry.call('scheduler_disable_rule', {
  ruleId: 'auto-diagnose-console-error',
});
```

## Rule Cooldown

Each rule has a cooldown period (default: 10 seconds) to prevent rapid re-triggering. During cooldown, matching events are ignored. Use `scheduler_get_stats` to check `cooldownActive` status.
