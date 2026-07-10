/**
 * Incident Engine — The heart of Fennec's reasoning system.
 *
 * Replaces the simple RootCauseInferrer with a full incident lifecycle:
 * - Listens to EventBus for trigger events
 * - Correlates related events using the correlation window
 * - Creates formal Incidents with confidence scoring
 * - Manages incident lifecycle (active → resolved/dismissed)
 * - Generates alerts for the Level 0 pulse system
 */

import { randomUUID } from "node:crypto";
import { EventBus, type BusEvent, type EventType } from "../correlation/EventBus.js";
import { TimelineBuilder } from "../correlation/Timeline.js";
import {
  type Incident,
  type IncidentCreateInput,
  type IncidentSeverity,
  type IncidentStatus,
  type Alert,
} from "./types.js";

// ─── Inference Rules ─────────────────────────────────────────────

interface InferenceRule {
  pattern: string; // e.g. "browser:network:500 + process:stderr:Error"
  category: Incident["category"];
  rootCause: string;
  confidence: number;
  fix: string;
  severity: IncidentSeverity;
}

const INFERENCE_RULES: InferenceRule[] = [
  {
    pattern: "browser:network:500 + process:stderr:Error",
    category: "network",
    rootCause: "Server error caused network failure",
    confidence: 0.9,
    fix: "Check server logs for unhandled exceptions or misconfigurations",
    severity: "error",
  },
  {
    pattern: "browser:network:401 + process:stderr:JWT",
    category: "authentication",
    rootCause: "Authentication token issue",
    confidence: 0.92,
    fix: "Verify JWT_SECRET is set and the auth token is valid",
    severity: "critical",
  },
  {
    pattern: "browser:console:TypeError + browser:network:failed",
    category: "runtime",
    rootCause: "Network failure caused JavaScript error",
    confidence: 0.85,
    fix: "Ensure the API endpoint is reachable and returning valid data",
    severity: "error",
  },
  {
    pattern: "process:stderr:ENOENT",
    category: "configuration",
    rootCause: "Missing file or environment variable",
    confidence: 0.88,
    fix: "Check if required files exist and environment variables are set",
    severity: "error",
  },
  {
    pattern: "browser:network:404",
    category: "network",
    rootCause: "API route or resource not found",
    confidence: 0.9,
    fix: "Verify the URL path matches the server's defined routes",
    severity: "error",
  },
  {
    pattern: "browser:console:error + process:stderr:Error",
    category: "runtime",
    rootCause: "Server-side error reflected in browser",
    confidence: 0.87,
    fix: "Check server error logs for the root cause of the issue",
    severity: "error",
  },
  {
    pattern: "browser:network:0",
    category: "network",
    rootCause: "Network request blocked (CORS, mixed content, or connection refused)",
    confidence: 0.85,
    fix: "Check CORS headers, ensure the endpoint is reachable, and verify HTTPS consistency",
    severity: "error",
  },
  {
    pattern: "process:stderr:ECONNREFUSED",
    category: "network",
    rootCause: "Database or service connection refused",
    confidence: 0.9,
    fix: "Ensure the target service is running and the connection string is correct",
    severity: "critical",
  },
  {
    pattern: "process:stderr:heap + process:stderr:out of memory",
    category: "performance",
    rootCause: "Memory leak or excessive memory usage",
    confidence: 0.85,
    fix: "Check for memory leaks, increase available memory, or optimize resource usage",
    severity: "warning",
  },
  {
    pattern: "browser:console:error + process:stderr:timeout",
    category: "performance",
    rootCause: "Operation timed out — slow database query or API call",
    confidence: 0.8,
    fix: "Check query performance, add indexes, or increase timeout values",
    severity: "warning",
  },
];

// ─── Incident Engine ─────────────────────────────────────────────

export class IncidentEngine {
  private incidents: Map<string, Incident> = new Map();
  private alerts: Alert[] = [];
  private maxAlerts = 100;
  private eventBus: EventBus;
  private timelineBuilder: TimelineBuilder;
  private correlationWindowMs: number;
  private minConfidence: number;

