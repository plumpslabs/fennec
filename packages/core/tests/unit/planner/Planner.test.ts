import { describe, it, expect, beforeEach } from "vitest";
import { Planner } from "../../../src/planner/Planner.js";

describe("Planner", () => {
  let planner: Planner;

  beforeEach(() => {
    planner = new Planner();
  });

  describe("createPlan", () => {
    it("should create a plan with steps", () => {
      const plan = planner.createPlan("Test login flow", [
        { description: "Navigate to login", tool: "browser_navigate", input: { url: "https://example.com/login" }, dependsOn: [], timeoutMs: 30000 },
        { description: "Click submit", tool: "browser_click", input: { selector: "#submit" }, dependsOn: ["step_1"], timeoutMs: 10000 },
      ]);

      expect(plan.goal).toBe("Test login flow");
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]!.id).toBe("step_1");
      expect(plan.steps[1]!.id).toBe("step_2");
      expect(plan.steps[0]!.status).toBe("pending");
      expect(plan.status).toBe("pending");
    });

    it("should auto-generate step IDs sequentially", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
        { description: "Step 2", tool: "tool2", input: {}, dependsOn: [], timeoutMs: 1000 },
        { description: "Step 3", tool: "tool3", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);
      expect(plan.steps[0]!.id).toBe("step_1");
      expect(plan.steps[1]!.id).toBe("step_2");
      expect(plan.steps[2]!.id).toBe("step_3");
    });
  });

  describe("createAutoPlan", () => {
    it("should detect login flow from goal", () => {
      const plan = planner.createAutoPlan("login to my app");
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.description.toLowerCase().includes("login"))).toBe(true);
    });

    it("should detect debug flow from goal", () => {
      const plan = planner.createAutoPlan("debug the error on the page");
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.tool === "diagnose_fullstack")).toBe(true);
    });

    it("should detect screenshot flow from goal", () => {
      const plan = planner.createAutoPlan("take a screenshot");
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.tool === "browser_screenshot")).toBe(true);
    });

    it("should generate default plan for unknown goal", () => {
      const plan = planner.createAutoPlan("some random task");
      expect(plan.steps.length).toBeGreaterThan(0);
    });
  });

  describe("executePlan", () => {
    it("should execute steps in order", async () => {
      const plan = planner.createPlan("Simple test", [
        { description: "Step 1", tool: "tool1", input: { val: 1 }, dependsOn: [], timeoutMs: 1000 },
        { description: "Step 2", tool: "tool2", input: { val: 2 }, dependsOn: ["step_1"], timeoutMs: 1000 },
      ]);

      const executed: string[] = [];
      const result = await planner.executePlan(plan.id, async (tool, input) => {
        executed.push(`${tool}(${JSON.stringify(input)})`);
        return { done: true };
      });

      expect(executed).toHaveLength(2);
      expect(executed[0]).toContain("tool1");
      expect(executed[1]).toContain("tool2");
      expect(result.status).toBe("completed");
    });

    it("should skip steps with unmet dependencies", async () => {
      const plan = planner.createPlan("Dep test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
        { description: "Step 2", tool: "tool2", input: {}, dependsOn: ["nonexistent"], timeoutMs: 1000 },
      ]);

      const result = await planner.executePlan(plan.id, async () => ({ done: true }));

      expect(result.steps[0]!.status).toBe("completed");
      expect(result.steps[1]!.status).toBe("skipped");
      expect(result.steps[1]!.error).toContain("Dependencies not met");
    });

    it("should fail plan when a step errors", async () => {
      const plan = planner.createPlan("Error test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
        { description: "Step 2", tool: "tool2", input: {}, dependsOn: ["step_1"], timeoutMs: 1000 },
      ]);

      let callCount = 0;
      const result = await planner.executePlan(plan.id, async () => {
        callCount++;
        if (callCount === 2) throw new Error("Step failed");
        return { ok: true };
      });

      expect(result.status).toBe("failed");
      expect(result.steps[0]!.status).toBe("completed");
      expect(result.steps[1]!.status).toBe("failed");
      expect(result.steps[1]!.error).toContain("Step failed");
    });

    it("should callback on each step completion", async () => {
      const plan = planner.createPlan("Callback test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);

      const completedSteps: string[] = [];
      await planner.executePlan(plan.id, async () => ({ done: true }), (step) => {
        completedSteps.push(step.id);
      });

      expect(completedSteps).toHaveLength(1);
      expect(completedSteps[0]).toBe("step_1");
    });
  });

  describe("updateStepInput", () => {
    it("should update input for a specific step", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: { url: "" }, dependsOn: [], timeoutMs: 1000 },
      ]);

      const updated = planner.updateStepInput(plan.id, "step_1", { url: "https://example.com" });
      expect(updated).toBe(true);
      expect(plan.steps[0]!.input.url).toBe("https://example.com");
    });

    it("should return false for unknown step", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);
      expect(planner.updateStepInput(plan.id, "nonexistent", {})).toBe(false);
    });
  });

  describe("cancelPlan", () => {
    it("should cancel a running plan", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);
      // Set as running first
      plan.status = "running";

      const cancelled = planner.cancelPlan(plan.id);
      expect(cancelled).toBe(true);
      expect(plan.status).toBe("failed");
      expect(plan.completedAt).toBeDefined();
    });

    it("should return false for completed plan", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);
      plan.status = "completed";

      expect(planner.cancelPlan(plan.id)).toBe(false);
    });
  });

  describe("getPlan and listPlans", () => {
    it("should get a plan by ID", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);
      expect(planner.getPlan(plan.id)?.goal).toBe("Test");
    });

    it("should return undefined for unknown plan", () => {
      expect(planner.getPlan("nonexistent")).toBeUndefined();
    });

    it("should list all plans", () => {
      planner.createPlan("Plan A", [{ description: "Step 1", tool: "t1", input: {}, dependsOn: [], timeoutMs: 1000 }]);
      planner.createPlan("Plan B", [{ description: "Step 1", tool: "t2", input: {}, dependsOn: [], timeoutMs: 1000 }]);
      expect(planner.listPlans()).toHaveLength(2);
    });
  });

  describe("deletePlan", () => {
    it("should delete a plan", () => {
      const plan = planner.createPlan("Test", [
        { description: "Step 1", tool: "tool1", input: {}, dependsOn: [], timeoutMs: 1000 },
      ]);
      expect(planner.deletePlan(plan.id)).toBe(true);
      expect(planner.getPlan(plan.id)).toBeUndefined();
    });
  });
});
