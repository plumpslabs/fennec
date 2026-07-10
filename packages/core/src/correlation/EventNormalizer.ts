/**
 * Event Normalizer — Standardizes event format across all sensors.
 *
 * Phase 2b of the VISION.md roadmap.
 * Converts raw sensor events (browser, console, network, process, mobile)
 * into a standardized NormalizedEvent format suitable for the EventBus
 * and IncidentEngine.
 */

import type { ConsoleEvent, NetworkEvent } from "../session/types.js";

// ─── Normalized Event Format ─────────────────────────────────────

export type EventSource =
  | "browser:console"
  | "browser:network"
  | "browser:navigation"
  | "browser:screenshot"
  | "browser:dom"
  | "process:stdout"
  | "process:stderr"
  | "process:status"
  | "process:crash"
  | "terminal:output"
  | "terminal:error"
  | "mobile:logcat"
  | "mobile:device"
  | "system:health"
  | "system:error";

export type EventSeverity = "debug" | "info" | "warn" | "error" | "critical";

export interface NormalizedEvent {
  /** Unique event identifier */
  id: string;
  /** Standardized event type (sensor:subtype) */
  source: EventSource;
  /** ISO timestamp */
  timestamp: string;
  /** Severity level */
  severity: EventSeverity;
  /** Human-readable summary (max 200 chars) */
  summary: string;
  /** Structured payload — varies by source */
  payload: Record<string, unknown>;
  /** Optional session ID this event belongs to */
  sessionId?: string;
  /** Optional process ID this event belongs to */
  processId?: string;
  /** Raw event tags for correlation */
  tags: string[];
}

// ─── Normalizer ──────────────────────────────────────────────────

export class EventNormalizer {
  private counter = 0;

  /** Generate a unique event ID */
  private nextId(): string {
    this.counter++;
    return `evt_${Date.now()}_${this.counter}`;
  }

  /** Normalize a ConsoleEvent from a browser session */
  normalizeConsoleEvent(
    event: ConsoleEvent,
    sessionId?: string,
  ): NormalizedEvent {
    return {
      id: this.nextId(),
      source: "browser:console",
      timestamp: event.timestamp,
      severity:
        event.level === "error"
          ? "error"
          : event.level === "warn"
            ? "warn"
            : event.level === "info"
              ? "info"
              : "debug",
      summary: `[${event.level}] ${event.message.slice(0, 150)}`,
      payload: {
        level: event.level,
        message: event.message,
        source: event.source,
        stackTrace: event.stackTrace,
      },
      sessionId,
      tags: ["console", event.level, `source:${event.source.slice(0, 40)}`],
    };
  }

  /** Normalize a NetworkEvent from a browser session */
  normalizeNetworkEvent(
    event: NetworkEvent,
    sessionId?: string,
  ): NormalizedEvent {
    const severity: EventSeverity =
      event.status >= 500
        ? "critical"
        : event.status >= 400
          ? "error"
          : event.status >= 300
            ? "warn"
            : "info";

    return {
      id: this.nextId(),
      source: "browser:network",
      timestamp: event.timestamp,
      severity,
      summary: `${event.method} ${event.url.slice(0, 100)} → ${event.status} (${event.duration}ms)`,
      payload: {
        requestId: event.requestId,
        method: event.method,
        url: event.url,
        status: event.status,
        statusText: event.statusText,
        duration: event.duration,
        type: event.type,
      },
      sessionId,
      tags: [
        "network",
        `http:${event.status}`,
        `method:${event.method}`,
        `type:${event.type}`,
      ],
    };
  }

