import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  networkIntercept,
  networkRemoveIntercept,
  networkMockResponse,
  networkApiCall,
} from '../../../src/tools/devtools/network.js';
import { NetworkCollector } from '../../../src/cdp/NetworkCollector.js';

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

describe('NetworkCollector response body', () => {
  it('captures responseBody via Network.getResponseBody on loadingFinished', async () => {
    const collector = new NetworkCollector();
    const handlers: Record<string, (msg: unknown) => void> = {};
    const send = vi.fn(async (method: string, _params: unknown) => {
      if (method === 'Network.getResponseBody')
        return { body: '{"ok":true}', base64Encoded: false };
      return {};
    });

    await collector.enable({
      send,
      on: (event: string, cb: (msg: unknown) => void) => {
        handlers[event] = cb;
      },
    } as any);

    handlers['Network.requestWillBeSent']!({
      requestId: '1',
      request: { url: 'http://x/api', method: 'GET' },
      type: 'fetch',
      timestamp: 1,
    });
    handlers['Network.responseReceived']!({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        headers: {},
        requestTime: 1,
        timing: { requestTime: 1, sendStart: 1, sendEnd: 1, receiveHeadersEnd: 1 },
      },
      timestamp: 1,
    });
    handlers['Network.loadingFinished']!({ requestId: '1', encodedDataLength: 0, timestamp: 1.1 });

    // fetchResponseBody is fire-and-forget; let it resolve.
    await new Promise((r) => setTimeout(r, 20));

    const ev = collector.getEvents().find((e) => e.requestId === '1');
    expect(send).toHaveBeenCalledWith('Network.getResponseBody', { requestId: '1' });
    expect(ev?.responseBody).toBe('{"ok":true}');
  });

  it('decodes base64-encoded response bodies', async () => {
    const collector = new NetworkCollector();
    const handlers: Record<string, (msg: unknown) => void> = {};
    const payload = Buffer.from('hello').toString('base64');
    const send = vi.fn(async (method: string) => {
      if (method === 'Network.getResponseBody') return { body: payload, base64Encoded: true };
      return {};
    });

    await collector.enable({
      send,
      on: (event: string, cb: (msg: unknown) => void) => {
        handlers[event] = cb;
      },
    } as any);

    handlers['Network.requestWillBeSent']!({
      requestId: '2',
      request: { url: 'http://x/b', method: 'GET' },
      type: 'fetch',
      timestamp: 1,
    });
    handlers['Network.responseReceived']!({
      requestId: '2',
      response: { status: 200, statusText: 'OK', headers: {} },
      timestamp: 1,
    });
    handlers['Network.loadingFinished']!({ requestId: '2', encodedDataLength: 0, timestamp: 1.1 });

    await new Promise((r) => setTimeout(r, 20));

    const ev = collector.getEvents().find((e) => e.requestId === '2');
    expect(ev?.responseBody).toBe('hello');
  });
});

describe('network_api_call tool', () => {
  it('should have correct name and description', () => {
    expect(networkApiCall.name).toBe('network_api_call');
    expect(networkApiCall.description).toContain('<use_case>');
    expect(networkApiCall.description).toContain('API Client');
  });

  it('should require url', () => {
    const result = networkApiCall.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid url and default GET method', () => {
    const result = networkApiCall.inputSchema.safeParse({
      url: 'https://api.example.com/data',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe('GET');
      expect(result.data.timeout).toBe(10000);
    }
  });

  it('should accept custom method, headers, and body', () => {
    const result = networkApiCall.inputSchema.safeParse({
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"test": true}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe('POST');
      expect(result.data.body).toBe('{"test": true}');
    }
  });
});
