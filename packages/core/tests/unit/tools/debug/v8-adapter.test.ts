import { describe, it, expect, beforeEach, vi } from 'vitest';
import { V8DebuggerAdapter } from '../../../../src/tools/debug/v8-adapter.js';
import type { BrowserCDPSession } from '../../../../src/browser/types.js';

/**
 * Create a mock CDP session for testing V8DebuggerAdapter.
 * Records all sent commands and allows simulating responses/events.
 */
function createMockCDPSession(): { session: BrowserCDPSession; sent: Array<{ method: string; params?: Record<string, unknown> }>; triggerEvent: (method: string, params: unknown) => void } {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const eventHandlers = new Map<string, Array<(params: unknown) => void>>();

  const session: BrowserCDPSession = {
    send: vi.fn().mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      // Return default responses for known commands
      if (method === 'Debugger.enable') {
        return { debuggerId: 'test-debugger-1' };
      }
      if (method === 'Debugger.setBreakpointByUrl') {
        return {
          breakpointId: 'cdp_bp_1',
          locations: [{ scriptId: 'script_1', lineNumber: params?.lineNumber ?? 0, columnNumber: 0 }],
        };
      }
      if (method === 'Debugger.evaluateOnCallFrame') {
        return {
          result: { type: 'string', value: 'test_result' },
        };
      }
      if (method === 'Runtime.getProperties') {
        return {
          result: [
            { name: 'x', value: { type: 'number', value: 42 } },
            { name: 'name', value: { type: 'string', value: 'hello' } },
          ],
        };
      }
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource: 'console.log("hello");' };
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
  };

  return {
    session,
    sent,
    triggerEvent: (method: string, params: unknown) => {
      const handlers = eventHandlers.get(method);
      if (handlers) {
        for (const h of handlers) h(params);
      }
    },
  };
}

