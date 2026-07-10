/**
 * AI-Native API — Observation-centric tools for AI agents.
 *
 * These tools replace the browser-centric API (click, type, navigate)
 * with an observation-centric API (observe, diagnose, correlate, summarize,
 * explain, investigate, predict).
 *
 * Design principles:
 * - Always return summarized, token-efficient responses
 * - Use Lazy Context levels (Level 0 = pulse, Level 1/2 = detail on demand)
 * - Leverage EventBus + IncidentEngine for correlation
 * - Never return raw DOM or full log dumps
 */

import { z } from "zod";
import { createTool } from "../_registry.js";
import { getLogger } from "../../utils/logger.js";

// ─── Helper: Build a DOM summary from the page ──────────────────

async function getDomSummary(browser: any): Promise<string> {
  try {
    const result: any = await browser.evaluate(() => {
      const tags: Record<string, number> = {};
      let interactable = 0;
      const interactableTags = new Set(["a", "button", "input", "select", "textarea", "form", "label"]);

      const walker = document.createTreeWalker(
        document.documentElement,
        NodeFilter.SHOW_ELEMENT,
        null,
      );
      let node: Node | null;
      let total = 0;
      while ((node = walker.nextNode()) && total < 500) {
        const el = node as Element;
        total++;
        const tag = el.tagName.toLowerCase();
        tags[tag] = (tags[tag] ?? 0) + 1;
        if (
          interactableTags.has(tag) ||
          el.getAttribute("role") !== null ||
          el.hasAttribute("onclick") ||
          (el as HTMLElement).tabIndex >= 0
        ) {
          interactable++;
        }
      }

      const sortedTags = Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      return {
        total,
        interactable,
        depth: total,
        tags: sortedTags.map(([t, c]) => `${t}:${c}`).join(", "),
      };
    });

    return `Page: ${result.total} elements (${result.interactable} interactable). Tags: ${result.tags}`;
  } catch {
    return "DOM summary unavailable";
  }
}

// ─── Helper: Build console summary ───────────────────────────────

