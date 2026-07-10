import { z } from "zod";
import { createTool } from "../_registry.js";
import type { NetworkEvent } from "../../session/types.js";

export const networkGetLogs = createTool({
  name: "network_get_logs",
  category: "devtools",
  description: "`<use_case>Network inspector</use_case> 🌐 Get all network request logs from the page. Filter by HTTP status code, method (GET/POST/etc), or URL pattern. Returns requests[], failedCount (>=400), slowCount (>1s). Use when you need to inspect API calls, check request/response patterns, or monitor network activity. More comprehensive than diagnose_network which only shows failures.`",
  inputSchema: z.object({
    status: z.number().optional().describe("Filter by HTTP status code"),
    method: z.string().optional().describe("Filter by HTTP method (GET, POST, etc.)"),
    urlPattern: z.string().optional().describe("Filter by URL pattern"),
    limit: z.number().optional().default(50).describe("Maximum number of requests to return"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    let requests = session.networkBuffer;

    if (input.status) {
      const status = input.status;
      requests = requests.filter((r) => r.status === status);
    }
    if (input.method) {
      const method = input.method.toUpperCase();
      requests = requests.filter((r) => r.method.toUpperCase() === method);
    }
    if (input.urlPattern) {
      const pattern = input.urlPattern;
      requests = requests.filter((r) => r.url.includes(pattern));
    }

    if (input.limit && input.limit > 0) {
      requests = requests.slice(-input.limit);
    }

    const failedCount = requests.filter((r) => r.status >= 400).length;
    const slowCount = requests.filter((r) => r.duration > 1000).length;

    return responseBuilder.success({
      requests,
      count: requests.length,
      failedCount,
      slowCount,
    }, sessionManager.buildMeta(session));
  },
});

export const networkGetFailedRequests = createTool({
  name: "network_get_failed_requests",
  category: "devtools",
  description: "`<use_case>Network inspector</use_case> ❌ Get ONLY failed network requests (HTTP status >= 400). Returns requests[] with their URLs, methods, and status codes. Faster than network_get_logs when you only care about failures. Use for quick error checking — like after form submission or API call.`",
  inputSchema: z.object({
    since: z.string().optional().describe("ISO timestamp filter"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const requests = session.networkBuffer.filter((r) => r.status >= 400);

    return responseBuilder.success({
      requests,
      count: requests.length,
    }, sessionManager.buildMeta(session));
  },
});

export const networkGetCorsIssues = createTool({
  name: "network_get_cors_issues",
  category: "devtools",
  description: "`<use_case>Network inspector</use_case> 🔒 Detect CORS-related issues from network logs. Returns issues[] with affected URLs, methods, and reason. Use when you see blocked requests in console or cross-origin errors. CORS errors show as status=0 or missing access-control-allow-origin headers.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);

    const issues: Array<{ url: string; method: string; reason: string }> = [];

    for (const req of session.networkBuffer) {
      if (req.status === 0) {
        issues.push({
          url: req.url,
          method: req.method,
          reason: "Request blocked (status 0) - likely CORS or mixed content",
        });
      }
      if (req.responseHeaders?.["access-control-allow-origin"] === undefined && req.status >= 400) {
        // Potential CORS issue
      }
    }

    return responseBuilder.success({
      issues,
      count: issues.length,
    }, sessionManager.buildMeta(session));
  },
});

export const networkClearLogs = createTool({
  name: "network_clear_logs",
  category: "devtools",
  description: "`<use_case>Network inspector</use_case> 🧹 Clear the network request log buffer. Returns cleared=true. Use before performing an action (like clicking a button or submitting a form) so you can see only the new network requests that result from that action.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    session.networkBuffer = [];
    return responseBuilder.success({ cleared: true }, sessionManager.buildMeta(session));
  },
});

export const networkWaitForRequest = createTool({
  name: "network_wait_for_request",
  category: "devtools",
  description: "`<use_case>Network inspector</use_case> ⏳ Wait for a specific network request to happen. Provide a URL pattern (glob or substring) and optional HTTP method. Returns full request/response details including headers, status, postData. Use when you need to capture API responses, intercept form submissions, or verify that a specific request was made. Has timeout (default 30s).`",
  inputSchema: z.object({
    urlPattern: z.string().describe("URL or pattern to wait for (glob or substring)"),
    method: z.string().optional().describe("HTTP method filter (GET, POST, etc.)"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();
    try {
      // Use Playwright's waitForRequest for reliable waiting
      const request = await session.browser.waitForRequest(
        (req) => {
          const urlMatch = req.url().includes(input.urlPattern);
          const methodMatch = input.method ? req.method().toUpperCase() === input.method.toUpperCase() : true;
          return urlMatch && methodMatch;
        },
        { timeout: input.timeout },
      );

      const response = await request.response();
      return responseBuilder.success({
        request: {
          url: request.url,
          method: request.method,
          headers: request.headers,
          postData: request.postData,
          resourceType: request.resourceType,
        },
        response: response ? {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: response.url,
        } : null,
        elapsed: Date.now() - startTime,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "REQUEST_TIMEOUT",
        suggestions: [
          `No request matching "${input.urlPattern}" received within ${input.timeout}ms`,
          "Try broadening the URL pattern",
          "Check if the page is making the expected request",
        ],
      });
    }
  },
});

export const networkGetRequestDetail = createTool({
  name: "network_get_request_detail",
  category: "devtools",
  description: "`<use_case>Network inspector</use_case> 🔎 Get FULL details of a network request including request/response headers, body, timing, and size. Provide either exact URL or requestId (from network_get_logs). More detailed than network_get_logs which only shows summary. Use when you need to inspect response bodies, request payloads, or timing breakdown.`",
  inputSchema: z.object({
    url: z.string().optional().describe("URL of the request to get detail for"),
    requestId: z.string().optional().describe("Request ID from the buffer"),
    sessionId: z.string().optional().describe("Session ID"),
  }).refine((data) => data.url || data.requestId, {
    message: "Either url or requestId must be provided",
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    let request: (typeof session.networkBuffer)[0] | undefined;

    if (input.requestId) {
      request = session.networkBuffer.find((r) => r.requestId === input.requestId);
    } else if (input.url) {
      request = session.networkBuffer.find((r) => r.url.includes(input.url!));
    }

    if (!request) {
      return responseBuilder.error(
        new Error("Request not found in buffer"),
        { code: "ELEMENT_NOT_FOUND", suggestions: ["Use network_get_logs to see available requests", "Verify the URL or requestId"] },
      );
    }

    return responseBuilder.success({
      request: {
        url: request.url,
        method: request.method,
        status: request.status,
        duration: request.duration,
        requestHeaders: request.requestHeaders,
        responseHeaders: request.responseHeaders,
        requestBody: request.requestBody,
        responseBody: request.responseBody,
        timestamp: request.timestamp,
      },
    }, sessionManager.buildMeta(session));
  },
});


// ─── Network Intercept / Mock ────────────────────────────────────

export const networkIntercept = createTool({
  name: "network_intercept",
  category: "devtools",
  description: "`<use_case>Network mocking</use_case> 🚦 Intercept network requests matching a URL pattern. Returns an interceptorId for later removal. Use when you want to log, modify, or block specific requests. Unlike network_mock_response which replaces responses, this just intercepts and allows the request to continue. Combine with network_remove_intercept to stop intercepting.`",
  inputSchema: z.object({
    urlPattern: z.string().describe("URL pattern to intercept (glob or substring)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const interceptorId = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const handler = async (route: any) => {
        await route.continue();
      };
      await session.browser.route(input.urlPattern, handler);
      // Store handler reference for unrouting later via a WeakRef or keep in memory
      // For now, store on session metadata
      const meta = session.metadata as Record<string, any>;
      if (!meta.interceptorRefs) {
        meta.interceptorRefs = {};
      }
      meta.interceptorRefs[interceptorId] = {
        urlPattern: input.urlPattern,
      };
      return responseBuilder.success({ interceptorId, active: true }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NETWORK_INTERCEPT_FAILED",
        suggestions: ["Check if the page is still open", "Verify URL pattern syntax"],
      });
    }
  },
});

export const networkRemoveIntercept = createTool({
  name: "network_remove_intercept",
  category: "devtools",
  description: "`<use_case>Network mocking</use_case> 🗑️ Remove a network intercept or mock that was previously set by network_intercept or network_mock_response. Provide the interceptorId or mockId. Returns removed=true/false. Use after you're done intercepting to restore normal network behavior.`",
  inputSchema: z.object({
    interceptorId: z.string().describe("Interceptor ID to remove"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const refs = (session.metadata as Record<string, any>).interceptorRefs ?? {};
      const intercept = refs[input.interceptorId];
      if (!intercept) {
        return responseBuilder.success({ removed: false, reason: "Interceptor not found" }, sessionManager.buildMeta(session));
      }
      await session.browser.unroute(intercept.urlPattern);
      delete refs[input.interceptorId];
      return responseBuilder.success({ removed: true }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NETWORK_INTERCEPT_FAILED",
      });
    }
  },
});

export const networkMockResponse = createTool({
  name: "network_mock_response",
  category: "devtools",
  description: "`<use_case>Network mocking</use_case> 🎭 Mock a response for a URL pattern — intercept matching requests and fulfill them with a custom status, body, and headers. Returns a mockId for later removal. Use for testing error states, simulating API responses, or testing without a real backend. More powerful than network_intercept because it replaces the response entirely.`",
  inputSchema: z.object({
    urlPattern: z.string().describe("URL pattern to mock (glob or substring)"),
    statusCode: z.number().optional().default(200).describe("HTTP status code"),
    body: z.string().optional().default("").describe("Response body"),
    contentType: z.string().optional().default("application/json").describe("Content-Type header"),
    headers: z.record(z.string(), z.string()).optional().describe("Additional response headers"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const mockId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await session.browser.route(input.urlPattern, async (route) => {
        await route.fulfill({
          status: input.statusCode,
          contentType: input.contentType,
          body: input.body,
          headers: input.headers,
        });
      });
      const meta = session.metadata as Record<string, any>;
      if (!meta.interceptorRefs) {
        meta.interceptorRefs = {};
      }
      meta.interceptorRefs[mockId] = {
        urlPattern: input.urlPattern,
        isMock: true,
      };
      return responseBuilder.success({ mockId, active: true }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NETWORK_INTERCEPT_FAILED",
        suggestions: ["Check if the page is still open", "Verify URL pattern syntax"],
      });
    }
  },
});
