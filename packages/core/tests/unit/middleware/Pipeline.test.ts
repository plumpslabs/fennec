import { describe, it, expect, beforeEach } from "vitest";
import { Pipeline } from "../../../src/middleware/Pipeline.js";
import type { MiddlewareFn, MiddlewareContext } from "../../../src/middleware/Pipeline.js";
import type { ToolDefinition, ToolContext } from "../../../src/tools/_registry.js";
import { z } from "zod";
import { createLogger } from "../../../src/utils/logger.js";

// Set up logger for tests
createLogger({ level: "error" });

function createMockTool(handler: (input: any, ctx: ToolContext) => any): ToolDefinition {
  return {
    name: "test_tool",
    description: "Test tool",
    inputSchema: z.object({}),
    handler: async (input, ctx) => handler(input, ctx),
  };
}

function createMockToolContext(): ToolContext {
  return {
    sessionManager: {
      getOrDefault: () => null,
      buildMeta: () => ({ elapsed: 0, sessionId: "test", timestamp: new Date().toISOString() }),
      getConsoleBuffer: () => [],
    } as any,
    responseBuilder: {
      success: (data: any) => ({ success: true, data, meta: {} }),
      error: (err: any) => ({ success: false, error: { code: "ERROR", message: String(err), suggestions: [], context: {} }, meta: {} }),
    } as any,
    config: {
      security: { sandbox: true, allowProcessSpawn: true, allowProcessKill: false, allowJSEvaluation: true, allowedDomains: [], blockedDomains: [], allowFileProtocol: false, allowCDPRawAccess: false, exportPath: "./exports", maxExportSizeMB: 10 },
      process: { spawnAllowlist: [], maxProcesses: 10, logBufferLines: 2000 },
    } as any,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    processManager: {} as any,
    logWatcher: {} as any,
    sessionStore: {} as any,
    resourceManager: {} as any,
    stateManager: {} as any,
    capabilityDetector: {} as any,
    planner: {} as any,
    workflowEngine: {} as any,
    recorder: {} as any,
    workflowScheduler: {} as any,
    eventBus: {} as any,
    lazyContext: {} as any,
  };
}

describe("Pipeline", () => {
  let pipeline: Pipeline;

  beforeEach(() => {
    pipeline = new Pipeline();
  });

  it("should execute a tool with no middleware", async () => {
    const tool = createMockTool(async () => ({ success: true, data: { result: "ok" } }));
    const result = await pipeline.execute(tool, {}, createMockToolContext());
    expect(result).toEqual({ success: true, data: { result: "ok" } });
  });

  it("should execute middleware in order", async () => {
    const order: number[] = [];

    pipeline.use(async (_ctx, next) => {
      order.push(1);
      const result = await next();
      order.push(4);
      return result;
    });

    pipeline.use(async (_ctx, next) => {
      order.push(2);
      const result = await next();
      order.push(3);
      return result;
    });

    const tool = createMockTool(async () => {
      order.push(5);
      return { success: true, data: {} };
    });

    await pipeline.execute(tool, {}, createMockToolContext());
    expect(order).toEqual([1, 2, 5, 3, 4]);
  });

  it("should pass context through middleware chain", async () => {
    pipeline.use(async (ctx, next) => {
      ctx.metadata["middleware1"] = "ran";
      return next();
    });

    let capturedCtx: MiddlewareContext | undefined;
    pipeline.use(async (ctx, next) => {
      ctx.metadata["middleware2"] = "ran";
      capturedCtx = ctx;
      return next();
    });

    const tool = createMockTool(async () => ({ success: true, data: {} }));
    await pipeline.execute(tool, {}, createMockToolContext());

    expect(capturedCtx?.metadata).toHaveProperty("middleware1", "ran");
    expect(capturedCtx?.metadata).toHaveProperty("middleware2", "ran");
  });

  it("should handle middleware that stops the chain", async () => {
    pipeline.use(async (_ctx, _next) => {
      return { success: true, data: { fromMiddleware: true } };
    });

    const tool = createMockTool(async () => ({ success: true, data: { fromTool: true } }));
    const result = await pipeline.execute(tool, {}, createMockToolContext());

    expect(result).toEqual({ success: true, data: { fromMiddleware: true } });
  });

  it("should propagate errors from middleware", async () => {
    pipeline.use(async (_ctx, _next) => {
      throw new Error("Middleware error");
    });

    const tool = createMockTool(async () => ({ success: true, data: {} }));
    await expect(pipeline.execute(tool, {}, createMockToolContext())).rejects.toThrow("Middleware error");
  });

  it("should record retry count in context", async () => {
    pipeline.use(async (ctx, next) => {
      ctx.retryCount = 2;
      return next();
    });

    let capturedCtx: MiddlewareContext | undefined;
    pipeline.use(async (ctx, next) => {
      capturedCtx = ctx;
      return next();
    });

    const tool = createMockTool(async () => ({ success: true, data: {} }));
    await pipeline.execute(tool, {}, createMockToolContext());

    expect(capturedCtx?.retryCount).toBe(2);
  });

  it("should handle empty middleware gracefully", async () => {
    const tool = createMockTool(async () => ({ success: true, data: { empty: true } }));
    const result = await pipeline.execute(tool, {}, createMockToolContext());
    expect(result).toEqual({ success: true, data: { empty: true } });
  });

  describe("middleware management", () => {
    it("should register middleware with use()", () => {
      const fn: MiddlewareFn = async (_ctx, next) => next();
      pipeline.use(fn);
      expect(pipeline.getMiddlewares()).toHaveLength(1);
    });

    it("should insert middleware before another", () => {
      const fn1: MiddlewareFn = async (_ctx, next) => next();
      const fn2: MiddlewareFn = async (_ctx, next) => next();
      const fn3: MiddlewareFn = async (_ctx, next) => next();

      pipeline.use(fn1);
      pipeline.use(fn3);
      pipeline.insertBefore(fn3, fn2);

      const middlewares = pipeline.getMiddlewares();
      expect(middlewares[0]).toBe(fn1);
      expect(middlewares[1]).toBe(fn2);
      expect(middlewares[2]).toBe(fn3);
    });

    it("should return false when inserting before non-existent middleware", () => {
      const fn: MiddlewareFn = async (_ctx, next) => next();
      expect(pipeline.insertBefore(fn, fn)).toBe(false);
    });

    it("should insert middleware after another", () => {
      const fn1: MiddlewareFn = async (_ctx, next) => next();
      const fn2: MiddlewareFn = async (_ctx, next) => next();

      pipeline.use(fn1);
      pipeline.insertAfter(fn1, fn2);

      expect(pipeline.getMiddlewares()[1]).toBe(fn2);
    });

    it("should remove middleware", () => {
      const fn1: MiddlewareFn = async (_ctx, next) => next();
      const fn2: MiddlewareFn = async (_ctx, next) => next();

      pipeline.use(fn1);
      pipeline.use(fn2);
      pipeline.remove(fn1);

      expect(pipeline.getMiddlewares()).toHaveLength(1);
      expect(pipeline.getMiddlewares()[0]).toBe(fn2);
    });

    it("should return false when removing non-existent middleware", () => {
      const fn: MiddlewareFn = async (_ctx, next) => next();
      expect(pipeline.remove(fn)).toBe(false);
    });

    it("should clear all middleware", () => {
      pipeline.use(async (_ctx, next) => next());
      pipeline.use(async (_ctx, next) => next());
      pipeline.clear();

      expect(pipeline.getMiddlewares()).toHaveLength(0);
    });
  });
});
