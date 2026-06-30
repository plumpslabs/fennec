import type { MiddlewareFn } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";

export interface AuditEntry {
  id: string;
  timestamp: string;
  toolName: string;
  category: string | undefined;
  sessionId: string | null;
  input: Record<string, unknown>;
  result: { success: boolean; errorCode?: string } | null;
  durationMs: number;
}

/**
 * Create an audit log middleware that records all tool calls with
 * full context for security auditing and debugging.
 */
export function createAuditLog(options?: {
  /** Max entries to keep in memory. Default 5000. */
  maxEntries?: number;
  /** Whether to log audit entries to logger. Default true. */
  logToConsole?: boolean;
}): { middleware: MiddlewareFn; getAuditLog: (limit?: number) => AuditEntry[]; clearAuditLog: () => void } {
  const maxEntries = options?.maxEntries ?? 5000;
  const logToConsole = options?.logToConsole ?? true;
  const auditEntries: AuditEntry[] = [];
  const logger = getLogger();

  const getAuditLog = (limit = 100): AuditEntry[] => {
    return auditEntries.slice(-limit);
  };

  const clearAuditLog = (): void => {
    auditEntries.length = 0;
  };

  const middleware: MiddlewareFn = async (ctx, next) => {
    const startTime = Date.now();
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const result = await next();
      const durationMs = Date.now() - startTime;
      const resultObj = result as Record<string, unknown>;
      const isError = resultObj?.success === false;
      const errorCode = isError
        ? ((resultObj.error as Record<string, unknown> | undefined)?.code as string) ?? "UNKNOWN"
        : undefined;

      const entry: AuditEntry = {
        id,
        timestamp: new Date().toISOString(),
        toolName: ctx.toolName,
        category: ctx.category,
        sessionId: ctx.session?.id ?? null,
        input: ctx.input,
        result: { success: !isError, errorCode },
        durationMs,
      };

      auditEntries.push(entry);
      if (auditEntries.length > maxEntries) {
        auditEntries.splice(0, auditEntries.length - maxEntries);
      }

      if (logToConsole) {
        logger.info(
          {
            auditId: id,
            tool: ctx.toolName,
            durationMs,
            success: !isError,
            errorCode,
            sessionId: ctx.session?.id,
          },
          "AuditLog: tool call recorded",
        );
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      const entry: AuditEntry = {
        id,
        timestamp: new Date().toISOString(),
        toolName: ctx.toolName,
        category: ctx.category,
        sessionId: ctx.session?.id ?? null,
        input: ctx.input,
        result: { success: false, errorCode: "EXCEPTION" },
        durationMs,
      };

      auditEntries.push(entry);
      if (auditEntries.length > maxEntries) {
        auditEntries.splice(0, auditEntries.length - maxEntries);
      }

      if (logToConsole) {
        logger.error(
          {
            auditId: id,
            tool: ctx.toolName,
            durationMs,
            sessionId: ctx.session?.id,
            error: String(error),
          },
          "AuditLog: tool call failed with exception",
        );
      }

      throw error;
    }
  };

  return { middleware, getAuditLog, clearAuditLog };
}
