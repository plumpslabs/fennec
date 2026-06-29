import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WorkflowScheduler } from "../../../src/scheduler/WorkflowScheduler.js";
import { EventBus } from "../../../src/correlation/EventBus.js";
import { WorkflowEngine } from "../../../src/workflow/WorkflowEngine.js";
import type { BusEvent } from "../../../src/correlation/EventBus.js";

function createSimpleWorkflow(engine: WorkflowEngine): string {
  const wf = engine.register({
    name: "Simple Debug",
    description: "Simple diagnostic workflow",
    version: "1.0.0",
    tags: ["test"],
    steps: [
      {
        id: "step1", type: "execute", description: "Check state",
        params: { tool: "browser_get_current_url", input: {} },
        timeoutMs: 5000, retryOnFailure: false, maxRetries: 0, onFailure: "skip",
      },
    ],
  });
  return wf.id;
}

describe("WorkflowScheduler", () => {
  let eventBus: EventBus;
  let workflowEngine: WorkflowEngine;
  let scheduler: WorkflowScheduler;

  beforeEach(() => {
    eventBus = new EventBus();
    workflowEngine = new WorkflowEngine("/tmp/test-scheduler");
    scheduler = new WorkflowScheduler(eventBus, workflowEngine);
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe("rule management", () => {
    it("should add a rule", () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "test-rule",
        name: "Test Rule",
        description: "A test",
        enabled: true,
        eventType: "browser:network",
        workflowId: wfId,
        cooldownMs: 5000,
        priority: "medium",
      });

      const rules = scheduler.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]!.id).toBe("test-rule");
    });

    it("should add multiple rules at once", () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRules([
        {
          id: "rule-1", name: "Rule 1", description: "", enabled: true,
          eventType: "browser:network", workflowId: wfId, cooldownMs: 1000, priority: "low",
        },
        {
          id: "rule-2", name: "Rule 2", description: "", enabled: true,
          eventType: "browser:console", workflowId: wfId, cooldownMs: 1000, priority: "medium",
        },
      ]);

      expect(scheduler.listRules()).toHaveLength(2);
    });

    it("should remove a rule", () => {
      scheduler.addRule({
        id: "test-rule", name: "Test", description: "", enabled: true,
        eventType: "browser:console", workflowId: "wf-test", cooldownMs: 1000, priority: "low",
      });

      expect(scheduler.removeRule("test-rule")).toBe(true);
      expect(scheduler.listRules()).toHaveLength(0);
    });

    it("should return false when removing unknown rule", () => {
      expect(scheduler.removeRule("nonexistent")).toBe(false);
    });

    it("should get a rule by ID", () => {
      scheduler.addRule({
        id: "my-rule", name: "My Rule", description: "", enabled: true,
        eventType: "process:stderr", workflowId: "wf", cooldownMs: 1000, priority: "high",
      });

      const rule = scheduler.getRule("my-rule");
      expect(rule).toBeDefined();
      expect(rule!.name).toBe("My Rule");
    });

    it("should enable/disable a rule", () => {
      scheduler.addRule({
        id: "test-rule", name: "Test", description: "", enabled: true,
        eventType: "browser:error", workflowId: "wf", cooldownMs: 1000, priority: "low",
      });

      expect(scheduler.setRuleEnabled("test-rule", false)).toBe(true);
      expect(scheduler.getRule("test-rule")!.enabled).toBe(false);
    });
  });

  describe("start and stop", () => {
    it("should start and subscribe to events", () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "test-rule", name: "Test", description: "", enabled: true,
        eventType: "browser:console", workflowId: wfId, cooldownMs: 1000, priority: "low",
      });

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it("should stop and unsubscribe", () => {
      scheduler.addRule({
        id: "test-rule", name: "Test", description: "", enabled: true,
        eventType: "browser:console", workflowId: "wf", cooldownMs: 1000, priority: "low",
      });

      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("should not start twice", () => {
      scheduler.addRule({
        id: "test-rule", name: "Test", description: "", enabled: true,
        eventType: "browser:console", workflowId: "wf", cooldownMs: 1000, priority: "low",
      });

      scheduler.start();
      scheduler.start(); // should be no-op
      expect(scheduler.isRunning()).toBe(true);
    });

    it("should not subscribe to disabled rules", () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "disabled-rule", name: "Disabled", description: "", enabled: false,
        eventType: "browser:error", workflowId: wfId, cooldownMs: 1000, priority: "low",
      });

      // Should start without error
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });
  });

  describe("event matching", () => {
    it("should trigger workflow on matching event", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "match-500",
        name: "Match 500",
        description: "",
        enabled: true,
        eventType: "browser:network",
        conditions: [{ field: "data.status", equals: 500 }],
        workflowId: wfId,
        cooldownMs: 5000,
        priority: "high",
      });

      scheduler.start();

      // Publish a matching event
      eventBus.publish("browser:network", { status: 500, url: "/api/test" });

      // Wait for async execution
      await new Promise((r) => setTimeout(r, 200));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(1);
    });

    it("should NOT trigger workflow on non-matching event", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "match-500",
        name: "Match 500",
        description: "",
        enabled: true,
        eventType: "browser:network",
        conditions: [{ field: "data.status", equals: 500 }],
        workflowId: wfId,
        cooldownMs: 5000,
        priority: "high",
      });

      scheduler.start();

      // Publish a non-matching event
      eventBus.publish("browser:network", { status: 404, url: "/api/notfound" });

      await new Promise((r) => setTimeout(r, 200));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(0);
    });

    it("should match using regex pattern", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "match-error-log",
        name: "Match Error Log",
        description: "",
        enabled: true,
        eventType: "process:stderr",
        conditions: [{ field: "data.line", matches: "Error|FATAL" }],
        workflowId: wfId,
        cooldownMs: 5000,
        priority: "medium",
      });

      scheduler.start();

      eventBus.publish("process:stderr", { line: "FATAL: Database connection failed" });

      await new Promise((r) => setTimeout(r, 200));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(1);
    });

    it("should use conditionFn for custom matching", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "custom-match",
        name: "Custom Match",
        description: "",
        enabled: true,
        eventType: "browser:network",
        conditionFn: (event) => {
          const status = event.data.status as number;
          return status >= 500 || (event.data.url as string)?.includes("/api/auth");
        },
        workflowId: wfId,
        cooldownMs: 5000,
        priority: "high",
      });

      scheduler.start();

      eventBus.publish("browser:network", { status: 403, url: "/api/auth/login" });

      await new Promise((r) => setTimeout(r, 200));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(1);
    });
  });

  describe("cooldown", () => {
    it("should respect cooldown period", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "cooldown-rule",
        name: "Cooldown Rule",
        description: "",
        enabled: true,
        eventType: "browser:network",
        conditions: [{ field: "data.status", equals: 500 }],
        workflowId: wfId,
        cooldownMs: 100000, // Long cooldown
        priority: "high",
      });

      scheduler.start();

      // First event
      eventBus.publish("browser:network", { status: 500, url: "/api/1" });
      await new Promise((r) => setTimeout(r, 100));

      // Second event (within cooldown)
      eventBus.publish("browser:network", { status: 500, url: "/api/2" });
      await new Promise((r) => setTimeout(r, 100));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(1);
    });
  });

  describe("triggerRule", () => {
    it("should manually trigger a rule", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "manual-rule",
        name: "Manual Rule",
        description: "",
        enabled: true,
        eventType: "browser:network",
        workflowId: wfId,
        cooldownMs: 1000,
        priority: "low",
      });

      const execution = await scheduler.triggerRule("manual-rule", { manual: true });
      expect(execution).not.toBeNull();
      expect(execution!.status).toBe("completed");
    });

    it("should return null for disabled rule", async () => {
      scheduler.addRule({
        id: "disabled-rule",
        name: "Disabled",
        description: "",
        enabled: false,
        eventType: "browser:network",
        workflowId: "wf",
        cooldownMs: 1000,
        priority: "low",
      });

      const execution = await scheduler.triggerRule("disabled-rule");
      expect(execution).toBeNull();
    });

    it("should return null for nonexistent rule", async () => {
      const execution = await scheduler.triggerRule("nonexistent");
      expect(execution).toBeNull();
    });
  });

  describe("stats", () => {
    it("should report stats correctly", () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "rule-1", name: "Rule 1", description: "", enabled: true,
        eventType: "browser:console", workflowId: wfId, cooldownMs: 1000, priority: "high",
      });
      scheduler.addRule({
        id: "rule-2", name: "Rule 2", description: "", enabled: false,
        eventType: "browser:error", workflowId: wfId, cooldownMs: 1000, priority: "low",
      });

      const stats = scheduler.getStats();
      expect(stats.totalRules).toBe(2);
      expect(stats.enabledRules).toBe(1);
      expect(stats.totalTriggered).toBe(0);
    });

    it("should clear history", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);
      scheduler.addRule({
        id: "clear-test",
        name: "Clear Test",
        description: "",
        enabled: true,
        eventType: "browser:console",
        conditions: [{ field: "data.level", equals: "error" }],
        workflowId: wfId,
        cooldownMs: 100,
        priority: "low",
      });

      scheduler.start();
      eventBus.publish("browser:console", { level: "error", message: "test" });
      await new Promise((r) => setTimeout(r, 200));

      expect(scheduler.getStats().totalTriggered).toBe(1);

      scheduler.clearHistory();
      expect(scheduler.getStats().totalTriggered).toBe(0);
    });
  });

  describe("createDefaultRules", () => {
    it("should create default trigger rules", () => {
      const rules = WorkflowScheduler.createDefaultRules("wf-debug");
      expect(rules.length).toBeGreaterThanOrEqual(4);

      const network500 = rules.find((r) => r.id === "auto-debug-network-500");
      expect(network500).toBeDefined();
      expect(network500!.eventType).toBe("browser:network");
      expect(network500!.priority).toBe("high");
      expect(network500!.injectToSmartHook).toBe(true);

      const consoleError = rules.find((r) => r.id === "auto-debug-console-error");
      expect(consoleError).toBeDefined();
      expect(consoleError!.eventType).toBe("browser:console");

      const serverError = rules.find((r) => r.id === "auto-debug-server-error");
      expect(serverError).toBeDefined();
      expect(serverError!.eventType).toBe("process:stderr");
    });
  });

  describe("integration: EventBus + WorkflowEngine + Scheduler", () => {
    it("should complete end-to-end flow: event → match → execute", async () => {
      const wfId = createSimpleWorkflow(workflowEngine);

      scheduler.addRule({
        id: "e2e-test",
        name: "E2E Test",
        description: "",
        enabled: true,
        eventType: "browser:network",
        conditions: [{ field: "data.status", gte: 400 }],
        workflowId: wfId,
        cooldownMs: 500,
        priority: "high",
        contextTemplate: { reason: "auto-triggered" },
      });

      scheduler.start();

      eventBus.publish("browser:network", { status: 500, url: "/api/test", duration: 1234 });

      await new Promise((r) => setTimeout(r, 300));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(1);
      expect(stats.lastTriggered).not.toBeNull();
      expect(stats.lastTriggered!.ruleId).toBe("e2e-test");
      expect(stats.lastTriggered!.execution.status).toBe("completed");
    });

    it("should handle multiple events targeting different rules", async () => {
      const debugWfId = createSimpleWorkflow(workflowEngine);

      scheduler.addRules([
        {
          id: "rule-500", name: "500 Handler", description: "", enabled: true,
          eventType: "browser:network",
          conditions: [{ field: "data.status", equals: 500 }],
          workflowId: debugWfId, cooldownMs: 200, priority: "high",
        },
        {
          id: "rule-401", name: "401 Handler", description: "", enabled: true,
          eventType: "browser:network",
          conditions: [{ field: "data.status", equals: 401 }],
          workflowId: debugWfId, cooldownMs: 200, priority: "high",
        },
        {
          id: "rule-console-error", name: "Console Error", description: "", enabled: true,
          eventType: "browser:console",
          conditions: [{ field: "data.level", equals: "error" }],
          workflowId: debugWfId, cooldownMs: 200, priority: "medium",
        },
      ]);

      scheduler.start();

      eventBus.publish("browser:network", { status: 500, url: "/api/1" });
      eventBus.publish("browser:network", { status: 401, url: "/api/2" });
      eventBus.publish("browser:console", { level: "error", message: "JS Error" });

      await new Promise((r) => setTimeout(r, 500));

      const stats = scheduler.getStats();
      expect(stats.totalTriggered).toBe(3);
    });
  });
});
