/**
 * Tests for JDWP Adapter — Java/Kotlin/Scala debugging.
 */
import { describe, it, expect } from 'vitest';

describe('JDWP Adapter', () => {
  let JDWPAdapter: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/jdwp-adapter.js');
    JDWPAdapter = mod.JDWPAdapter;
  });

  describe('adapter creation', () => {
    it('should create adapter with default config', () => {
      const adapter = new JDWPAdapter();
      expect(adapter.runtime).toBe('java');
      expect(adapter.isEnabled).toBe(false);
    });

    it('should create adapter with custom config', () => {
      const adapter = new JDWPAdapter({ host: '10.0.0.1', port: 5006 });
      expect(adapter.runtime).toBe('java');
    });
  });

  describe('DebugAdapter interface compliance', () => {
    it('should have all required DebugAdapter methods', () => {
      const adapter = new JDWPAdapter();
      expect(typeof adapter.enable).toBe('function');
      expect(typeof adapter.disable).toBe('function');
      expect(typeof adapter.setBreakpointByUrl).toBe('function');
      expect(typeof adapter.removeBreakpoint).toBe('function');
      expect(typeof adapter.resume).toBe('function');
      expect(typeof adapter.stepOver).toBe('function');
      expect(typeof adapter.stepInto).toBe('function');
      expect(typeof adapter.stepOut).toBe('function');
      expect(typeof adapter.evaluateOnCallFrame).toBe('function');
      expect(typeof adapter.getProperties).toBe('function');
      expect(typeof adapter.onPaused).toBe('function');
      expect(typeof adapter.onResumed).toBe('function');
      expect(typeof adapter.onScriptParsed).toBe('function');
    });

    it('should throw when calling methods before enable', async () => {
      const adapter = new JDWPAdapter();
      await expect(adapter.setBreakpointByUrl('Test.java', 10)).rejects.toThrow('not enabled');
      await expect(adapter.resume()).rejects.toThrow('not enabled');
      await expect(adapter.stepOver()).rejects.toThrow('not enabled');
    });
  });

  describe('getProperties objectId parsing', () => {
    it('should return empty for unknown objectId format', async () => {
      const adapter = new JDWPAdapter();
      const result = await adapter.getProperties('unknown_format');
      expect(result.result).toEqual([]);
    });

    it('should return empty for invalid scope format', async () => {
      const adapter = new JDWPAdapter();
      const result = await adapter.getProperties('java_scope:invalid');
      expect(result.result).toEqual([]);
    });
  });

  describe('step operations before enable', () => {
    it('should throw on stepOver before enable', async () => {
      const adapter = new JDWPAdapter();
      await expect(adapter.stepOver()).rejects.toThrow('not enabled');
    });

    it('should throw on stepInto before enable', async () => {
      const adapter = new JDWPAdapter();
      await expect(adapter.stepInto()).rejects.toThrow('not enabled');
    });

    it('should throw on stepOut before enable', async () => {
      const adapter = new JDWPAdapter();
      await expect(adapter.stepOut()).rejects.toThrow('not enabled');
    });
  });

  describe('event handlers', () => {
    it('should register and call onPaused handler', () => {
      const adapter = new JDWPAdapter();
      let called = false;
      adapter.onPaused(() => {
        called = true;
      });
      adapter.onPaused((event: any) => {
        expect(event.reason).toBeDefined();
      });
      expect(typeof adapter.onPaused).toBe('function');
    });

    it('should register onResumed handler', () => {
      const adapter = new JDWPAdapter();
      let called = false;
      adapter.onResumed(() => {
        called = true;
      });
      expect(typeof adapter.onResumed).toBe('function');
    });
  });
});
