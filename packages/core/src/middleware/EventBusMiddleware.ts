/**
 * EventBusMiddleware — Routes all tool executions through the EventBus.
 *
 * Every tool execution publishes a `tool:executed` event on the EventBus
 * with the tool name, category, success/failure, and a one-line summary.
 * This allows the IncidentEngine to correlate tool calls with other events
 * (browser, network, process) for cross-layer reasoning.
 *
 * The middleware is minimal (~15 tokens added per tool call).
 */

import type { MiddlewareFn } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";
import type { EventBus } from "../correlation/EventBus.js";

export function createEventBusMiddleware(eventBus: EventBus): MiddlewareFn {
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    try {
      const resultObj = result as Record<string, unknown>;
      const success = resultObj?.success !== false;

      let summary = "";
      try {
        const s = JSON.stringify(resultObj ?? {});
        summary = s.slice(0, 120);
      } catch {
        summary = "(non-serializable)";
      }

      eventBus.publish("tool:executed", {
        toolName: ctx.toolName,
        category: ctx.category ?? "uncategorized",
        success,
        summary,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Best-effort — don't crash the tool response for event publishing
      logger.warn({ error }, "EventBusMiddleware: failed to publish tool event");
    }

    return result;
  };
}
