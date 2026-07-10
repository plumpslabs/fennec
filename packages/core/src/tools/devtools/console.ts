import { z } from "zod";
import { createTool } from "../_registry.js";

/**
 * Build a human-readable summary of console logs grouped by level.
 * This is the token-efficient alternative to dumping all raw logs.
 */
function buildLogSummary(errorCount: number, warnCount: number, infoCount: number, logs: Array<{ level: string; message: string }>): string {
  const parts: string[] = [];

  if (errorCount > 0) {
    // Extract unique error messages (truncated) for the summary
    const uniqueErrors = new Set<string>();
    for (const log of logs) {
      if (log.level === "error") {
        uniqueErrors.add(log.message.replace(/\d+/g, 'N').slice(0, 80));
      }
    }
    const errorsSummary = Array.from(uniqueErrors).slice(0, 3).join("; ");
    parts.push(`${errorCount} error(s): ${errorsSummary}`);
  }

  if (warnCount > 0) {
    parts.push(`${warnCount} warning(s)`);
  }

  if (infoCount > 0) {
    parts.push(`${infoCount} info log(s)`);
  }

  if (parts.length === 0) {
    return "No console logs";
  }

  return parts.join(". ");
}

export const devtoolsGetConsoleLogs = createTool({
  name: "devtools_get_console_logs",
  category: "devtools",
  description: "`<use_case>Console inspector</use_case> 🔍 Get browser console logs from the current page. Filter by level (log/info/warn/error/debug), keyword, or time range. Returns errorCount, warnCount, infoCount, and a readable summary. Use when you need to see app logs, find warnings, or trace console output. More focused than observe() — use this for raw log inspection.`",
  inputSchema: z.object({
    level: z.enum(["log", "info", "warn", "error", "debug"]).optional().describe("Filter by log level"),
    limit: z.number().optional().default(50).describe("Maximum number of logs to return"),
    since: z.string().optional().describe("ISO timestamp to filter logs after"),
    keyword: z.string().optional().describe("Filter logs containing this keyword"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const logs = sessionManager.getConsoleBuffer(session.id, {
      level: input.level,
      limit: input.limit,
      since: input.since,
      keyword: input.keyword,
    });

    const errorCount = logs.filter((l) => l.level === "error").length;
    const warnCount = logs.filter((l) => l.level === "warn").length;
    const infoCount = logs.filter((l) => l.level === "info").length;

    // Level-based summary: return raw logs only for error level, summary for others
    const isHighDetail = input.level === "error" || (errorCount > 0 && input.limit && input.limit <= 20);

    return responseBuilder.success({
      // Only return full logs when explicitly asked for errors
      logs: isHighDetail ? logs : [],
      errorCount,
      warnCount,
      infoCount,
      // Level-based summary string
      summary: buildLogSummary(errorCount, warnCount, infoCount, logs),
    }, sessionManager.buildMeta(session));
  },
});

export const devtoolsClearConsole = createTool({
  name: "devtools_clear_console",
  category: "devtools",
  description: "`<use_case>Console inspector</use_case> 🧹 Clear all console logs from the buffer. Returns previousCount of how many entries were removed. Use when you want a fresh log state before performing an action — like clearing logs before clicking a button so you can see only new errors.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const previousCount = sessionManager.clearConsoleBuffer(session.id);
    return responseBuilder.success({
      cleared: true,
      previousCount,
    }, sessionManager.buildMeta(session));
  },
});

export const devtoolsEvaluate = createTool({
  name: "devtools_evaluate",
  category: "devtools",
  description: "`<use_case>Code execution</use_case> ⚡ Execute JavaScript code directly in the browser page context. Returns the result and its type. Requires security.allowJSEvaluation to be enabled. Use for advanced DOM manipulation, reading page variables, or calling JS functions that aren't exposed via other tools. Safer alternatives: browser_get_dom_snapshot for DOM, storage_get_local for localStorage.`",
  inputSchema: z.object({
    expression: z.string().describe("JavaScript expression to evaluate"),
    awaitResult: z.boolean().optional().default(true).describe("Wait for promise resolution"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    if (!config.security.allowJSEvaluation) {
      return responseBuilder.error(
        new Error("JavaScript evaluation is disabled in security settings"),
        { code: "INVALID_INPUT" },
      );
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const result = await session.browser.evaluate(input.expression);
      return responseBuilder.success({
        result,
        type: typeof result,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "INVALID_INPUT",
        suggestions: [
          "Check the JavaScript syntax",
          "Ensure the page supports the APIs being called",
        ],
      });
    }
  },
});

export const devtoolsGetJsErrors = createTool({
  name: "devtools_get_js_errors",
  category: "devtools",
  description: "`<use_case>Console inspector</use_case> 🐛 Get ONLY JavaScript errors from the console — filters out info/warn/debug logs. Returns grouped errors by pattern, lastError, and count. More focused than devtools_get_console_logs(level=error) because it also groups similar errors and shows the most recent one. Use for quick error triage.`",
  inputSchema: z.object({
    since: z.string().optional().describe("ISO timestamp to filter errors after"),
    limit: z.number().optional().default(20).describe("Maximum number of errors to return"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const errors = sessionManager.getConsoleBuffer(session.id, {
      level: "error",
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

    return responseBuilder.success({
      errors: errors.slice(-5), // Only return last 5 raw errors
      count: errors.length,
      grouped,                   // Grouped by pattern
      summary: errors.length > 0
        ? `${errors.length} error(s): ${grouped.map(g => `${g.message.slice(0, 60)} (${g.count}x)`).join("; ")}`
        : "No errors",
      lastError: errors.length > 0 ? errors[errors.length - 1] : null,
    }, sessionManager.buildMeta(session));
  },
});

export const devtoolsWatchConsole = createTool({
  name: "devtools_watch_console",
  category: "devtools",
  description: "`<use_case>Console inspector</use_case> ⏱️ Watch console logs in real-time for a specified duration (ms). Captures all logs emitted during the window — useful for catching startup errors, tracking log output during a specific interaction, or monitoring short-lived processes. Unlike devtools_get_console_logs which shows historical logs, this captures a live window.`",
  inputSchema: z.object({
    durationMs: z.number().describe("Duration in milliseconds to watch console"),
    level: z.enum(["log", "info", "warn", "error", "debug"]).optional().describe("Filter by log level"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const before = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, input.durationMs));
    const logs = sessionManager.getConsoleBuffer(session.id, {
      level: input.level,
      since: before,
    });

    const errorCount = logs.filter((l) => l.level === "error").length;
    const warnCount = logs.filter((l) => l.level === "warn").length;

    return responseBuilder.success({
      logs,
      errorCount,
      warnCount,
      summary: errorCount > 0
        ? `${errorCount} error(s) in ${input.durationMs}ms`
        : warnCount > 0
          ? `${warnCount} warning(s) in ${input.durationMs}ms`
          : `No errors or warnings in ${input.durationMs}ms`,
    }, sessionManager.buildMeta(session));
  },
});

