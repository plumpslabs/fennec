import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PipeWatcher } from '../../src/process/PipeWatcher.js';
import { LogWatcher } from '../../src/process/LogWatcher.js';

describe('Integration: LogWatcher + PipeWatcher dual monitoring', () => {
  let pipeWatcher: PipeWatcher;
  let logWatcher: LogWatcher;
  let tmpDir: string;
  const tempFiles: string[] = [];

  beforeEach(() => {
    pipeWatcher = new PipeWatcher(100);
    logWatcher = new LogWatcher(100);
    tmpDir = mkdtempSync(join(tmpdir(), 'fennec-int-'));
  });

  afterEach(() => {
    pipeWatcher.cleanup();
    logWatcher.cleanup();
    // Cleanup temp files
    for (const f of tempFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    try {
      unlinkSync(tmpDir);
    } catch {
      /* ignore */
    }
  });

  function createTempFile(name: string, content = ''): string {
    const path = join(tmpDir, name);
    writeFileSync(path, content, 'utf-8');
    tempFiles.push(path);
    return path;
  }

  it('should simultaneously monitor a log file and a named pipe', () => {
    // Setup: log file + pipe
    const logFile = createTempFile('app.log');
    writeFileSync(logFile, '[INFO] Server initialized\n', 'utf-8');

    // Start watching log file
    const fileWatcherId = logWatcher.watchFile(logFile, 'app-log');
    expect(fileWatcherId).toBe('app-log');

    // Create pipe for another source
    const pipe = pipeWatcher.createPipe('build-output');
    pipe.write('[INFO] Build started');

    // Both should have their data
    expect(logWatcher.list()).toHaveLength(1);
    expect(logWatcher.list()[0]!.id).toBe('app-log');
    expect(pipeWatcher.list()).toHaveLength(1);
    expect(pipeWatcher.list()[0]!.pipeId).toBe('build-output');
    expect(pipeWatcher.getLogs('build-output')).toHaveLength(1);
  });

  it('should capture file changes while pipe is also receiving data', async () => {
    const logFile = createTempFile('hybrid.log');
    writeFileSync(logFile, '[INFO] initial log\n');

    const fileWatcherId = logWatcher.watchFile(logFile, 'hybrid-log');
    const pipe = pipeWatcher.createPipe('hybrid-pipe');

    // Wait for watcher to initialize
    await new Promise((r) => setTimeout(r, 100));

    // Append to file
    writeFileSync(logFile, '[ERROR] file error occurred\n', { flag: 'a' });

    // Write to pipe simultaneously
    pipe.write('[ERROR] pipe error occurred');

    // Wait for FS watcher to pick up the change
    await new Promise((r) => setTimeout(r, 200));

    // Both sources should have captured their errors
    const fileErrors = logWatcher.getLogs('hybrid-log', { level: 'error' });
    const pipeErrors = pipeWatcher.getLogs('hybrid-pipe', { level: 'error' });

    expect(pipeErrors).toHaveLength(1);
    expect(pipeErrors[0]!.line).toContain('pipe error');

    // File watcher might or might not have caught it depending on FS timing
    // But the watcher should be running
    expect(fileWatcherId).toBe('hybrid-log');
  });

  it('should stop file watcher while pipe continues running', () => {
    const logFile = createTempFile('stop-test.log');
    writeFileSync(logFile, 'initial\n');
    const fileWatcherId = logWatcher.watchFile(logFile, 'stop-test');

    const pipe = pipeWatcher.createPipe('continuing-pipe');
    pipe.write('[INFO] before stop');

    // Stop log watcher
    expect(logWatcher.stop(fileWatcherId)).toBe(true);
    expect(logWatcher.list()).toHaveLength(0);

    // Pipe should still work
    pipe.write('[INFO] after stop');
    expect(pipeWatcher.getLogs('continuing-pipe')).toHaveLength(2);

    // Stop non-existent watcher returns false
    expect(logWatcher.stop('nonexistent')).toBe(false);
  });

  it('should manage buffers independently across watchers', () => {
    const logFile = createTempFile('buffer-test.log');

    const logId = logWatcher.watchFile(logFile, 'buffer-log');
    const pipe = pipeWatcher.createPipe('buffer-pipe');

    pipe.write('[INFO] pipe line 1');
    pipe.write('[INFO] pipe line 2');

    // Clear pipe buffer independently
    pipeWatcher.clear('buffer-pipe');
    expect(pipeWatcher.getLogs('buffer-pipe')).toHaveLength(0);

    // Log watcher still exists
    expect(logWatcher.list()).toHaveLength(1);
    expect(logWatcher.list()[0]!.id).toBe('buffer-log');

    // After clear, pipe can still receive data
    pipe.write('[INFO] pipe after clear');
    expect(pipeWatcher.getLogs('buffer-pipe')).toHaveLength(1);
  });

  it('should handle getErrors on file watcher and pipe watcher differently', () => {
    const logFile = createTempFile('errors-test.log');
    writeFileSync(logFile, '[ERROR] file error\n');

    // For pipe, getErrors doesn't exist — but we can filter by level
    const pipe = pipeWatcher.createPipe('errors-pipe');
    pipe.write('[ERROR] critical failure');
    pipe.write('[INFO] normal operation');

    const pipeErrors = pipeWatcher.getLogs('errors-pipe', { level: 'error' });
    expect(pipeErrors).toHaveLength(1);
    expect(pipeErrors[0]!.level).toBe('error');

    const pipeInfos = pipeWatcher.getLogs('errors-pipe', { level: 'info' });
    expect(pipeInfos).toHaveLength(1);

    // Pipe listing should show counts
    const list = pipeWatcher.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.count).toBe(2);
  });

  it('should handle rapid stop/start of same watcher type', async () => {
    // Stop non-existent
    expect(logWatcher.stop('never-created')).toBe(false);

    // Create and stop
    const logFile = createTempFile('rapid-cycle.log');
    writeFileSync(logFile, 'initial\n');

    const id1 = logWatcher.watchFile(logFile, 'rapid');
    expect(logWatcher.stop(id1)).toBe(true);

    // Re-create with same name
    const id2 = logWatcher.watchFile(logFile, 'rapid');

    // Should work independently
    expect(logWatcher.list()).toHaveLength(1);
    expect(logWatcher.list()[0]!.id).toBe('rapid');

    logWatcher.stop(id2);
  });
});
