# DevTools — Performance Tools

Tools for measuring page performance, memory usage, and simulating network conditions.

## Tools

| Tool                               | Description                                                      | Parameters            |
| ---------------------------------- | ---------------------------------------------------------------- | --------------------- |
| `devtools_get_performance_metrics` | Get Core Web Vitals: FCP, LCP, TBT, CLS, TTI, memory             | sessionId?            |
| `devtools_get_memory_usage`        | Get JS heap size, total size, limit, DOM node count              | sessionId?            |
| `devtools_get_dom_counters`        | Get DOM node/document/frame counters                             | sessionId?            |
| `devtools_start_profiling`         | Start CPU profiling via CDP (returns profileId)                  | sessionId?            |
| `devtools_stop_profiling`          | Stop CPU profiling, return top functions + samples               | profileId, sessionId? |
| `devtools_simulate_network`        | Simulate network condition: offline, slow-3g, fast-3g, 4g, reset | condition, sessionId? |

## Return Data

```typescript
// devtools_get_performance_metrics
{
  FCP: number | null;       // First Contentful Paint (ms)
  LCP: number | null;       // Largest Contentful Paint (ms)
  TBT: number | null;       // Total Blocking Time (ms)
  CLS: number | null;       // Cumulative Layout Shift
  TTI: number | null;       // Time to Interactive (ms)
  memoryUsage: {
    jsHeapSize: number;
    totalSize: number;
    limit: number;
  } | null;
}

// devtools_stop_profiling
{
  topFunctions: Array<{
    functionName: string;
    url: string;
    lineNumber: number;
    hitCount: number;
  }>;
  duration: number;  // ms
  totalSamples: number;
}
```

## Examples

```typescript
// Check performance metrics
const perf = await toolRegistry.call('devtools_get_performance_metrics', {});
// Returns FCP, LCP, CLS, TBT, memory usage

// Simulate slow 3G
await toolRegistry.call('devtools_simulate_network', {
  condition: 'slow-3g',
});

// Profile CPU for 3 seconds
const prof = await toolRegistry.call('devtools_start_profiling', {});
// ... do something ...
const result = await toolRegistry.call('devtools_stop_profiling', {
  profileId: prof.profileId,
});
// Returns: { topFunctions: [...], duration: N, totalSamples: N }
```

## Network Conditions

| Condition | Latency | Download  | Upload    |
| --------- | ------- | --------- | --------- |
| `offline` | —       | 0         | 0         |
| `slow-3g` | 400ms   | 40 kbps   | 10 kbps   |
| `fast-3g` | 150ms   | 700 kbps  | 100 kbps  |
| `4g`      | 50ms    | 3 Mbps    | 1 Mbps    |
| `reset`   | 0       | unlimited | unlimited |
