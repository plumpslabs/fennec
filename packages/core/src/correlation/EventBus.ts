export type EventType =
  | "browser:console"
  | "browser:network"
  | "browser:error"
  | "process:stdout"
  | "process:stderr"
  | "process:exit"
  | "terminal:log";

export interface BusEvent {
  type: EventType;
  data: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (event: BusEvent) => void;

export class EventBus {
  private subscribers: Map<EventType, Set<EventHandler>> = new Map();
  private history: BusEvent[] = [];
  private maxHistory = 10000;

  subscribe(type: EventType, handler: EventHandler): () => void {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    this.subscribers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(type)?.delete(handler);
    };
  }

  publish(type: EventType, data: Record<string, unknown>): void {
    const event: BusEvent = {
      type,
      data,
      timestamp: Date.now(),
    };

    // Add to history
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Notify subscribers
    const handlers = this.subscribers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // Silently handle subscriber errors
        }
      }
    }
  }

  getEventsInWindow(from: number, to: number): BusEvent[] {
    return this.history.filter((e) => e.timestamp >= from && e.timestamp <= to);
  }

  getHistory(type?: EventType, limit = 100): BusEvent[] {
    let events = this.history;
    if (type) {
      events = events.filter((e) => e.type === type);
    }
    return events.slice(-limit);
  }

  clear(): void {
    this.history = [];
  }
}
