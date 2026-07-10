/**
 * Lazy Context — Levels 1, 2, and 3
 *
 * Implements the on-demand context system described in VISION.md:
 *
 * Level 0 (Pulse):  Always sent — "healthy | 3 warnings | 1 critical"      ~5 tokens
 * Level 1 (Summary): On request — "Critical: DB timeout"                  ~50 tokens
 * Level 2 (Detail):  On expand — list of correlated events                 ~200 tokens
 * Level 3 (Raw):     On "show raw" — original log lines, DOM, etc.         ~2000+ tokens
 *
 * Levels 2 and 3 are expensive — they should only be fetched when explicitly requested.
 */

import type { FennecSession } from "../session/types.js";
import type { IncidentEngine } from "../incident/IncidentEngine.js";
import type { EventBus } from "../correlation/EventBus.js";
import type { Pulse } from "./PulseContext.js";
import { getLogger } from "../utils/logger.js";
import { truncateByTokens, estimateTokens } from "../utils/tokenCounter.js";

// ─── Level 1: Summary ───────────────────────────────────────────

export interface L1Summary {
  level: 1;
  incidents: Array<{
    id: string;
    severity: string;
    category: string;
    rootCause: string;
    confidence: number;
    fix: string | null;
  }>;
  pulse: Pulse;
  summary: string;
}

// ─── Level 2: Detail ────────────────────────────────────────────

export interface L2Detail {
  level: 2;
  timeline: Array<{
    at: string;
    relativeMs: number;
    layer: string;
    event: string;
  }>;
  evidence: Record<string, unknown>;
  correlation: Array<{
    pattern: string;
    confidence: number;
    events: string[];
  }>;
}

// ─── Level 3: Raw ───────────────────────────────────────────────

export interface L3Raw {
  level: 3;
  consoleLogs: Array<{ level: string; message: string; source: string; timestamp: string }>;
  networkRequests: Array<{ method: string; url: string; status: number; duration: number }>;
  domSummary: string;
}

// ─── Lazy Context Service ───────────────────────────────────────

export class LazyContext {
  private incidentEngine: IncidentEngine;
  private eventBus: EventBus;

  constructor(incidentEngine: IncidentEngine, eventBus: EventBus) {
    this.incidentEngine = incidentEngine;
    this.eventBus = eventBus;
  }

  /**
   * Level 1: Return a compressed summary of all active incidents.
   * The AI can use this to decide whether to expand to Level 2.
   * Budget: ~100 tokens max.
   */
  getSummary(session: FennecSession, pulse: Pulse, maxTokens = 100): L1Summary {
    const incidents = this.incidentEngine.getActiveIncidents();
    const critical = incidents.filter((i) => i.severity === "critical");

    const summaryParts: string[] = [];
    summaryParts.push(`Pulse: ${pulse.summary}`);

    if (critical.length > 0) {
      for (const inc of critical.slice(0, 3)) {
        summaryParts.push(`[CRITICAL] ${inc.rootCause} (${Math.round(inc.confidence * 100)}%)`);
      }
    }

    const nonCritical = incidents.filter((i) => i.severity !== "critical").slice(0, 5);
    for (const inc of nonCritical) {
      summaryParts.push(`[${inc.severity.toUpperCase()}] ${inc.rootCause}`);
    }

    const result: L1Summary = {
      level: 1,
      incidents: incidents.slice(0, 5).map((i) => ({
        id: i.id,
        severity: i.severity,
        category: i.category,
        rootCause: i.rootCause.slice(0, 100),
        confidence: i.confidence,
        fix: i.fix?.slice(0, 100) ?? null,
      })),
      pulse,
      summary: truncateByTokens(summaryParts.join(" | "), maxTokens),
    };

    if (incidents.length > 5) {
      result.summary += ` (+${incidents.length - 5} more incidents)`;
    }

    return result;
  }

