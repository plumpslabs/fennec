import type { EventBus, BusEvent, EventType } from '../correlation/EventBus.js';
import type {
  WorkflowEngine,
  WorkflowStep,
  WorkflowExecution,
} from '../workflow/WorkflowEngine.js';
import { getLogger } from '../utils/logger.js';

/**
 * Function type for executing tool calls from scheduled workflows.
 * Receives the tool name and parsed input, returns the tool result.
 */
export type ToolExecutor = (toolName: string, input: Record<string, unknown>) => Promise<unknown>;

export type TriggerPriority = 'low' | 'medium' | 'high';

export interface TriggerCondition {
  /** Event data key to check (supports dot notation like "data.status") */
  field?: string;
  /** Expected value (exact match) */
  equals?: unknown;
  /** Pattern to test against (converted to RegExp) */
  matches?: string;
  /** Value must be greater than */
  gt?: number;
  /** Value must be less than */
  lt?: number;
  /** Value must be >= */
  gte?: number;
  /** Value must be <= */
  lte?: number;
  /** Check if field exists */
  exists?: boolean;
}

export interface TriggerRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** The EventType to subscribe to */
  eventType: EventType;
  /** Optional: multiple conditions (AND logic) */
  conditions?: TriggerCondition[];
  /** Custom condition function (if conditions array isn't enough) */
  conditionFn?: (event: BusEvent) => boolean;
  /** Workflow to trigger */
  workflowId: string;
  /** Cooldown in ms — prevents re-triggering within this window */
  cooldownMs: number;
  /** Priority: high runs before medium before low */
  priority: TriggerPriority;
  /** Template context to pass to the workflow execution */
  contextTemplate?: Record<string, unknown>;
  /** Whether to inject results into the SmartHook middleware context */
  injectToSmartHook?: boolean;
}

export interface TriggerEvent {
  ruleId: string;
  ruleName: string;
  event: BusEvent;
  workflowId: string;
  execution: WorkflowExecution;
  triggeredAt: number;
}

export interface SchedulerStats {
  totalRules: number;
  enabledRules: number;
  totalTriggered: number;
  lastTriggered: TriggerEvent | null;
  cooldownActive: number;
  recentTriggerHistory: TriggerEvent[];
}

type EventHandler = (event: BusEvent) => void;

/**
 * WorkflowScheduler connects EventBus → TriggerRules → WorkflowEngine.
 * It listens to events from the EventBus, matches them against trigger rules,
 * and automatically executes workflows when conditions are met.
 */
export class WorkflowScheduler {
  private eventBus: EventBus;
  private workflowEngine: WorkflowEngine;
  private rules: Map<string, TriggerRule> = new Map();
  private cooldowns: Map<string, number> = new Map(); // ruleId → next allowed timestamp
  private unsubscribers: Array<() => void> = [];
  private triggerHistory: TriggerEvent[] = [];
  private maxHistory = 100;
  private started = false;
  private scheduledWorkflows: Map<string, WorkflowExecution> = new Map();
  private toolExecutor: ToolExecutor | null = null;

  constructor(eventBus: EventBus, workflowEngine: WorkflowEngine) {
    this.eventBus = eventBus;
    this.workflowEngine = workflowEngine;
  }

  /**
   * Set a real tool executor so workflow steps can call tools through the pipeline.
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * Check if a real tool executor has been configured.
   */
  hasToolExecutor(): boolean {
    return this.toolExecutor !== null;
  }

  /**
   * Add a trigger rule.
   */
  addRule(rule: TriggerRule): void {
    this.rules.set(rule.id, rule);
    getLogger().info({ ruleId: rule.id, eventType: rule.eventType }, 'Scheduler: rule added');
  }

  /**
   * Add multiple trigger rules at once.
   */
  addRules(rules: TriggerRule[]): void {
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  /**
   * Remove a trigger rule by ID.
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get a trigger rule by ID.
   */
  getRule(ruleId: string): TriggerRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * List all trigger rules.
   */
  listRules(): TriggerRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Enable or disable a rule.
   */
  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    return true;
  }

