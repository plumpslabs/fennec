import { z } from "zod";
import { createTool } from "../_registry.js";

export const schedulerGetStats = createTool({
  name: "scheduler_get_stats",
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> 📊 Get scheduler stats and recent trigger history. Returns: rules count, enabled rules, total triggered, cooldown status, last trigger info with workflow execution status. Use to see what auto-diagnosis workflows have been triggered by events (500 errors, console errors). Good first step before scheduler_list_rules to understand scheduler activity.`",
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
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> 🔍 Get the most recent auto-triggered workflow execution result. Returns step results with diagnosis data, console logs, network failures, and screenshots (if available). Use when the scheduler auto-triggered a diagnosis workflow (e.g., on 500 error) and you want to see what it found. If no auto-triggered execution exists, returns found=false.`",
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
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> ▶️ Manually trigger a scheduler rule by ID — executes the associated workflow immediately, bypassing event matching. Returns the workflow execution with step results. Use to force-run diagnosis on demand, re-test after fixing an issue, or manually invoke an auto-diagnosis rule. Get ruleId from scheduler_list_rules.`",
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
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> 📋 List all registered scheduler trigger rules. Shows: rule ID, name, description, enabled status, event type (e.g., 'network:error', 'console:error'), priority, cooldown ms, and associated workflow. Use to discover what auto-trigger rules exist. Disable noisy rules with scheduler_disable_rule. Check stats with scheduler_get_stats.`",
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
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> ⏹️ Disable a scheduler trigger rule by ID — stops it from matching events until re-enabled. Returns disabled=true/false. Use to suppress noisy rules, prevent auto-triggers during testing, or temporarily disable unwanted diagnosis. Get ruleId from scheduler_list_rules. Re-enable with scheduler_enable_rule.`",
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
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> ✅ Enable a previously disabled scheduler trigger rule by ID — resumes event matching. Returns enabled=true/false. Use to re-activate rules that were suppressed with scheduler_disable_rule. Get ruleId from scheduler_list_rules. After enabling, the rule will match and trigger on matching events again.`",
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
  category: "scheduler",
  description:
    "`<use_case>Scheduler</use_case> 🧹 Clear scheduler trigger history — resets all stats and removes recorded trigger events. Returns cleared=true. Use to reset state for a clean slate, e.g., after investigating a batch of auto-triggered diagnoses. Doesn't affect rules or their enabled/disabled status — only clears the history log.`",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder, workflowScheduler }) => {
    workflowScheduler.clearHistory();
    return responseBuilder.success({ cleared: true });
  },
});
