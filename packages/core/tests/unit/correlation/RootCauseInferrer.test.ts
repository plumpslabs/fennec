import { describe, it, expect } from "vitest";
import { RootCauseInferrer } from "../../../src/correlation/RootCauseInferrer.js";
import type { BusEvent } from "../../../src/correlation/EventBus.js";

function makeEvent(type: BusEvent["type"], data: Record<string, unknown>): BusEvent {
  return { type, data, timestamp: Date.now() };
}

describe("RootCauseInferrer", () => {
  const inferrer = new RootCauseInferrer();

  it("should detect server error + network 500 pattern", () => {
    const trigger = makeEvent("browser:network", { method: "POST", url: "/api/login", status: 500 });
    const related = [makeEvent("process:stderr", { line: "Error: something broke" })];

    const result = inferrer.infer(trigger, related);
    expect(result.rootCause).toBe("Server error caused network failure");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.fix).toContain("server logs");
  });

  it("should detect auth token issue", () => {
    const trigger = makeEvent("browser:network", { method: "GET", url: "/api/user", status: 401 });
    const related = [makeEvent("process:stderr", { line: "JWT verification failed" })];

    const result = inferrer.infer(trigger, related);
    expect(result.rootCause).toBe("Authentication token issue");
    expect(result.confidence).toBeGreaterThanOrEqual(0.92);
    expect(result.fix).toContain("JWT_SECRET");
  });

  it("should detect missing file/env var", () => {
    const trigger = makeEvent("process:stderr", { line: "ENOENT: file not found" });

    const result = inferrer.infer(trigger, []);
    expect(result.rootCause).toBe("Missing file or environment variable");
    expect(result.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it("should detect 404 route not found", () => {
    const trigger = makeEvent("browser:network", { method: "GET", url: "/api/nonexistent", status: 404 });

    const result = inferrer.infer(trigger, []);
    expect(result.rootCause).toBe("API route or resource not found");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should return null for unknown patterns", () => {
    const trigger = makeEvent("browser:console", { level: "info", message: "something normal" });

    const result = inferrer.infer(trigger, []);
    expect(result.rootCause).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.fix).toBeNull();
  });

  it("should detect server error from console + stderr correlation", () => {
    const trigger = makeEvent("browser:console", { level: "error", message: "Request failed" });
    const related = [makeEvent("process:stderr", { line: "Error: DB timeout" })];

    const result = inferrer.infer(trigger, related);
    expect(result.rootCause).toBe("Server-side error reflected in browser");
    expect(result.confidence).toBeGreaterThanOrEqual(0.87);
  });

  it("should detect network failure + TypeError pattern when keyword 'failed' is present", () => {
    // The inferrer extracts keyword from pattern "browser:console:TypeError + browser:network:failed"
    // For "browser:network:failed", it looks for "failed" in event data string
    const trigger = makeEvent("browser:console", { level: "error", message: "TypeError: cannot read data" });
    const related = [makeEvent("browser:network", { method: "GET", url: "/api/data", status: 0, statusText: "failed" })];

    const result = inferrer.infer(trigger, related);
    expect(result.rootCause).toBe("Network failure caused JavaScript error");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("should match patterns regardless of event order", () => {
    const trigger = makeEvent("process:stderr", { line: "JWT verification failed" });
    const related = [makeEvent("browser:network", { method: "GET", url: "/api/me", status: 401 })];

    const result = inferrer.infer(trigger, related);
    expect(result.rootCause).toBe("Authentication token issue");
    expect(result.confidence).toBeGreaterThanOrEqual(0.92);
  });
});