function getConsoleSummary(
  consoleBuffer: Array<{ level: string; message: string }>,
): string {
  const errors = consoleBuffer.filter((l) => l.level === "error");
  const warnings = consoleBuffer.filter((l) => l.level === "warn");

  if (errors.length === 0 && warnings.length === 0) return "No console issues";

  const parts: string[] = [];
  if (errors.length > 0) {
    const uniqueErrors = [...new Set(errors.map((e) => e.message.slice(0, 80)))];
    parts.push(`${errors.length} error(s): ${uniqueErrors.slice(0, 3).join("; ")}`);
  }
  if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`);
  return parts.join(". ");
}

// ─── Helper: Build network summary ───────────────────────────────

function getNetworkSummary(
  networkBuffer: Array<{
    method: string;
    url: string;
    status: number;
    duration: number;
  }>,
): string {
  const failed = networkBuffer.filter((r) => r.status >= 400);
  const slow = networkBuffer.filter((r) => r.duration > 1000);

  if (failed.length === 0 && slow.length === 0) return "Network healthy";

  const parts: string[] = [];
  if (failed.length > 0) {
    const endpoints = failed.map(
      (r) => `${r.method} ${r.url.slice(0, 60)} → ${r.status}`,
    );
    parts.push(`${failed.length} failed: ${endpoints.slice(0, 3).join(", ")}`);
  }
  if (slow.length > 0) parts.push(`${slow.length} slow request(s)`);
  return parts.join(". ");
}

// ─── Tool: observe ───────────────────────────────────────────────

export const observe = createTool({
  name: "observe",
  category: "ai",
  description:
    "`<use_case>Observation</use_case> Observe the current state of all connected sensors (browser, console, network) and return a summarized health overview. Returns a token-efficient Level 0 pulse plus optional Level 1 detail. This is the primary entry point for AI situational awareness.`",
  inputSchema: z.object({
    detail: z
      .enum(["pulse", "summary", "full"])
      .optional()
      .default("pulse")
      .describe(
        "Level of detail: pulse (~5 tokens), summary (~100 tokens), full (~500 tokens)",
      ),
    sources: z
      .array(z.enum(["browser", "console", "network", "process"]))
      .optional()
      .default(["browser", "console", "network"])
      .describe("Which sensors to observe"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const sources = input.sources ?? ["browser", "console", "network"];
    const result: Record<string, any> = {};

    // Browser observation
    if (sources.includes("browser") && session.browser) {
      try {
        const url =
          typeof session.browser.url === "function"
            ? session.browser.url()
            : "unknown";
        const title = await session.browser.title().catch(() => "unknown");
        result.page = { url, title };

        if (input.detail === "full" || input.detail === "summary") {
          result.domSummary = await getDomSummary(session.browser);
        }
      } catch {
        result.page = { url: "unavailable", title: "unavailable" };
      }
    }

    // Console observation
    if (sources.includes("console")) {
      const summary = getConsoleSummary(session.consoleBuffer);
      result.console = { summary };

      if (input.detail === "full") {
        const errors = session.consoleBuffer
          .filter((l) => l.level === "error")
          .slice(-5);
        result.console.errors = errors.map((e) => ({
          message: e.message.slice(0, 200),
          source: e.source,
        }));
      }
    }

    // Network observation
    if (sources.includes("network")) {
      const summary = getNetworkSummary(session.networkBuffer);
      result.network = { summary };

      if (input.detail === "full") {
        const failed = session.networkBuffer
          .filter((r) => r.status >= 400)
          .slice(-5);
        result.network.failedRequests = failed.map((r) => ({
          url: r.url.slice(0, 100),
          method: r.method,
          status: r.status,
        }));
      }
    }

    // Process observation
    if (sources.includes("process")) {
      result.process = { monitored: "via process_list tool" };
    }

    // Count incidents
    try {
      const recentErrors = session.consoleBuffer.filter(
        (l) => l.level === "error",
      ).length;
      const recentFailures = session.networkBuffer.filter(
        (r) => r.status >= 400,
      ).length;

      if (recentErrors > 0 || recentFailures > 0) {
        result.incidents = {
          count: recentErrors + recentFailures,
          hasErrors: recentErrors > 0,
          hasNetworkFailures: recentFailures > 0,
        };
      }
    } catch {
      /* best-effort */
    }

    // Always include one-line summary
    const summaryParts: string[] = [];
    if (result.page && typeof result.page === "object") {
      const p = result.page as Record<string, any>;
      summaryParts.push(`Page: ${String(p.title ?? "unknown").slice(0, 40)}`);
    }
    if (result.console && typeof result.console === "object") {
      const c = result.console as Record<string, any>;
      summaryParts.push(`Console: ${c.summary ?? "ok"}`);
    }
    if (result.network && typeof result.network === "object") {
      const n = result.network as Record<string, any>;
      summaryParts.push(`Network: ${n.summary ?? "ok"}`);
    }
    result._summary = summaryParts.join(" | ");

    return responseBuilder.success(result, sessionManager.buildMeta(session));
  },
});

// ─── Tool: aiDiagnose ──────────────────────────────────────────────
// NOTE: named aiDiagnose to avoid conflict with diagnose_fullstack in diagnostic/index.ts

export const aiDiagnose = createTool({
  name: "ai_diagnose",
  category: "ai",
  description:
    "`<use_case>Diagnosis</use_case> Full-stack diagnosis with correlation. Collects evidence from all sensors, correlates events, identifies root cause with confidence score, and suggests fixes. Returns a structured incident report.`",
  inputSchema: z.object({
    processId: z
      .string()
      .optional()
      .describe("Server process ID to correlate with browser state"),
    focus: z
      .enum(["all", "auth", "network", "runtime"])
      .optional()
      .default("all")
      .describe("Diagnostic focus area"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, incidentEngine, processManager }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Collect evidence from all layers
      const url =
        typeof page.url === "function" ? page.url() : "unknown";
      const title = await page.title().catch(() => "unknown");
      const consoleErrors = sessionManager.getConsoleBuffer(session.id, {
        level: "error",
        limit: 10,
      });
      const networkFailures = session.networkBuffer
        .filter((r) => r.status >= 400)
        .slice(-10);

      // Server-side evidence (if processId provided)
      let serverErrors: string[] = [];
      let processStatus: Record<string, any> | null = null;

      if (input.processId) {
        try {
          const serverLogs = processManager.getLogs(input.processId, {
            level: "error",
            lines: 20,
          });
          serverErrors = serverLogs.map((l) => l.line);
          const status = processManager.getStatus(input.processId);
          processStatus = {
            running: status.running,
            uptime: status.uptime,
            pid: status.pid,
          };
        } catch {
          /* not found */
        }
      }

      // ⚡ SINGLE SOURCE OF TRUTH: Use IncidentEngine instead of inline inference
      // The IncidentEngine auto-detects patterns from EventBus events.
      // We reuse its getActiveIncidents() for pre-detected issues.
      const activeIncidents = incidentEngine.getActiveIncidents();

      // Build evidence for the response
      const evidence = {
        page: { url, title },
        consoleErrors: consoleErrors.map((e) => e.message).slice(0, 5),
        networkFailures: networkFailures
          .map((r) => `${r.method} ${r.url} → ${r.status}`)
          .slice(0, 5),
      };

      // Use IncidentEngine incidents as the authoritative diagnosis
      if (activeIncidents.length > 0) {
        const topIncident = activeIncidents
          .sort((a, b) => b.confidence - a.confidence)[0]!;

        return responseBuilder.success(
          {
            diagnosis: {
              rootCause: topIncident.rootCause,
              confidence: topIncident.confidence,
              fix: topIncident.fix,
              category: topIncident.category,
            },
            evidence,
            activeIncidents: activeIncidents.map((inc) => ({
              id: inc.id,
              severity: inc.severity,
              category: inc.category,
              rootCause: inc.rootCause,
              confidence: inc.confidence,
              fix: inc.fix,
            })),
            summary: `[${topIncident.category.toUpperCase()}] ${topIncident.rootCause} (${Math.round(topIncident.confidence * 100)}% confidence)`,
          },
          sessionManager.buildMeta(session),
        );
      }

      // No incidents from engine — manual fallback using combined evidence
      const combinedText = [
        ...consoleErrors.map((e) => e.message),
        ...networkFailures.map((r) => `${r.status} ${r.url}`),
      ].join(" ").toLowerCase();

      let rootCause: string | null = null;
      let confidence = 0;
      let fix: string | null = null;
      let category = "unknown";

      if (combinedText.includes("jwt") || combinedText.includes("token")) {
        rootCause = "Authentication token issue";
        confidence = 0.7;
        fix = "Verify JWT_SECRET is set and auth tokens are valid";
        category = "auth";
      } else if (combinedText.includes("not found") || combinedText.includes("enoent")) {
        rootCause = "Missing file or resource";
        confidence = 0.7;
        fix = "Check if required files exist and paths are correct";
        category = "configuration";
      } else if (consoleErrors.length > 0) {
        rootCause = "Client-side JavaScript error";
        confidence = 0.6;
        fix = "Check the specific error message and trace in console";
        category = "runtime";
      }

      return responseBuilder.success(
        {
          diagnosis: { rootCause, confidence, fix, category },
          evidence,
          summary: rootCause
            ? `[${category.toUpperCase()}] ${rootCause} (${Math.round(confidence * 100)}% confidence)`
            : "No root cause identified — system appears healthy",
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

// ─── Tool: correlate ─────────────────────────────────────────────

export const correlate = createTool({
  name: "correlate",
  category: "ai",
  description:
    "`<use_case>Correlation</use_case> Correlate events across browser, server, and network layers. Returns a timeline with root cause analysis. Useful when aiDiagnose() finds partial information and you need deeper cross-layer analysis.`",
  inputSchema: z.object({
    timeWindowMs: z
      .number()
      .optional()
      .default(1000)
      .describe("Time window for event correlation in milliseconds"),
    processId: z.string().optional().describe("Server process ID to correlate"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, processManager, eventBus }) => {
    const session = sessionManager.getOrDefault(input.sessionId);

    try {
      // Get recent events from EventBus
      const recentEvents = eventBus.getHistory(undefined, 50);

      // Build timeline
      const timeline = recentEvents.map((e: any) => ({
        time: new Date(e.timestamp).toISOString(),
        layer: e.type.startsWith("browser")
          ? ("browser" as const)
          : e.type.startsWith("process")
            ? ("server" as const)
            : ("terminal" as const),
        event: e.type,
        detail: JSON.stringify(e.data).slice(0, 200),
      }));

      // Get server logs if processId provided
      let serverTimeline: Array<{ time: string; line: string }> = [];
      if (input.processId) {
        try {
          const logs = processManager.getLogs(input.processId, { lines: 20 });
          serverTimeline = logs.map((l: any) => ({
            time: l.timestamp,
            line: l.line.slice(0, 200),
          }));
        } catch {
          /* not found */
        }
      }

      // Correlate: check for overlapping error patterns
      const correlations: Array<{
        pattern: string;
        events: string[];
        confidence: number;
      }> = [];

      const browserErrors = recentEvents.filter(
        (e: any) =>
          e.type === "browser:console" && String(e.data.level) === "error",
      );
      const networkErrors = recentEvents.filter(
        (e: any) =>
          e.type === "browser:network" && Number(e.data.status) >= 400,
      );
      const processErrors = recentEvents.filter(
        (e: any) => e.type === "process:stderr",
      );

      if (browserErrors.length > 0 && processErrors.length > 0) {
        correlations.push({
          pattern: "Browser error + Server error",
          events: [
            `Browser: ${browserErrors[0]?.data.message ?? ""}`,
            `Server: ${processErrors[0]?.data.line ?? ""}`,
          ].slice(0, 2),
          confidence: 0.85,
        });
      }

      if (networkErrors.length > 0 && processErrors.length > 0) {
        correlations.push({
          pattern: "Network failure + Server error",
          events: [
            `Network: ${networkErrors[0]?.data.method} ${networkErrors[0]?.data.url} → ${networkErrors[0]?.data.status}`,
            `Server: ${processErrors[0]?.data.line ?? ""}`,
          ].slice(0, 2),
          confidence: 0.9,
        });
      }

      return responseBuilder.success(
        {
          timeline,
          serverLogs: serverTimeline,
          correlations,
          summary:
            correlations.length > 0
              ? `${correlations.length} correlation(s) found — see correlations array for details`
              : "No significant cross-layer correlations found",
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

// ─── Tool: summarize ─────────────────────────────────────────────

export const summarize = createTool({
  name: "summarize",
  category: "ai",
  description:
    "`<use_case>Summarization</use_case> Compress raw data (logs, events, DOM) into concise insight. Returns only the essential information — errors, warnings, and key state changes. Token-efficient replacement for dumping raw logs.`",
  inputSchema: z.object({
    source: z
      .enum(["console", "network", "dom", "session"])
      .describe("Source to summarize"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum items to include in detail"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const result: Record<string, any> = {};
    const limit = input.limit ?? 10;

    switch (input.source) {
      case "console": {
        const buffer = session.consoleBuffer;
        const byLevel: Record<string, number> = {};
        for (const l of buffer) {
          byLevel[l.level] = (byLevel[l.level] ?? 0) + 1;
        }

        result.counts = byLevel;
        result.summary = getConsoleSummary(buffer);

        const errors = buffer
          .filter((l) => l.level === "error")
          .slice(-limit);
        if (errors.length > 0) {
          result.errors = errors.map((e) => ({
            message: e.message.slice(0, 200),
            source: e.source,
            time: e.timestamp,
          }));
        }
        break;
      }

      case "network": {
        const buffer = session.networkBuffer;
        const total = buffer.length;
        const failed = buffer.filter((r) => r.status >= 400).length;
        const slow = buffer.filter((r) => r.duration > 1000).length;

        result.counts = { total, failed, slow };
        result.summary = getNetworkSummary(buffer);

        const failures = buffer
          .filter((r) => r.status >= 400)
          .slice(-limit);
        if (failures.length > 0) {
          result.failures = failures.map((r) => ({
            url: r.url.slice(0, 100),
            method: r.method,
            status: r.status,
            duration: r.duration,
          }));
        }
        break;
      }

      case "dom": {
        if (session.browser) {
          const summary = await getDomSummary(session.browser);
          result.summary = summary;
          result.source = "browser";
        } else {
          result.summary = "No browser session available";
        }
        break;
      }

      case "session": {
        result.sessionId = session.id;
        result.url =
          typeof session.browser?.url === "function"
            ? session.browser.url()
            : "unknown";            result.createdAt = session.createdAt.toISOString();
        result.lastUsedAt = session.lastUsedAt.toISOString();
        result.consoleSize = session.consoleBuffer.length;
        result.networkSize = session.networkBuffer.length;
        break;
      }
    }

    return responseBuilder.success(result, sessionManager.buildMeta(session));
  },
});

// ─── Tool: explain ────────────────────────────────────────────────
// Pilar 7 — Explain what happened in plain language.
// Uses Lazy Context Level 1-2 to generate token-efficient explanations.

export const explain = createTool({
  name: "explain",
  category: "ai",
  description:
    "`<use_case>Explanation</use_case> Explain the current state or a specific incident in plain language. Uses Lazy Context Level 1-2 to generate a token-efficient, human-readable explanation of what's happening in the stack.`",
  inputSchema: z.object({
    focus: z
      .enum(["current", "incident", "error", "state"])
      .optional()
      .default("current")
      .describe("What to explain: current state, a specific incident, an error, or general state"),
    incidentId: z.string().optional().describe("Incident ID (if focus is 'incident')"),
    detail: z
      .enum(["pulse", "summary", "detail"])
      .optional()
      .default("summary")
      .describe("Level of detail for the explanation"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, lazyContext }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const incidentId = input.incidentId;

    try {
      // Get pulse for context
      const pulse = await (async () => {
        try {
          const p: Record<string, any> = { level: 0, status: "healthy", consoleErrors: 0, consoleWarnings: 0, networkFailures: 0, networkSlow: 0, summary: "" };
          const buf = session.consoleBuffer ?? [];
          for (const l of buf) {
            if (l.level === "error") p.consoleErrors++;
            else if (l.level === "warn") p.consoleWarnings++;
          }
          if (p.consoleErrors > 0) p.status = "error";
          else if (p.consoleWarnings > 0) p.status = "warning";
          const parts: string[] = [`status: ${p.status}`];
          if (p.consoleErrors > 0) parts.push(`${p.consoleErrors} error(s)`);
          if (p.consoleWarnings > 0) parts.push(`${p.consoleWarnings} warning(s)`);
          p.summary = parts.join(" | ");
          return p;
        } catch { return { level: 0, status: "unknown", summary: "pulse unavailable" } as any; }
      })();

      const result: Record<string, any> = {
        pulse,
        timestamp: new Date().toISOString(),
      };

      switch (input.focus) {
        case "current": {
          // Explain current state using Lazy Context Level 1
          const summary = lazyContext.getSummary(session, pulse as any);
          result.level = 1;
          result.summary = summary;

          if (input.detail === "detail") {
            const detail = lazyContext.getDetail(session, incidentId);
            result.level = 2;
            result.detail = detail;
          }

          result.explanation = buildExplanation(summary);
          break;
        }

        case "incident": {
          if (!incidentId) {
            return responseBuilder.error(new Error("incidentId required when focus='incident'"), {
              code: "MISSING_INCIDENT_ID",
            });
          }
          const detail = lazyContext.getDetail(session, incidentId);
          result.level = 2;
          result.detail = detail;
          result.explanation = `Incident ${incidentId}: ${(detail.evidence.rootCause as string) ?? "Unknown"}. ${detail.timeline.length} event(s) in timeline.`;
          break;
        }

        case "error": {
          const errors = session.consoleBuffer.filter((l) => l.level === "error");
          result.errors = errors.slice(-5).map((e) => ({
            message: e.message.slice(0, 300),
            source: e.source,
          }));
          result.explanation = errors.length === 0
            ? "No errors found in the current session."
            : `${errors.length} error(s) found. ${errors[0]?.message.slice(0, 100)}`;
          break;
        }

        case "state": {
          const url = typeof session.browser?.url === "function"
            ? session.browser.url()
            : "unknown";
          const title = typeof session.browser?.title === "function"
            ? await session.browser.title().catch(() => "unknown")
            : "unknown";
          result.state = { url, title, logs: session.consoleBuffer.length, requests: session.networkBuffer.length };
          result.explanation = `Session active on ${url.slice(0, 60)} (${title.slice(0, 40)}). ${session.consoleBuffer.length} log entries, ${session.networkBuffer.length} network requests.`;
          break;
        }
      }

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

/** Build a plain-language explanation from a L1Summary */
function buildExplanation(summary: any): string {
  const parts: string[] = [];
  if (summary.incidents && summary.incidents.length > 0) {
    const critical = summary.incidents.filter((i: any) => i.severity === "critical");
    const errors = summary.incidents.filter((i: any) => i.severity === "error");

    if (critical.length > 0) {
      parts.push(`${critical.length} critical issue(s):`);
      for (const c of critical.slice(0, 3)) {
        parts.push(`  - ${c.rootCause} (fix: ${c.fix ?? "unknown"})`);
      }
    }
    if (errors.length > 0) {
      parts.push(`${errors.length} error(s):`);
      for (const e of errors.slice(0, 3)) {
        parts.push(`  - ${e.rootCause}`);
      }
    }
  } else {
    parts.push("No active incidents.");
  }

  parts.push(`Pulse: ${summary.pulse?.summary ?? "healthy"}`);
  return parts.join("\n");
}

// ─── Tool: investigate ────────────────────────────────────────────
// Pilar 7 — Deep dive into a specific incident.
// Uses Lazy Context Level 2-3 to expand evidence chains.

export const investigate = createTool({
  name: "investigate",
  category: "ai",
  description:
    "`<use_case>Investigation</use_case> Deep dive into a specific incident or error. Expands the evidence chain using Lazy Context Level 2-3, showing correlated events, timeline, and raw data. Use this when explain() reveals something suspicious and you need more detail.`",
  inputSchema: z.object({
    incidentId: z.string().optional().describe("Incident ID to investigate"),
    followChain: z
      .boolean()
      .optional()
      .default(true)
      .describe("Follow the chain of related events across layers"),
    includeRaw: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include Level 3 raw data (logs, network, DOM)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, lazyContext }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const incidentId = input.incidentId;

    try {
      const result: Record<string, any> = {};

      // Level 2: Get detailed timeline and correlation
      result.level2 = lazyContext.getDetail(session, incidentId);

      // Follow chain: trace events across layers
      if (input.followChain !== false) {
        const chain: Array<{ layer: string; time: string; event: string }> = [];
        for (const tl of result.level2.timeline ?? []) {
          chain.push({
            layer: tl.layer,
            time: tl.at,
            event: tl.event.slice(0, 150),
          });
        }
        result.chain = chain;
      }

      // Level 3: Include raw data if requested
      if (input.includeRaw) {
        result.level3 = lazyContext.getRaw(session);
      }

      // Build investigation summary
      const totalEvents = result.level2?.timeline?.length ?? 0;
      const correlations = result.level2?.correlation?.length ?? 0;
      result.summary = `Investigation complete. ${totalEvents} event(s) in timeline, ${correlations} correlation(s) found.${input.includeRaw ? " Raw data included." : " Use includeRaw=true for Level 3 data."}`;

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

// ─── Tool: predict ────────────────────────────────────────────────
// Pilar 7 — Predict failure based on patterns.
// Analyzes historical events and incident patterns to predict likely failures.

export const predict = createTool({
  name: "predict",
  category: "ai",
  description:
    "`<use_case>Prediction</use_case> Predict likely failures based on current patterns and historical events. Analyzes EventBus history, console trends, and network error patterns to identify potential issues before they become critical.`",
  inputSchema: z.object({
    horizon: z
      .enum(["short", "medium", "long"])
      .optional()
      .default("short")
      .describe("Prediction horizon: short (next few minutes), medium (next hour), long (next session)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, eventBus }) => {
    const session = sessionManager.getOrDefault(input.sessionId);

    try {
      // Analyze recent events from EventBus
      const recentEvents = eventBus.getHistory(undefined, 100);

      // Count error trends
      const browserErrors = recentEvents.filter((e: any) => e.type === "browser:console" && String(e.data.level) === "error");
      const networkErrors = recentEvents.filter((e: any) => e.type === "browser:network" && Number(e.data.status) >= 400);
      const processErrors = recentEvents.filter((e: any) => e.type === "process:stderr");
      const toolExecutions = recentEvents.filter((e: any) => e.type === "tool:executed");

      // Build predictions based on patterns
      const predictions: Array<{
        type: string;
        confidence: number;
        signal: string;
        prediction: string;
        recommendedAction: string;
      }> = [];

      // Pattern 1: Increasing error rate
      if (browserErrors.length > 5) {
        predictions.push({
          type: "degradation",
          confidence: 0.75,
          signal: `${browserErrors.length} browser errors in recent history`,
          prediction: "Application stability may degrade — check for recurring errors",
          recommendedAction: "Run diagnose() to identify root cause",
        });
      }

      // Pattern 2: Network failures
      if (networkErrors.length > 3) {
        predictions.push({
          type: "network",
          confidence: 0.8,
          signal: `${networkErrors.length} failed network requests`,
          prediction: "API may become unreachable if network errors persist",
          recommendedAction: "Check server status and network connectivity",
        });
      }

      // Pattern 3: Server process issues
      if (processErrors.length > 0) {
        predictions.push({
          type: "server",
          confidence: 0.7,
          signal: `${processErrors.length} server error(s)`,
          prediction: "Server may crash if errors continue — watch for memory/exhaustion patterns",
          recommendedAction: "Monitor server logs and resource usage",
        });
      }

      // Pattern 4: No errors detected (default healthy)
      if (predictions.length === 0) {
        predictions.push({
          type: "healthy",
          confidence: 0.9,
          signal: "No significant errors detected",
          prediction: "System appears stable with no predicted failures",
          recommendedAction: "Continue normal monitoring",
        });
      }

      // Pattern 5: High tool failure rate
      const failedTools = toolExecutions.filter((e: any) => e.data.success === false);
      if (failedTools.length > 2) {
        predictions.push({
          type: "tool",
          confidence: 0.65,
          signal: `${failedTools.length} tool execution(s) failed`,
          prediction: "Tool failures suggest underlying infrastructure issues",
          recommendedAction: "Check resource availability and dependencies",
        });
      }

      return responseBuilder.success(
        {
          predictions,
          summary: predictions
            .map((p: any) => `[${p.type.toUpperCase()}] ${p.prediction} (${Math.round(p.confidence * 100)}%)`)
            .join(" | "),
          meta: {
            analyzed: recentEvents.length,
            browserErrors: browserErrors.length,
            networkErrors: networkErrors.length,
            processErrors: processErrors.length,
          },
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

