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
      requests = requests.filter((r) => r.status === input.status);
    }
    if (input.method) {
      requests = requests.filter((r) => r.method.toUpperCase() === input.method.toUpperCase());
    }
    if (input.urlPattern) {
      requests = requests.filter((r) => r.url.includes(input.urlPattern));
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
