import { z } from "zod";
import { createTool } from "../_registry.js";

// ─── planner_execute_goal ───────────────────────────────────────

export const plannerExecuteGoal = createTool({
  name: "planner_execute_goal",
  category: "planner",
  description:
    "`<use_case>Planner</use_case> 🤖 AI-powered multi-step plan EXECUTION. Describe a goal in plain English and Fennec automatically: creates an execution plan → converts to workflow → executes every step. Supports: login flows, form filling, checkout, debugging, screenshots. Returns step-by-step results with per-step status (completed/failed/skipped). Use for complex multi-step tasks — like 'login to my app', 'debug the error on the page', 'fill the checkout form'. To review the plan before executing, use planner_create_plan first.`",
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
    "`<use_case>Planner</use_case> 📋 Generate a multi-step execution plan from a goal WITHOUT executing it. Returns plan steps with descriptions and tool assignments. Use to review what the planner WILL do before committing — safer than planner_execute_goal which plans AND executes. After reviewing, use planner_execute_goal with the same goal to run it.`",
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
  description:
    "`<use_case>Planner</use_case> 📚 List all plans that have been created with their execution status. Returns totalPlans, each with id, goal, status, steps count, timestamps. Use to track plan history, check previous execution results, or find a planId for planner_get_plan. Plans persist within the session.`",
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
  description:
    "`<use_case>Planner</use_case> 🔍 Get detailed info about a specific plan by ID. Returns full plan details: goal, all steps with their status and errors, timestamps, and current execution progress. Use after planner_execute_goal to see per-step results, or after planner_create_plan to review the full plan. Get planId from planner_list_plans.`",
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
  description:
    "`<use_case>Planner</use_case> ⏹️ Cancel a running plan execution by plan ID. Returns cancelled=true/false. Use when a plan is taking too long, stuck on a step, or you want to abort mid-execution. Only works on plans with status 'running'. Get planId from planner_list_plans. After cancellation, use planner_get_plan to see partial results.`",
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
