import { describe, it, expect } from 'vitest';
import { detectLogLevel, isErrorLine } from '../../../src/utils/levelDetector.js';

describe('detectLogLevel', () => {
  it('should detect error level from common patterns', () => {
    expect(detectLogLevel('[ERROR] something broke')).toBe('error');
    expect(detectLogLevel('Error: connection refused')).toBe('error');
    expect(detectLogLevel('Exception: type error')).toBe('error');
    expect(detectLogLevel('FATAL: out of memory')).toBe('error');
    expect(detectLogLevel('✗ Test failed')).toBe('error');
    expect(detectLogLevel('× Test failed')).toBe('error');
  });

  it('should detect warn level from common patterns', () => {
    expect(detectLogLevel('[WARN] deprecated API')).toBe('warn');
    expect(detectLogLevel('Warning: memory usage high')).toBe('warn');
    expect(detectLogLevel('⚠ Rate limit approaching')).toBe('warn');
  });

  it('should detect info level from common patterns', () => {
    expect(detectLogLevel('[INFO] server started')).toBe('info');
    expect(detectLogLevel('Server ready on port 3000')).toBe('info');
    expect(detectLogLevel('listening on port 8080')).toBe('info');
    expect(detectLogLevel('✓ All tests passed')).toBe('info');
    expect(detectLogLevel('✔ Build succeeded')).toBe('info');
  });

  it('should detect debug level from common patterns', () => {
    expect(detectLogLevel('[DEBUG] variable value: 42')).toBe('debug');
    expect(detectLogLevel('[DBG] tracing request')).toBe('debug');
    expect(detectLogLevel('verbose: connecting to db')).toBe('debug');
  });

  it('should return info as default for unrecognized lines', () => {
    expect(detectLogLevel('some random line')).toBe('info');
    expect(detectLogLevel('')).toBe('info');
    expect(detectLogLevel('   ')).toBe('info');
  });

  it('should be case insensitive', () => {
    expect(detectLogLevel('error')).toBe('error');
    expect(detectLogLevel('ERROR')).toBe('error');
    expect(detectLogLevel('Error')).toBe('error');
  });
});

describe('isErrorLine', () => {
  it('should return true for error lines', () => {
    expect(isErrorLine('[ERROR] crash')).toBe(true);
    expect(isErrorLine('Fatal: system halted')).toBe(true);
  });

  it('should return false for non-error lines', () => {
    expect(isErrorLine('[INFO] all good')).toBe(false);
    expect(isErrorLine('normal log line')).toBe(false);
    expect(isErrorLine('')).toBe(false);
  });
});
