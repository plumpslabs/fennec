export type PlanStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  tool: string;
  input: Record<string, unknown>;
  dependsOn: string[];
  status: PlanStatus;
  result?: unknown;
  error?: string;
  timeoutMs: number;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: number;
  completedAt?: number;
  currentStepIndex: number;
}

export type PlanExecutor = (
  tool: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

export class Planner {
  private plans: Map<string, Plan> = new Map();
  private nextPlanId = 0;

  /**
   * Create a plan from a goal and a list of steps.
   */
  createPlan(goal: string, steps: Omit<PlanStep, "id" | "status">[]): Plan {
    const plan: Plan = {
      id: `plan_${++this.nextPlanId}`,
      goal,
      steps: steps.map((s, i) => ({
        ...s,
        id: `step_${i + 1}`,
        status: "pending",
      })),
      status: "pending",
      createdAt: Date.now(),
      currentStepIndex: 0,
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  /**
   * Create a plan automatically from a complex goal.
   */
  createAutoPlan(goal: string): Plan {
    // Analyze goal and auto-generate steps
    const steps: Omit<PlanStep, "id" | "status">[] = [];
    const goalLower = goal.toLowerCase();

    // Login flow
    if (goalLower.includes("login") || goalLower.includes("sign in") || goalLower.includes("authenticate")) {
      steps.push(
        { description: "Navigate to login page", tool: "browser_navigate", input: { url: "" }, dependsOn: [], timeoutMs: 30000 },
        { description: "Fill username/email field", tool: "browser_type", input: { selector: 'input[type="email"], input[name*="user"]', text: "" }, dependsOn: ["step_1"], timeoutMs: 10000 },
        { description: "Fill password field", tool: "browser_type", input: { selector: 'input[type="password"]', text: "" }, dependsOn: ["step_2"], timeoutMs: 10000 },
        { description: "Submit login form", tool: "browser_click", input: { selector: 'button[type="submit"]' }, dependsOn: ["step_3"], timeoutMs: 15000 },
        { description: "Verify login success", tool: "auth_check_logged_in", input: {}, dependsOn: ["step_4"], timeoutMs: 10000 },
      );
    }

    // Form filling
    if (goalLower.includes("fill form") || goalLower.includes("submit form")) {
      steps.push(
        { description: "Navigate to form page", tool: "browser_navigate", input: { url: "" }, dependsOn: [], timeoutMs: 30000 },
        { description: "Wait for form to load", tool: "browser_wait_for_element", input: { selector: "form", state: "attached" }, dependsOn: ["step_1"], timeoutMs: 10000 },
        { description: "Fill form fields", tool: "browser_type", input: { selector: "", text: "" }, dependsOn: ["step_2"], timeoutMs: 30000 },
        { description: "Submit form", tool: "browser_click", input: { selector: 'button[type="submit"]' }, dependsOn: ["step_3"], timeoutMs: 15000 },
      );
    }

    // Debug/Diagnose
    if (goalLower.includes("debug") || goalLower.includes("diagnose") || goalLower.includes("why")) {
      steps.push(
        { description: "Get current page state", tool: "browser_get_current_url", input: {}, dependsOn: [], timeoutMs: 5000 },
        { description: "Check console errors", tool: "devtools_get_console_logs", input: { level: "error", limit: 10 }, dependsOn: [], timeoutMs: 5000 },
        { description: "Check network failures", tool: "network_get_failed_requests", input: {}, dependsOn: [], timeoutMs: 5000 },
        { description: "Run full diagnosis", tool: "diagnose_fullstack", input: {}, dependsOn: ["step_1", "step_2", "step_3"], timeoutMs: 15000 },
      );
    }

    // Screenshot / Capture
    if (goalLower.includes("screenshot") || goalLower.includes("capture") || goalLower.includes("snapshot")) {
      steps.push(
        { description: "Take page screenshot", tool: "browser_screenshot", input: { fullPage: true }, dependsOn: [], timeoutMs: 10000 },
        { description: "Get page metadata", tool: "browser_get_meta", input: {}, dependsOn: [], timeoutMs: 5000 },
      );
    }

    // Checkout flow
    if (goalLower.includes("checkout") || goalLower.includes("purchase") || goalLower.includes("buy")) {
      steps.push(
        { description: "Navigate to cart/checkout", tool: "browser_navigate", input: { url: "" }, dependsOn: [], timeoutMs: 30000 },
        { description: "Verify items in cart", tool: "browser_get_page_text", input: { selector: ".cart" }, dependsOn: ["step_1"], timeoutMs: 10000 },
        { description: "Fill shipping details", tool: "browser_type", input: { selector: "", text: "" }, dependsOn: ["step_2"], timeoutMs: 30000 },
        { description: "Place order", tool: "browser_click", input: { selector: 'button:has-text("Place Order"), button:has-text("Pay")' }, dependsOn: ["step_3"], timeoutMs: 20000 },
        { description: "Verify order confirmation", tool: "browser_wait_for_element", input: { selector: 'h1:has-text("Thank you"), .order-confirmation', state: "visible" }, dependsOn: ["step_4"], timeoutMs: 15000 },
      );
    }

    // Default: generic browse and capture
    if (steps.length === 0) {
      steps.push(
        { description: "Navigate to target page", tool: "browser_navigate", input: { url: "" }, dependsOn: [], timeoutMs: 30000 },
        { description: "Get page information", tool: "browser_get_current_url", input: {}, dependsOn: ["step_1"], timeoutMs: 5000 },
        { description: "Take screenshot", tool: "browser_screenshot", input: {}, dependsOn: ["step_2"], timeoutMs: 10000 },
      );
    }

    return this.createPlan(goal, steps);
  }

  /**
   * Get a plan by ID.
   */
  getPlan(id: string): Plan | undefined {
    return this.plans.get(id);
  }

  /**
   * List all plans.
   */
  listPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  /**
   * Execute a plan step by step using the provided executor.
   */
  async executePlan(
    planId: string,
    executor: PlanExecutor,
    onStepComplete?: (step: PlanStep, plan: Plan) => void,
  ): Promise<Plan> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    plan.status = "running";

    // Resolve dependency order (topological sort)
    const resolvedOrder = this.resolveDependencyOrder(plan.steps);

    for (let i = 0; i < resolvedOrder.length; i++) {
      const stepIndex = resolvedOrder[i]!;
      const step = plan.steps[stepIndex]!;

      // Check if dependencies are all completed
      const depsMet = step.dependsOn.every((depId) => {
        const dep = plan.steps.find((s) => s.id === depId);
        return dep?.status === "completed";
      });

      if (!depsMet) {
        step.status = "skipped";
        step.error = "Dependencies not met";
        continue;
      }

      step.status = "running";
      plan.currentStepIndex = stepIndex;

      try {
        const result = await executor(step.tool, step.input);
        step.status = "completed";
        step.result = result;

        if (onStepComplete) {
          onStepComplete(step, plan);
        }
      } catch (error) {
        step.status = "failed";
        step.error = String(error);
        plan.status = "failed";
        plan.completedAt = Date.now();
        return plan;
      }
    }

    // Check if all steps completed
    const allCompleted = plan.steps.every((s) => s.status === "completed" || s.status === "skipped");
    plan.status = allCompleted ? "completed" : "failed";
    plan.completedAt = Date.now();

    return plan;
  }

  /**
   * Resolve dependency order using topological sort.
   */
  private resolveDependencyOrder(steps: PlanStep[]): number[] {
    const visited = new Set<number>();
    const order: number[] = [];
    const stepMap = new Map(steps.map((s, i) => [s.id, i]));

    const visit = (index: number, path: Set<number>): void => {
      if (visited.has(index)) return;
      if (path.has(index)) throw new Error("Circular dependency detected");
      path.add(index);

      const step = steps[index]!;
      for (const depId of step.dependsOn) {
        const depIndex = stepMap.get(depId);
        if (depIndex !== undefined) {
          visit(depIndex, path);
        }
      }

      visited.add(index);
      order.push(index);
    };

    for (let i = 0; i < steps.length; i++) {
      if (!visited.has(i)) {
        visit(i, new Set());
      }
    }

    return order;
  }

  /**
   * Update a specific step's input (e.g., fill in actual values after user provides them).
   */
  updateStepInput(planId: string, stepId: string, input: Record<string, unknown>): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return false;

    step.input = { ...step.input, ...input };
    return true;
  }

  /**
   * Cancel a running plan.
   */
  cancelPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== "running") return false;

    plan.status = "failed";
    plan.completedAt = Date.now();
    return true;
  }

  /**
   * Delete a plan from history.
   */
  deletePlan(planId: string): boolean {
    return this.plans.delete(planId);
  }
}