  /**
   * Start listening for events and triggering workflows.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const logger = getLogger();

    // Group rules by event type so we only subscribe once per type
    const rulesByType = new Map<EventType, TriggerRule[]>();
    for (const [, rule] of this.rules) {
      if (!rule.enabled) continue;
      const existing = rulesByType.get(rule.eventType) ?? [];
      existing.push(rule);
      rulesByType.set(rule.eventType, existing);
    }

    // Subscribe to each event type
    for (const [eventType, rules] of rulesByType) {
      const handler: EventHandler = (event) => {
        this.handleEvent(event, rules).catch((err) => {
          logger.error({ eventType, err }, 'Scheduler: event handler failed');
        });
      };

      const unsubscribe = this.eventBus.subscribe(eventType, handler);
      this.unsubscribers.push(unsubscribe);
    }

    const totalRules = this.rules.size;
    const enabledRules = rulesByType.size;
    logger.info(
      { totalRules, enabledRules, subscribedTypes: Array.from(rulesByType.keys()) },
      'Scheduler: started',
    );
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.started = false;
    getLogger().info('Scheduler: stopped');
  }

  /**
   * Check if the scheduler is running.
   */
  isRunning(): boolean {
    return this.started;
  }

  /**
   * Get scheduler statistics and recent trigger history.
   */
  getStats(): SchedulerStats {
    const now = Date.now();
    let cooldownActive = 0;

    for (const [, nextAllowed] of this.cooldowns) {
      if (nextAllowed > now) cooldownActive++;
    }

    return {
      totalRules: this.rules.size,
      enabledRules: Array.from(this.rules.values()).filter((r) => r.enabled).length,
      totalTriggered: this.triggerHistory.length,
      lastTriggered: this.triggerHistory[this.triggerHistory.length - 1] ?? null,
      cooldownActive,
      recentTriggerHistory: this.triggerHistory.slice(-20),
    };
  }

  /**
   * Clear trigger history.
   */
  clearHistory(): void {
    this.triggerHistory = [];
  }

  /**
   * Manually trigger a rule by ID.
   */
  async triggerRule(
    ruleId: string,
    context?: Record<string, unknown>,
  ): Promise<WorkflowExecution | null> {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.enabled) return null;

    // Create a synthetic event
    const syntheticEvent: BusEvent = {
      type: rule.eventType,
      data: {},
      timestamp: Date.now(),
    };