  constructor(
    eventBus: EventBus,
    options: {
      windowMs?: number;
      minConfidence?: number;
      maxAlerts?: number;
    } = {},
  ) {
    this.eventBus = eventBus;
    this.timelineBuilder = new TimelineBuilder();
    this.correlationWindowMs = options.windowMs ?? 500;
    this.minConfidence = options.minConfidence ?? 0.7;
    this.maxAlerts = options.maxAlerts ?? 100;

    // Auto-subscribe to EventBus for real-time incident detection
    this.subscribeToEvents();
  }

  /**
   * Subscribes to all relevant event types on the EventBus.
   * When a new event arrives, it checks against inference rules
   * and auto-creates incidents if patterns match.
   */
  private subscribeToEvents(): void {
    const triggerEvents: EventType[] = [
      "browser:console",
      "browser:network",
      "browser:error",
      "process:stderr",
      "process:exit",
    ];

    for (const eventType of triggerEvents) {
      this.eventBus.subscribe(eventType, (event) => {
        const incident = this.attemptInference(event);
        if (incident) {
          this.addIncident(incident);
        }
      });
    }
  }

  /**
   * Attempt to infer an incident from a trigger event.
   * Uses inference rules and the event bus correlation window.
   */
  private attemptInference(trigger: BusEvent): Incident | null {
    const relatedEvents = this.eventBus.getEventsInWindow(
      trigger.timestamp - this.correlationWindowMs,
      trigger.timestamp,
    );

    for (const rule of INFERENCE_RULES) {
      if (this.matchesPattern(rule.pattern, trigger, relatedEvents)) {
        return this.createIncident({
          title: rule.rootCause,
          severity: rule.severity,
          confidence: rule.confidence,
          layer: this.eventTypeToLayer(trigger.type),
          category: rule.category,
          rootCause: rule.rootCause,
          fix: rule.fix,
          evidence: { trigger, related: relatedEvents },
          timeline: this.buildTimeline(trigger, relatedEvents),
          tags: [rule.category, trigger.type],
        });
      }
    }

    return null;
  }

  /**
   * Match a pattern string against events.
   * E.g. "browser:network:500 + process:stderr:Error"
   */
  private matchesPattern(pattern: string, trigger: BusEvent, related: BusEvent[]): boolean {
    const parts = pattern.split(" + ");
    const allEvents = [trigger, ...related];

    for (const part of parts) {
      const layer = part.split(":")[0] ?? "";
      const keywordMatch = part.match(/:(\w+)$/);
      const keyword = keywordMatch?.[1] ?? null;

      const found = allEvents.some((e) => {
        const matchesLayer = e.type.startsWith(layer);
        const eventStr = JSON.stringify(e.data).toLowerCase();
        const matchesKeyword = keyword ? eventStr.includes(keyword.toLowerCase()) : true;
        return matchesLayer && matchesKeyword;
      });

      if (!found) return false;
    }

    return true;
  }

  /**
   * Create a formal incident from input data.
   */
  private createIncident(input: IncidentCreateInput): Incident {
    const now = Date.now();
    return {
      id: `inc_${randomUUID().slice(0, 8)}`,
      title: input.title,
      severity: input.severity,
      status: "active",
      confidence: input.confidence,
      layer: input.layer,
      category: input.category,
      rootCause: input.rootCause,
      fix: input.fix ?? null,
      evidence: input.evidence,
      timeline: input.timeline,
      createdAt: now,
      updatedAt: now,
      tags: input.tags ?? [],
    };
  }

  /**
   * Build a timeline from a trigger and related events.
   */
  private buildTimeline(trigger: BusEvent, related: BusEvent[]): Incident["timeline"] {
    const all = [trigger, ...related].sort((a, b) => a.timestamp - b.timestamp);
    const baseTime = all[0]?.timestamp ?? trigger.timestamp;

    return all.map((e) => ({
      at: e.timestamp,
      relativeMs: e.timestamp - baseTime,
      layer: this.eventTypeToLayer(e.type),
      event: this.eventToDescription(e),
    }));
  }

