import { describe, it, expect, beforeEach } from 'vitest';
import { PipeWatcher } from '../../src/process/PipeWatcher.js';
import { detectLogLevel } from '../../src/utils/levelDetector.js';
import { EventBus } from '../../src/correlation/EventBus.js';

describe('Integration: PipeWatcher + ProcessManager-like log pipeline', () => {
  let pipeWatcher: PipeWatcher;
  let eventBus: EventBus;

  beforeEach(() => {
    pipeWatcher = new PipeWatcher(200);
    eventBus = new EventBus();
  });

  it('should simulate the CLI pipe command pipeline (stdin → PipeWatcher → process.stdout)', () => {
    // Simulates what happens when a user runs: npm run dev | fennec pipe --name "dev-server"
    const pipe = pipeWatcher.createPipe('dev-server');

    // Simulate stdin 'data' events (like from the CLI pipe command)
    const simulateData = (data: string) => {
      pipe.write(data);
      // Also publish to event bus for correlation
      const lines = data.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const level = detectLogLevel(line);
        if (level === 'error') {
          eventBus.publish('process:stderr', { line, processId: 'dev-server' });
        } else {
          eventBus.publish('process:stdout', { line, processId: 'dev-server' });
        }
      }
    };

    // Simulate incoming data from piped process
    simulateData('[INFO] Starting dev server...');
    simulateData('[INFO] Compiling modules...');
    simulateData("[ERROR] Module not found: './config'");
    simulateData('[WARN] Using default configuration');

    // Verify pipe captured everything
    expect(pipeWatcher.getLogs('dev-server')).toHaveLength(4);

    // Filter by level
    expect(pipeWatcher.getLogs('dev-server', { level: 'error' })).toHaveLength(1);
    expect(pipeWatcher.getLogs('dev-server', { level: 'warn' })).toHaveLength(1);
    expect(pipeWatcher.getLogs('dev-server', { level: 'info' })).toHaveLength(2);

    // Verify event bus
    expect(eventBus.getHistory('process:stderr')).toHaveLength(1);
    expect(eventBus.getHistory('process:stdout')).toHaveLength(3);

    // Verify pipe listing
    const list = pipeWatcher.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.pipeId).toBe('dev-server');
    expect(list[0]!.count).toBe(4);
  });

  it('should handle rapid piped data from a process', () => {
    const pipe = pipeWatcher.createPipe('rapid-process');

    // Simulate rapid output from a build tool like Vite or webpack
    const buildOutput = [
      '[INFO] Starting build...',
      '[INFO] Compiling entry point: src/index.ts',
      '[INFO] Resolving dependencies...',
      '[INFO] Module graph constructed (15 modules)',
      '[WARN] Circular dependency detected: src/utils/helper.ts → src/utils/index.ts → src/utils/helper.ts',
      '[INFO] Optimizing bundle...',
      '[INFO] Build completed in 1.2s',
    ];

    // Write all at once (like a burst of stdout)
    pipe.write(buildOutput.join('\n'));

    const logs = pipeWatcher.getLogs('rapid-process');
    expect(logs).toHaveLength(7);

    // Verify order preserved
    expect(logs[0]!.line).toBe('[INFO] Starting build...');
    expect(logs[6]!.line).toBe('[INFO] Build completed in 1.2s');

    // Verify level detection
    expect(logs.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(logs.filter((l) => l.level === 'info')).toHaveLength(6);
  });

  it('should handle piped stderr with error level detection', () => {
    const pipe = pipeWatcher.createPipe('stderr-test');

    // Simulate stderr output from Node.js process
    pipe.write("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express'");
    pipe.write('    at packageResolve (node:internal/modules/esm/resolve:123)');
    pipe.write('    at moduleResolve (node:internal/modules/esm/resolve:456)');
    pipe.write('[ERROR] Failed to start server: missing dependencies');

    const logs = pipeWatcher.getLogs('stderr-test');
    expect(logs).toHaveLength(4);

    // Error detection: lines with 'Error' or '[ERROR]' keywords are detected
    // Stack trace lines (at packageResolve, at moduleResolve) are detected as 'info' (default)
    const errors = pipeWatcher.getLogs('stderr-test', { level: 'error' });
    expect(errors).toHaveLength(2); // Lines 1 and 4 have error keywords

    // Check specific line detection
    expect(errors[0]!.line).toContain('ERR_MODULE_NOT_FOUND');
    expect(errors[1]!.line).toContain('Failed to start server');

    // Stack trace lines are detected as info (no error keyword)
    const infos = pipeWatcher.getLogs('stderr-test', { level: 'info' });
    expect(infos).toHaveLength(2);
  });

  it('should handle pipe buffer overflow from a chatty process', () => {
    const smallWatcher = new PipeWatcher(10);
    const pipe = smallWatcher.createPipe('chatty-process');

    // Simulate a process that outputs 100 lines
    for (let i = 0; i < 100; i++) {
      pipe.write(`[INFO] line ${i}`);
    }

    const logs = smallWatcher.getLogs('chatty-process');
    expect(logs).toHaveLength(10);

    // Only the last 10 lines are kept (ring buffer behavior)
    expect(logs[0]!.line).toBe('[INFO] line 90');
    expect(logs[9]!.line).toBe('[INFO] line 99');
  });

  it('should handle multiple named pipes (multiple process monitoring)', () => {
    // Simulate monitoring multiple processes via named pipes
    const pipeBackend = pipeWatcher.createPipe('backend');
    const pipeFrontend = pipeWatcher.createPipe('frontend');
    const pipeDb = pipeWatcher.createPipe('database');

    pipeBackend.write('[INFO] API server listening on port 3000');
    pipeFrontend.write('[INFO] Vite dev server running at http://localhost:5173');
    pipeDb.write('[INFO] PostgreSQL connection established');
    pipeDb.write('[ERROR] Connection pool exhausted');

    // Each pipe has correct data
    expect(pipeWatcher.getLogs('backend')).toHaveLength(1);
    expect(pipeWatcher.getLogs('frontend')).toHaveLength(1);
    expect(pipeWatcher.getLogs('database')).toHaveLength(2);

    // Isolation: error from DB pipe doesn't affect others
    const backendErrors = pipeWatcher.getLogs('backend', { level: 'error' });
    expect(backendErrors).toHaveLength(0);

    // Pipe listing shows all 3
    expect(pipeWatcher.list()).toHaveLength(3);
  });

  it('should clear a specific pipe buffer and continue monitoring', () => {
    const pipe = pipeWatcher.createPipe('clearable-process');
    pipe.write('[INFO] log 1');
    pipe.write('[INFO] log 2');

    expect(pipeWatcher.clear('clearable-process')).toBe(2);
    expect(pipeWatcher.getLogs('clearable-process')).toHaveLength(0);

    // Process continues to output after clear
    pipe.write('[INFO] log 3');
    expect(pipeWatcher.getLogs('clearable-process')).toHaveLength(1);
    expect(pipeWatcher.getLogs('clearable-process')[0]!.line).toBe('[INFO] log 3');
  });

  it('should cleanup all pipes on shutdown', () => {
    pipeWatcher.createPipe('pipe-1');
    pipeWatcher.createPipe('pipe-2');
    expect(pipeWatcher.list()).toHaveLength(2);

    pipeWatcher.cleanup();
    expect(pipeWatcher.list()).toHaveLength(0);

    // Should be able to create new pipes after cleanup
    const newPipe = pipeWatcher.createPipe('new-process');
    newPipe.write('[INFO] restarted');
    expect(pipeWatcher.list()).toHaveLength(1);
  });
});
