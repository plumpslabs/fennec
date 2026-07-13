import { z } from 'zod';
import { createTool } from '../_registry.js';
import type { ToolContext } from '../_registry.js';

export const browserNavigate = createTool({
  name: 'browser_navigate',
  category: 'navigation',
  description:
    "`<use_case>Navigation</use_case> 🚀 Navigate the browser to a URL. Supports waitUntil options: 'networkidle' (default, waits for no network activity), 'load', 'domcontentloaded', 'commit'. Returns finalUrl (in case of redirects), statusCode, loadTime. Use as the primary way to load pages. For smarter navigation with auto-DOM summary, use smart_navigate instead. Built-in retry: set maxRetries (default 0) and retryOn (default ['timeout','navigation_error']) to auto-retry flaky loads. For going back/forward in history, use browser_go_back / browser_go_forward.`",
  inputSchema: z.object({
    url: z.string().url().describe('The URL to navigate to'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
      .optional()
      .default('networkidle')
      .describe('When to consider navigation complete'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    maxRetries: z
      .number()
      .optional()
      .default(0)
      .describe('Number of automatic retries on failure (default 0 = no retry)'),
    retryOn: z
      .array(z.enum(['timeout', 'navigation_error']))
      .optional()
      .default(['timeout', 'navigation_error'])
      .describe('Error classes that trigger a retry'),
    retryDelayMs: z
      .number()
      .optional()
      .default(1000)
      .describe('Delay between retries in milliseconds'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, logger }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();
    const maxRetries = Math.max(0, input.maxRetries ?? 0);

    const classify = (err: unknown): 'timeout' | 'navigation_error' => {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
      return 'navigation_error';
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await session.browser.navigate(input.url, {
          waitUntil: input.waitUntil,
          timeout: input.timeout,
        });

        return responseBuilder.success(
          {
            finalUrl: result.finalUrl,
            statusCode: result.statusCode,
            loadTime: result.loadTimeMs,
            attempts: attempt + 1,
          },
          { ...sessionManager.buildMeta(session), elapsed: result.loadTimeMs },
        );
      } catch (error) {
        lastError = error;
        const cls = classify(error);
        const canRetry =
          (input.retryOn ?? ['timeout', 'navigation_error']).includes(cls) && attempt < maxRetries;
        if (canRetry) {
          logger?.info?.({ attempt: attempt + 1, cls }, 'browser_navigate: retrying after failure');
          await new Promise((r) => setTimeout(r, input.retryDelayMs ?? 1000));
          continue;
        }
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    return responseBuilder.error(lastError, {
      code: 'NAVIGATION_FAILED',
      suggestions: [
        'Check if the URL is accessible from your network',
        'Try increasing the timeout parameter',
        'Verify the URL format includes protocol (http:// or https://)',
      ],
      meta: { ...sessionManager.buildMeta(session), elapsed },
    });
  },
});

export const browserGoBack = createTool({
  name: 'browser_go_back',
  category: 'navigation',
  description:
    '`<use_case>Navigation</use_case> ⬅️ Go back one page in browser history. Returns currentUrl after navigation. Use after clicking a link or submitting a form that navigated to a new page — to return to the previous page. Like pressing the browser back button. For forward navigation, use browser_go_forward.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.browser.goBack();
      return responseBuilder.success(
        {
          currentUrl: session.browser.url(),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'NAVIGATION_FAILED',
        suggestions: ['Check if there is previous page in history'],
      });
    }
  },
});

export const browserGoForward = createTool({
  name: 'browser_go_forward',
  category: 'navigation',
  description:
    '`<use_case>Navigation</use_case> ➡️ Go forward one page in browser history (undo a browser_go_back). Returns currentUrl after navigation. Only works if you previously went back — no forward history if you just navigated normally. Like pressing the browser forward button.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.browser.goForward();
      return responseBuilder.success(
        {
          currentUrl: session.browser.url(),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'NAVIGATION_FAILED',
        suggestions: ['Check if there is next page in history'],
      });
    }
  },
});

export const browserReload = createTool({
  name: 'browser_reload',
  category: 'navigation',
  description:
    '`<use_case>Navigation</use_case> 🔄 Reload the current page. Optionally hardReload (bypass browser cache) for fresh content. Returns loadTime. Use when you need to refresh page state, re-fetch data, or test initial load behavior. For navigation to a different URL, use browser_navigate instead.`',
  inputSchema: z.object({
    hardReload: z.boolean().optional().default(false).describe('If true, bypass cache'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();

    try {
      await session.browser.reload();
      return responseBuilder.success(
        { loadTime: Date.now() - startTime },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'NAVIGATION_FAILED',
      });
    }
  },
});

export const browserGetCurrentUrl = createTool({
  name: 'browser_get_current_url',
  category: 'navigation',
  description:
    "`<use_case>Navigation</use_case> ℹ️ Get current page info: URL, title, and document.readyState. Fast — no async waits needed for URL. Use to verify navigation succeeded, check what page you're on, or monitor page loading progress ('loading' → 'interactive' → 'complete'). Similar to tab_get_current but returns readyState which indicates page load status.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const url = session.browser.url();
      const title = await session.browser.title();
      const readyState = await session.browser.readyState();

      return responseBuilder.success(
        {
          url,
          title,
          readyState,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserWaitForNavigation = createTool({
  name: 'browser_wait_for_navigation',
  category: 'navigation',
  description:
    '`<use_case>Navigation</use_case> ⏳ Wait for the page to navigate to a URL matching a pattern (substring match). Has configurable timeout (default 30s). Returns finalUrl and elapsed time. Use AFTER triggering a navigation (clicking a link, submitting a form) to wait for the new page to load. Unlike browser_navigate which triggers navigation, this only WAITS for navigation to happen.`',
  inputSchema: z.object({
    urlPattern: z.string().optional().describe('URL pattern to wait for (glob or regex string)'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();

    try {
      await session.browser.waitForURL(
        (url) => {
          if (!input.urlPattern) return true;
          return url.toString().includes(input.urlPattern);
        },
        { timeout: input.timeout },
      );

      return responseBuilder.success(
        {
          finalUrl: session.browser.url(),
          elapsed: Date.now() - startTime,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'NAVIGATION_TIMEOUT',
        suggestions: [
          'Check if navigation was triggered',
          'Try increasing the timeout',
          'Verify the URL pattern matches expected destination',
        ],
      });
    }
  },
});
