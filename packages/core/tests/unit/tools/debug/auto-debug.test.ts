import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SnapshotManager } from '../../../../src/tools/debug/auto-debug.js';
import type { AutoDebugSnapshot } from '../../../../src/tools/debug/auto-debug.js';

describe('SnapshotManager', () => {
  let mgr: SnapshotManager;

  beforeEach(() => {
    mgr = new SnapshotManager({
      maxSnapshots: 10,
      snapshotTTLMs: 60000, // 1 min for tests
      dedupWindowMs: 500,  // 500ms dedup window for tests
    });
  });

  afterEach(() => {
    mgr.stop();
  });

  const makeSnapshot = (overrides: Partial<Omit<AutoDebugSnapshot, 'id' | 'lastSeen'>> = {}) => ({
    ruleId: 'error' as const,
    ruleName: 'Test Rule',
    timestamp: new Date().toISOString(),
    eventType: 'process:stderr',
    sourceName: 'test-app',
    message: 'Test error message',
    count: 1,
    errorGroups: [],
    recentLogs: [],
    consoleErrors: [],
    networkFailures: [],
    ...overrides,
  });

  describe('basic operations', () => {
    it('should store a snapshot', () => {
      const snapshot = mgr.add(makeSnapshot());
      expect(snapshot.id).toMatch(/^auto_\d+$/);
      expect(snapshot.message).toBe('Test error message');
      expect(snapshot.count).toBe(1);
      expect(snapshot.lastSeen).toBe(snapshot.timestamp);
    });

    it('should get latest snapshots', () => {
      mgr.add(makeSnapshot({ message: 'Error 1' }));
      mgr.add(makeSnapshot({ message: 'Error 2' }));

      const latest = mgr.getLatest({ limit: 1 });
      expect(latest).toHaveLength(1);
      expect(latest[0]!.message).toBe('Error 2');
    });

    it('should filter by source name', () => {
      mgr.add(makeSnapshot({ sourceName: 'app-1', message: 'Error A' }));
      mgr.add(makeSnapshot({ sourceName: 'app-2', message: 'Error B' }));

      const filtered = mgr.getLatest({ sourceName: 'app-1', limit: 10 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.message).toBe('Error A');
    });

    it('should filter by rule ID', () => {
      mgr.add(makeSnapshot({ ruleId: 'crash', message: 'Crash!' }));
      mgr.add(makeSnapshot({ ruleId: 'error', message: 'Error!' }));

      const filtered = mgr.getLatest({ ruleId: 'crash', limit: 10 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.message).toBe('Crash!');
    });

    it('should return all snapshots', () => {
      mgr.add(makeSnapshot({ message: 'A' }));
      mgr.add(makeSnapshot({ message: 'B' }));
      mgr.add(makeSnapshot({ message: 'C' }));

      expect(mgr.getAll()).toHaveLength(3);
    });

    it('should clear all snapshots', () => {
      mgr.add(makeSnapshot());
      mgr.clear();
      expect(mgr.count).toBe(0);
    });
  });

  describe('dedup behavior', () => {
    it('should dedup same source+rule+message within dedup window', () => {
      const snap1 = mgr.add(makeSnapshot({ message: 'Same error' }));
      const snap2 = mgr.add(makeSnapshot({ message: 'Same error' }));

      // Should return same snapshot with incremented count
      expect(snap1.id).toBe(snap2.id);
      expect(snap2.count).toBe(2);
      expect(mgr.count).toBe(1);
    });

    it('should create new snapshot after dedup window expires', async () => {
      mgr.add(makeSnapshot({ message: 'Error' }));

      // Wait for dedup window to expire
      await new Promise((resolve) => setTimeout(resolve, 600));

      const snap2 = mgr.add(makeSnapshot({ message: 'Error' }));

      // Should be a new snapshot because dedup window expired
      const all = mgr.getAll();
      expect(all).toHaveLength(2);
    });

    it('should not dedup different messages', () => {
      mgr.add(makeSnapshot({ message: 'Error A' }));
      mgr.add(makeSnapshot({ message: 'Error B' }));

      expect(mgr.count).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest when exceeding maxSnapshots', () => {
      const small = new SnapshotManager({ maxSnapshots: 3 });
      small.add(makeSnapshot({ message: 'Oldest' }));
      small.add(makeSnapshot({ message: 'Middle' }));
      small.add(makeSnapshot({ message: 'Newest' }));
      small.add(makeSnapshot({ message: 'Extra' }));

      expect(small.count).toBe(3);
      const latest = small.getAll();
      // Oldest ('Oldest') should have been evicted
      expect(latest.some((s) => s.message === 'Oldest')).toBe(false);
      small.stop();
    });
  });

  describe('TTL pruning', () => {
    it('should prune expired snapshots', async () => {
      const shortTTL = new SnapshotManager({
        maxSnapshots: 10,
        snapshotTTLMs: 100, // 100ms TTL
        dedupWindowMs: 100000,
      });

      shortTTL.add(makeSnapshot({ message: 'Will expire' }));
      expect(shortTTL.count).toBe(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 200));

      shortTTL.pruneExpired();
      expect(shortTTL.count).toBe(0);
      shortTTL.stop();
    });
  });

  describe('getSince', () => {
    it('should return snapshots since a timestamp', () => {
      const before = new Date(Date.now() - 1000).toISOString();
      mgr.add(makeSnapshot({ message: 'Recent' }));

      const results = mgr.getSince(before);
      expect(results).toHaveLength(1);
    });

    it('should return empty for future timestamp', () => {
      mgr.add(makeSnapshot({ message: 'Past' }));

      const future = new Date(Date.now() + 60000).toISOString();
      const results = mgr.getSince(future);
      expect(results).toHaveLength(0);
    });
  });
});

// ─── AutoDebugEngine tests ─────────────────────────────────────

import { EventBus } from '../../../../src/correlation/EventBus.js';
import { getAutoDebugEngine, resetAutoDebugEngine } from '../../../../src/tools/debug/auto-debug.js';

describe('AutoDebugEngine (via EventBus)', () => {
  let bus: EventBus;

  beforeEach(() => {
    resetAutoDebugEngine(); // Reset singleton so each test gets a fresh engine
    bus = new EventBus();
  });

  it('should create engine with EventBus', () => {
    const engine = getAutoDebugEngine(bus);
    expect(engine).not.toBeNull();
    engine?.stop();
  });

  it('should start and stop', () => {
    const engine = getAutoDebugEngine(bus)!;
    expect(engine).toBeDefined();
    engine.stop();
    expect(engine.getStats().totalSnapshots).toBe(0);
  });

  it('should track rule state', () => {
    const engine = getAutoDebugEngine(bus)!;

    const rules = engine.listRules();
    expect(rules.length).toBe(5);
    expect(rules.map((r) => r.id)).toEqual(['crash', 'error', 'browser', 'hang', 'timeout']);
    expect(rules.every((r) => r.enabled)).toBe(true);

    engine.stop();
  });

  it('should enable/disable rules', () => {
    const engine = getAutoDebugEngine(bus)!;

    engine.setRuleEnabled('crash', false);
    expect(engine.isRuleEnabled('crash')).toBe(false);
    expect(engine.isRuleEnabled('error')).toBe(true);

    engine.stop();
  });

  it('should get stats', () => {
    const engine = getAutoDebugEngine(bus)!;

    const stats = engine.getStats();
    expect(stats).toHaveProperty('totalSnapshots');
    expect(stats).toHaveProperty('enabledRules');
    expect(stats).toHaveProperty('rules');
    expect(stats.rules.length).toBe(5);
    expect(stats.enabledRules).toBe(5);

    engine.stop();
  });

  it('should subscribe to EventBus events when started', () => {
    const engine = getAutoDebugEngine(bus)!;

    // Publish some events
    bus.publish('process:exit', { code: 1, processId: 'test-app' });

    const snapshots = engine.snapshots.getAll();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]!.ruleId).toBe('crash');

    engine.stop();
  });

  it('should handle stderr errors', () => {
    const engine = getAutoDebugEngine(bus)!;

    bus.publish('process:stderr', { line: 'Error: Something failed', processId: 'test-app' });

    const snapshots = engine.snapshots.getAll();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]!.ruleId).toBe('error');

    engine.stop();
  });

  it('should handle browser console errors', () => {
    const engine = getAutoDebugEngine(bus)!;

    bus.publish('browser:console', {
      level: 'error',
      message: 'Cannot read property of undefined',
      source: 'app.js:42',
      sessionId: 'sess_1',
    });

    const snapshots = engine.snapshots.getAll();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]!.ruleId).toBe('browser');

    engine.stop();
  });

  it('should handle network 5xx errors', () => {
    const engine = getAutoDebugEngine(bus)!;

    bus.publish('browser:network', {
      method: 'GET',
      url: 'http://localhost:3000/api/users',
      status: 500,
      statusText: 'Internal Server Error',
      sessionId: 'sess_1',
    });

    const snapshots = engine.snapshots.getAll();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]!.ruleId).toBe('browser');

    engine.stop();
  });

  it('should not create snapshot for non-error exit codes', () => {
    const engine = getAutoDebugEngine(bus)!;

    bus.publish('process:exit', { code: 0, processId: 'test-app' });

    expect(engine.snapshots.count).toBe(0);

    engine.stop();
  });

  it('should include suggested fix in snapshots', () => {
    const engine = getAutoDebugEngine(bus)!;

    bus.publish('process:exit', { code: 1, processId: 'test-app' });

    const snapshots = engine.snapshots.getAll();
    expect(snapshots[0]!.suggestedFix).toBeTruthy();

    engine.stop();
  });
});
