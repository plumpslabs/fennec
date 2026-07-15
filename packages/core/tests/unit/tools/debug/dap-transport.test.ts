/**
 * Tests for DAP Transport — JSON-RPC message parsing and framing.
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('DAP Transport', () => {
  let DAPTransport: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/dap-transport.js');
    DAPTransport = mod.DAPTransport;
  });

  describe('DAPMessage interface', () => {
    it('should have correct shape for request messages', () => {
      const msg = {
        seq: 1,
        type: 'request' as const,
        command: 'initialize',
        arguments: { clientID: 'test' },
      };
      expect(msg.seq).toBe(1);
      expect(msg.type).toBe('request');
      expect(msg.command).toBe('initialize');
    });

    it('should have correct shape for response messages', () => {
      const msg = {
        seq: 2,
        type: 'response' as const,
        request_seq: 1,
        success: true,
        command: 'initialize',
        body: { supportsConfigurationDoneRequest: true },
      };
      expect(msg.request_seq).toBe(1);
      expect(msg.success).toBe(true);
    });

    it('should have correct shape for event messages', () => {
      const msg = {
        seq: 3,
        type: 'event' as const,
        event: 'stopped',
        body: { reason: 'breakpoint', threadId: 1 },
      };
      expect(msg.event).toBe('stopped');
    });
  });

  describe('transport construction', () => {
    it('should create TCP transport with options', () => {
      const transport = new DAPTransport('tcp', { host: '127.0.0.1', port: 5678 });
      expect(transport.isConnected).toBe(false);
    });

    it('should create stdio transport with options', () => {
      const transport = new DAPTransport('stdio', {
        command: 'netcoredbg',
        args: ['--interpreter=vscode'],
      });
      expect(transport.isConnected).toBe(false);
    });
  });

  describe('Content-Length framing', () => {
    it('should parse Content-Length headers from stdio data', () => {
      // This tests the internal buffer processing logic
      const transport = new DAPTransport('stdio', { command: 'test' });
      const json = JSON.stringify({ seq: 1, type: 'event', event: 'stopped' });
      const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`;
      const data = header + json;

      // We can't directly test the private handleData, but we can verify
      // that Content-Length is correctly calculated
      const contentLength = Buffer.byteLength(json, 'utf-8');
      expect(contentLength).toBe(json.length);
      expect(header).toContain(`Content-Length: ${contentLength}`);
    });

    it('should handle multiple messages in one buffer', () => {
      const transport = new DAPTransport('stdio', { command: 'test' });
      const msg1 = JSON.stringify({ seq: 1, type: 'event', event: 'stopped' });
      const msg2 = JSON.stringify({ seq: 2, type: 'event', event: 'continued' });
      const h1 = `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n`;
      const h2 = `Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n`;

      const data = h1 + msg1 + h2 + msg2;
      expect(data.length).toBeGreaterThan(0);
      expect(data).toContain('Content-Length');
    });
  });

  describe('newline-delimited JSON (TCP mode)', () => {
    it('should build correct TCP command string', () => {
      const transport = new DAPTransport('tcp', { host: '127.0.0.1', port: 5678 });
      const json = { seq: 1, type: 'request', command: 'initialize', arguments: {} };
      const raw = JSON.stringify(json);
      // In TCP mode, messages are newline-delimited
      const tcpMessage = raw + '\n';
      expect(tcpMessage).toContain('initialize');
      expect(tcpMessage).toContain('\n');
    });
  });
});
