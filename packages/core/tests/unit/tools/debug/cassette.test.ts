/**
 * Tests for CassetteRecorder — record/replay/diff for MCP tool calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// The cassette module uses fs which works in Node — no mocking needed
// We test the logic by constructing CassetteEntry arrays directly

describe('Cassette Recorder', () => {
  let CassetteRecorder: any;
  let recorder: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/cassette.js');
    CassetteRecorder = mod.CassetteRecorder;
    recorder = new CassetteRecorder();
  });

  describe('startRecording / stopRecording', () => {
    it('should start recording and return an ID', () => {
      const id = recorder.startRecording('test-session', 'A test recording');
      expect(id).toContain('cassette_');
      const status = recorder.getStatus();
      expect(status.recording).toBe(true);
      expect(status.currentId).toBe(id);
    });

    it('should stop recording and return a cassette with metadata', () => {
      recorder.startRecording('test');
      const cassette = recorder.stopRecording();
      expect(cassette).not.toBeNull();
      expect(cassette.name).toBe('test');
      expect(cassette.entries).toEqual([]);
      expect(cassette.metadata.totalTools).toBe(0);
      expect(cassette.metadata.successRate).toBe(0);
    });

    it('should return null when stopping without active recording', () => {
      const cassette = recorder.stopRecording();
      expect(cassette).toBeNull();
    });

    it('should accumulate entries during recording', () => {
      recorder.startRecording('test');
      const id = recorder.getStatus().currentId;

      // Simulate middleware recording entries via direct access
      if (recorder.currentCassette) {
        recorder.currentCassette.entries.push({
          id: 'e1', timestamp: new Date().toISOString(),
          toolName: 'browser_navigate', category: 'navigation',
          input: { url: 'http://test.com' }, output: { success: true },
          error: null, durationMs: 100, success: true,
        });
        recorder.currentCassette.entries.push({
          id: 'e2', timestamp: new Date().toISOString(),
          toolName: 'browser_click', category: 'interaction',
          input: { selector: '#btn' }, output: { success: true },
          error: null, durationMs: 50, success: true,
        });
      }

      const cassette = recorder.stopRecording();
      expect(cassette.entries.length).toBe(2);
      expect(cassette.metadata.totalTools).toBe(2);
      expect(cassette.metadata.successRate).toBe(100);
    });
  });

  describe('middleware', () => {
    it('should return a MiddlewareFn that records tool calls', () => {
      const mw = recorder.middleware();
      expect(typeof mw).toBe('function');
      expect(mw.length).toBe(2); // (ctx, next)
    });

    it('should not record when not recording', async () => {
      const mw = recorder.middleware();
      const ctx = { toolName: 'test', category: 'test', input: {}, startTime: Date.now() } as any;
      const next = async () => ({ success: true, data: 'ok' });

      const result = await mw(ctx, next);
      expect(result).toEqual({ success: true, data: 'ok' });
      expect(recorder.getStatus().recording).toBe(false);
    });

    it('should capture tool output when recording', async () => {
      recorder.startRecording('test');
      const mw = recorder.middleware();
      const ctx = { toolName: 'test_tool', category: 'test', input: { foo: 'bar' }, startTime: Date.now() } as any;
      const next = async () => ({ success: true, data: 'result' });

      await mw(ctx, next);
      const cassette = recorder.stopRecording();
      expect(cassette.entries.length).toBe(1);
      expect(cassette.entries[0]!.toolName).toBe('test_tool');
      expect(cassette.entries[0]!.input).toEqual({ foo: 'bar' });
      expect(cassette.entries[0]!.success).toBe(true);
    });

    it('should capture errors when recording', async () => {
      recorder.startRecording('test');
      const mw = recorder.middleware();
      const ctx = { toolName: 'failing_tool', category: 'test', input: {}, startTime: Date.now() } as any;
      const next = async () => ({ success: false, error: { code: 'FAIL', message: 'Something broke' } });

      await mw(ctx, next);
      const cassette = recorder.stopRecording();
      expect(cassette.entries.length).toBe(1);
      expect(cassette.entries[0]!.success).toBe(false);
      expect(cassette.entries[0]!.error).toContain('Something broke');
    });
  });

  describe('diff', () => {
    it('should detect matching entries', () => {
      const original = createTestCassette('a', [
        { toolName: 'nav', success: true, durationMs: 100 },
        { toolName: 'click', success: true, durationMs: 50 },
      ]);
      const replay = createTestEntries([
        { toolName: 'nav', success: true, durationMs: 110 },
        { toolName: 'click', success: true, durationMs: 45 },
      ]);

      const result = recorder.diff('cassette_a', original, replay);
      expect(result.summary.matching).toBe(2);
      expect(result.summary.different).toBe(0);
      expect(result.summary.regressions).toBe(0);
    });

    it('should detect regressions', () => {
      const original = createTestCassette('a', [
        { toolName: 'nav', success: true, durationMs: 100 },
        { toolName: 'click', success: true, durationMs: 50 },
      ]);
      const replay = createTestEntries([
        { toolName: 'nav', success: true, durationMs: 110 },
        { toolName: 'click', success: false, durationMs: 0 }, // regression!
      ]);

      const result = recorder.diff('cassette_a', original, replay);
      expect(result.summary.regressions).toBe(1);
      expect(result.diffs.filter(d => d.status === 'regression').length).toBe(1);
    });

    it('should handle diff where B has more entries', () => {
      const original = createTestCassette('a', [
        { toolName: 'nav', success: true, durationMs: 100 },
      ]);
      const replay = createTestEntries([
        { toolName: 'nav', success: true, durationMs: 110 },
        { toolName: 'click', success: true, durationMs: 50 },
      ]);

      const result = recorder.diff('cassette_a', original, replay);
      expect(result.summary.onlyInB).toBe(1);
    });
  });

  describe('listCassettes', () => {
    it('should return empty array when no cassettes exist', () => {
      const list = recorder.listCassettes();
      expect(Array.isArray(list)).toBe(true);
    });
  });
});

// ─── Helpers ─────────────────────────────────────────────────────

function createTestCassette(id: string, entries: Array<{ toolName: string; success: boolean; durationMs: number }>) {
  return {
    id,
    name: 'test',
    description: '',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    sessionId: null,
    entries: entries.map((e, i) => ({
      id: `e${i}`,
      timestamp: new Date().toISOString(),
      toolName: e.toolName,
      input: {},
      output: e.success ? { success: true } : null,
      error: e.success ? null : 'Error occurred',
      durationMs: e.durationMs,
      success: e.success,
    })),
    metadata: { fennecVersion: 'test', totalTools: entries.length, totalDurationMs: 150, successRate: 100, tags: [] },
  };
}

function createTestEntries(entries: Array<{ toolName: string; success: boolean; durationMs: number }>) {
  return entries.map((e, i) => ({
    id: `r${i}`,
    timestamp: new Date().toISOString(),
    toolName: e.toolName,
    input: {},
    output: e.success ? { success: true } : null,
    error: e.success ? null : 'Error occurred',
    durationMs: e.durationMs,
    success: e.success,
  }));
}
