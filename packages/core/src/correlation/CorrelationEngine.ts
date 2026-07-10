/**
 * @deprecated Use IncidentEngine instead (packages/core/src/incident/IncidentEngine.ts).
 * IncidentEngine provides:
 * - Auto-subscription to EventBus for real-time detection
 * - Formal incident lifecycle (active → resolved/dismissed)
 * - Alert generation for Level 0 pulse system
 * - Deduplication of similar incidents
 * - Richer pattern matching with severity levels
 */
import { EventBus, type BusEvent } from "./EventBus.js";
import { RootCauseInferrer } from "./RootCauseInferrer.js";

export interface TimelineEntry {
  at: number;
  relativeMs: number;
  layer: "browser" | "server" | "terminal";
  event: string;
  detail?: string;
}

export interface CorrelatedTimeline {
  trigger: BusEvent;
  relatedEvents: BusEvent[];
  timeline: TimelineEntry[];
  rootCause: string | null;
  confidence: number;
  fix: string | null;
}

/** @deprecated Use IncidentEngine */
export class CorrelationEngine {
  private eventBus: EventBus;
  private rootCauseInferrer: RootCauseInferrer;
  private correlationWindowMs: number;
  private minConfidence: number;

  constructor(
    eventBus: EventBus,
    options: { windowMs?: number; minConfidence?: number } = {},
  ) {
    this.eventBus = eventBus;
    this.rootCauseInferrer = new RootCauseInferrer();
    this.correlationWindowMs = options.windowMs ?? 500;
    this.minConfidence = options.minConfidence ?? 0.7;
  }

  correlate(trigger: BusEvent): CorrelatedTimeline {
    const window = this.eventBus.getEventsInWindow(
      trigger.timestamp - this.correlationWindowMs,
      trigger.timestamp + this.correlationWindowMs,
    );

    const timeline = this.buildTimeline(trigger, window);
    const rootCauseInfo = this.rootCauseInferrer.infer(trigger, window);

    return {
      trigger,
      relatedEvents: window,
      timeline,
      rootCause: rootCauseInfo.confidence >= this.minConfidence ? rootCauseInfo.rootCause : null,
      confidence: rootCauseInfo.confidence,
      fix: rootCauseInfo.confidence >= this.minConfidence ? rootCauseInfo.fix : null,
    };
  }

  private buildTimeline(trigger: BusEvent, related: BusEvent[]): TimelineEntry[] {
    const all = [trigger, ...related].sort((a, b) => a.timestamp - b.timestamp);
    const baseTime = all[0]?.timestamp ?? trigger.timestamp;

    return all.map((e) => ({
      at: e.timestamp,
      relativeMs: e.timestamp - baseTime,
      layer: this.eventTypeToLayer(e.type),
      event: this.eventToDescription(e),
    }));
  }

  private eventTypeToLayer(type: string): "browser" | "server" | "terminal" {
    if (type.startsWith("browser")) return "browser";
    if (type.startsWith("process")) return "server";
    return "terminal";
  }

  private eventToDescription(event: BusEvent): string {
    const { type, data } = event;
    switch (type) {
      case "browser:console":
        return `[${data.level}] ${data.message}`;
      case "browser:network":
        return `${data.method} ${data.url} -> ${data.status}`;
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
