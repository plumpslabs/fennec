import type { MiddlewareFn, MiddlewareContext, ToolResult } from './Pipeline.js';
import { getLogger } from '../utils/logger.js';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: Array<{ code?: string; messagePattern?: string }>;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
  retryableErrors: [
    { code: 'ELEMENT_NOT_FOUND' },
    { code: 'ELEMENT_NOT_INTERACTABLE' },
    { code: 'NAVIGATION_TIMEOUT' },
    { code: 'TIMEOUT' },
    { code: 'REQUEST_TIMEOUT' },
    { code: 'NETWORK_INTERCEPT_FAILED' },
    { messagePattern: 'timeout' },
    { messagePattern: 'net::ERR_' },
    { messagePattern: 'Target closed' },
    { messagePattern: 'Protocol error' },
    { messagePattern: 'Session closed' },
  ],
};

function isRetryable(error: unknown, retryableErrors: RetryConfig['retryableErrors']): boolean {
  const errorStr = String(error);
  const err = error as { code?: string };
  const errorCode = err.code;

  for (const rule of retryableErrors) {
    if (rule.code && errorCode === rule.code) return true;
    if (rule.messagePattern && errorStr.toLowerCase().includes(rule.messagePattern.toLowerCase()))
      return true;
  }

  return false;
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

export function createRetryHandler(config: Partial<RetryConfig> = {}): MiddlewareFn {
  const retryConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const logger = getLogger();

  return async (ctx: MiddlewareContext, next) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      ctx.retryCount = attempt;

      if (attempt > 0) {
        const delay = calculateDelay(attempt - 1, retryConfig.baseDelayMs, retryConfig.maxDelayMs);
        logger.info(
          { tool: ctx.toolName, attempt, maxRetries: retryConfig.maxRetries, delayMs: delay },
          'RetryHandler: retrying tool execution',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const result = await next();
        // If this was a retry and it succeeded, mark it
        if (attempt > 0) {
          const r = result as ToolResult;
          r.retried = true;
          r.retryCount = attempt;
        }
        return result;
      } catch (error) {
        lastError = error;

        // Check if error is retryable by inspecting the result structure
        const errorResult = error as ToolResult;
        const errorCode = errorResult.error?.code;

        if (errorCode) {
          // Check if contains a retryable error code
          const isRetryableCode = retryConfig.retryableErrors.some((r) => r.code === errorCode);
          if (isRetryableCode && attempt < retryConfig.maxRetries) {
            logger.info(
              { tool: ctx.toolName, errorCode, attempt },
              'RetryHandler: retryable error, will retry',
            );
            continue;
          }
        }

        // Check if error message is retryable
        if (isRetryable(error, retryConfig.retryableErrors) && attempt < retryConfig.maxRetries) {
          logger.info(
            { tool: ctx.toolName, error: String(error), attempt },
            'RetryHandler: retryable error, will retry',
          );
          continue;
        }

        // Non-retryable error or out of retries
        if (attempt >= retryConfig.maxRetries) {
          logger.warn(
            { tool: ctx.toolName, attempts: attempt + 1 },
            'RetryHandler: max retries exceeded',
          );
        }
        throw error;
      }
    }

    throw lastError;
  };
}
