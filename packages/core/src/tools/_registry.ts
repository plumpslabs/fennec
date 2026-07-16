import type { z } from 'zod';
import type { SessionManager } from '../session/SessionManager.js';
import type { ResponseBuilder } from '../response/ResponseBuilder.js';
import type { FennecConfig } from '../config/defaults.js';
import type { ProcessManager } from '../process/ProcessManager.js';
import type { LogWatcher } from '../process/LogWatcher.js';
import type { SessionStore } from '../session/SessionStore.js';
import type { ResourceManager } from '../resource/ResourceManager.js';
import type { StateManager } from '../state/index.js';
import type { CapabilityDetector } from '../capability/Detector.js';
import type { Planner } from '../planner/Planner.js';
import type { WorkflowEngine } from '../workflow/WorkflowEngine.js';
import type { Recorder } from '../recorder/Recorder.js';
import type { WorkflowScheduler } from '../scheduler/WorkflowScheduler.js';
import type { EventBus } from '../correlation/EventBus.js';
import type { LazyContext } from '../middleware/LazyContext.js';
import type { IncidentEngine } from '../incident/IncidentEngine.js';
import type { PerformanceMetrics } from '../utils/PerformanceMetrics.js';
import type { FennecLogger } from '../utils/logger.js';

export interface ToolContext {
  sessionManager: SessionManager;
  responseBuilder: ResponseBuilder;
  config: FennecConfig;
  logger: FennecLogger;
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
  lazyContext: LazyContext;
  incidentEngine: IncidentEngine;
  performanceMetrics: PerformanceMetrics;
  toolRegistry?: ToolRegistry;
  tokenBudget?: { maxResponseTokens: number };
  /** Progress reporter for long-running tools — sends notifications to MCP client */
  progressReporter?: import('../utils/ProgressReporter.js').ProgressReporter;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  /**
   * Tool category for grouping and selective loading.
   * Clients can request only specific categories to reduce context window usage.
   */
  category?: string;
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

  /**
   * Get all tool categories that have at least one registered tool.
   */
  getCategories(): string[] {
    const cats = new Set<string>();
    for (const tool of this.tools.values()) {
      if (tool.category) cats.add(tool.category);
    }
    return Array.from(cats).sort();
  }

  /**
   * Get tools filtered by one or more categories.
   * If categories is empty, returns ALL tools (backward compatible).
   */
  getByCategories(categories?: string[]): ToolDefinition[] {
    if (!categories || categories.length === 0) {
      return this.getAll();
    }
    const catSet = new Set(categories);
    return Array.from(this.tools.values()).filter((t) => t.category && catSet.has(t.category));
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
