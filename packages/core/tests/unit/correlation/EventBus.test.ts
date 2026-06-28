import { describe, it, expect, beforeEach } from "vitest";
import { EventBus } from "../../../src/correlation/EventBus.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("should publish and receive events", () => {
    const received: unknown[] = [];
    bus.subscribe("browser:console", (event) => {
      received.push(event.data);
    });

    bus.publish("browser:console", { level: "error", message: "test error" });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ level: "error", message: "test error" });
  });

  it("should support multiple subscribers per event type", () => {
    const received1: unknown[] = [];
    const received2: unknown[] = [];

    bus.subscribe("browser:console", (e) => received1.push(e.data));
    bus.subscribe("browser:console", (e) => received2.push(e.data));

    bus.publish("browser:console", { message: "hello" });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it("should support unsubscribe", () => {
    const received: unknown[] = [];
    const unsubscribe = bus.subscribe("browser:error", (e) => received.push(e.data));

    bus.publish("browser:error", { message: "first" });
    expect(received).toHaveLength(1);

    unsubscribe();
    bus.publish("browser:error", { message: "second" });
    expect(received).toHaveLength(1); // Still 1, second not received
  });

  it("should not deliver events to subscribers of other types", () => {
    const received: unknown[] = [];
    bus.subscribe("process:stderr", (e) => received.push(e.data));

    bus.publish("browser:console", { message: "should not see" });
    expect(received).toHaveLength(0);
  });

  it("should keep history of events", () => {
    bus.publish("browser:console", { message: "event 1" });
    bus.publish("process:stdout", { line: "output" });

    const history = bus.getHistory();
    expect(history).toHaveLength(2);
  });

  it("should filter history by event type", () => {
    bus.publish("browser:console", { message: "log" });
    bus.publish("process:stdout", { line: "output" });

    const consoleHistory = bus.getHistory("browser:console");
    expect(consoleHistory).toHaveLength(1);
    expect(consoleHistory[0]!.type).toBe("browser:console");
  });

  it("should limit history to specified count", () => {
    for (let i = 0; i < 10; i++) {
      bus.publish("browser:console", { message: `event ${i}` });
    }

    const history = bus.getHistory(undefined, 3);
    expect(history).toHaveLength(3);
  });

  it("should get events in a time window", () => {
    bus.publish("browser:console", { message: "before window" });
    // The following depends on timing, so we add a small delay
    const after = Date.now() + 1;
    bus.publish("process:stdout", { line: "in window" });

    const windowEvents = bus.getEventsInWindow(0, Date.now());
    expect(windowEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("should clear all history", () => {
    bus.publish("browser:console", { message: "test" });
    expect(bus.getHistory()).toHaveLength(1);

    bus.clear();
    expect(bus.getHistory()).toHaveLength(0);
  });

  it("should include timestamp in events", () => {
    const before = Date.now();
    bus.publish("browser:console", { message: "timed" });
    const after = Date.now();

    const history = bus.getHistory();
    expect(history[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(history[0]!.timestamp).toBeLessThanOrEqual(after);
  });

  it("should handle subscriber errors gracefully", () => {
    bus.subscribe("browser:error", () => {
      throw new Error("Subscriber error");
    });

    // Should not throw
    expect(() => bus.publish("browser:error", { message: "test" })).not.toThrow();
  });
});
