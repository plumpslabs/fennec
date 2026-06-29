import { z } from "zod";
import { createTool } from "../_registry.js";

export const schedulerGetStats = createTool({
  name: "scheduler_get_stats",
  description:
    "`<use_case>Scheduler</use_case> Get Workflow Scheduler stats and recent trigger history. Returns rules count, total triggers, last trigger info, and recent history. Useful to see what auto-diagnosis workflows have been triggered by events like 500 errors or console errors.",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder, workflowScheduler }) => {
    const stats = workflowScheduler.getStats();
    return responseBuilder.success({
      totalRules: stats.totalRules,
      enabledRules: stats.enabledRules,
      totalTriggered: stats.totalTriggered,
      cooldownActive: stats.cooldownActive,
      lastTriggered: stats.lastTriggered
        ? {
            ruleName: stats.lastTriggered.ruleName,
            ruleId: stats.lastTriggered.ruleId,
            eventType: stats.lastTriggered.event.type,
            triggeredAt: new Date(stats.lastTriggered.triggeredAt).toISOString(),
            workflowId: stats.lastTriggered.workflowId,
            executionStatus: stats.lastTriggered.execution.status,
          }
        : null,
      recentTriggers: stats.recentTriggerHistory.map((t) => ({
        ruleName: t.ruleName,
        ruleId: t.ruleId,
        eventType: t.event.type,
        triggeredAt: new Date(t.triggeredAt).toISOString(),
        workflowId: t.workflowId,
        executionStatus: t.execution.status,
      })),
    });
  },
});

export const schedulerGetLastResult = createTool({
  name: "scheduler_get_last_result",
  description:
    "`<use_case>Scheduler</use_case> Get the most recent auto-triggered workflow execution result. Returns step results with diagnosis data, console logs, network failures, and screenshot if available. Useful when AI wants to see what the auto-diagnosis workflow already found.",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder, workflowScheduler }) => {
    const execution = workflowScheduler.getLastScheduledResult();
    if (!execution) {
      return responseBuilder.success({
        found: false,
        message: "No auto-triggered workflow results available yet",
      });
    }

    return responseBuilder.success({
      found: true,
      executionId: execution.id,
      workflowId: execution.workflowId,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      stepResults: execution.stepResults.map((sr) => ({
        stepId: sr.stepId,
        status: sr.status,
        result: sr.result,
        error: sr.error,
      })),
      contextSnapshot: execution.context,
    });
  },
});

export const schedulerTriggerRule = createTool({
  name: "scheduler_trigger_rule",
  description:
    "`<use_case>Scheduler</use_case> Manually trigger a scheduler rule by ID. This executes the associated workflow immediately, bypassing event matching. Returns the workflow execution result. Useful to re-run diagnosis or force a workflow execution.",
  inputSchema: z.object({
    ruleId: z.string().describe("ID of the rule to trigger"),
    context: z
      .record(z.unknown())
      .optional()
      .describe("Optional extra context to pass to the workflow"),
  }),
  handler: async (input, { responseBuilder, workflowScheduler }) => {
    const execution = await workflowScheduler.triggerRule(
      input.ruleId,
      input.context as Record<string, unknown> | undefined,
    );

    if (!execution) {
      return responseBuilder.error(
        new Error(`Rule not found or disabled: ${input.ruleId}`),
        {
          code: "RULE_NOT_FOUND",
          suggestions: [
            "Use scheduler_list_rules to see available rule IDs",
            "Check if the rule is enabled",
          ],
        },
      );
    }

    return responseBuilder.success({
      triggered: true,
      executionId: execution.id,
      workflowId: execution.workflowId,
      status: execution.status,
      stepResults: execution.stepResults.map((sr) => ({
        stepId: sr.stepId,
        status: sr.status,
        result: sr.result,
        error: sr.error,
      })),
    });
  },
});

export const schedulerListRules = createTool({
  name: "scheduler_list_rules",
  description:
    "`<use_case>Scheduler</use_case> List all registered scheduler trigger rules with their status. Shows rule ID, name, event type, priority, cooldown, and whether the rule is enabled. Useful to understand what auto-trigger rules are active.",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder, workflowScheduler }) => {
    const rules = workflowScheduler.listRules();
    return responseBuilder.success({
      count: rules.length,
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        enabled: r.enabled,
        eventType: r.eventType,
        priority: r.priority,
        cooldownMs: r.cooldownMs,
        workflowId: r.workflowId,
        injectToSmartHook: r.injectToSmartHook ?? false,
      })),
    });
  },
});

export const schedulerDisableRule = createTool({
  name: "scheduler_disable_rule",
  description:
    "`<use_case>Scheduler</use_case> Disable a scheduler trigger rule by ID. The rule will stop matching events until re-enabled. Useful to suppress noisy or unwanted auto-triggers.",
  inputSchema: z.object({
    ruleId: z.string().describe("ID of the rule to disable"),
  }),
  handler: async (input, { responseBuilder, workflowScheduler }) => {
    const success = workflowScheduler.setRuleEnabled(input.ruleId, false);
    if (!success) {
      return responseBuilder.error(
        new Error(`Rule not found: ${input.ruleId}`),
        { code: "RULE_NOT_FOUND" },
      );
    }
    return responseBuilder.success({ disabled: true, ruleId: input.ruleId });
  },
});

export const schedulerEnableRule = createTool({
  name: "scheduler_enable_rule",
  description:
    "`<use_case>Scheduler</use_case> Enable a previously disabled scheduler trigger rule by ID. The rule will resume matching events. Useful to re-activate a rule that was suppressed.",
  inputSchema: z.object({
    ruleId: z.string().describe("ID of the rule to enable"),
  }),
  handler: async (input, { responseBuilder, workflowScheduler }) => {
    const success = workflowScheduler.setRuleEnabled(input.ruleId, true);
    if (!success) {
      return responseBuilder.error(
        new Error(`Rule not found: ${input.ruleId}`),
        { code: "RULE_NOT_FOUND" },
      );
    }
    return responseBuilder.success({ enabled: true, ruleId: input.ruleId });
  },
});

export const schedulerClearHistory = createTool({
  name: "scheduler_clear_history",
  description:
    "`<use_case>Scheduler</use_case> Clear scheduler trigger history. Resets the stats and removes all recorded trigger events.",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder, workflowScheduler }) => {
    workflowScheduler.clearHistory();
    return responseBuilder.success({ cleared: true });
  },
});
