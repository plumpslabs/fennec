import { getLogger } from "../utils/logger.js";
import type { ToolDefinition, ToolContext } from "../tools/_registry.js";
import type { FennecSession } from "../session/types.js";
import type { FennecConfig } from "../config/defaults.js";
import type { WorkflowScheduler } from "../scheduler/WorkflowScheduler.js";
import type { StateManager } from "../state/index.js";

export interface MiddlewareContext {
  toolName: string;
  /** Tool category for grouping/filtering. Populated from ToolDefinition.category. */
  category: string | undefined;
  input: Record<string, unknown>;
  parsedInput: Record<string, unknown>;
  session: FennecSession | null;
  config: FennecConfig;
  startTime: number;
  retryCount: number;
  errors: Array<{ error: unknown; timestamp: number }>;
  metadata: Record<string, unknown>;
  /** Reference to scheduler so middleware can access auto-triggered workflow results */
  workflowScheduler: WorkflowScheduler | null;
  /** Reference to state manager so middleware can access session context info */
  stateManager: StateManager | null;
}

export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<Record<string, unknown>>,
) => Promise<Record<string, unknown>>;

export class Pipeline {
  private middlewares: MiddlewareFn[] = [];

  use(fn: MiddlewareFn): void {
    this.middlewares.push(fn);
  }

  insertBefore(target: MiddlewareFn, fn: MiddlewareFn): boolean {
    const idx = this.middlewares.indexOf(target);
    if (idx === -1) return false;
    this.middlewares.splice(idx, 0, fn);
    return true;
  }

  insertAfter(target: MiddlewareFn, fn: MiddlewareFn): boolean {
    const idx = this.middlewares.indexOf(target);
    if (idx === -1) return false;
    this.middlewares.splice(idx + 1, 0, fn);
    return true;
  }

  remove(fn: MiddlewareFn): boolean {
    const idx = this.middlewares.indexOf(fn);
    if (idx === -1) return false;
    this.middlewares.splice(idx, 1);
    return true;
  }

  clear(): void {
    this.middlewares = [];
  }

  async execute(
    tool: ToolDefinition,
    parsedInput: Record<string, unknown>,
    toolContext: ToolContext,
  ): Promise<Record<string, unknown>> {
    const logger = getLogger();

    const ctx: MiddlewareContext = {
      toolName: tool.name,
      category: tool.category,
      input: parsedInput,
      parsedInput,
      session: null,
      config: toolContext.config,
      startTime: Date.now(),
      retryCount: 0,
      errors: [],
      metadata: {},
      workflowScheduler: toolContext.workflowScheduler,
      stateManager: toolContext.stateManager,
    };

    // Try to get session if available
    try {
      ctx.session = toolContext.sessionManager.getOrDefault(
        (parsedInput as Record<string, string | undefined>).sessionId,
      );

      // Auto-detect context switches via StateManager
      if (ctx.session && toolContext.stateManager) {
        const sessionId = ctx.session.id;
        const switchEvent = toolContext.stateManager.setActiveSession(sessionId, {
          url: ctx.session.browser?.url() ?? undefined,
        });

        if (switchEvent) {
          logger.info(
            {
              fromSession: switchEvent.fromSessionId,
              toSession: switchEvent.toSessionId,
              tool: tool.name,
            },
            "Pipeline: context switch detected",
          );
        }
      }
    } catch {
      // Tools don't always need a session
    }

    // Build middleware chain
    const chain = [...this.middlewares];

    // Final handler is the tool itself
    const finalHandler: MiddlewareFn = async (mwCtx) => {
      logger.info({ tool: mwCtx.toolName, args: parsedInput }, "Middleware: executing tool handler");
      const result = await tool.handler(parsedInput, toolContext);
      return result as Record<string, unknown>;
    };

    // Execute middleware chain recursively
    const run = async (mwCtx: MiddlewareContext, idx: number): Promise<Record<string, unknown>> => {
      if (idx >= chain.length) {
        return finalHandler(mwCtx, async () => ({} as Record<string, unknown>));
      }
      const mw = chain[idx] as MiddlewareFn;
      return mw(mwCtx, () => run(mwCtx, idx + 1));
    };

    try {
      const result = await run(ctx, 0);
      return result;
    } catch (error) {
      logger.error({ tool: ctx.toolName, error }, "Middleware: pipeline execution failed");
      throw error;
    }
  }

  getMiddlewares(): MiddlewareFn[] {
    return [...this.middlewares];
  }
}