  /** Normalize a navigation event */
  normalizeNavigation(
    url: string,
    ok: boolean,
    loadTimeMs?: number,
    sessionId?: string,
  ): NormalizedEvent {
    return {
      id: this.nextId(),
      source: "browser:navigation",
      timestamp: new Date().toISOString(),
      severity: ok ? "info" : "error",
      summary: ok
        ? `Navigated to ${url.slice(0, 120)}`
        : `Navigation failed: ${url.slice(0, 120)}`,
      payload: { url, ok, loadTimeMs: loadTimeMs ?? 0 },
      sessionId,
      tags: ["navigation", ok ? "success" : "failure"],
    };
  }

  /** Normalize a process log line */
  normalizeProcessLine(
    line: string,
    level: string,
    processId: string,
    source: "stdout" | "stderr",
  ): NormalizedEvent {
    const severity: EventSeverity =
      level === "error" || level === "critical"
        ? "error"
        : level === "warn"
          ? "warn"
          : "info";

    return {
      id: this.nextId(),
      source: source === "stderr" ? "process:stderr" : "process:stdout",
      timestamp: new Date().toISOString(),
      severity,
      summary: line.slice(0, 150),
      payload: { processId, line, level },
      processId,
      tags: ["process", `level:${level}`, `pid:${processId}`],
    };
  }

  /** Normalize a terminal log entry */
  normalizeTerminalLog(
    line: string,
    watcherId: string,
    isError: boolean,
  ): NormalizedEvent {
    return {
      id: this.nextId(),
      source: isError ? "terminal:error" : "terminal:output",
      timestamp: new Date().toISOString(),
      severity: isError ? "error" : "info",
      summary: line.slice(0, 150),
      payload: { watcherId, line },
      tags: ["terminal", `watcher:${watcherId}`, isError ? "error" : "output"],
    };
  }

  /** Normalize a mobile logcat entry */
  normalizeLogcatEntry(
    entry: { time: string; tag: string; message: string; level?: string },
    deviceId: string,
  ): NormalizedEvent {
    const level = entry.level ?? "info";
    const severity: EventSeverity =
      level === "error" || level === "fatal"
        ? "error"
        : level === "warn"
          ? "warn"
          : "info";

    return {
      id: this.nextId(),
      source: "mobile:logcat",
      timestamp: entry.time,
      severity,
      summary: `[${entry.tag}] ${entry.message.slice(0, 150)}`,
      payload: { deviceId, tag: entry.tag, message: entry.message, level },
      tags: ["mobile", "logcat", `device:${deviceId}`, `tag:${entry.tag}`],
    };
  }

  /** Normalize a system health check result */
  normalizeSystemHealth(
    healthy: boolean,
    details: Record<string, unknown>,
  ): NormalizedEvent {
    return {
      id: this.nextId(),
      source: "system:health",
      timestamp: new Date().toISOString(),
      severity: healthy ? "info" : "warn",
      summary: healthy
        ? "System health check passed"
        : "System health check detected issues",
      payload: { healthy, details },
      tags: ["system", "health", healthy ? "pass" : "fail"],
    };
  }

  /** Bulk-normalize an array of mixed events */
  normalizeMany(
    events: Array<{
      type: "console" | "network" | "process" | "terminal" | "navigation";
      data: any;
      sessionId?: string;
      processId?: string;
    }>,
  ): NormalizedEvent[] {
    return events.map((e) => {
      switch (e.type) {
        case "console":
          return this.normalizeConsoleEvent(e.data, e.sessionId);
        case "network":
          return this.normalizeNetworkEvent(e.data, e.sessionId);
        case "process":
          return this.normalizeProcessLine(
            e.data.line,
            e.data.level ?? "info",
            e.processId ?? "unknown",
            e.data.source ?? "stdout",
          );
        case "terminal":
          return this.normalizeTerminalLog(
            e.data.line,
            e.data.watcherId,
            e.data.isError ?? false,
          );
        case "navigation":
          return this.normalizeNavigation(
            e.data.url,
            e.data.ok ?? true,
            e.data.loadTimeMs,
            e.sessionId,
          );
        default:
          throw new Error(`Unknown event type: ${e.type}`);
      }
    });
  }
}
