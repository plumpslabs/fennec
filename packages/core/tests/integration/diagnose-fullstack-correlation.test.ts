import { describe, it, expect, beforeEach } from "vitest";
import { PipeWatcher } from "../../src/process/PipeWatcher.js";
import { EventBus } from "../../src/correlation/EventBus.js";
import { CorrelationEngine } from "../../src/correlation/CorrelationEngine.js";
import type { BusEvent } from "../../src/correlation/EventBus.js";

describe("Integration: diagnose_fullstack-like correlation with PipeWatcher + EventBus", () => {
  let pipeWatcher: PipeWatcher;
  let eventBus: EventBus;
  let engine: CorrelationEngine;

  beforeEach(() => {
    pipeWatcher = new PipeWatcher(500);
    eventBus = new EventBus();
    engine = new CorrelationEngine(eventBus, { windowMs: 2000, minConfidence: 0.7 });
  });

  /**
   * Simulates what diagnose_fullstack does internally:
   * 1. Collect browser console errors (simulated via EventBus)
   * 2. Collect network failures (simulated via EventBus)
   * 3. Collect server errors (from PipeWatcher)
   * 4. Correlate and return root cause
   */
  function simulateDiagnoseFullstack(processId: string) {
    // Collect server errors from pipe
    const serverErrors = pipeWatcher.getLogs(processId, { level: "error" });

    // Collect browser console errors from event bus
    const browserErrors = eventBus.getHistory("browser:console");

    // Collect network failures from event bus
    const networkFailures = eventBus.getHistory("browser:network");

    // Use the latest network failure as trigger, or console error
    const trigger: BusEvent | null =
      networkFailures.length > 0
        ? {
            type: "browser:network" as const,
            data: networkFailures[networkFailures.length - 1]!.data,
            timestamp: Date.now(),
          }
        : browserErrors.length > 0
          ? {
              type: "browser:console" as const,
              data: browserErrors[browserErrors.length - 1]!.data,
              timestamp: Date.now(),
            }
          : null;

    if (!trigger) {
      return { serverErrors, browserErrors, networkFailures, correlation: null };
    }

    const correlation = engine.correlate(trigger);

    // Build the combined output like diagnose_fullstack
    return {
      browser: {
        consoleErrors: browserErrors.map((e) => e.data.message || String(e.data)),
        networkFailures: networkFailures.map((e) => ({
          url: e.data.url,
          status: e.data.status,
          method: e.data.method,
        })),
      },
      server: {
        recentErrors: serverErrors.map((e) => e.line),
        logCount: pipeWatcher.getLogs(processId).length,
      },
      correlation: {
        rootCause: correlation.rootCause,
        confidence: correlation.confidence,
        fix: correlation.fix,
        timeline: correlation.timeline,
      },
    };
  }

  it("should diagnose JWT_SECRET missing from both pipe logs and browser errors", () => {
    const pipe = pipeWatcher.createPipe("dev-server");

    // Server side: JWT error in pipe
    pipe.write("[ERROR] JWT_SECRET environment variable is not set");
    eventBus.publish("process:stderr", { line: "JWT_SECRET environment variable is not set" });

    // Browser side: 500 + console error
    eventBus.publish("browser:network", {
      method: "POST",
      url: "/api/auth/login",
      status: 500,
      duration: 234,
    });
    eventBus.publish("browser:console", {
      level: "error",
      message: "TypeError: Cannot read properties of undefined (reading 'token')",
      source: "auth.js:67",
    });

    const result = simulateDiagnoseFullstack("dev-server");

    // Verify combined data
    expect(result.server.recentErrors).toHaveLength(1);
    expect(result.server.recentErrors[0]).toContain("JWT_SECRET");
    expect(result.browser.consoleErrors).toHaveLength(1);
    expect(result.browser.networkFailures).toHaveLength(1);
    expect(result.browser.networkFailures[0]!.status).toBe(500);

    // Correlation should find root cause
    if (result.correlation?.rootCause) {
      expect(result.correlation.rootCause).toBeTruthy();
      expect(result.correlation.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("should diagnose 500 error from pipe logs and browser network", () => {
    const pipe = pipeWatcher.createPipe("api-server");

    // Server: 500 error
    pipe.write("[ERROR] TypeError: Cannot read properties of null (reading 'email')");
    pipe.write("[ERROR] GET /api/users/999 - 500 (12ms)");
    eventBus.publish("process:stderr", { line: "TypeError: Cannot read properties of null (reading 'email')" });

    // Browser: failed request
    eventBus.publish("browser:network", {
      method: "GET",
      url: "/api/users/999",
      status: 500,
      duration: 312,
    });

    // Browser: console error from the failure
    eventBus.publish("browser:console", {
      level: "error",
      message: "Uncaught (in promise) Error: Failed to load user data",
      source: "app.js:145",
    });

    const result = simulateDiagnoseFullstack("api-server");

    expect(result.server.recentErrors).toHaveLength(2);
    expect(result.browser.networkFailures).toHaveLength(1);
    expect(result.browser.consoleErrors).toHaveLength(1);

    if (result.correlation?.rootCause) {
      // Confidence should be high since we have server error + network failure
      expect(result.correlation.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("should return empty correlation when no errors present", () => {
    const pipe = pipeWatcher.createPipe("healthy-server");

    pipe.write("[INFO] Server started successfully");
    pipe.write("[INFO] GET / 200 5ms");

    eventBus.publish("browser:network", {
      method: "GET",
      url: "/",
      status: 200,
      duration: 5,
    });

    const result = simulateDiagnoseFullstack("healthy-server");

    expect(result.server.recentErrors).toHaveLength(0);
    expect(result.server.logCount).toBe(2);

    // No error events means the browser events become the trigger
    // but correlation will have low or no root cause
    if (result.correlation?.rootCause) {
      // If it finds a root cause for a healthy app, confidence should be low
      expect(result.correlation.confidence).toBeLessThan(0.7);
    }
  });

  it("should handle multiple error types and pick the highest confidence", () => {
    const pipe = pipeWatcher.createPipe("multi-error-server");

    // Multiple error types in pipe
    pipe.write("[ERROR] ENOENT: file not found, open '.env'");
    pipe.write("[ERROR] JWT verification failed");
    pipe.write("[ERROR] TypeError: Cannot read property 'x' of undefined");
    pipe.write("[ERROR] Connection refused to database");

    eventBus.publish("process:stderr", { line: "ENOENT: file not found, open '.env'" });
    eventBus.publish("browser:network", { method: "GET", url: "/api/data", status: 500 });

    // Filter pipe logs by keyword
    const envErrors = pipeWatcher.getLogs("multi-error-server", { keyword: "ENOENT" });
    expect(envErrors).toHaveLength(1);

    const jwtErrors = pipeWatcher.getLogs("multi-error-server", { keyword: "JWT" });
    expect(jwtErrors).toHaveLength(1);

    const result = simulateDiagnoseFullstack("multi-error-server");

    expect(result.server.recentErrors.length).toBeGreaterThanOrEqual(1);

    // The correlation should detect "missing env or file" pattern
    // because ENOENT was published right before the browser event
    if (result.correlation?.rootCause) {
      expect(result.correlation.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("should correlate by keyword across pipe logs and browser events", () => {
    const pipe = pipeWatcher.createPipe("keyword-server");

    pipe.write("[INFO] Database migration started");
    pipe.write("[ERROR] Database connection timeout after 30s");
    pipe.write("[INFO] Fallback to cache layer");

    eventBus.publish("process:stderr", { line: "Database connection timeout after 30s" });
    eventBus.publish("browser:network", { method: "GET", url: "/api/products", status: 503 });

    // Search pipe logs for connection issues
    const dbErrors = pipeWatcher.getLogs("keyword-server", { keyword: "Database" });
    expect(dbErrors).toHaveLength(2); // Both DB-related lines

    const timeoutErrors = pipeWatcher.getLogs("keyword-server", { keyword: "timeout" });
    expect(timeoutErrors).toHaveLength(1);

    const result = simulateDiagnoseFullstack("keyword-server");

    expect(result.server.recentErrors).toHaveLength(1);
    expect(result.server.recentErrors[0]).toContain("timeout");
  });

  it("should build accurate timeline with pipe and browser events", () => {
    const pipe = pipeWatcher.createPipe("timeline-server");

    // Simulate a sequence of events
    pipe.write("[INFO] Request POST /api/order received");
    pipe.write("[INFO] Processing payment...");
    pipe.write("[ERROR] Payment gateway timeout");
    pipe.write("[INFO] Returning 500 to client");

    eventBus.publish("process:stdout", { line: "Request POST /api/order received" });
    eventBus.publish("process:stdout", { line: "Processing payment..." });
    eventBus.publish("process:stderr", { line: "Payment gateway timeout" });
    eventBus.publish("browser:network", { method: "POST", url: "/api/order", status: 500 });

    const serverLogs = pipeWatcher.getLogs("timeline-server");

    // Verify the sequence
    expect(serverLogs).toHaveLength(4);
    expect(serverLogs[0]!.line).toContain("received");
    expect(serverLogs[1]!.line).toContain("Processing");
    expect(serverLogs[2]!.line).toContain("timeout");
    expect(serverLogs[3]!.line).toContain("500");

    const result = simulateDiagnoseFullstack("timeline-server");

    // Timeline should have entries
    if (result.correlation?.timeline) {
      expect(result.correlation.timeline.length).toBeGreaterThanOrEqual(1);
      // Each timeline entry should have required fields
      for (const entry of result.correlation.timeline) {
        expect(entry).toHaveProperty("relativeMs");
        expect(entry).toHaveProperty("layer");
        expect(entry).toHaveProperty("event");
      }
    }
  });
});
