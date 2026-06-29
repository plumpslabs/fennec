import { z } from "zod";
import { createTool } from "../_registry.js";
import type { NetworkEvent } from "../../session/types.js";

export const networkGetLogs = createTool({
  name: "network_get_logs",
  description: "`<use_case>Network debugging</use_case> Get network request logs. Filterable by status, method, URL pattern. requests[], count, failedCount, slowCount.`",
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
  description: "`<use_case>Network debugging</use_case> Get all failed network requests (status >= 400). requests[], count.`",
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
  description: "`<use_case>Network debugging</use_case> Detect CORS-related issues from network logs. issues[], count.`",
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
  description: "`<use_case>Network debugging</use_case> Clear all network request logs from the buffer. cleared (bool).`",
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
  description: "`<use_case>Network debugging</use_case> Wait for a network request matching a URL pattern and method. Returns full request and response details once captured. request, response, elapsed (ms).`",
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
      const [request] = await Promise.all([
        session.page.waitForRequest(
          (req) => {
            const urlMatch = req.url().includes(input.urlPattern);
            const methodMatch = input.method ? req.method().toUpperCase() === input.method.toUpperCase() : true;
            return urlMatch && methodMatch;
          },
          { timeout: input.timeout },
        ),
      ]);

      const response = await request.response();
      return responseBuilder.success({
        request: {
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          postData: request.postData(),
          resourceType: request.resourceType(),
        },
        response: response ? {
          status: response.status(),
          statusText: response.statusText(),
          headers: response.headers(),
          url: response.url(),
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
  description: "`<use_case>Network debugging</use_case> Get full detail of a network request by URL or requestId from the buffer. Provide either url or requestId. request, response, timing, size.`",
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
  description: "`<use_case>Network mocking</use_case> Intercept network requests matching a URL pattern. Returns an interceptorId that can be used to remove the intercept later. interceptorId (string).`",
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
      await session.page.route(input.urlPattern, handler);
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
  description: "`<use_case>Network mocking</use_case> Remove a previously set network intercept by interceptorId. success (bool).`",
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
      await session.page.unroute(intercept.urlPattern);
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
  description: "`<use_case>Network mocking</use_case> Mock a response for a URL pattern. Intercept and fulfill with custom status, body, and headers. mockId (string).`",
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
      await session.page.route(input.urlPattern, async (route) => {
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
