import type { MiddlewareFn } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";
import { takeScreenshot } from "../utils/screenshot.js";

export function createSmartHook(): MiddlewareFn {
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    const resultObj = result as Record<string, unknown>;
    const isError =
      resultObj &&
      "success" in resultObj &&
      resultObj.success === false;

    if (!isError) {
      return result;
    }

    const errorObj = resultObj.error as Record<string, unknown> | undefined;
    const errorCode = (errorObj?.code as string) ?? "UNKNOWN";

    logger.info(
      { tool: ctx.toolName, errorCode },
      "SmartHook: error detected, collecting context",
    )

    // === StateManager Context ===
    // Inject current session context info so AI knows which session/context it's in
    let contextSwitchInfo: Record<string, unknown> | null = null;
    if (ctx.stateManager) {
      const activeInfo = ctx.stateManager.getActiveSessionInfo();
      if (activeInfo) {
        contextSwitchInfo = {
          activeSessionId: activeInfo.sessionId,
          activeSessionUrl: activeInfo.url ?? null,
          activeSessionTitle: activeInfo.title ?? null,
        };
      }

      // Get all session states to show AI what's available
      const allStates = ctx.stateManager.getAllStates();
      if (allStates.length > 0) {
        if (!contextSwitchInfo) contextSwitchInfo = {};
        contextSwitchInfo.availableSessions = allStates.map((s) => ({
          sessionId: s.sessionId,
          state: s.state,
          idleSec: Math.round(s.idleMs / 1000),
        }));
      }
    }
    // === End StateManager Context ===
;

    // If session available, auto-collect debug evidence
    let enrichedContext: Record<string, unknown> = {};

    if (ctx.session) {
      const page = ctx.session.page;
      if (page) {
        try {
          // Collect evidence in parallel (no isClosed guard — try regardless)
          const [url, screenshot] = await Promise.allSettled([
            page.url(),
            takeScreenshot(page).catch(() => null),
          ]);

          if (url.status === "fulfilled") {
            enrichedContext.currentUrl = url.value;
          }
          if (screenshot.status === "fulfilled" && screenshot.value) {
            enrichedContext.screenshot = screenshot.value.base64;
          }

          // Get page title
          try {
            enrichedContext.pageTitle = await page.title();
          } catch { /* ignore */ }

          // Get console errors from session buffer
          const errors = ctx.session.consoleBuffer
            .filter((l) => l.level === "error")
            .slice(-5)
            .map((l) => `[${l.level}] ${l.message}`);

          if (errors.length > 0) {
            enrichedContext.consoleLogs = errors;
          }

          // Get recent network failures
          const networkFailures = ctx.session.networkBuffer
            .filter((r) => r.status >= 400)
            .slice(-5)
            .map((r) => `${r.method} ${r.url} -> ${r.status}`);

          if (networkFailures.length > 0) {
            enrichedContext.networkFailures = networkFailures;
          }
        } catch {
          // Enrichment is best-effort
        }
      }

      // For ELEMENT_NOT_FOUND: inject URL + title prominently so AI knows current page
      if (errorCode === "ELEMENT_NOT_FOUND") {
        enrichedContext.url = enrichedContext.currentUrl ?? "unknown";
        enrichedContext.title = enrichedContext.pageTitle ?? "unknown";
        enrichedContext.message =
          `Element not found on page: ${enrichedContext.url} ("${enrichedContext.title}"). ` +
          `Use browser_get_dom_snapshot to see available elements.`;
      }
    }

    // === Scheduler Integration ===
    // Check if the scheduler has auto-triggered any workflow results
    // that could provide pre-computed diagnosis for this error context
    if (ctx.workflowScheduler) {
      try {
        const lastResult = ctx.workflowScheduler.getLastScheduledResult();
        if (lastResult && lastResult.status === "completed") {
          const age = Date.now() - new Date(lastResult.completedAt!).getTime();
          // Only use results from the last 60 seconds
          if (age < 60000) {
            enrichedContext.autoDiagnosis = {
              workflowId: lastResult.workflowId,
              executionId: lastResult.id,
              completedAt: lastResult.completedAt,
              stepResults: lastResult.stepResults.map((sr) => ({
                stepId: sr.stepId,
                status: sr.status,
                result: sr.result,
                error: sr.error,
              })),
              contextSnapshot: lastResult.context,
            };

            logger.info(
              { executionId: lastResult.id, workflowId: lastResult.workflowId },
              "SmartHook: injected auto-triggered diagnosis result",
            );
          }
        }

        // Also check scheduler stats for recent triggers
        const stats = ctx.workflowScheduler.getStats();
        if (stats.lastTriggered) {
          const triggerAge = Date.now() - stats.lastTriggered.triggeredAt;
          if (triggerAge < 30000) {
            enrichedContext.recentTrigger = {
              ruleName: stats.lastTriggered.ruleName,
              ruleId: stats.lastTriggered.ruleId,
              eventType: stats.lastTriggered.event.type,
              triggeredAt: new Date(stats.lastTriggered.triggeredAt).toISOString(),
            };
          }
        }
      } catch (schedulerError) {
        // Scheduler integration is best-effort
        logger.warn({ error: schedulerError }, "SmartHook: failed to check scheduler results");
      }
    }
    // === End Scheduler Integration ===

    // For ELEMENT_NOT_FOUND: inject URL as top-level field for AI visibility
    if (errorCode === "ELEMENT_NOT_FOUND" && enrichedContext.url) {
      (resultObj as Record<string, unknown>).currentUrl = enrichedContext.url;
      (resultObj as Record<string, unknown>).pageTitle = enrichedContext.title;
    }

    // Inject context switch / session info into enriched context
    if (contextSwitchInfo) {
      enrichedContext.sessionContext = contextSwitchInfo;

      // Also inject as top-level field so AI immediately sees it
      (resultObj as Record<string, unknown>).sessionContext = contextSwitchInfo;
    }

    // Attach enriched context to error response
    if (errorObj && Object.keys(enrichedContext).length > 0) {
      errorObj.context = {
        ...(errorObj.context as Record<string, unknown> ?? {}),
        ...enrichedContext,
      };
    }

    return result;
  };
}
