import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessManager } from '../../../src/process/ProcessManager.js';

const testConfig = {
  maxProcesses: 10,
  logBufferLines: 100,
  spawnAllowlist: ['node', 'npm', 'echo'],
};

describe('ProcessManager', () => {
  let manager: ProcessManager;

  beforeEach(() => {
    manager = new ProcessManager(testConfig);
  });

  it('should reject commands not in allowlist', () => {
    expect(() => manager.spawn('unknown-cmd')).toThrow('not in spawn allowlist');
  });

  it('should allow commands in allowlist', () => {
    // This might fail on Windows if 'echo' is not available via spawn without shell
    // but it tests the allowlist logic
    expect(() => manager.spawn('echo', ['hello'])).not.toThrow();
  });

  it('should list empty when no processes spawned', () => {
    const list = manager.list();
    expect(list).toEqual([]);
  });

  it('should throw for non-existent process ID', () => {
    expect(() => manager.get('nonexistent')).toThrow('Process not found');
    expect(() => manager.getLogs('nonexistent')).toThrow('Process not found');
    expect(() => manager.getStatus('nonexistent')).toThrow('Process not found');
  });

  it('should return false when killing non-existent process', () => {
    const result = manager.kill('nonexistent');
    expect(result).toBe(false);
  });

  it('should track process count', () => {
    const proc1 = manager.spawn('echo', ['hello'], undefined, undefined, 'proc1');
    const proc2 = manager.spawn('echo', ['world'], undefined, undefined, 'proc2');

    expect(manager.list()).toHaveLength(2);
    expect(proc1.processId).toBe('proc1');
    expect(proc2.processId).toBe('proc2');
  });

  it('should enforce max processes limit', () => {
    const smallManager = new ProcessManager({
      maxProcesses: 2,
      logBufferLines: 100,
      spawnAllowlist: ['echo'],
    });
    smallManager.spawn('echo', ['1']);
    smallManager.spawn('echo', ['2']);

    expect(() => smallManager.spawn('echo', ['3'])).toThrow('Maximum processes');
  });

  it('should clean up all processes', () => {
    manager.spawn('echo', ['a'], undefined, undefined, 'a');
    manager.spawn('echo', ['b'], undefined, undefined, 'b');

    manager.cleanup();
    expect(manager.list()).toHaveLength(0);
  });
});