  /**
   * Level 2: Return detailed timeline and evidence for an incident.
   * This is the "expand" level — more tokens but still compressed.
   * Budget: ~500 tokens max.
   */
  getDetail(session: FennecSession, incidentId?: string, maxTokens = 500): L2Detail {
    const logger = getLogger();

    // Get timeline from recent EventBus events
    const recentEvents = this.eventBus.getHistory(undefined, 30);

    const timeline = recentEvents.map((e) => ({
      at: new Date(e.timestamp).toISOString().slice(11, 23),
      relativeMs: e.timestamp - (recentEvents[0]?.timestamp ?? e.timestamp),
      layer: e.type.startsWith("browser")
        ? "browser"
        : e.type.startsWith("process")
          ? "server"
          : e.type.startsWith("terminal")
            ? "terminal"
            : "tool",
      event: `${e.type}: ${JSON.stringify(e.data).slice(0, 120)}`,
    }));

    // Find correlations
    const browserErrors = recentEvents.filter(
      (e) => e.type === "browser:console" && String(e.data.level) === "error",
    );
    const networkErrors = recentEvents.filter(
      (e) => e.type === "browser:network" && Number(e.data.status) >= 400,
    );
    const processErrors = recentEvents.filter((e) => e.type === "process:stderr");

    const correlation: L2Detail["correlation"] = [];

    if (browserErrors.length > 0 && processErrors.length > 0) {
      correlation.push({
        pattern: "Browser error + Server error",
        confidence: 0.85,
        events: [
          `Browser: ${String(browserErrors[0]?.data.message ?? "").slice(0, 100)}`,
          `Server: ${String(processErrors[0]?.data.line ?? "").slice(0, 100)}`,
        ],
      });
    }
    if (networkErrors.length > 0 && processErrors.length > 0) {
      correlation.push({
        pattern: "Network failure + Server error",
        confidence: 0.9,
        events: [
          `Network: ${networkErrors[0]?.data.method} ${networkErrors[0]?.data.url} → ${networkErrors[0]?.data.status}`,
          `Server: ${String(processErrors[0]?.data.line ?? "").slice(0, 100)}`,
        ],
      });
    }

    // Get incident-specific evidence
    let evidence: Record<string, unknown> = {};
    if (incidentId) {
      const incident = this.incidentEngine.getIncident(incidentId);
      if (incident) {
        evidence = {
          incidentId: incident.id,
          category: incident.category,
          rootCause: incident.rootCause,
          fix: incident.fix,
          tags: incident.tags,
        };
      }
    }

    const result: L2Detail = {
      level: 2,
      timeline: timeline.slice(0, 15),
      evidence,
      correlation: correlation.slice(0, 3),
    };

    // Truncate if over budget
    const jsonStr = JSON.stringify(result);
    if (estimateTokens(jsonStr) > maxTokens) {
      // Aggressively trim timeline
      result.timeline = timeline.slice(0, 8);
      result.correlation = correlation.slice(0, 2);
    }

    return result;
  }

  /**
   * Level 3: Return raw data from the session.
   * Highest token cost — only on explicit "show raw" request.
   * Budget: ~2000 tokens max.
   */
  getRaw(session: FennecSession, maxTokens = 2000): L3Raw {
    const consoleLogs = session.consoleBuffer.slice(-20).map((l) => ({
      level: l.level,
      message: l.message.slice(0, 300),
      source: l.source,
      timestamp: l.timestamp,
    }));

    const networkRequests = session.networkBuffer.slice(-10).map((r) => ({
      method: r.method,
      url: r.url.slice(0, 150),
      status: r.status,
      duration: r.duration,
    }));

    let domSummary = "DOM unavailable (no browser session)";
    if (session.browser) {
      try {
        domSummary = `URL: ${session.browser.url().slice(0, 200)}`;
      } catch {
        domSummary = "DOM unavailable (cross-origin)";
      }
    }

    return {
      level: 3,
      consoleLogs: consoleLogs.slice(0, 10).map((l) => ({
        ...l,
        message: truncateByTokens(l.message, 50),
      })),
      networkRequests: networkRequests.slice(0, 5).map((r) => ({
        ...r,
        url: truncateByTokens(r.url, 30),
      })),
      domSummary: truncateByTokens(domSummary, maxTokens * 0.3),
    };
  }
}
