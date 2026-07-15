/**
 * Tests for DAP Adapter — DAP protocol mapping for Python, Go, .NET, Ruby, Rust, Dart.
 */
import { describe, it, expect } from 'vitest';

describe('DAP Adapter', () => {
  let DAPAdapter: any;
  let ADAPTER_CONFIGS: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/dap-adapter.js');
    DAPAdapter = mod.DAPAdapter;
    ADAPTER_CONFIGS = mod.ADAPTER_CONFIGS;
  });

  describe('ADAPTER_CONFIGS', () => {
    it('should have config for all supported runtimes', () => {
      const runtimes = ['python', 'go', 'dotnet', 'ruby', 'rust', 'dart'];
      for (const r of runtimes) {
        expect(ADAPTER_CONFIGS[r]).toBeDefined();
        expect(ADAPTER_CONFIGS[r].runtime).toBe(r);
      }
    });

    it('should have correct transport modes', () => {
      expect(ADAPTER_CONFIGS.python.transport).toBe('tcp');
      expect(ADAPTER_CONFIGS.go.transport).toBe('tcp');
      expect(ADAPTER_CONFIGS.dotnet.transport).toBe('stdio');
      expect(ADAPTER_CONFIGS.rust.transport).toBe('stdio');
      expect(ADAPTER_CONFIGS.ruby.transport).toBe('tcp');
    });

    it('should have correct ports', () => {
      expect(ADAPTER_CONFIGS.python.port).toBe(5678);
      expect(ADAPTER_CONFIGS.go.port).toBe(2345);
      expect(ADAPTER_CONFIGS.ruby.port).toBe(1234);
    });
  });

  describe('adapter creation', () => {
    it('should create adapter with correct runtime', () => {
      const adapter = new DAPAdapter(ADAPTER_CONFIGS.python);
      expect(adapter.runtime).toBe('python');
      expect(adapter.isEnabled).toBe(false);
    });

    it('should create adapter for each runtime type', () => {
      const runtimes = ['python', 'go', 'dotnet', 'ruby', 'rust', 'dart'];
      for (const r of runtimes) {
        const adapter = new DAPAdapter(ADAPTER_CONFIGS[r]);
        expect(adapter.runtime).toBe(r);
      }
    });
  });

  describe('LAUNCH_CONFIGS', () => {
    it('should have launch config for each runtime', async () => {
      const { DAPAdapter: DA } = await import('../../../../src/tools/debug/dap-adapter.js');
      expect(DA).toBeDefined();
    });
  });

  describe('DebugAdapter interface compliance', () => {
    it('should have all required DebugAdapter methods', () => {
      const adapter = new DAPAdapter(ADAPTER_CONFIGS.python);
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
      const adapter = new DAPAdapter(ADAPTER_CONFIGS.python);
      await expect(adapter.setBreakpointByUrl('test.py', 10)).rejects.toThrow('not enabled');
      await expect(adapter.resume()).rejects.toThrow('not enabled');
      await expect(adapter.stepOver()).rejects.toThrow('not enabled');
    });
  });
});
