import { describe, it, expect, vi } from 'vitest';
import { ConsoleCollector } from '../../../src/cdp/ConsoleCollector.js';
import type { ConsoleEvent } from '../../../src/session/types.js';

function makeCdp() {
  const handlers: Record<string, (msg: unknown) => void> = {};
  return {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (msg: unknown) => void) => {
      handlers[event] = cb;
    }),
    handlers,
  };
}

describe('ConsoleCollector — ignorePatterns', () => {
  it('drops console errors matching an ignore pattern (e.g. Vite HMR websocket)', async () => {
    const cdp = makeCdp();
    const collector = new ConsoleCollector();
    const received: ConsoleEvent[] = [];
    collector.on('smart-hook', (e) => received.push(e));

    await collector.enable(cdp as never, {
      ignorePatterns: ['failed to connect to websocket'],
    });

    cdp.handlers['Console.messageAdded']!({
      message: {
        level: 'error',
        text: '[vite] failed to connect to websocket (SecurityError: Failed to construct WebSocket)',
        source: 'vite-client',
      },
    });

    expect(received).toHaveLength(0);
  });

  it('still emits console errors that do not match any ignore pattern', async () => {
    const cdp = makeCdp();
    const collector = new ConsoleCollector();
    const received: ConsoleEvent[] = [];
    collector.on('smart-hook', (e) => received.push(e));

    await collector.enable(cdp as never, {
      ignorePatterns: ['failed to connect to websocket'],
    });

    cdp.handlers['Console.messageAdded']!({
      message: { level: 'error', text: 'ReferenceError: foo is not defined', source: 'app.js' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.message).toMatch(/ReferenceError/);
  });

  it('supports regex ignore patterns and the Runtime.exceptionThrown path', async () => {
    const cdp = makeCdp();
    const collector = new ConsoleCollector();
    const received: ConsoleEvent[] = [];
    collector.on('smart-hook', (e) => received.push(e));

    await collector.enable(cdp as never, { ignorePatterns: ['/insecure websocket connection/i'] });

    cdp.handlers['Runtime.exceptionThrown']!({
      exceptionDetails: {
        text: "SecurityError: Failed to construct 'WebSocket': An insecure WebSocket connection",
      },
    });

    expect(received).toHaveLength(0);
  });

  it('emits everything when no ignore patterns are configured', async () => {
    const cdp = makeCdp();
    const collector = new ConsoleCollector();
    const received: ConsoleEvent[] = [];
    collector.on('smart-hook', (e) => received.push(e));

    await collector.enable(cdp as never);

    cdp.handlers['Console.messageAdded']!({
      message: { level: 'error', text: '[vite] failed to connect to websocket', source: 'vite' },
    });

    expect(received).toHaveLength(1);
  });
});