    return this.executeWorkflow(rule, syntheticEvent, context);
  }

  /**
   * Handle an incoming EventBus event.
   */
  private async handleEvent(event: BusEvent, rules: TriggerRule[]): Promise<void> {
    // Sort by priority
    const sortedRules = [...rules]
      .filter((r) => r.enabled)
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));

    for (const rule of sortedRules) {
      if (!this.shouldTrigger(rule, event)) continue;

      await this.executeWorkflow(rule, event);
    }
  }

  /**
   * Check if a rule should trigger for a given event.
   */
  private shouldTrigger(rule: TriggerRule, event: BusEvent): boolean {
    // Check cooldown
    const now = Date.now();
    const nextAllowed = this.cooldowns.get(rule.id);
    if (nextAllowed && nextAllowed > now) {
      return false;
    }

    // Check custom condition function
    if (rule.conditionFn) {
      try {
        if (!rule.conditionFn(event)) return false;
      } catch {
        return false;
      }
    }

    // Check structured conditions (AND logic)
    if (rule.conditions && rule.conditions.length > 0) {
      for (const condition of rule.conditions) {
        if (!this.evaluateCondition(condition, event)) return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a single condition against an event.
   */
  private evaluateCondition(condition: TriggerCondition, event: BusEvent): boolean {
    let value: unknown;

    if (condition.field) {
      value = this.resolveField(event, condition.field);
    } else {
      value = event.data;
    }

    if (condition.exists !== undefined) {
      const exists = value !== undefined && value !== null;
      if (exists !== condition.exists) return false;
    }

    if (condition.equals !== undefined) {
      if (value !== condition.equals) return false;
    }

    if (condition.matches !== undefined && typeof value === 'string') {
      try {
        const regex = new RegExp(condition.matches, 'i');
        if (!regex.test(value)) return false;
      } catch {
        return false;
      }
    }

    if (typeof value === 'number') {
      if (condition.gt !== undefined && !(value > condition.gt)) return false;
      if (condition.lt !== undefined && !(value < condition.lt)) return false;
      if (condition.gte !== undefined && !(value >= condition.gte)) return false;
      if (condition.lte !== undefined && !(value <= condition.lte)) return false;
    }

    return true;
  }

  /**
   * Resolve a dot-notation field path from an event.
   */
  private resolveField(event: BusEvent, field: string): unknown {
    const parts = field.split('.');
    let current: unknown = event as unknown as Record<string, unknown>;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Execute a workflow for a matched rule.
   */
  private async executeWorkflow(
    rule: TriggerRule,
    event: BusEvent,
    extraContext?: Record<string, unknown>,
  ): Promise<WorkflowExecution | null> {
    const logger = getLogger();

    // Set cooldown
    this.cooldowns.set(rule.id, Date.now() + rule.cooldownMs);

    // Build execution context from event data + template + extra
    const initialContext: Record<string, unknown> = {
      triggerEvent: {
        type: event.type,
        data: event.data,
        timestamp: event.timestamp,
      },
      triggerRuleId: rule.id,
      triggerRuleName: rule.name,
      ...(rule.contextTemplate ?? {}),
      ...(extraContext ?? {}),
    };

    try {
      // Create an executor that maps WorkflowStep to actual tool calls
      // If a real tool executor is configured, use it for "execute" type steps
      const execution = await this.workflowEngine.execute(
        rule.workflowId,
        async (step: WorkflowStep, context: Record<string, unknown>) => {
          logger.info(
            { workflowId: rule.workflowId, stepId: step.id, stepType: step.type },
            'Scheduler: executing workflow step',
          );

          // For "execute" type steps, call the real tool via pipeline if available
          if (step.type === 'execute') {
            const toolName = step.params.tool as string | undefined;
            const toolInput = step.params.input as Record<string, unknown> | undefined;

            if (toolName && this.toolExecutor) {
              // Call the real tool through the pipeline
              return this.toolExecutor(toolName, toolInput ?? {});
            }

            if (toolName) {
              // Return structured info about what tool would be called
              return {
                tool: toolName,
                input: toolInput ?? {},
                scheduled: true,
                timestamp: Date.now(),
              };
            }
          }

          // For other step types, just return the step info
          return {
            stepId: step.id,
            type: step.type,
            params: step.params,
            scheduled: true,
            timestamp: Date.now(),
          };
        },
        initialContext,
      );

      // Record trigger
      const triggerEvent: TriggerEvent = {
        ruleId: rule.id,
        ruleName: rule.name,
        event,
        workflowId: rule.workflowId,
        execution,
        triggeredAt: Date.now(),
      };

      this.triggerHistory.push(triggerEvent);
      if (this.triggerHistory.length > this.maxHistory) {
        this.triggerHistory.shift();
      }

      // Store execution reference
      this.scheduledWorkflows.set(execution.id, execution);

      logger.info(
        {
          ruleId: rule.id,
          workflowId: rule.workflowId,
          executionStatus: execution.status,
        },
        'Scheduler: workflow triggered',
      );

      return execution;
    } catch (error) {
      logger.error(
        { ruleId: rule.id, workflowId: rule.workflowId, error },
        'Scheduler: workflow execution failed',
      );
      return null;
    }
  }

  /**
   * Get the most recent scheduled workflow result for a specific context.
   */
  getLastScheduledResult(contextKey?: string): WorkflowExecution | null {
    if (this.scheduledWorkflows.size === 0) return null;

    const executions = Array.from(this.scheduledWorkflows.values());
    const last = executions[executions.length - 1];
    return last ?? null;
  }

  /**
   * Check if there's an active workflow execution for a given rule.
   */
  isWorkflowRunning(ruleId: string): boolean {
    for (const [, execution] of this.scheduledWorkflows) {
      if (execution.status === 'running') {
        // Check if any execution was triggered by this rule
        const lastTrigger = [...this.triggerHistory].reverse().find((t) => t.ruleId === ruleId);
        if (lastTrigger && lastTrigger.execution.id === execution.id) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Clear all scheduled workflow results.
   */
  clearScheduledResults(): void {
    this.scheduledWorkflows.clear();
  }

  /**
   * Priority weight for sorting.
   */
  private priorityWeight(priority: TriggerPriority): number {
    switch (priority) {
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
    }
  }

  /**
   * Create default built-in trigger rules.
   */
  static createDefaultRules(debugWorkflowId: string): TriggerRule[] {
    return [
      {
        id: 'auto-debug-network-500',
        name: 'Auto Debug on Server Error (500)',
        description: 'Auto-trigger full diagnosis when a network request returns 500',
        enabled: true,
        eventType: 'browser:network',
        conditions: [{ field: 'data.status', equals: 500 }],
        workflowId: debugWorkflowId,
        cooldownMs: 15000,
        priority: 'high',
        contextTemplate: { autoFocus: 'errors', source: 'auto-trigger:500' },
        injectToSmartHook: true,
      },
      {
        id: 'auto-debug-network-401',
        name: 'Auto Debug on Auth Error (401)',
        description: 'Auto-trigger auth diagnosis on 401 errors',
        enabled: true,
        eventType: 'browser:network',
        conditions: [{ field: 'data.status', equals: 401 }],
        workflowId: debugWorkflowId,
        cooldownMs: 20000,
        priority: 'high',
        contextTemplate: { autoFocus: 'auth', source: 'auto-trigger:401' },
        injectToSmartHook: true,
      },
      {
        id: 'auto-debug-console-error',
        name: 'Auto Debug on Console Error',
        description: 'Auto-trigger diagnosis when JavaScript errors appear in console',
        enabled: true,
        eventType: 'browser:console',
        conditions: [{ field: 'data.level', equals: 'error' }],
        workflowId: debugWorkflowId,
        cooldownMs: 10000,
        priority: 'medium',
        contextTemplate: { autoFocus: 'errors', source: 'auto-trigger:console' },
        injectToSmartHook: true,
      },
      {
        id: 'auto-debug-server-error',
        name: 'Auto Debug on Server Stderr',
        description: 'Auto-trigger when server process writes errors to stderr',
        enabled: true,
        eventType: 'process:stderr',
        conditions: [
          { field: 'data.line', matches: 'error|Error|ERROR|exception|Exception|FATAL|fatal' },
        ],
        workflowId: debugWorkflowId,
        cooldownMs: 15000,
        priority: 'medium',
        contextTemplate: { autoFocus: 'errors', source: 'auto-trigger:stderr' },
        injectToSmartHook: true,
      },
      {
        id: 'auto-debug-process-exit',
        name: 'Auto Debug on Process Crash',
        description: 'Auto-trigger diagnosis when a managed process crashes unexpectedly',
        enabled: true,
        eventType: 'process:exit',
        conditions: [{ field: 'data.code', exists: true }],
        workflowId: debugWorkflowId,
        cooldownMs: 30000,
        priority: 'high',
        contextTemplate: { autoFocus: 'errors', source: 'auto-trigger:process-exit' },
        injectToSmartHook: true,
      },
    ];
  }
}
