import type { BusEvent } from "./EventBus.js";
import type { TimelineEntry } from "./CorrelationEngine.js";

export class TimelineBuilder {
  build(events: BusEvent[]): TimelineEntry[] {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const baseTime = sorted[0]?.timestamp ?? Date.now();

    return sorted.map((e) => ({
      at: e.timestamp,
      relativeMs: e.timestamp - baseTime,
      layer: this.mapLayer(e.type),
      event: this.formatEvent(e),
      detail: this.formatDetail(e),
    }));
  }

  private mapLayer(type: string): "browser" | "server" | "terminal" {
    if (type.startsWith("browser")) return "browser";
    if (type.startsWith("process")) return "server";
    return "terminal";
  }

  private formatEvent(event: BusEvent): string {
    const data = event.data;
    switch (event.type) {
      case "browser:network":
        return `${data.method} ${data.url}`;
      case "browser:console":
        return `[${data.level}] ${data.message}`;
      case "browser:error":
        return `Error: ${data.message}`;
      case "process:stdout":
      case "process:stderr":
        return `${data.line}`;
      default:
        return `${event.type}`;
    }
  }

  private formatDetail(event: BusEvent): string {
    switch (event.type) {
      case "browser:network":
        return `Status: ${event.data.status}`;
      case "process:stderr":
        return `Error output`;
      case "process:exit":
        return `Exit code: ${event.data.code}`;
      default:
        return "";
    }
  }
}
