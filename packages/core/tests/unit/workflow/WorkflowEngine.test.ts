import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '../../../src/workflow/WorkflowEngine.js';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine('/tmp/fennec-test-workflows');
  });

  describe('register', () => {
    it('should register a workflow', () => {
      const wf = engine.register({
        name: 'Test Workflow',
        description: 'A test workflow',
        version: '1.0.0',
        tags: ['test'],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Navigate to page',
            params: { url: 'https://example.com' },
            timeoutMs: 30000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
        ],
      });

      expect(wf.id).toBeDefined();
      expect(wf.name).toBe('Test Workflow');
      expect(wf.createdAt).toBeDefined();
      expect(wf.updatedAt).toBeDefined();
    });
  });

  describe('get and list', () => {
    it('should get a workflow by ID', () => {
      const wf = engine.register({
        name: 'Test',
        description: 'Test workflow',
        version: '1.0.0',
        tags: [],
        steps: [],
      });
      expect(engine.get(wf.id)?.name).toBe('Test');
    });

    it('should return undefined for unknown workflow', () => {
      expect(engine.get('nonexistent')).toBeUndefined();
    });

    it('should list all workflows', () => {
      engine.register({ name: 'WF1', description: '', version: '1.0.0', tags: [], steps: [] });
      engine.register({ name: 'WF2', description: '', version: '1.0.0', tags: [], steps: [] });
      expect(engine.list()).toHaveLength(2);
    });
  });

  describe('findByTag', () => {
    it('should find workflows by tag', () => {
      engine.register({
        name: 'Debug',
        description: '',
        version: '1.0.0',
        tags: ['diagnostic', 'built-in'],
        steps: [],
      });
      engine.register({
        name: 'Other',
        description: '',
        version: '1.0.0',
        tags: ['other'],
        steps: [],
      });
      expect(engine.findByTag('diagnostic')).toHaveLength(1);
      expect(engine.findByTag('built-in')).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('should remove a workflow', () => {
      const wf = engine.register({
        name: 'Test',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [],
      });
      expect(engine.remove(wf.id)).toBe(true);
      expect(engine.get(wf.id)).toBeUndefined();
    });

    it('should return false for unknown workflow', () => {
      expect(engine.remove('nonexistent')).toBe(false);
    });
  });

  describe('createDebugWorkflow', () => {
    it('should create a debug workflow with diagnostic steps', () => {
      const wf = engine.createDebugWorkflow('My Debug');
      expect(wf.name).toBe('My Debug');
      expect(wf.tags).toContain('diagnostic');
      expect(wf.tags).toContain('built-in');
      expect(wf.steps.length).toBeGreaterThanOrEqual(4);
      expect(wf.steps.some((s) => s.type === 'screenshot')).toBe(true);
    });
  });

  describe('createLoginWorkflow', () => {
    it('should create a login workflow', () => {
      const wf = engine.createLoginWorkflow('My Login');
      expect(wf.name).toBe('My Login');
      expect(wf.tags).toContain('auth');
      expect(wf.tags).toContain('built-in');
      expect(wf.steps.length).toBeGreaterThanOrEqual(4);
      expect(wf.steps.some((s) => s.type === 'navigate')).toBe(true);
      expect(wf.steps.some((s) => s.type === 'assert')).toBe(true);
    });
  });

  describe('execute', () => {
    it('should execute a workflow successfully', async () => {
      const wf = engine.register({
        name: 'Simple',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Go to page',
            params: { url: 'https://example.com' },
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
        ],
      });

      const result = await engine.execute(wf.id, async (step) => {
        return { url: step.params.url };
      });

      expect(result.status).toBe('completed');
      expect(result.stepResults[0]!.status).toBe('completed');
    });

    it('should abort on step failure when onFailure is abort', async () => {
      const wf = engine.register({
        name: 'Failing',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Step 1',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
          {
            id: 'step2',
            type: 'click',
            description: 'Step 2',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
        ],
      });

      const result = await engine.execute(wf.id, async (step) => {
        if (step.id === 'step1') throw new Error('Failed on step 1');
        return {};
      });

      expect(result.status).toBe('failed');
      expect(result.stepResults[0]!.status).toBe('failed');
      expect(result.stepResults[1]!.status).toBe('pending'); // never executed
    });

    it('should skip failing steps when onFailure is skip', async () => {
      const wf = engine.register({
        name: 'Skip',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Step 1',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'skip',
          },
          {
            id: 'step2',
            type: 'click',
            description: 'Step 2',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
        ],
      });

      const result = await engine.execute(wf.id, async (step) => {
        if (step.id === 'step1') throw new Error('Failed');
        return {};
      });

      expect(result.status).toBe('completed'); // step2 completed, step1 skipped
      expect(result.stepResults[0]!.status).toBe('skipped');
      expect(result.stepResults[1]!.status).toBe('completed');
    });

    it('should retry on failure when retryOnFailure is true', async () => {
      let attempts = 0;
      const wf = engine.register({
        name: 'Retry',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Step 1',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: true,
            maxRetries: 2,
            onFailure: 'abort',
          },
        ],
      });

      const result = await engine.execute(wf.id, async () => {
        attempts++;
        if (attempts < 3) throw new Error('Not ready yet');
        return { success: true };
      });

      expect(result.status).toBe('completed');
      expect(attempts).toBe(3); // 2 retries + 1 initial
    });

    it('should pass context between steps', async () => {
      const wf = engine.register({
        name: 'Context',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Step 1',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
          {
            id: 'step2',
            type: 'click',
            description: 'Step 2',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
        ],
      });

      const result = await engine.execute(wf.id, async (step, context) => {
        if (step.id === 'step1') {
          context['shared'] = 'data from step 1';
          return { stored: true };
        }
        return { shared: context['shared'] };
      });

      expect(result.status).toBe('completed');
    });
  });

  describe('getExecution and listExecutions', () => {
    it('should track executions', async () => {
      const wf = engine.register({
        name: 'Exec',
        description: '',
        version: '1.0.0',
        tags: [],
        steps: [
          {
            id: 'step1',
            type: 'navigate',
            description: 'Step 1',
            params: {},
            timeoutMs: 5000,
            retryOnFailure: false,
            maxRetries: 0,
            onFailure: 'abort',
          },
        ],
      });

      await engine.execute(wf.id, async () => ({}));

      const executions = engine.listExecutions();
      expect(executions).toHaveLength(1);
      expect(executions[0]!.workflowId).toBe(wf.id);
    });
  });
});
