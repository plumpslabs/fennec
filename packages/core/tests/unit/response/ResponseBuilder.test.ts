import { describe, it, expect } from 'vitest';
import { ResponseBuilder, sanitize } from '../../../src/response/ResponseBuilder.js';

describe('ResponseBuilder', () => {
  const builder = new ResponseBuilder();
  const testMeta = { elapsed: 100, sessionId: 'sess_test', timestamp: '2024-01-01T00:00:00.000Z' };

  describe('success', () => {
    it('should create a success response with data and meta', () => {
      const response = builder.success({ foo: 'bar' }, testMeta);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ foo: 'bar' });
      expect(response.meta).toEqual(testMeta);
    });

    it('should auto-generate meta when not provided', () => {
      const response = builder.success({ result: 'ok' });
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ result: 'ok' });
      expect(response.meta.sessionId).toBe('');
      expect(response.meta.elapsed).toBe(0);
      expect(response.meta.timestamp).toBeDefined();
    });

    it('should handle empty data object', () => {
      const response = builder.success({}, testMeta);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({});
    });

    it('should handle complex nested data', () => {
      const data = {
        user: { name: 'John', roles: ['admin'] },
        count: 42,
        tags: ['a', 'b', 'c'],
      };
      const response = builder.success(data, testMeta);
      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
    });
  });

  describe('error', () => {
    it('should create an error response with default code', () => {
      const response = builder.error(new Error('Something broke'));
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('UNKNOWN');
      expect(response.error.message).toBe('Something broke');
      expect(response.error.suggestions).toEqual([]);
      expect(response.error.context).toEqual({});
    });

    it('should create an error response with custom code and suggestions', () => {
      const response = builder.error(new Error('Element not found'), {
        code: 'ELEMENT_NOT_FOUND',
        suggestions: ['Try a different selector', 'Check page content'],
        meta: testMeta,
      });
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('ELEMENT_NOT_FOUND');
      expect(response.error.suggestions).toHaveLength(2);
      expect(response.error.suggestions[0]).toBe('Try a different selector');
    });

    it('should include error context', () => {
      const response = builder.error(new Error('Timeout'), {
        code: 'TIMEOUT',
        context: { timeoutMs: 5000, currentUrl: 'https://example.com' },
      });
      expect(response.success).toBe(false);
      expect(response.error.context).toEqual({
        timeoutMs: 5000,
        currentUrl: 'https://example.com',
      });
    });

    it('should convert non-Error to Error', () => {
      const response = builder.error('string error');
      expect(response.success).toBe(false);
      expect(response.error.message).toBe('string error');
    });

    it('should handle null/undefined error', () => {
      const response = builder.error(null);
      expect(response.success).toBe(false);
      expect(response.error.message).toBe('null');
    });
  });

  describe('sanitize (circular-ref protection)', () => {
    it('should stringify a circular structure without throwing', () => {
      const a: Record<string, unknown> = { name: 'a' };
      const b: Record<string, unknown> = { name: 'b' };
      a.context = b;
      b.take_screenshot = a; // mimics the reported `context.take_screenshot` cycle
      const out = sanitize(a);
      expect(JSON.stringify(out)).toContain('[Circular]');
      expect(() => JSON.stringify(sanitize(a))).not.toThrow();
    });

    it('should drop functions and non-serializable values', () => {
      const data = { ok: 1, fn: () => 1, nested: { alsoFn: () => 'x' } };
      const out = sanitize(data) as Record<string, unknown>;
      expect(out.fn).toBeUndefined();
      expect((out.nested as Record<string, unknown>).alsoFn).toBeUndefined();
      expect(out.ok).toBe(1);
    });

    it('should keep success() serializable even with cycles in data', () => {
      const data: Record<string, unknown> = { step: 'take_screenshot' };
      data.context = data; // self-referential cycle
      const response = builder.success(data, { sessionId: 's1' });
      expect(() => JSON.stringify(response)).not.toThrow();
    });
  });
});
