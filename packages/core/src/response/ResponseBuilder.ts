import type { SessionMeta } from '../session/types.js';

export interface SuccessResponse<T = Record<string, unknown>> {
  success: true;
  data: T;
  meta: SessionMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    suggestions: string[];
    context: Record<string, unknown>;
  };
  meta: SessionMeta;
}

export type ToolResponse<T = Record<string, unknown>> = SuccessResponse<T> | ErrorResponse;

/**
 * Strip circular references and non-serializable values (functions, live
 * Playwright handles, the ToolContext, etc.) from a tool result before it
 * reaches the JSON-RPC transport.
 *
 * Why: some handlers (e.g. workflow results, or a tool that accidentally
 * embeds the `context` object) produce object graphs with cycles
 * (`context.take_screenshot` → back to the result). `JSON.stringify` throws
 * "Converting circular structure to JSON", which is a hard MCP protocol
 * violation — it breaks the agent's tool-call loop, not just a cosmetic glitch.
 * Sanitizing here guarantees every tool result is serializable.
 */
export function sanitize<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (val: unknown): unknown => {
    if (val === null || typeof val !== 'object') return val;
    if (val instanceof Date) return val.toISOString();
    // Objects with a custom toJSON (e.g. some Playwright wrappers) serialize cleanly.
    if (typeof (val as { toJSON?: unknown }).toJSON === 'function') {
      try {
        return (val as { toJSON: () => unknown }).toJSON();
      } catch {
        return '[Unserializable]';
      }
    }
    if (seen.has(val as object)) return '[Circular]';
    seen.add(val as object);
    if (Array.isArray(val)) return val.map(walk);
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (typeof v === 'function') continue; // drop functions — not serializable
      try {
        out[k] = walk(v);
      } catch {
        out[k] = '[Unserializable]';
      }
    }
    return out;
  };
  return walk(value) as T;
}

export class ResponseBuilder {
  success<T = Record<string, unknown>>(data: T, meta?: Partial<SessionMeta>): SuccessResponse<T> {
    return {
      success: true,
      data: sanitize(data),
      meta: {
        elapsed: meta?.elapsed ?? 0,
        sessionId: meta?.sessionId ?? '',
        timestamp: meta?.timestamp ?? new Date().toISOString(),
      },
    };
  }

  error(
    error: unknown,
    options?: {
      code?: string;
      suggestions?: string[];
      context?: Record<string, unknown>;
      meta?: Partial<SessionMeta>;
    },
  ): ErrorResponse {
    const err = error instanceof Error ? error : new Error(String(error));

    return {
      success: false,
      error: {
        code: options?.code ?? 'UNKNOWN',
        message: err.message,
        suggestions: options?.suggestions ?? [],
        context: sanitize(options?.context ?? {}),
      },
      meta: {
        elapsed: options?.meta?.elapsed ?? 0,
        sessionId: options?.meta?.sessionId ?? '',
        timestamp: options?.meta?.timestamp ?? new Date().toISOString(),
      },
    };
  }
}
