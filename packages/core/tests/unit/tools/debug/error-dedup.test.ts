import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorDedup } from '../../../../src/tools/debug/error-dedup.js';

describe('ErrorDedup', () => {
  let dedup: ErrorDedup;

  beforeEach(() => {
    dedup = new ErrorDedup({ maxGroups: 10 });
  });

  describe('basic error grouping', () => {
    it('should store a single error', () => {
      const result = dedup.add(
        'TypeError: Cannot read property x',
        'Error: TypeError\n  at fn (app.js:10:20)',
      );
      expect(result).not.toBeNull();
      expect(result!.count).toBe(1);
      expect(result!.message).toBe('TypeError: Cannot read property x');
    });

    it('should dedup identical stack traces by incrementing count', () => {
      const stack = 'Error: TypeError\n  at fn (app.js:10:20)\n  at main (app.js:50:5)';

      dedup.add('TypeError: Cannot read property x', stack);
      const result = dedup.add('TypeError: Cannot read property x', stack);

      expect(result!.count).toBe(2);
    });

    it('should treat different stack traces as different errors', () => {
      dedup.add('Error A', 'Error A\n  at fn (a.js:1:1)');
      dedup.add('Error B', 'Error B\n  at fn (b.js:2:2)');

      expect(dedup.uniqueCount).toBe(2);
      expect(dedup.totalCount).toBe(2);
    });

    it('should normalize line numbers for dedup', () => {
      const stack1 = 'Error\n  at fn (app.js:10:20)';
      const stack2 = 'Error\n  at fn (app.js:42:99)';

      dedup.add('Same error', stack1);
      const result = dedup.add('Same error', stack2);

      // Should be deduped because line numbers are normalized
      expect(result!.count).toBe(2);
      expect(dedup.uniqueCount).toBe(1);
    });
  });

  describe('error without stack trace', () => {
    it('should handle errors without stack trace by hashing the message', () => {
      dedup.add('Simple error message');
      dedup.add('Simple error message');

      expect(dedup.totalCount).toBe(2);
      expect(dedup.uniqueCount).toBe(1);
    });
  });

  describe('noise filtering', () => {
    it('should ignore patterns from default ignore list', () => {
      dedup.add('WebSocket connection to ws://localhost failed');
      expect(dedup.uniqueCount).toBe(0);
    });

    it('should ignore custom patterns', () => {
      const custom = new ErrorDedup({
        ignorePatterns: ['deprecated', 'experimental'],
      });
      custom.add('This feature is deprecated');
      custom.add('This API is experimental');

      expect(custom.uniqueCount).toBe(0);
    });

    it('should return null for ignored messages', () => {
      const result = dedup.add('failed to connect to websocket');
      expect(result).toBeNull();
    });

    it('should not ignore non-matching messages', () => {
      dedup.add('Failed to fetch /api/users');
      expect(dedup.uniqueCount).toBe(1);
    });
  });

  describe('getSummary', () => {
    it('should return "No errors" when empty', () => {
      expect(dedup.getSummary()).toBe('No errors');
    });

    it('should return grouped summary with counts', () => {
      dedup.add('TypeError at user.ts', 'Error\n  at getUser (user.ts:10:5)');
      dedup.add('TypeError at user.ts', 'Error\n  at getUser (user.ts:10:5)');
      dedup.add('Timeout at api.js', 'Error\n  at fetch (api.js:20:5)');

      const summary = dedup.getSummary();
      expect(summary).toContain('TypeError');
      expect(summary).toContain('(2x)');
      expect(summary).toContain('(1x)');
    });

    it('should limit groups in summary to maxGroups', () => {
      for (let i = 0; i < 10; i++) {
        dedup.add(`Error ${i}`, `Error\n  at fn (file${i}.js:1:1)`);
      }

      const summary = dedup.getSummary(3);
      expect(summary.split('; ').length).toBeLessThanOrEqual(3);
    });
  });

  describe('clear', () => {
    it('should clear all groups', () => {
      dedup.add('Error 1');
      dedup.add('Error 2');
      expect(dedup.uniqueCount).toBe(2);

      dedup.clear();
      expect(dedup.uniqueCount).toBe(0);
      expect(dedup.totalCount).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest group when exceeding maxGroups', () => {
      const small = new ErrorDedup({ maxGroups: 3 });

      small.add('Error 1', 'Error\n  at fn (1.js:1:1)');
      small.add('Error 2', 'Error\n  at fn (2.js:1:1)');
      small.add('Error 3', 'Error\n  at fn (3.js:1:1)');
      small.add('Error 4', 'Error\n  at fn (4.js:1:1)'); // should evict Error 1

      expect(small.uniqueCount).toBe(3);
      const groups = small.getGroups();
      expect(groups.some((g) => g.message === 'Error 1')).toBe(false);
    });
  });

  describe('level detection', () => {
    it('should preserve the error level', () => {
      dedup.add('Critical error', undefined, 'critical');
      dedup.add('Normal error', undefined, 'error');
      dedup.add('Just a warning', undefined, 'warn');

      const groups = dedup.getGroups();
      expect(groups.find((g) => g.message === 'Critical error')!.level).toBe('critical');
      expect(groups.find((g) => g.message === 'Normal error')!.level).toBe('error');
      expect(groups.find((g) => g.message === 'Just a warning')!.level).toBe('warn');
    });
  });

  describe('topFrame extraction', () => {
    it('should extract top frame from stack trace', () => {
      const stack = 'Error\n  at getUser (user.ts:42:15)\n  at main (app.ts:1:1)';
      const result = dedup.add('Error in getUser', stack);
      expect(result!.topFrame).toContain('getUser');
      expect(result!.topFrame).toContain('user.ts');
    });

    it('should return undefined topFrame for errors without frames', () => {
      const result = dedup.add('Simple error');
      expect(result!.topFrame).toBeUndefined();
    });
  });
});
