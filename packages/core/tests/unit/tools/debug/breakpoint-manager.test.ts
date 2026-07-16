import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BreakpointSessionManager,
  getBreakpointManager,
} from '../../../../src/tools/debug/breakpoint-manager.js';
import type { BrowserCDPSession } from '../../../../src/browser/types.js';

/**
 * Create a mock CDP session for testing BreakpointSessionManager.
 */
function createMockCDPSession(): BrowserCDPSession {
  let eventId = 0;
  const eventHandlers = new Map<string, Array<(params: unknown) => void>>();

  return {
    send: vi.fn().mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Debugger.enable') {
        return { debuggerId: `debugger_${++eventId}` };
      }
      if (method === 'Debugger.setBreakpointByUrl') {
        const id = `cdp_bp_${eventId}`;
        eventId++;
        return {
          breakpointId: id,
          locations: [
            { scriptId: 'script_1', lineNumber: params?.lineNumber ?? 0, columnNumber: 0 },
          ],
        };
      }
      if (method === 'Runtime.getProperties') {
        return {
          result: [
            { name: 'x', value: { type: 'number', value: 42 } },
            { name: 'name', value: { type: 'string', value: 'hello' } },
            {
              name: 'items',
              value: { type: 'object', objectId: 'obj_items', description: 'Array(3)' },
            },
          ],
        };
      }
      if (method === 'Debugger.evaluateOnCallFrame') {
        return {
          result: { type: 'string', value: 'evaluated_result' },
        };
      }
      return {};
    }),
    on: vi.fn().mockImplementation((event: string, handler: (params: unknown) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);
    }),
    off: vi.fn(),
    // Expose for tests: ability to simulate events
    _triggerEvent: (event: string, params: unknown) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        for (const h of handlers) h(params);
      }
    },
  } as BrowserCDPSession & { _triggerEvent: (event: string, params: unknown) => void };
}