  /**
   * Add an incident to the store and generate an alert.
   */
  private addIncident(incident: Incident): void {
    // Avoid duplicates: check if similar incident already exists
    const existing = this.findSimilar(incident);
    if (existing) {
      existing.updatedAt = Date.now();
      existing.confidence = Math.max(existing.confidence, incident.confidence);
      return;
    }

    this.incidents.set(incident.id, incident);

    // Generate alert
    this.alerts.push({
      id: `alert_${randomUUID().slice(0, 8)}`,
      incidentId: incident.id,
      severity: incident.severity,
      summary: `[${incident.severity.toUpperCase()}] ${incident.rootCause}`,
      createdAt: Date.now(),
      acknowledged: false,
    });

    // Trim alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts);
    }
  }

  /**
   * Find a similar active incident to avoid duplicates.
   */
  private findSimilar(incident: Incident): Incident | undefined {
    for (const [, existing] of this.incidents) {
      if (existing.status !== "active") continue;
      if (existing.category !== incident.category) continue;
      if (existing.rootCause === incident.rootCause) {
        // Same root cause — same incident
        return existing;
      }
    }
    return undefined;
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Get all active incidents.
   */
  getActiveIncidents(): Incident[] {
    return Array.from(this.incidents.values()).filter((i) => i.status === "active");
  }

  /**
   * Get an incident by ID.
   */
  getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  /**
   * Get all incidents (including resolved).
   */
  getAllIncidents(): Incident[] {
    return Array.from(this.incidents.values());
  }

  /**
   * Mark an incident as resolved.
   */
  resolveIncident(id: string): boolean {
    const incident = this.incidents.get(id);
    if (!incident) return false;
    if (incident.status !== "active") return false;

    incident.status = "resolved";
    incident.resolvedAt = Date.now();
    incident.updatedAt = Date.now();
    return true;
  }

  /**
   * Dismiss an incident (ignore).
   */
  dismissIncident(id: string): boolean {
    const incident = this.incidents.get(id);
    if (!incident) return false;

    incident.status = "dismissed";
    incident.updatedAt = Date.now();
    return true;
  }

  /**
   * Get unacknowledged alerts for the Level 0 pulse.
   */
  getPendingAlerts(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * Acknowledge an alert.
   */
  acknowledgeAlert(id: string): boolean {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  /**
   * Acknowledge all alerts.
   */
  acknowledgeAllAlerts(): number {
    let count = 0;
    for (const alert of this.alerts) {
      if (!alert.acknowledged) {
        alert.acknowledged = true;
        count++;
      }
    }
    return count;
  }

  /**
   * Get a summary string for the Level 0 pulse.
   * E.g. "2 critical, 3 error(s), 1 warning"
   */
  getPulseSummary(): string {
    const active = this.getActiveIncidents();
    if (active.length === 0) return "healthy";

    const critical = active.filter((i) => i.severity === "critical").length;
    const errors = active.filter((i) => i.severity === "error").length;
    const warnings = active.filter((i) => i.severity === "warning").length;

    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical`);
    if (errors > 0) parts.push(`${errors} error(s)`);
    if (warnings > 0) parts.push(`${warnings} warning(s)`);

    return parts.join(", ") || "healthy";
  }

  /**
   * Get incident counts by severity.
   */
  getStats(): { active: number; resolved: number; bySeverity: Record<string, number> } {
    const all = Array.from(this.incidents.values());
    const active = all.filter((i) => i.status === "active").length;
    const resolved = all.filter((i) => i.status === "resolved").length;
    const bySeverity: Record<string, number> = {};

    for (const i of all) {
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
    }

    return { active, resolved, bySeverity };
  }

  /**
   * Clear all incidents and alerts.
   */
  clear(): void {
    this.incidents.clear();
    this.alerts = [];
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private eventTypeToLayer(type: string): Incident["layer"] {
    if (type.startsWith("browser")) return "browser";
    if (type.startsWith("process")) return "server";
    if (type.startsWith("terminal")) return "terminal";
    return "network";
  }

  private eventToDescription(event: BusEvent): string {
    const { type, data } = event;
    switch (type) {
      case "browser:console":
        return `[${data.level}] ${data.message}`;
      case "browser:network":
        return `${data.method} ${data.url} → ${data.status}`;
      case "browser:error":
        return `Error: ${data.message}`;
      case "process:stdout":
        return `[stdout] ${data.line}`;
      case "process:stderr":
        return `[stderr] ${data.line}`;
      case "process:exit":
        return `Process exited (code: ${data.code})`;
      case "terminal:log":
        return `[${data.source}] ${data.line}`;
      default:
        return `Event: ${type}`;
    }
  }
}
