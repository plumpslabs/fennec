import { z } from 'zod';
import { createTool } from '../_registry.js';
import { PerformanceCollector } from '../../cdp/PerformanceCollector.js';
import { resolveSelector } from '../../utils/selector.js';

const perfCollector = new PerformanceCollector();

export const diagnosePage = createTool({
  name: 'diagnose_page',
  category: 'diagnostic',
  description:
    '`<use_case>Diagnostic</use_case> 🩺 Comprehensive one-shot page health check. Collects: page URL/title/state, console errors, network failures (>=400), and performance metrics. Returns summary with errorCount and failedRequests. Use as your first diagnostic step when something seems wrong. More complete than diagnose_network (network only) or devtools_get_js_errors (console only). For full-stack diagnosis including server processes, use diagnose_fullstack.`',
  inputSchema: z.object({
    focus: z
      .enum(['errors', 'performance', 'network', 'all'])
      .optional()
      .default('all')
      .describe('Diagnostic focus area'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;
    try {
      const [url, title, readyState, consoleLogs, perfMetrics] = await Promise.all([
        page.url(),
        page.title().catch(() => ''),
        page.evaluate(() => document.readyState).catch(() => 'unknown'),
        Promise.resolve(sessionManager.getConsoleBuffer(session.id, { level: 'error', limit: 10 })),
        perfCollector.getMetrics(page).catch(() => null),
      ]);
      const networkFailures = session.networkBuffer.filter((r) => r.status >= 400).slice(-5);
      return responseBuilder.success(
        {
          page: { url, title, readyState },
          consoleErrors: consoleLogs.map((l) => l.message),
          networkFailures,
          performance: perfMetrics,
          summary: { errorCount: consoleLogs.length, failedRequests: networkFailures.length },
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const diagnoseElement = createTool({
  name: 'diagnose_element',
  category: 'diagnostic',
  description:
    "`<use_case>Diagnostic</use_case> 🔍 Debug a specific element: checks existence (in DOM), visibility (isVisible), enablement (isEnabled), and overall interactability. Returns reason and actionable suggestions if the element can't be interacted with. Use when browser_click or browser_type fails — this tells you WHY (not visible? disabled? not in DOM?). For full element details including attributes and bounding box, use browser_get_element_info instead.`",
  inputSchema: z.object({
    selector: z.string().describe('Element selector to diagnose'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.success(
          {
            exists: false,
            visible: false,
            interactable: false,
            reason: 'Element not found in DOM',
            suggestions: [
              'Check if the page has finished loading',
              'Try a different selector strategy',
            ],
          },
          sessionManager.buildMeta(session),
        );
      }
      const locator = session.browser.locator(resolved.selector);
      const [visible, enabled] = await Promise.all([
        locator.isVisible().catch(() => false),
        locator.isEnabled().catch(() => false),
      ]);
      const reasons: string[] = [];
      const suggestions: string[] = [];
      if (!visible) {
        reasons.push('Element is not visible');
        suggestions.push('Try scrolling to the element');
      }
      if (!enabled) {
        reasons.push('Element is disabled');
        suggestions.push('Check if element should be enabled by a previous step');
      }
      return responseBuilder.success(
        {
          exists: true,
          visible,
          enabled,
          interactable: visible && enabled,
          reason: reasons.length > 0 ? reasons.join('; ') : 'Element looks interactable',
          suggestions,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const diagnoseNetwork = createTool({
  name: 'diagnose_network',
  category: 'diagnostic',
  description:
    '`<use_case>Diagnostic</use_case> 🌐 Network-only diagnostic: failed requests (>=400), slow requests (>1s), CORS issues, and summary with total/failed/slow/cors counts. More focused than diagnose_page which also checks console and performance. Use for quick network health checks — e.g., after an API call fails. For detailed request inspection, use network_get_logs or network_get_request_detail.`',
  inputSchema: z.object({
    since: z.string().optional().describe('ISO timestamp filter'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const requests = session.networkBuffer;
    const failedRequests = requests.filter((r) => r.status >= 400);
    const slowRequests = requests.filter((r) => r.duration > 1000);
    const corsIssues = requests.filter(
      (r) =>
        r.status === 0 ||
        (r.responseHeaders && !r.responseHeaders['access-control-allow-origin'] && r.status >= 400),
    );
    return responseBuilder.success(
      {
        failedRequests: failedRequests.slice(-10),
        slowRequests: slowRequests.slice(-5),
        corsIssues: corsIssues.slice(-5),
        summary: {
          total: requests.length,
          failed: failedRequests.length,
          slow: slowRequests.length,
          cors: corsIssues.length,
        },
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const diagnoseAuth = createTool({
  name: 'diagnose_auth',
  category: 'diagnostic',
  description:
    "`<use_case>Diagnostic</use_case> 🔐 Check authentication state: analyzes cookies for auth tokens (session, jwt, token, auth, sid, connect). Returns isAuthenticated, tokenFound, cookiesPresent, authCookiesCount, expiryInfo. Use to quickly verify if you're logged in on a site, check token expiry, or diagnose login issues. More detailed than auth_check_logged_in which also checks page elements. For saving/loading auth, use auth_save_session / auth_load_session.`",
  inputSchema: z.object({ sessionId: z.string().optional().describe('Session ID') }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cookies = await session.browser.contextCookies();
      const authCookies = cookies.filter((c) => /token|session|auth|jwt|sid|connect/i.test(c.name));
      return responseBuilder.success(
        {
          isAuthenticated: authCookies.length > 0,
          tokenFound: authCookies.some((c) => /token|jwt/i.test(c.name)),
          cookiesPresent: cookies.length,
          authCookiesCount: authCookies.length,
          expiryInfo:
            authCookies.length > 0
              ? authCookies.map((c) => ({
                  name: c.name,
                  expires: c.expires ? new Date(c.expires * 1000).toISOString() : 'session',
                }))
              : null,
          currentUrl: session.browser.url(),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const diagnoseFullstack = createTool({
  name: 'diagnose_fullstack',
  category: 'diagnostic',
  description:
    '`<use_case>Diagnostic</use_case> 🏥 Full-stack diagnostic: correlates browser-side errors (console + network) with server-side process logs. Returns: browser state, server errors (if processId provided), and correlation analysis with rootCause, confidence score, and suggested fix. Use when debugging full-stack apps — provides unified view of frontend + backend issues. Detects patterns: auth tokens, missing env vars, 500 errors + server crashes. Simpler: diagnose_page for just browser side.`',
  inputSchema: z.object({
    processId: z.string().optional().describe('Server process ID to correlate with browser state'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, processManager }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;
    try {
      const [url, title, consoleErrors, networkFailures] = await Promise.all([
        page.url(),
        page.title().catch(() => ''),
        Promise.resolve(sessionManager.getConsoleBuffer(session.id, { level: 'error', limit: 10 })),
        Promise.resolve(session.networkBuffer.filter((r) => r.status >= 400).slice(-10)),
      ]);

      let serverErrors: string[] = [];
      let processStatus: Record<string, unknown> | null = null;

      if (input.processId) {
        try {
          const serverLogs = processManager.getLogs(input.processId, { level: 'error', lines: 20 });
          serverErrors = serverLogs.map((l) => l.line);
          const status = processManager.getStatus(input.processId);
          processStatus = { running: status.running, uptime: status.uptime, pid: status.pid };
        } catch {
          /* process not found */
        }
      }

      // Root cause inference
      let rootCause: string | null = null;
      let confidence = 0;
      let fix: string | null = null;
      const combinedText = [
        ...consoleErrors.map((e) => e.message),
        ...serverErrors,
        ...networkFailures.map((r) => `${r.status} ${r.url}`),
      ]
        .join(' ')
        .toLowerCase();

      if (combinedText.includes('jwt') || combinedText.includes('token')) {
        rootCause = 'Authentication token issue';
        confidence = 0.92;
        fix = 'Verify JWT_SECRET is set and auth tokens are valid';
      } else if (
        combinedText.includes('env') ||
        combinedText.includes('not found') ||
        combinedText.includes('enoent')
      ) {
        rootCause = 'Missing environment variable or file';
        confidence = 0.88;
        fix = 'Check if required env vars and files exist';
      } else if (networkFailures.some((r) => r.status === 500) && serverErrors.length > 0) {
        rootCause = 'Server error caused network failure';
        confidence = 0.9;
        fix = 'Check server logs for unhandled exceptions';
      } else if (consoleErrors.length > 0 && networkFailures.length > 0) {
        rootCause = 'Network failure likely caused JavaScript error';
        confidence = 0.85;
        fix = 'Ensure all API endpoints are reachable';
      }

      return responseBuilder.success(
        {
          browser: {
            url,
            title,
            consoleErrors: consoleErrors.map((e) => e.message),
            networkFailures,
          },
          server: { recentErrors: serverErrors, processStatus },
          correlation: { rootCause, confidence, fix },
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const diagnosePerformance = createTool({
  name: 'diagnose_performance',
  category: 'diagnostic',
  description:
    "`<use_case>Diagnostic</use_case> ⚡ Performance diagnostic: checks Web Vitals (FCP, LCP, CLS, memory) and returns score (0-100), issues[], and optimization recommendations[]. More actionable than devtools_get_performance_metrics which just returns raw metrics. Use for performance auditing — tells you what's wrong AND how to fix it. Includes memory leak detection (JS heap > 100MB).`",
  inputSchema: z.object({ sessionId: z.string().optional().describe('Session ID') }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const metrics = await perfCollector.getMetrics(session.browser);
      const issues: string[] = [];
      const recommendations: string[] = [];
      if (metrics.FCP !== null && metrics.FCP > 2000) {
        issues.push('First Contentful Paint is slow (> 2s)');
        recommendations.push('Optimize critical rendering path');
      }
      if (metrics.LCP !== null && metrics.LCP > 2500) {
        issues.push('Largest Contentful Paint is slow (> 2.5s)');
        recommendations.push('Optimize largest content elements');
      }
      if (metrics.memoryUsage && metrics.memoryUsage.jsHeapSize > 100_000_000) {
        issues.push('High JavaScript memory usage (> 100MB)');
        recommendations.push('Check for memory leaks');
      }
      const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 25);
      return responseBuilder.success(
        { metrics, score, issues, recommendations },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