describe('BreakpointSessionManager', () => {
  let manager: BreakpointSessionManager;
  let cdp: BrowserCDPSession & { _triggerEvent: (event: string, params: unknown) => void };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BreakpointSessionManager(60000); // 1 min idle timeout for tests
    cdp = createMockCDPSession() as any;
  });

  describe('session lifecycle', () => {
    it('should create a new debug session', async () => {
      const sessionId = await manager.getOrCreateSession('test_sess_1', cdp);
      expect(sessionId).toBe('test_sess_1');
      expect(cdp.send).toHaveBeenCalledWith('Debugger.enable');
    });

    it('should re-use existing session for same ID', async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
      await manager.getOrCreateSession('test_sess_1', cdp);

      // Debugger.enable should only be called once
      const enableCalls = (cdp.send as any).mock.calls.filter(
        (c: any[]) => c[0] === 'Debugger.enable',
      );
      expect(enableCalls).toHaveLength(1);
    });

    it('should throw on getAdapter for non-existent session', () => {
      expect(() => manager.getAdapter('nonexistent')).toThrow('No debug session found');
    });

    it('should close a debug session', async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
      await manager.closeSession('test_sess_1');
      expect(manager.activeSessionCount).toBe(0);
    });
  });

  describe('breakpoint management', () => {
    beforeEach(async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
    });

    it('should set a breakpoint', async () => {
      const bp = await manager.setBreakpoint('test_sess_1', 'app.js', 42);

      expect(bp.id).toMatch(/^bp_\d+$/);
      expect(bp.file).toBe('app.js');
      expect(bp.line).toBe(42);
      expect(bp.active).toBe(true);
      expect(bp.scriptId).toBe('script_1');
    });

    it('should set breakpoint with condition', async () => {
      const bp = await manager.setBreakpoint('test_sess_1', 'app.js', 42, {
        condition: 'x > 5',
      });

      expect(bp.condition).toBe('x > 5');
    });

    it('should list breakpoints', async () => {
      await manager.setBreakpoint('test_sess_1', 'app.js', 10);
      await manager.setBreakpoint('test_sess_1', 'utils.js', 25);

      const list = manager.listBreakpoints('test_sess_1');
      expect(list).toHaveLength(2);
    });

    it('should remove a breakpoint', async () => {
      const bp = await manager.setBreakpoint('test_sess_1', 'app.js', 42);
      const removed = await manager.removeBreakpoint('test_sess_1', bp.id);

      expect(removed).toBe(true);
      expect(manager.listBreakpoints('test_sess_1')).toHaveLength(0);
      // Should call CDP removeBreakpoint
      expect(cdp.send).toHaveBeenCalledWith('Debugger.removeBreakpoint', {
        breakpointId: bp.cdpId,
      });
    });

    it('should return false for removing non-existent breakpoint', async () => {
      const removed = await manager.removeBreakpoint('test_sess_1', 'bp_nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('pause/resume lifecycle', () => {
    beforeEach(async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
    });

    it('should capture pause state from Debugger.paused event', () => {
      const pauseEvent = {
        callFrames: [
          {
            callFrameId: 'frame_1',
            functionName: 'handleClick',
            url: 'app.js',
            lineNumber: 42,
            columnNumber: 5,
            scopeChain: [
              {
                type: 'local',
                object: { type: 'object', objectId: 'scope_local', description: 'Object' },
              },
            ],
            this: { type: 'object', className: 'Window' },
          },
        ],
        reason: 'breakpoint',
        hitBreakpoints: ['bp_1'],
      };

      cdp._triggerEvent('Debugger.paused', pauseEvent);

      const pauseState = manager.getPauseState('test_sess_1');
      expect(pauseState).not.toBeNull();
      expect(pauseState!.reason).toBe('breakpoint');
      expect(pauseState!.callFrames).toHaveLength(1);
      expect(pauseState!.callFrames[0]!.functionName).toBe('handleClick');
    });

    it('should return null pause state when not paused', () => {
      expect(manager.getPauseState('test_sess_1')).toBeNull();
    });

    it('should resume execution', async () => {
      // Simulate pause first
      cdp._triggerEvent('Debugger.paused', {
        callFrames: [
          {
            callFrameId: 'frame_1',
            functionName: 'fn',
            url: 'app.js',
            lineNumber: 1,
            columnNumber: 1,
            scopeChain: [],
            this: { type: 'object' },
          },
        ],
        reason: 'breakpoint',
      });

      const resumed = await manager.resume('test_sess_1');
      expect(resumed).toBe(true);
      expect(cdp.send).toHaveBeenCalledWith('Debugger.resume');
    });

    it('should return false when trying to resume while not paused', async () => {
      const resumed = await manager.resume('test_sess_1');
      expect(resumed).toBe(false);
    });
  });

  describe('stepping', () => {
    beforeEach(async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
      cdp._triggerEvent('Debugger.paused', {
        callFrames: [
          {
            callFrameId: 'frame_1',
            functionName: 'fn',
            url: 'app.js',
            lineNumber: 1,
            columnNumber: 1,
            scopeChain: [],
            this: { type: 'object' },
          },
        ],
        reason: 'breakpoint',
      });
    });

    it('should step over', async () => {
      const stepped = await manager.stepOver('test_sess_1');
      expect(stepped).toBe(true);
      expect(cdp.send).toHaveBeenCalledWith('Debugger.stepOver');
    });

    it('should step into', async () => {
      const stepped = await manager.stepInto('test_sess_1');
      expect(stepped).toBe(true);
      expect(cdp.send).toHaveBeenCalledWith('Debugger.stepInto');
    });

    it('should step out', async () => {
      const stepped = await manager.stepOut('test_sess_1');
      expect(stepped).toBe(true);
      expect(cdp.send).toHaveBeenCalledWith('Debugger.stepOut');
    });
  });

  describe('variable inspection', () => {
    beforeEach(async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
      cdp._triggerEvent('Debugger.paused', {
        callFrames: [
          {
            callFrameId: 'frame_1',
            functionName: 'fn',
            url: 'app.js',
            lineNumber: 42,
            columnNumber: 5,
            scopeChain: [
              {
                type: 'local',
                object: { type: 'object', objectId: 'scope_local', description: 'local scope' },
              },
            ],
            this: { type: 'object' },
          },
        ],
        reason: 'breakpoint',
      });
    });

    it('should get variables when paused', async () => {
      const variables = await manager.getVariables('test_sess_1', {
        maxVariables: 10,
        maxDepth: 2,
      });
      expect(variables.length).toBeGreaterThan(0);
      expect(variables[0]!.type).toBe('local');
      expect(variables[0]!.variables.length).toBeGreaterThan(0);
    });

    it('should return empty when not paused', async () => {
      const freshManager = new BreakpointSessionManager();
      await freshManager.getOrCreateSession('fresh_sess', cdp);

      const variables = await freshManager.getVariables('fresh_sess');
      expect(variables).toEqual([]);
    });
  });

  describe('expression evaluation', () => {
    beforeEach(async () => {
      await manager.getOrCreateSession('test_sess_1', cdp);
    });

    it('should evaluate expression in paused context', async () => {
      cdp._triggerEvent('Debugger.paused', {
        callFrames: [
          {
            callFrameId: 'frame_1',
            functionName: 'fn',
            url: 'app.js',
            lineNumber: 1,
            columnNumber: 1,
            scopeChain: [],
            this: { type: 'object' },
          },
        ],
        reason: 'breakpoint',
      });

      const result = await manager.evaluate('test_sess_1', 'x + 1');
      expect(result.type).toBe('string');
      expect(result.value).toBe('evaluated_result');
    });

    it('should return error when not paused', async () => {
      const result = await manager.evaluate('test_sess_1', 'x + 1');
      expect(result.exception).toContain('Not paused');
    });
  });

  describe('pause summary', () => {
    it('should return "Not paused" when not paused', () => {
      expect(manager.getPauseSummary('nonexistent')).toBe('Not paused');
    });

    it('should format pause summary', async () => {
      await manager.getOrCreateSession('test_sess_2', cdp);

      cdp._triggerEvent('Debugger.paused', {
        callFrames: [
          {
            callFrameId: 'f1',
            functionName: 'outer',
            url: 'http://localhost/app.js',
            lineNumber: 10,
            columnNumber: 5,
            scopeChain: [],
            this: { type: 'object' },
          },
          {
            callFrameId: 'f2',
            functionName: 'inner',
            url: 'http://localhost/utils.js',
            lineNumber: 25,
            columnNumber: 3,
            scopeChain: [],
            this: { type: 'object' },
          },
        ],
        reason: 'breakpoint',
      });

      const summary = manager.getPauseSummary('test_sess_2');
      expect(summary).toContain('Paused: breakpoint');
      expect(summary).toContain('outer');
      expect(summary).toContain('inner');
    });
  });

  describe('cleanup', () => {
    it('should close all sessions', async () => {
      await manager.getOrCreateSession('sess_1', createMockCDPSession() as any);
      await manager.getOrCreateSession('sess_2', createMockCDPSession() as any);

      expect(manager.activeSessionCount).toBe(2);
      await manager.closeAll();
      expect(manager.activeSessionCount).toBe(0);
    });
  });
});
