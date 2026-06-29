import { randomUUID } from "node:crypto";

export type WorkflowStepType =
  | "navigate"
  | "click"
  | "type"
  | "wait"
  | "assert"
  | "screenshot"
  | "execute"
  | "subflow";

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  description: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  retryOnFailure: boolean;
  maxRetries: number;
  onFailure?: "abort" | "skip" | "retry";
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  author?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  stepResults: Array<{
    stepId: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    startedAt?: string;
    completedAt?: string;
    result?: unknown;
    error?: string;
  }>;
  context: Record<string, unknown>;
}

export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private storagePath: string;

  constructor(storagePath = "./.fennec/workflows") {
    this.storagePath = storagePath;
  }

  /**
   * Register a workflow definition.
   */
  register(workflow: Omit<Workflow, "id" | "createdAt" | "updatedAt">): Workflow {
    const now = new Date().toISOString();
    const wf: Workflow = {
      ...workflow,
      id: `wf_${randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    this.workflows.set(wf.id, wf);
    return wf;
  }

  /**
   * Get a workflow by ID.
   */
  get(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * List all registered workflows.
   */
  list(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Find workflows by tag.
   */
  findByTag(tag: string): Workflow[] {
    return this.list().filter((w) => w.tags.includes(tag));
  }

  /**
   * Remove a workflow.
   */
  remove(id: string): boolean {
    return this.workflows.delete(id);
  }

  /**
   * Create a built-in debugging workflow.
   */
  createDebugWorkflow(name: string): Workflow {
    return this.register({
      name,
      description: "Full-stack diagnostic workflow: check browser state, console, network, and server logs",
      version: "1.0.0",
      tags: ["diagnostic", "built-in"],
      steps: [
        {
          id: "check_url",
          type: "execute",
          description: "Get current page URL and title",
          params: { tool: "browser_get_current_url", input: {} },
          timeoutMs: 5000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "abort",
        },
        {
          id: "check_console",
          type: "execute",
          description: "Get browser console errors",
          params: { tool: "devtools_get_console_logs", input: { level: "error", limit: 10 } },
          timeoutMs: 5000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "skip",
        },
        {
          id: "check_network",
          type: "execute",
          description: "Get failed network requests",
          params: { tool: "network_get_failed_requests", input: {} },
          timeoutMs: 5000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "skip",
        },
        {
          id: "take_screenshot",
          type: "screenshot",
          description: "Capture page screenshot",
          params: { fullPage: false },
          timeoutMs: 10000,
          retryOnFailure: true,
          maxRetries: 1,
          onFailure: "skip",
        },
        {
          id: "summarize",
          type: "execute",
          description: "Run full-stack diagnosis with correlation",
          params: { tool: "diagnose_fullstack", input: {} },
          timeoutMs: 15000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "skip",
        },
      ],
    });
  }

  /**
   * Create a login workflow.
   */
  createLoginWorkflow(name: string): Workflow {
    return this.register({
      name,
      description: "Login to a web application with credentials",
      version: "1.0.0",
      tags: ["auth", "built-in"],
      steps: [
        {
          id: "navigate",
          type: "navigate",
          description: "Navigate to login page",
          params: { url: "" },
          timeoutMs: 30000,
          retryOnFailure: true,
          maxRetries: 1,
          onFailure: "abort",
        },
        {
          id: "fill_username",
          type: "type",
          description: "Fill username/email",
          params: { selector: 'input[type="email"], input[name*="user"]', text: "", clear: true },
          timeoutMs: 10000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "abort",
        },
        {
          id: "fill_password",
          type: "type",
          description: "Fill password",
          params: { selector: 'input[type="password"]', text: "", clear: true },
          timeoutMs: 10000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "abort",
        },
        {
          id: "submit",
          type: "click",
          description: "Click submit button",
          params: { selector: 'button[type="submit"]' },
          timeoutMs: 15000,
          retryOnFailure: true,
          maxRetries: 2,
          onFailure: "abort",
        },
        {
          id: "verify",
          type: "assert",
          description: "Verify successful login",
          params: { tool: "auth_check_logged_in", expected: { loggedIn: true } },
          timeoutMs: 10000,
          retryOnFailure: false,
          maxRetries: 0,
          onFailure: "abort",
        },
      ],
    });
  }

  /**
   * Execute a workflow.
   */
  async execute(
    workflowId: string,
    executor: (step: WorkflowStep, context: Record<string, unknown>) => Promise<unknown>,
    initialContext: Record<string, unknown> = {},
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const execution: WorkflowExecution = {
      id: `exec_${randomUUID().slice(0, 8)}`,
      workflowId,
      status: "running",
      startedAt: new Date().toISOString(),
      currentStepIndex: 0,
      stepResults: workflow.steps.map((s) => ({
        stepId: s.id,
        status: "pending",
      })),
      context: { ...initialContext },
    };

    this.executions.set(execution.id, execution);

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]!;
      execution.currentStepIndex = i;
      const result = execution.stepResults[i]!;
      result.status = "running";
      result.startedAt = new Date().toISOString();

      let attempts = 0;
      const maxAttempts = step.retryOnFailure ? step.maxRetries + 1 : 1;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const stepResult = await executor(step, execution.context);
          result.status = "completed";
          result.result = stepResult;
          result.completedAt = new Date().toISOString();

          // Store result in context for later steps
          execution.context[step.id] = stepResult;
          break;
        } catch (error) {
          if (attempts >= maxAttempts) {
            result.error = String(error);
            result.completedAt = new Date().toISOString();

            if (step.onFailure === "skip") {
              result.status = "skipped";
              // Skip — continue to next step
            } else {
              result.status = "failed";
              if (step.onFailure === "abort") {
                execution.status = "failed";
                execution.completedAt = new Date().toISOString();
                return execution;
              }
            }
          }
        }
      }
    }

    execution.status = execution.stepResults.every(
      (r) => r.status === "completed" || r.status === "skipped",
    )
      ? "completed"
      : "failed";
    execution.completedAt = new Date().toISOString();

    return execution;
  }

  /**
   * Get execution status.
   */
  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }

  /**
   * List all executions.
   */
  listExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Save workflows to disk.
   */
  async persist(): Promise<void> {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(this.storagePath, { recursive: true });

    for (const [, workflow] of this.workflows) {
      const filePath = join(this.storagePath, `${workflow.id}.json`);
      writeFileSync(filePath, JSON.stringify(workflow, null, 2), "utf-8");
    }
  }

  /**
   * Load workflows from disk.
   */
  async load(): Promise<void> {
    const { existsSync, readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    if (!existsSync(this.storagePath)) return;

    const files = readdirSync(this.storagePath).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = readFileSync(join(this.storagePath, file), "utf-8");
        const workflow = JSON.parse(content) as Workflow;
        this.workflows.set(workflow.id, workflow);
      } catch {
        // Skip corrupted files
      }
    }
  }
}
