import { describe, it, expect, beforeEach } from 'vitest';
import { PipeWatcher } from '../../../src/process/PipeWatcher.js';

describe('PipeWatcher', () => {
  let watcher: PipeWatcher;

  beforeEach(() => {
    watcher = new PipeWatcher(100);
  });

  it('should create a pipe and write data to it', () => {
    const pipe = watcher.createPipe('test-pipe');
    pipe.write('hello world');

    const logs = watcher.getLogs('test-pipe');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.line).toBe('hello world');
    expect(logs[0]!.level).toBe('info');
  });

  it('should detect error level in pipe data', () => {
    const pipe = watcher.createPipe('error-pipe');
    pipe.write('[ERROR] something broke');

    const logs = watcher.getLogs('error-pipe');
    expect(logs[0]!.level).toBe('error');
  });

  it('should store multiple lines from a single write', () => {
    const pipe = watcher.createPipe('multi-line');
    pipe.write('line one\nline two\nline three');

    const logs = watcher.getLogs('multi-line');
    expect(logs).toHaveLength(3);
  });

  it('should filter logs by level', () => {
    const pipe = watcher.createPipe('levels');
    pipe.write('[INFO] normal operation');
    pipe.write('[ERROR] critical failure');
    pipe.write('[WARN] caution');

    const errors = watcher.getLogs('levels', { level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toContain('critical failure');
  });

  it('should filter logs by keyword', () => {
    const pipe = watcher.createPipe('keywords');
    pipe.write('database connection established');
    pipe.write('server listening on port 3000');
    pipe.write('user login successful');

    const filtered = watcher.getLogs('keywords', { keyword: 'database' });
    expect(filtered).toHaveLength(1);
  });

  it('should limit logs by count', () => {
    const pipe = watcher.createPipe('limited');
    for (let i = 0; i < 10; i++) {
      pipe.write(`log entry ${i}`);
    }

    const logs = watcher.getLogs('limited', { lines: 3 });
    expect(logs).toHaveLength(3);
    expect(logs[0]!.line).toBe('log entry 7');
    expect(logs[2]!.line).toBe('log entry 9');
  });

  it('should clear buffer for a specific pipe', () => {
    const pipe = watcher.createPipe('clearable');
    pipe.write('data to clear');

    const count = watcher.clear('clearable');
    expect(count).toBe(1);

    const logs = watcher.getLogs('clearable');
    expect(logs).toHaveLength(0);
  });

  it('should list all active pipes', () => {
    watcher.createPipe('pipe-a');
    watcher.createPipe('pipe-b');

    const list = watcher.list();
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.pipeId === 'pipe-a')).toBeDefined();
    expect(list.find((p) => p.pipeId === 'pipe-b')).toBeDefined();
  });

  it('should return empty array for non-existent pipe in getLogs', () => {
    const logs = watcher.getLogs('nonexistent');
    expect(logs).toEqual([]);
  });

  it('should clean up all pipes', () => {
    watcher.createPipe('pipe-1');
    watcher.createPipe('pipe-2');
    expect(watcher.list()).toHaveLength(2);

    watcher.cleanup();
    expect(watcher.list()).toHaveLength(0);
  });

  it('should respect maxLines buffer limit', () => {
    const smallWatcher = new PipeWatcher(3);
    const pipe = smallWatcher.createPipe('small');

    for (let i = 0; i < 10; i++) {
      pipe.write(`line ${i}`);
    }

    const logs = smallWatcher.getLogs('small');
    expect(logs).toHaveLength(3);
    expect(logs[0]!.line).toBe('line 7');
    expect(logs[2]!.line).toBe('line 9');
  });

  // ─── Edge Cases: Empty Data ────────────────────────────────

  it('should handle empty string write (no-op)', () => {
    const pipe = watcher.createPipe('empty-string');
    pipe.write('');
    expect(watcher.getLogs('empty-string')).toHaveLength(0);
  });

  it('should handle whitespace-only data (filtered as empty)', () => {
    const pipe = watcher.createPipe('whitespace');
    pipe.write('   ');
    pipe.write('\t\t');
    pipe.write(' \n \n ');
    // All whitespace-only lines get filtered by .split().filter(l => l.trim())
    expect(watcher.getLogs('whitespace')).toHaveLength(0);
  });

  it('should handle newline-only input (all lines trimmed empty)', () => {
    const pipe = watcher.createPipe('newlines-only');
    pipe.write('\n\n\n');
    pipe.write('\r\n\r\n');
    expect(watcher.getLogs('newlines-only')).toHaveLength(0);
  });

  it('should handle write with only newlines between actual data', () => {
    const pipe = watcher.createPipe('interleaved-empty');
    pipe.write('first\n\n\nsecond\n\nthird');
    const logs = watcher.getLogs('interleaved-empty');
    expect(logs).toHaveLength(3);
    expect(logs[0]!.line).toBe('first');
    expect(logs[1]!.line).toBe('second');
    expect(logs[2]!.line).toBe('third');
  });

  it('should handle multiple consecutive empty writes', () => {
    const pipe = watcher.createPipe('consecutive-empty');
    pipe.write('');
    pipe.write('');
    pipe.write('real data');
    expect(watcher.getLogs('consecutive-empty')).toHaveLength(1);
  });

  // ─── Edge Cases: Newline Variants ──────────────────────────

  it('should handle Windows CRLF line endings', () => {
    const pipe = watcher.createPipe('crlf');
    pipe.write('line1\r\nline2\r\nline3');
    const logs = watcher.getLogs('crlf');
    expect(logs).toHaveLength(3);
    // CRLF split by \n: lines keep the trailing \r because .trim() in filter
    // only checks truthiness, but the original line is pushed
    expect(logs[0]!.line).toBe('line1\r');
    expect(logs[1]!.line).toBe('line2\r');
    expect(logs[2]!.line).toBe('line3');
  });

  it('should handle trailing newline (final empty line trimmed)', () => {
    const pipe = watcher.createPipe('trailing-newline');
    pipe.write('line one\nline two\n');
    expect(watcher.getLogs('trailing-newline')).toHaveLength(2);
  });

  it('should handle leading newline (first empty line trimmed)', () => {
    const pipe = watcher.createPipe('leading-newline');
    pipe.write('\nline one\nline two');
    expect(watcher.getLogs('leading-newline')).toHaveLength(2);
  });

  it('should handle mixed LF and CRLF in the same chunk', () => {
    const pipe = watcher.createPipe('mixed-line-endings');
    pipe.write('unix\nwindows\r\nmixed\n');
    const logs = watcher.getLogs('mixed-line-endings');
    expect(logs).toHaveLength(3);
    expect(logs[0]!.line).toBe('unix');
    // \r stays attached to the CRLF-split line
    expect(logs[1]!.line).toBe('windows\r');
    expect(logs[2]!.line).toBe('mixed');
  });

  // ─── Multi-line Data: Complex Scenarios ─────────────────────

  it('should detect mixed log levels from a multi-line chunk', () => {
    const pipe = watcher.createPipe('mixed-levels');
    pipe.write(
      '[INFO] startup complete\n[ERROR] db connection failed\n[WARN] memory high\n[DEBUG] cache hit',
    );
    const logs = watcher.getLogs('mixed-levels');
    expect(logs).toHaveLength(4);
    expect(logs[0]!.level).toBe('info');
    expect(logs[1]!.level).toBe('error');
    expect(logs[2]!.level).toBe('warn');
    expect(logs[3]!.level).toBe('debug');
  });

  it('should interleave writes across multiple pipe IDs', () => {
    const pipeA = watcher.createPipe('pipe-a');
    const pipeB = watcher.createPipe('pipe-b');
    pipeA.write('from a - 1');
    pipeB.write('from b - 1');
    pipeA.write('from a - 2');
    pipeB.write('from b - 2');

    expect(watcher.getLogs('pipe-a')).toHaveLength(2);
    expect(watcher.getLogs('pipe-a')[0]!.line).toBe('from a - 1');
    expect(watcher.getLogs('pipe-a')[1]!.line).toBe('from a - 2');
    expect(watcher.getLogs('pipe-b')).toHaveLength(2);
    expect(watcher.getLogs('pipe-b')[0]!.line).toBe('from b - 1');
    expect(watcher.getLogs('pipe-b')[1]!.line).toBe('from b - 2');
  });

  it('should handle a single write with hundreds of lines', () => {
    const bigWatcher = new PipeWatcher(500); // need capacity for 500 lines
    const pipe = bigWatcher.createPipe('hundreds');
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`line-${i}`);
    }
    pipe.write(lines.join('\n'));

    const logs = bigWatcher.getLogs('hundreds');
    expect(logs).toHaveLength(500);
    expect(logs[0]!.line).toBe('line-0');
    expect(logs[499]!.line).toBe('line-499');
  });

  // ─── Large Data Chunks ──────────────────────────────────────

  it('should handle a very long single line', () => {
    const pipe = watcher.createPipe('long-line');
    const longStr = 'A'.repeat(10000);
    pipe.write(longStr);

    const logs = watcher.getLogs('long-line');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.line).toHaveLength(10000);
  });

  it('should handle data chunk larger than maxLines (overflow trimmed)', () => {
    const tinyWatcher = new PipeWatcher(5);
    const pipe = tinyWatcher.createPipe('overflow');
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`data-${i}`);
    }
    pipe.write(lines.join('\n'));

    const logs = tinyWatcher.getLogs('overflow');
    expect(logs).toHaveLength(5);
    // Only the last 5 lines are kept
    expect(logs[0]!.line).toBe('data-95');
    expect(logs[4]!.line).toBe('data-99');
  });

  it('should handle chunk that exactly fills the buffer', () => {
    const preciseWatcher = new PipeWatcher(10);
    const pipe = preciseWatcher.createPipe('exact-fill');
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(`exact-${i}`);
    }
    pipe.write(lines.join('\n'));

    const logs = preciseWatcher.getLogs('exact-fill');
    expect(logs).toHaveLength(10);
    expect(logs[0]!.line).toBe('exact-0');
    expect(logs[9]!.line).toBe('exact-9');
  });

  it('should handle rapid sequential writes with backpressure-like pattern', () => {
    const pipe = watcher.createPipe('rapid-fire');
    for (let i = 0; i < 100; i++) {
      pipe.write(`fast-${i}`);
    }

    const logs = watcher.getLogs('rapid-fire');
    expect(logs).toHaveLength(100);
    expect(logs[0]!.line).toBe('fast-0');
    expect(logs[99]!.line).toBe('fast-99');
  });

  // ─── Edge Cases: Special Characters & Formatting ────────────

  it('should preserve lines with special characters', () => {
    const pipe = watcher.createPipe('special-chars');
    pipe.write('line with emoji 🦊🔥');
    pipe.write('line with unicode: ñoño あいうえお');
    pipe.write('line with <html> & "quotes"');
    pipe.write('line with trailing spaces   ');

    const logs = watcher.getLogs('special-chars');
    expect(logs).toHaveLength(4);
    expect(logs[0]!.line).toBe('line with emoji 🦊🔥');
    expect(logs[1]!.line).toBe('line with unicode: ñoño あいうえお');
    expect(logs[2]!.line).toBe('line with <html> & "quotes"');
    // Trailing spaces are NOT trimmed (only .trim() during split filtering)
    // But if the line is non-empty after trim, it passes through as-is
    expect(logs[3]!.line).toBe('line with trailing spaces   ');
  });

  // ─── Robustness: Write to Non-existent / Re-create ──────────

  it('should silently ignore write to non-existent pipe (buffer removed)', () => {
    const pipe = watcher.createPipe('temp');
    pipe.write('before cleanup');
    watcher.cleanup(); // buffer cleared

    // write() after cleanup should not throw because closure captures pipeId
    // but buffer is empty — it returns early via `if (!buffer) return;`
    expect(() => pipe.write('after cleanup')).not.toThrow();
  });

  it('should allow creating a new pipe with the same name after cleanup', () => {
    const pipe = watcher.createPipe('recreate');
    pipe.write('original data');
    watcher.cleanup();

    const pipe2 = watcher.createPipe('recreate');
    pipe2.write('new data');

    const logs = watcher.getLogs('recreate');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.line).toBe('new data');
  });

  it("should have each pipe's buffer isolated from others", () => {
    const pipe1 = watcher.createPipe('iso-1');
    const pipe2 = watcher.createPipe('iso-2');
    pipe1.write('only in pipe 1');
    expect(watcher.getLogs('iso-2')).toHaveLength(0);
    pipe2.write('only in pipe 2');
    expect(watcher.getLogs('iso-1')).toHaveLength(1);
  });

  it("should filter by 'since' timestamp", async () => {
    const pipe = watcher.createPipe('since-filter');
    pipe.write('before');

    await new Promise((r) => setTimeout(r, 5));
    const before = new Date().toISOString();
    // Extra wait so "after" gets a strictly later timestamp (> not >=)
    await new Promise((r) => setTimeout(r, 2));
    pipe.write('after');

    const logs = watcher.getLogs('since-filter', { since: before });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.line).toBe('after');
  });

  it('should not throw when clearing a non-existent pipe', () => {
    expect(() => watcher.clear('i-dont-exist')).not.toThrow();
    expect(watcher.clear('i-dont-exist')).toBe(0);
  });

  it('should handle mixed info/warn/error levels from multiple chunks', () => {
    const pipe = watcher.createPipe('multi-chunk-levels');
    pipe.write('[INFO] step 1 complete\n[WARN] step 2 slow');
    pipe.write('[ERROR] step 3 failed\n[INFO] rolling back');
    // Avoid /success/i matching "successful" before /debug/i can match "debug"
    pipe.write('[DEBUG] rollback finished');

    expect(watcher.getLogs('multi-chunk-levels', { level: 'error' })).toHaveLength(1);
    expect(watcher.getLogs('multi-chunk-levels', { level: 'info' })).toHaveLength(2);
    expect(watcher.getLogs('multi-chunk-levels', { level: 'warn' })).toHaveLength(1);
    expect(watcher.getLogs('multi-chunk-levels', { level: 'debug' })).toHaveLength(1);
  });

  it('should list counts that reflect current buffer size', () => {
    const pipe = watcher.createPipe('count-test');
    expect(watcher.list().find((p) => p.pipeId === 'count-test')!.count).toBe(0);
    pipe.write('one');
    expect(watcher.list().find((p) => p.pipeId === 'count-test')!.count).toBe(1);
    pipe.write('two');
    expect(watcher.list().find((p) => p.pipeId === 'count-test')!.count).toBe(2);
    watcher.clear('count-test');
    expect(watcher.list().find((p) => p.pipeId === 'count-test')!.count).toBe(0);
  });
});
