import { z } from 'zod';
import { createTool } from '../_registry.js';

/**
 * Build a human-readable summary of console logs grouped by level.
 * This is the token-efficient alternative to dumping all raw logs.
 */
function buildLogSummary(
  errorCount: number,
  warnCount: number,
  infoCount: number,
  logs: Array<{ level: string; message: string }>,
): string {
  const parts: string[] = [];

  if (errorCount > 0) {
    // Extract unique error messages (truncated) for the summary
    const uniqueErrors = new Set<string>();
    for (const log of logs) {
      if (log.level === 'error') {
        uniqueErrors.add(log.message.replace(/\d+/g, 'N').slice(0, 80));
      }
    }
    const errorsSummary = Array.from(uniqueErrors).slice(0, 3).join('; ');
    parts.push(`${errorCount} error(s): ${errorsSummary}`);
  }

  if (warnCount > 0) {
    parts.push(`${warnCount} warning(s)`);
  }

  if (infoCount > 0) {
    parts.push(`${infoCount} info log(s)`);
  }

  if (parts.length === 0) {
    return 'No console logs';
  }

  return parts.join('. ');
}

export const devtoolsGetConsoleLogs = createTool({
  name: 'devtools_get_console_logs',
  category: 'devtools',
  description:
    '`<use_case>Console inspector</use_case> 🔍 Get browser console logs from the current page. Filter by level (log/info/warn/error/debug), keyword, or time range. Returns errorCount, warnCount, infoCount, and a readable summary. Use when you need to see app logs, find warnings, or trace console output. More focused than observe() — use this for raw log inspection.`',
  inputSchema: z.object({
    level: z
      .enum(['log', 'info', 'warn', 'error', 'debug'])
      .optional()
      .describe('Filter by log level'),
    limit: z.number().optional().default(50).describe('Maximum number of logs to return'),
    since: z.string().optional().describe('ISO timestamp to filter logs after'),
    keyword: z.string().optional().describe('Filter logs containing this keyword'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const logs = sessionManager.getConsoleBuffer(session.id, {
      level: input.level,
      limit: input.limit,
      since: input.since,
      keyword: input.keyword,
    });

    const errorCount = logs.filter((l) => l.level === 'error').length;
    const warnCount = logs.filter((l) => l.level === 'warn').length;
    const infoCount = logs.filter((l) => l.level === 'info').length;

    // Level-based summary: return raw logs only for error level, summary for others
    const isHighDetail =
      input.level === 'error' || (errorCount > 0 && input.limit && input.limit <= 20);

    return responseBuilder.success(
      {
        // Only return full logs when explicitly asked for errors
        logs: isHighDetail ? logs : [],
        errorCount,
        warnCount,
        infoCount,
        // Level-based summary string
        summary: buildLogSummary(errorCount, warnCount, infoCount, logs),
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const devtoolsClearConsole = createTool({
  name: 'devtools_clear_console',
  category: 'devtools',
  description:
    '`<use_case>Console inspector</use_case> 🧹 Clear all console logs from the buffer. Returns previousCount of how many entries were removed. Use when you want a fresh log state before performing an action — like clearing logs before clicking a button so you can see only new errors.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const previousCount = sessionManager.clearConsoleBuffer(session.id);
    return responseBuilder.success(
      {
        cleared: true,
        previousCount,
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const devtoolsEvaluate = createTool({
  name: 'devtools_evaluate',
  category: 'devtools',
  description:
    "`<use_case>Code execution</use_case> ⚡ Execute JavaScript code directly in the browser page context. Returns ok:true with result + type on success, or ok:false with the explicit error message, error name, and FULL stack trace on failure (so you can see exactly where it broke). Requires security.allowJSEvaluation to be enabled. Use for advanced DOM manipulation, reading page variables, or calling JS functions that aren't exposed via other tools. Safer alternatives: browser_get_dom_snapshot for DOM, storage_get_local for localStorage.`",
  inputSchema: z.object({
    expression: z.string().describe('JavaScript expression to evaluate'),
    awaitResult: z.boolean().optional().default(true).describe('Wait for promise resolution'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    if (!config.security.allowJSEvaluation) {
      return responseBuilder.error(
        new Error('JavaScript evaluation is disabled in security settings'),
        { code: 'JS_EVAL_DISABLED' },
      );
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const result = await session.browser.evaluate(input.expression);
      return responseBuilder.success(
        {
          ok: true,
          result,
          type: typeof result,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      const err = error as Error & { name?: string; stack?: string };
      const isFetchLike = /fetch|\.json\(\)|\.map\(|TypeError|undefined \(reading/.test(
        err?.message ?? '',
      );
      return responseBuilder.success(
        {
          ok: false,
          code: 'JS_EVAL_ERROR',
          error: err?.message ?? String(error),
          name: err?.name ?? 'Error',
          stack: err?.stack ?? undefined,
          expression: input.expression,
          suggestions: isFetchLike
            ? [
                'For API calls, prefer devtools_api_fetch — it runs fetch() in the page context, inherits auth/cookies, and returns the raw response text even on HTTP errors (so you see the real API error instead of a chained .map() crash).',
              ]
            : undefined,
        },
        sessionManager.buildMeta(session),
      );
    }
  },
});

/**
 * In-browser fetch with full auth context.
 *
 * Unlike `network_api_call` (which runs from Node and therefore has no access
 * to the page's cookies, tokens, or CORS origin), this executes `fetch()`
 * INSIDE the page so it inherits the browser's authenticated session. On a
 * non-2xx response it does NOT throw — it returns the response with `ok:false`
 * and the RAW response body text, so the agent can see the actual API error
 * (e.g. `{"status":401,"message":"token expired"}`) instead of a cryptic
 * `.map is not a function` crash from a chained `.json().then(...)`.
 *
 * Addresses issues #84 (surfacing raw API errors) and #86 (browser-context
 * authenticated requests).
 */
export const devtoolsApiFetch = createTool({
  name: 'devtools_api_fetch',
  category: 'devtools',
  description:
    "`<use_case>API Client (in-browser)</use_case> 🌐 Make an HTTP request from INSIDE the browser page context — inherits the page's cookies, auth tokens, and CORS origin (unlike network_api_call which runs from the server with no session). Returns status, headers, ok, and the parsed body OR raw text on error. On non-2xx it returns ok:false with the raw response text instead of throwing, so you can read the real API error (e.g. token expired). Use for authenticated API calls that network_api_call can't make due to CORS/auth. Prefer this over devtools_evaluate + fetch() chains.`",
  inputSchema: z.object({
    url: z.string().describe('The URL to fetch (same-origin or CORS-enabled cross-origin)'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
      .optional()
      .default('GET')
      .describe('HTTP method'),
    headers: z.record(z.string(), z.string()).optional().describe('Extra request headers'),
    body: z.string().optional().describe('Request body (stringified JSON or text)'),
    timeout: z
      .number()
      .optional()
      .default(15000)
      .describe('Timeout in milliseconds (AbortController in the page)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const result = await session.browser.evaluate(
        async (opts: {
          url: string;
          method: string;
          headers?: Record<string, string>;
          body?: string;
          timeout: number;
        }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), opts.timeout);
          try {
            const init: RequestInit = {
              method: opts.method,
              headers: opts.headers,
              signal: controller.signal,
            };
            if (opts.body && !['GET', 'HEAD'].includes(opts.method)) {
              init.body = opts.body;
            }
            const res = await fetch(opts.url, init);
            const text = await res.text();
            let parsed: unknown = undefined;
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              try {
                parsed = JSON.parse(text);
              } catch {
                parsed = text;
              }
            } else {
              parsed = text;
            }
            const headers: Record<string, string> = {};
            res.headers.forEach((v, k) => {
              headers[k] = v;
            });
            return {
              ok: res.ok,
              status: res.status,
              statusText: res.statusText,
              headers,
              body: parsed,
              bodyRaw: text,
              size: text.length,
            };
          } finally {
            clearTimeout(timer);
          }
        },
        {
          url: input.url,
          method: input.method ?? 'GET',
          headers: input.headers,
          body: input.body,
          timeout: input.timeout ?? 15000,
        },
      );

      return responseBuilder.success(
        {
          ...result,
          hint: result.ok
            ? undefined
            : 'Non-2xx response returned with raw body above — read body/bodyRaw for the API error message.',
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'API_FETCH_FAILED',
        suggestions: [
          'Check the URL is reachable from the browser context (same-origin or CORS-enabled)',
          'Inspect cookies/auth via auth_check_logged_in',
          'For server-side (no-auth) requests, use network_api_call instead',
        ],
      });
    }
  },
});

export const devtoolsGetJsErrors = createTool({
  name: 'devtools_get_js_errors',
  category: 'devtools',
  description:
    '`<use_case>Console inspector</use_case> 🐛 Get ONLY JavaScript errors from the console — filters out info/warn/debug logs. Returns grouped errors by pattern, lastError, and count. More focused than devtools_get_console_logs(level=error) because it also groups similar errors and shows the most recent one. Use for quick error triage.`',
  inputSchema: z.object({
    since: z.string().optional().describe('ISO timestamp to filter errors after'),
    limit: z.number().optional().default(20).describe('Maximum number of errors to return'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const errors = sessionManager.getConsoleBuffer(session.id, {
      level: 'error',
      limit: input.limit,
      since: input.since,
    });

    // Summarize errors: group by message pattern
    const errorGroups = new Map<string, number>();
    for (const e of errors) {
      // Normalize: remove timestamps, numbers to group similar errors
      const key = e.message.replace(/\d+/g, 'N').slice(0, 100);
      errorGroups.set(key, (errorGroups.get(key) ?? 0) + 1);
    }

    const grouped = Array.from(errorGroups.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([msg, count]) => ({ message: msg, count }));

    return responseBuilder.success(
      {
        errors: errors.slice(-5), // Only return last 5 raw errors
        count: errors.length,
        grouped, // Grouped by pattern
        summary:
          errors.length > 0
            ? `${errors.length} error(s): ${grouped.map((g) => `${g.message.slice(0, 60)} (${g.count}x)`).join('; ')}`
            : 'No errors',
        lastError: errors.length > 0 ? errors[errors.length - 1] : null,
      },
      sessionManager.buildMeta(session),
    );
  },
});

// ─── devtools_get_component_state (#100) ─────────────────────────
// Reads React component props, state, and hooks from fiber nodes.

export const devtoolsGetComponentState = createTool({
  name: 'devtools_get_component_state',
  category: 'devtools',
  description:
    '`<use_case>Debugging</use_case> 🔬 Read React component internal state from fiber nodes. Given a CSS selector, walks the React fiber tree to extract props, state, context, and hooks for the matching component. Returns componentName, props, state, hooks summary, and context. Use to inspect React component internals during debugging — e.g., checking form state after input, verifying context values, or debugging re-renders. NOTE: Works only on pages using React; Vue/others return fiberInfo:null. Requires security.allowJSEvaluation to be enabled.`',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the DOM element rendered by the component'),
    maxDepth: z
      .number()
      .optional()
      .default(2)
      .describe('Max depth to traverse the fiber tree (default 2, max 5)'),
    includeHooks: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include full hook values (can be large for complex components)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);

    try {
      const result = await session.browser.evaluate(
        ({ sel, maxDep, inclHooks }: { sel: string; maxDep: number; inclHooks: boolean }) => {
          const el = document.querySelector(sel);
          if (!el) return { found: false, error: 'Element not found' };

          // Try React fiber
          const fiberKey = Object.keys(el).find(
            (k) =>
              k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
          );
          if (!fiberKey) {
            return { found: true, framework: 'unknown', fiberInfo: null };
          }

          const fiber = (el as unknown as Record<string, unknown>)[fiberKey as string];
          if (!fiber) {
            return { found: true, framework: 'react', fiberInfo: null };
          }

          // Walk up to find the nearest component with a name
          let current: Record<string, unknown> | null = fiber as Record<string, unknown>;
          let depth = 0;
          let componentName: string | null = null;

          while (current && depth < maxDep) {
            const type = current.type;
            if (type) {
              const typeObj = type as Record<string, unknown>;
              const name =
                typeof type === 'function'
                  ? (type as () => void).name || (typeObj.displayName as string) || 'Anonymous'
                  : typeof type === 'object'
                    ? (typeObj.name as string) ||
                      (typeObj.displayName as string) ||
                      null
                    : null;
              if (name && name !== 'Anonymous') {
                componentName = name as string;
                break;
              }
            }
            if (current.return) current = current.return as Record<string, unknown>;
            else break;
            depth++;
          }

          // Extract memoized state, props, and hooks
          const memoizedState = (fiber as Record<string, unknown>).memoizedState;
          const pendingProps = (fiber as Record<string, unknown>).pendingProps;
          const memoizedProps = (fiber as Record<string, unknown>).memoizedProps;
          const stateNode = (fiber as Record<string, unknown>).stateNode;
          const _flags = (fiber as Record<string, unknown>).flags;
          const _tag = (fiber as Record<string, unknown>).tag;
          const _elementType = (fiber as Record<string, unknown>).elementType;

          // Build hooks list
          const hooks: Array<{ type: string; value: unknown }> = [];
          if (memoizedState && typeof memoizedState === 'object') {
            let hook: Record<string, unknown> | null = memoizedState as Record<string, unknown>;
            let hookCount = 0;
            while (hook && hookCount < 20) {
              const queue = hook.queue;
              const hookType = queue ? (queue as Record<string, unknown>).lastRenderedState !== undefined ? 'useState' : 'useReducer' : 'useRef';
              const val = hook.memoizedState;
              hooks.push({
                type: hookType,
                value: inclHooks ? val : typeof val,
              });
              hook = hook.next as Record<string, unknown> | null;
              hookCount++;
            }
          }

          // Extract state from class component stateNode
          let classState: Record<string, unknown> | null = null;
          if (stateNode && typeof stateNode === 'object') {
            const sn = stateNode as Record<string, unknown>;
            if (sn.state && typeof sn.state === 'object') {
              classState = sn.state as Record<string, unknown>;
            }
          }

          return {
            found: true,
            framework: 'react',
            fiberInfo: {
              componentName,
              tag: _tag,
              flags: _flags,
              elementType:
                typeof _elementType === 'function'
                  ? ((_elementType as () => void).name || 'Anonymous')
                  : String(_elementType ?? null),
            },
            props: (pendingProps as Record<string, unknown>) ??
              (memoizedProps as Record<string, unknown>) ??
              null,
            state: classState,
            hooks: hooks.length > 0 ? hooks : null,
          };
        },
        {
          sel: input.selector,
          maxDep: Math.min(input.maxDepth ?? 2, 5),
          inclHooks: input.includeHooks ?? false,
        },
      );

      return responseBuilder.success(
        result as Record<string, unknown>,
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'COMPONENT_STATE_FAILED',
        suggestions: [
          'Verify the page uses React',
          'Try a different selector',
          'Use browser_get_dom_snapshot to find the element first',
        ],
      });
    }
  },
});

export const devtoolsWatchConsole = createTool({
  name: 'devtools_watch_console',
  category: 'devtools',
  description:
    '`<use_case>Console inspector</use_case> ⏱️ Watch console logs for a bounded window (durationMs). Self-terminating — it always stops after the duration (no resource leak), and with stopOnNavigation (default true) it also stops early if the page navigates. Captures all logs emitted during the window — useful for catching startup errors or tracking output during a specific interaction. Unlike devtools_get_console_logs (historical), this captures a live window.`',
  inputSchema: z.object({
    durationMs: z
      .number()
      .describe('Maximum duration in milliseconds to watch console (hard auto-stop)'),
    level: z
      .enum(['log', 'info', 'warn', 'error', 'debug'])
      .optional()
      .describe('Filter by log level'),
    stopOnNavigation: z
      .boolean()
      .optional()
      .default(true)
      .describe('Stop watching early if the page URL changes during the window'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const before = new Date().toISOString();
    const start = Date.now();
    const initialUrl = session.browser.url();

    // Bounded poll: always stops at durationMs; stops early on navigation.
    const step = 200;
    let stoppedOnNavigation = false;
    while (Date.now() - start < input.durationMs) {
      await new Promise((resolve) => setTimeout(resolve, step));
      if (input.stopOnNavigation && session.browser.url() !== initialUrl) {
        stoppedOnNavigation = true;
        break;
      }
    }

    const logs = sessionManager.getConsoleBuffer(session.id, {
      level: input.level,
      since: before,
    });

    const errorCount = logs.filter((l) => l.level === 'error').length;
    const warnCount = logs.filter((l) => l.level === 'warn').length;

    return responseBuilder.success(
      {
        logs,
        errorCount,
        warnCount,
        stoppedOnNavigation,
        summary:
          errorCount > 0
            ? `${errorCount} error(s) in ${input.durationMs}ms`
            : warnCount > 0
              ? `${warnCount} warning(s) in ${input.durationMs}ms`
              : `No errors or warnings in ${input.durationMs}ms`,
      },
      sessionManager.buildMeta(session),
    );
  },
});
