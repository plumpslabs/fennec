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
      /**
       * Auto-generate suggestions based on the error code and message (#99).
       * When true, the method enriches (but does not replace) the explicit
       * `suggestions` array with heuristic-driven next steps.
       */
      autoSuggest?: boolean;
    },
  ): ErrorResponse {
    const err = error instanceof Error ? error : new Error(String(error));
    const code = options?.code ?? 'UNKNOWN';
    const message = err.message;

    // Auto-generated suggestions (#99) — heuristic-driven next steps
    const autoSuggestions: string[] = [];
    if (options?.autoSuggest !== false) {
      if (code === 'ELEMENT_NOT_FOUND' || message.includes('not found') || message.includes('No element')) {
        autoSuggestions.push('Use browser_get_dom_snapshot to see available elements on the page');
      }
      if (code === 'ELEMENT_NOT_INTERACTABLE' || message.includes('interactable') || message.includes('visible')) {
        autoSuggestions.push('Try browser_scroll to bring the element into view first');
        autoSuggestions.push('Use browser_get_element_info to check element state (visible, enabled)');
      }
      if (code === 'REQUEST_TIMEOUT' || code === 'RESPONSE_TIMEOUT' || message.includes('timeout')) {
        autoSuggestions.push('Check if the page is loading correctly — use diagnose_page or observe()');
        autoSuggestions.push('Increase the timeout parameter if the operation legitimately takes longer');
      }
      if (code === 'NETWORK_INTERCEPT_FAILED' || message.includes('network') || message.includes('fetch')) {
        autoSuggestions.push('Use network_get_logs to check recent network activity');
      }
      if (code === 'CDP_ERROR' || message.includes('CDP') || message.includes('target')) {
        autoSuggestions.push('The browser page may have crashed or been closed — try browser_navigate to a URL');
      }
      if (message.includes('strict mode violation') || message.includes('resolved to')) {
        autoSuggestions.push('Use the index parameter to target a specific element when multiple match');
      }
      if (code === 'FORM_FILL_FAILED' || message.includes('form')) {
        autoSuggestions.push('Use browser_get_dom_snapshot to inspect the form structure');
      }
    }

    // Merge: explicit suggestions first, then auto-generated (deduplicated)
    const explicit = options?.suggestions ?? [];
    const merged = [...explicit];
    for (const s of autoSuggestions) {
      const lower = s.toLowerCase();
      if (!merged.some((existing) => existing.toLowerCase() === lower)) {
        merged.push(s);
      }
    }

    return {
      success: false,
      error: {
        code,
        message,
        suggestions: merged,
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
