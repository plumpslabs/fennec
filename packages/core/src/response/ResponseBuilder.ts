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

export class ResponseBuilder {
  success<T = Record<string, unknown>>(data: T, meta?: Partial<SessionMeta>): SuccessResponse<T> {
    return {
      success: true,
      data,
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
        context: options?.context ?? {},
      },
      meta: {
        elapsed: options?.meta?.elapsed ?? 0,
        sessionId: options?.meta?.sessionId ?? '',
        timestamp: options?.meta?.timestamp ?? new Date().toISOString(),
      },
    };
  }
}
