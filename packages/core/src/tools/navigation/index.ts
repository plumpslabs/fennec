import { z } from "zod";
import { createTool } from "../_registry.js";
import type { ToolContext } from "../_registry.js";

export const browserNavigate = createTool({
  name: "browser_navigate",
  category: "navigation",
  description: "`<use_case>Page navigation</use_case> Navigate to a URL. finalUrl, statusCode (int), loadTime (ms).`",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to navigate to"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .optional()
      .default("networkidle")
      .describe("When to consider navigation complete"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, logger }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();

    try {
      await session.page.goto(input.url, {
        waitUntil: input.waitUntil,
        timeout: input.timeout,
      });

      const finalUrl = session.page.url();
      const statusCode = await session.page.evaluate(() => {
        const perf = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return perf?.responseStatus ?? 200;
      }).catch(() => 200);

      const elapsed = Date.now() - startTime;

      return responseBuilder.success(
        {
          finalUrl,
          statusCode,
          loadTime: elapsed,
        },
        { ...sessionManager.buildMeta(session), elapsed },
      );
    } catch (error) {
      const elapsed = Date.now() - startTime;
      return responseBuilder.error(error, {
        code: "NAVIGATION_FAILED",
        suggestions: [
          "Check if the URL is accessible from your network",
          "Try increasing the timeout parameter",
          "Verify the URL format includes protocol (http:// or https://)",
        ],
        meta: { ...sessionManager.buildMeta(session), elapsed },
      });
    }
  },
});

export const browserGoBack = createTool({
  name: "browser_go_back",
  category: "navigation",
  description: "`<use_case>History navigation</use_case> Go back one page in browser history. currentUrl.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.page.goBack();
      return responseBuilder.success({
        currentUrl: session.page.url(),
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NAVIGATION_FAILED",
        suggestions: ["Check if there is previous page in history"],
      });
    }
  },
});

export const browserGoForward = createTool({
  name: "browser_go_forward",
  category: "navigation",
  description: "`<use_case>History navigation</use_case> Go forward one page in browser history. currentUrl.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.page.goForward();
      return responseBuilder.success({
        currentUrl: session.page.url(),
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NAVIGATION_FAILED",
        suggestions: ["Check if there is next page in history"],
      });
    }
  },
});

export const browserReload = createTool({
  name: "browser_reload",
  category: "navigation",
  description: "`<use_case>Page refresh</use_case> Reload the current page. Optionally bypass cache (hardReload). loadTime (ms).`",
  inputSchema: z.object({
    hardReload: z.boolean().optional().default(false).describe("If true, bypass cache"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();

    try {
      await session.page.reload({
        waitUntil: "networkidle",
      });

      return responseBuilder.success(
        {
          loadTime: Date.now() - startTime,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NAVIGATION_FAILED",
      });
    }
  },
});

export const browserGetCurrentUrl = createTool({
  name: "browser_get_current_url",
  category: "navigation",
  description: "`<use_case>Page state</use_case> Get current URL, page title, and document readyState. url, title, readyState.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const url = session.page.url();
      const title = await session.page.title();
      const readyState = await session.page.evaluate(() => document.readyState);

      return responseBuilder.success({
        url,
        title,
        readyState,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserWaitForNavigation = createTool({
  name: "browser_wait_for_navigation",
  category: "navigation",
  description: "`<use_case>Page state</use_case> Wait for the page to navigate to a URL matching a pattern (glob or substring). finalUrl, elapsed (ms).`",
  inputSchema: z.object({
    urlPattern: z.string().optional().describe("URL pattern to wait for (glob or regex string)"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();

    try {
      await session.page.waitForURL(
        (url) => {
          if (!input.urlPattern) return true;
          return url.toString().includes(input.urlPattern);
        },
        { timeout: input.timeout },
      );

      return responseBuilder.success({
        finalUrl: session.page.url(),
        elapsed: Date.now() - startTime,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NAVIGATION_TIMEOUT",
        suggestions: [
          "Check if navigation was triggered",
          "Try increasing the timeout",
          "Verify the URL pattern matches expected destination",
        ],
      });
    }
  },
});
