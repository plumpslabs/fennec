import type { MiddlewareFn } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";
import type { PerformanceMetrics } from "../utils/PerformanceMetrics.js";

export function createTelemetryMiddleware(metrics?: PerformanceMetrics): MiddlewareFn {
  const logger = getLogger();

  return async (ctx, next) => {
    const toolName = ctx.toolName;
    const startTime = Date.now();

    logger.info(
      {
        tool: toolName,
        args: sanitizeArgs(ctx.input),
        sessionId: ctx.session?.id ?? null,
      },
      "Telemetry: tool started",
    );

    try {
      const result = await next();
      const duration = Date.now() - startTime;

      const isError =
        result &&
        typeof result === "object" &&
        "success" in result &&
        result.success === false;

      const errorCode: string | undefined = isError
        ? String(((result as Record<string, unknown>).error as Record<string, unknown> | undefined)
            ?.code ?? "UNKNOWN")
        : undefined;

      logger.info(
        {
          tool: toolName,
          durationMs: duration,
          isError: !!isError,
          errorCode: errorCode ?? null,
        },
        "Telemetry: tool completed",
      );

      // Record performance metric
      if (metrics) {
        metrics.recordToolCall({
          toolName,
          category: ctx.category,
          durationMs: duration,
          success: !isError,
          errorCode,
          timestamp: Date.now(),
          sessionId: ctx.session?.id,
        });
      }

      // Attach elapsed time to meta
      const resultObj = result as Record<string, unknown>;
      if (resultObj.meta && typeof resultObj.meta === "object") {
        (resultObj.meta as Record<string, unknown>).elapsed = duration;
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          tool: toolName,
          durationMs: duration,
          error: String(error),
        },
        "Telemetry: tool failed",
      );

      // Record failure metric
      if (metrics) {
        metrics.recordToolCall({
          toolName,
          category: ctx.category,
          durationMs: duration,
          success: false,
          errorCode: "EXCEPTION",
          timestamp: Date.now(),
          sessionId: ctx.session?.id,
        });
      }

      throw error;
    }
  };
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = ["password", "token", "secret", "apiKey", "api_key", "authorization", "auth"];

  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = "***REDACTED***";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
