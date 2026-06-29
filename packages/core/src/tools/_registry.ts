import type { z } from "zod";
import type { SessionManager } from "../session/SessionManager.js";
import type { ResponseBuilder } from "../response/ResponseBuilder.js";
import type { FennecConfig } from "../config/defaults.js";
import type { ProcessManager } from "../process/ProcessManager.js";
import type { LogWatcher } from "../process/LogWatcher.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { ResourceManager } from "../resource/ResourceManager.js";
import type { StateManager } from "../state/index.js";
import type { CapabilityDetector } from "../capability/Detector.js";
import type { Planner } from "../planner/Planner.js";
import type { WorkflowEngine } from "../workflow/WorkflowEngine.js";
import type { Recorder } from "../recorder/Recorder.js";
import type { WorkflowScheduler } from "../scheduler/WorkflowScheduler.js";
import type { EventBus } from "../correlation/EventBus.js";
import type pino from "pino";

export interface ToolContext {
  sessionManager: SessionManager;
  responseBuilder: ResponseBuilder;
  config: FennecConfig;
  logger: pino.Logger;
  processManager: ProcessManager;
  logWatcher: LogWatcher;
  sessionStore: SessionStore;
  // New architecture modules
  resourceManager: ResourceManager;
  stateManager: StateManager;
  capabilityDetector: CapabilityDetector;
  planner: Planner;
  workflowEngine: WorkflowEngine;
  recorder: Recorder;
  workflowScheduler: WorkflowScheduler;
  eventBus: EventBus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

export class ToolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tools: Map<string, ToolDefinition<any, any>> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(tool: ToolDefinition<any, any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export function createTool<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return definition;
}