describe('V8DebuggerAdapter', () => {
  let mock: ReturnType<typeof createMockCDPSession>;
  let adapter: V8DebuggerAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockCDPSession();
    adapter = new V8DebuggerAdapter(mock.session);
  });

  describe('enable / disable', () => {
    it('should send Debugger.enable on enable()', async () => {
      const debuggerId = await adapter.enable();
      expect(debuggerId).toBe('test-debugger-1');
      expect(mock.sent[0]!.method).toBe('Debugger.enable');
      expect(adapter.isEnabled).toBe(true);
    });

    it('should send Debugger.disable on disable()', async () => {
      await adapter.enable();
      await adapter.disable();
      expect(mock.sent[1]!.method).toBe('Debugger.disable');
      expect(adapter.isEnabled).toBe(false);
    });

    it('should be idempotent on enable()', async () => {
      await adapter.enable();
      await adapter.enable();
      // Debugger.enable should only be sent once
      expect(mock.sent.filter((s) => s.method === 'Debugger.enable')).toHaveLength(1);
    });

    it('should register event listeners on enable()', async () => {
      await adapter.enable();
      expect(mock.session.on).toHaveBeenCalledWith('Debugger.paused', expect.any(Function));
      expect(mock.session.on).toHaveBeenCalledWith('Debugger.resumed', expect.any(Function));
      expect(mock.session.on).toHaveBeenCalledWith('Debugger.scriptParsed', expect.any(Function));
    });
  });

  describe('breakpoint management', () => {
    beforeEach(async () => {
      await adapter.enable();
    });

    it('should set breakpoint by URL', async () => {
      const result = await adapter.setBreakpointByUrl('app.js', 42, { condition: 'x > 5' });

      expect(result.breakpointId).toBe('cdp_bp_1');
      expect(mock.sent[1]!.method).toBe('Debugger.setBreakpointByUrl');
      expect(mock.sent[1]!.params).toEqual({
        lineNumber: 42,
        url: 'app.js',
        condition: 'x > 5',
      });
    });

    it('should set breakpoint without condition', async () => {
      await adapter.setBreakpointByUrl('app.js', 10);

      expect(mock.sent[1]!.params).toEqual({
        lineNumber: 10,
        url: 'app.js',
      });
    });

    it('should remove breakpoint by ID', async () => {
      await adapter.removeBreakpoint('cdp_bp_1');

      expect(mock.sent[1]!.method).toBe('Debugger.removeBreakpoint');
      expect(mock.sent[1]!.params).toEqual({ breakpointId: 'cdp_bp_1' });
    });

    it('should throw if not enabled', async () => {
      const disabledAdapter = new V8DebuggerAdapter(mock.session);
      await expect(disabledAdapter.setBreakpointByUrl('app.js', 10)).rejects.toThrow('Debugger not enabled');
    });
  });

  describe('execution control', () => {
    beforeEach(async () => {
      await adapter.enable();
    });

    it('should resume execution', async () => {
      await adapter.resume();
      expect(mock.sent[1]!.method).toBe('Debugger.resume');
    });

    it('should step over', async () => {
      await adapter.stepOver();
      expect(mock.sent[1]!.method).toBe('Debugger.stepOver');
    });

    it('should step into', async () => {
      await adapter.stepInto();
      expect(mock.sent[1]!.method).toBe('Debugger.stepInto');
    });

    it('should step out', async () => {
      await adapter.stepOut();
      expect(mock.sent[1]!.method).toBe('Debugger.stepOut');
    });

    it('should pause', async () => {
      await adapter.pause();
      expect(mock.sent[1]!.method).toBe('Debugger.pause');
    });

    it('should set pause on exceptions', async () => {
      await adapter.setPauseOnExceptions('all');
      expect(mock.sent[1]!.method).toBe('Debugger.setPauseOnExceptions');
      expect(mock.sent[1]!.params).toEqual({ state: 'all' });
    });

    it('should throw step commands if not enabled', async () => {
      const disabledAdapter = new V8DebuggerAdapter(mock.session);
      await expect(disabledAdapter.resume()).rejects.toThrow('Debugger not enabled');
    });
  });

  describe('evaluation and inspection', () => {
    beforeEach(async () => {
      await adapter.enable();
    });

    it('should evaluate on call frame', async () => {
      const result = await adapter.evaluateOnCallFrame('frame_1', 'x + 1', { returnByValue: true });

      expect(result.result.value).toBe('test_result');
      expect(mock.sent[1]!.method).toBe('Debugger.evaluateOnCallFrame');
      expect(mock.sent[1]!.params).toEqual({
        callFrameId: 'frame_1',
        expression: 'x + 1',
        returnByValue: true,
        generatePreview: false,
      });
    });

    it('should get object properties', async () => {
      const result = await adapter.getProperties('obj_1', { ownProperties: true });

      expect(result.result).toHaveLength(2);
      expect(result.result[0]!.name).toBe('x');
      expect(result.result[1]!.name).toBe('name');
      expect(mock.sent[1]!.method).toBe('Runtime.getProperties');
    });

    it('should get script source', async () => {
      const result = await adapter.getScriptSource('script_1');

      expect(result.scriptSource).toBe('console.log("hello");');
      expect(mock.sent[1]!.method).toBe('Debugger.getScriptSource');
    });
  });

  describe('event handlers', () => {
    beforeEach(async () => {
      await adapter.enable();
    });

    it('should call onPaused handler when Debugger.paused fires', () => {
      const handler = vi.fn();
      adapter.onPaused(handler);

      const pauseEvent = {
        callFrames: [{ callFrameId: 'frame_1', functionName: 'fn', url: 'app.js', lineNumber: 42, columnNumber: 5, scopeChain: [], this: { type: 'object' } }],
        reason: 'breakpoint',
        hitBreakpoints: ['bp_1'],
      };

      mock.triggerEvent('Debugger.paused', pauseEvent);
      expect(handler).toHaveBeenCalledWith(pauseEvent);
    });

    it('should call onResumed handler when Debugger.resumed fires', () => {
      const handler = vi.fn();
      adapter.onResumed(handler);

      mock.triggerEvent('Debugger.resumed', {});
      expect(handler).toHaveBeenCalled();
    });

    it('should call onScriptParsed when Debugger.scriptParsed fires', () => {
      const handler = vi.fn();
      adapter.onScriptParsed(handler);

      const scriptEvent = {
        scriptId: 'script_2',
        url: 'https://example.com/app.js',
        startLine: 0,
        startColumn: 0,
        endLine: 100,
        endColumn: 0,
        executionContextId: 1,
        hash: 'abc123',
      };

      mock.triggerEvent('Debugger.scriptParsed', scriptEvent);
      expect(handler).toHaveBeenCalledWith(scriptEvent);
    });
  });

  describe('lifecycle', () => {
    it('should be disabled initially', () => {
      expect(adapter.isEnabled).toBe(false);
    });

    it('should clear handlers on disable', async () => {
      const handler = vi.fn();
      adapter.onPaused(handler);
      await adapter.enable();
      await adapter.disable();

      // After disable, handlers should be cleared
      mock.triggerEvent('Debugger.paused', { callFrames: [], reason: 'test' });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
