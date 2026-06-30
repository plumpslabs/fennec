import { z } from "zod";
import { createTool } from "../_registry.js";

// ─── planner_execute_goal ───────────────────────────────────────

export const plannerExecuteGoal = createTool({
  name: "planner_execute_goal",
  category: "planner",
  description:
    "`<use_case>Automation</use_case> AI-powered multi-step plan execution. Describe a goal in natural language and Fennec will create an execution plan, convert it to a workflow, and execute every step automatically. Supports login flows, form filling, checkout, debugging/diagnosis, and screenshot capture. Returns step-by-step execution results with status per step.`",
  inputSchema: z.object({
    goal: z
      .string()
      .describe(
        "Goal description in natural language. Examples: 'login to my app', 'debug the error on the page', 'fill form and submit', 'take a screenshot of the current page', 'checkout the shopping cart'",
      ),
    initialContext: z
      .record(z.unknown())
      .optional()
      .describe("Optional initial context passed to every workflow step"),
  }),
  handler: async (input, { planner, workflowEngine, responseBuilder, logger }) => {
    const startTime = Date.now();

    try {
      // Phase 1: Create auto-plan from goal
      logger.info({ goal: input.goal }, "Planner: creating auto-plan");
      const plan = planner.createAutoPlan(input.goal);

      if (plan.steps.length === 0) {
        return responseBuilder.error(
          new Error(`Could not generate a plan for: "${input.goal}"`),
          {
            code: "PLAN_GENERATION_FAILED",
            suggestions: [
              "Try a more specific goal description",
              "Use individual browser tools directly",
              "Try: login, debug, screenshot, form, checkout",
            ],
          },
        );
      }

      logger.info(
        { planId: plan.id, steps: plan.steps.length, goal: input.goal },
        "Planner: plan created, executing via workflow engine",
      );

      // Phase 2: Execute plan through WorkflowEngine
      // WorkflowEngine.executePlan() converts Plan → Workflow → execute
      // Uses the tool executor wired to the pipeline (with middleware)
      const execution = await workflowEngine.executePlan(plan, {
        planGoal: input.goal,
        ...(input.initialContext ?? {}),
      });

      const elapsed = Date.now() - startTime;

      // Phase 3: Build rich response
      const stepResults = execution.stepResults.map((sr, i) => {
        const step = plan.steps[i];
        return {
          stepId: sr.stepId,
          description: step?.description ?? "",
          tool: step?.tool ?? "",
          status: sr.status,
          error: sr.error ?? null,
          duration: sr.startedAt && sr.completedAt
            ? new Date(sr.completedAt).getTime() - new Date(sr.startedAt).getTime()
            : null,
        };
      });

      const completedSteps = stepResults.filter((s) => s.status === "completed").length;
      const failedSteps = stepResults.filter((s) => s.status === "failed").length;
      const skippedSteps = stepResults.filter((s) => s.status === "skipped").length;

      const success = execution.status === "completed";

      return responseBuilder.success(
        {
          success,
          planId: plan.id,
          goal: input.goal,
          executionId: execution.id,
          status: execution.status,
          totalSteps: plan.steps.length,
          completedSteps,
          failedSteps,
          skippedSteps,
          elapsed,
          steps: stepResults,
          summary: success
            ? `✅ Completed ${completedSteps}/${plan.steps.length} steps in ${elapsed}ms`
            : `❌ Failed after completing ${completedSteps}/${plan.steps.length} steps (${failedSteps} failed, ${skippedSteps} skipped)`,
          context: execution.context,
        },
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: "PLAN_EXECUTION_FAILED",
        suggestions: [
          "Check if the browser session is active",
          "Verify the goal is specific enough",
          "Check logs for the specific step that failed",
        ],
      });
    }
  },
});

// ─── planner_create_plan ────────────────────────────────────────

export const plannerCreatePlan = createTool({
  name: "planner_create_plan",
  category: "planner",
  description:
    "`<use_case>Planning</use_case> Generate a multi-step execution plan from a goal WITHOUT executing it. Returns the plan steps so you can review before executing. Use planner_execute_goal to plan + execute in one call.`",
  inputSchema: z.object({
    goal: z
      .string()
      .describe("Goal description in natural language"),
  }),
  handler: async (input, { planner, responseBuilder }) => {
    const plan = planner.createAutoPlan(input.goal);

    if (plan.steps.length === 0) {
      return responseBuilder.error(
        new Error(`Could not generate a plan for: "${input.goal}"`),
        {
          code: "PLAN_GENERATION_FAILED",
          suggestions: [
            "Try: login, debug, screenshot, form, checkout",
            "Use individual browser tools directly",
          ],
        },
      );
    }

    return responseBuilder.success({
      planId: plan.id,
      goal: plan.goal,
      steps: plan.steps.map((s) => ({
        id: s.id,
        description: s.description,
        tool: s.tool,
        input: s.input,
        dependsOn: s.dependsOn,
        timeoutMs: s.timeoutMs,
      })),
      totalSteps: plan.steps.length,
      createdAt: new Date(plan.createdAt).toISOString(),
    });
  },
});

// ─── planner_list_plans ─────────────────────────────────────────

export const plannerListPlans = createTool({
  name: "planner_list_plans",
  category: "planner",
  description: "List all previously created plans and their execution status.",
  inputSchema: z.object({}),
  handler: async (_input, { planner, responseBuilder }) => {
    const plans = planner.listPlans();
    return responseBuilder.success({
      totalPlans: plans.length,
      plans: plans.map((p) => ({
        id: p.id,
        goal: p.goal,
        status: p.status,
        steps: p.steps.length,
        createdAt: new Date(p.createdAt).toISOString(),
        completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null,
        currentStep: p.currentStepIndex,
      })),
    });
  },
});

// ─── planner_get_plan ───────────────────────────────────────────

export const plannerGetPlan = createTool({
  name: "planner_get_plan",
  category: "planner",
  description: "Get detailed info about a specific plan by ID.",
  inputSchema: z.object({
    planId: z.string().describe("Plan ID to retrieve"),
  }),
  handler: async (input, { planner, responseBuilder }) => {
    const plan = planner.getPlan(input.planId);
    if (!plan) {
      return responseBuilder.error(
        new Error(`Plan not found: ${input.planId}`),
        { code: "PLAN_NOT_FOUND" },
      );
    }
    return responseBuilder.success({
      id: plan.id,
      goal: plan.goal,
      status: plan.status,
      steps: plan.steps.map((s) => ({
        id: s.id,
        description: s.description,
        tool: s.tool,
        status: s.status,
        error: s.error ?? null,
        dependsOn: s.dependsOn,
        timeoutMs: s.timeoutMs,
      })),
      createdAt: new Date(plan.createdAt).toISOString(),
      completedAt: plan.completedAt ? new Date(plan.completedAt).toISOString() : null,
      currentStepIndex: plan.currentStepIndex,
    });
  },
});

// ─── planner_cancel_plan ────────────────────────────────────────

export const plannerCancelPlan = createTool({
  name: "planner_cancel_plan",
  category: "planner",
  description: "Cancel a running plan execution.",
  inputSchema: z.object({
    planId: z.string().describe("Plan ID to cancel"),
  }),
  handler: async (input, { planner, responseBuilder }) => {
    const cancelled = planner.cancelPlan(input.planId);
    if (!cancelled) {
      return responseBuilder.error(
        new Error(`Plan not found or not running: ${input.planId}`),
        { code: "PLAN_NOT_RUNNING" },
      );
    }
    return responseBuilder.success({
      cancelled: true,
      planId: input.planId,
    });
  },
});
