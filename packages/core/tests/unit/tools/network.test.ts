import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  networkIntercept,
  networkRemoveIntercept,
  networkMockResponse,
} from '../../../src/tools/devtools/network.js';

describe('network_intercept tool', () => {
  it('should have correct name and description', () => {
    expect(networkIntercept.name).toBe('network_intercept');
    expect(networkIntercept.description).toContain('<use_case>');
    expect(networkIntercept.description).toContain('interceptorId');
  });

  it('should require urlPattern', () => {
    const result = networkIntercept.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid input', () => {
    const result = networkIntercept.inputSchema.safeParse({
      urlPattern: '**/api/**',
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional sessionId', () => {
    const result = networkIntercept.inputSchema.safeParse({
      urlPattern: '**/api/**',
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('sess_test');
    }
  });

  it('should allow empty urlPattern (Zod default, validated by Playwright)', () => {
    // Zod's z.string() allows empty strings — Playwright validates the pattern
    const result = networkIntercept.inputSchema.safeParse({
      urlPattern: '',
    });
    expect(result.success).toBe(true);
  });

  it('should strip unknown fields not in schema', () => {
    const result = networkIntercept.inputSchema.safeParse({
      urlPattern: '**/api/**',
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownField).toBeUndefined();
    }
  });
});

describe('network_remove_intercept tool', () => {
  it('should have correct name and description', () => {
    expect(networkRemoveIntercept.name).toBe('network_remove_intercept');
    expect(networkRemoveIntercept.description).toContain('<use_case>');
    expect(networkRemoveIntercept.description).toContain('interceptorId');
  });

  it('should require interceptorId', () => {
    const result = networkRemoveIntercept.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid input', () => {
    const result = networkRemoveIntercept.inputSchema.safeParse({
      interceptorId: 'int_123456_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional sessionId', () => {
    const result = networkRemoveIntercept.inputSchema.safeParse({
      interceptorId: 'int_123',
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
  });

  it('should reject non-string interceptorId', () => {
    const result = networkRemoveIntercept.inputSchema.safeParse({
      interceptorId: 123,
    });
    expect(result.success).toBe(false);
  });
});

describe('network_mock_response tool', () => {
  it('should have correct name and description', () => {
    expect(networkMockResponse.name).toBe('network_mock_response');
    expect(networkMockResponse.description).toContain('<use_case>');
    expect(networkMockResponse.description).toContain('mockId');
  });

  it('should require urlPattern', () => {
    const result = networkMockResponse.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept only urlPattern (defaults for others)', () => {
    const result = networkMockResponse.inputSchema.safeParse({
      urlPattern: '**/api/data',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.statusCode).toBe(200);
      expect(result.data.body).toBe('');
      expect(result.data.contentType).toBe('application/json');
    }
  });

  it('should accept custom status, body, and headers', () => {
    const result = networkMockResponse.inputSchema.safeParse({
      urlPattern: '**/api/data',
      statusCode: 500,
      body: JSON.stringify({ error: 'Server Error' }),
      contentType: 'application/json',
      headers: { 'x-custom': 'value123' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.statusCode).toBe(500);
      expect(result.data.body).toBe('{"error":"Server Error"}');
      expect(result.data.contentType).toBe('application/json');
      expect(result.data.headers?.['x-custom']).toBe('value123');
    }
  });

  it('should accept optional sessionId', () => {
    const result = networkMockResponse.inputSchema.safeParse({
      urlPattern: '**/api/data',
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid statusCode type', () => {
    const result = networkMockResponse.inputSchema.safeParse({
      urlPattern: '**/api/data',
      statusCode: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-object headers', () => {
    const result = networkMockResponse.inputSchema.safeParse({
      urlPattern: '**/api/data',
      headers: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should have inputSchema property of type ZodType', () => {
    expect(networkMockResponse.inputSchema).toBeDefined();
    expect(networkMockResponse.inputSchema).toBeInstanceOf(z.ZodType);
  });
});
