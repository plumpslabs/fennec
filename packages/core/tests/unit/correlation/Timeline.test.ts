import { describe, it, expect } from 'vitest';
import { TimelineBuilder } from '../../../src/correlation/Timeline.js';
import type { BusEvent } from '../../../src/correlation/EventBus.js';

function makeEvent(type: BusEvent['type'], data: Record<string, unknown>, offsetMs = 0): BusEvent {
  return { type, data, timestamp: Date.now() + offsetMs };
}

describe('TimelineBuilder', () => {
  const builder = new TimelineBuilder();

  it('should sort events by timestamp', () => {
    const events = [
      makeEvent('browser:console', { level: 'error', message: 'second' }, 100),
      makeEvent('browser:console', { level: 'error', message: 'first' }, 0),
      makeEvent('browser:console', { level: 'error', message: 'third' }, 200),
    ];

    const timeline = builder.build(events);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]!.event).toContain('first');
    expect(timeline[1]!.event).toContain('second');
    expect(timeline[2]!.event).toContain('third');
  });

  it('should calculate relative timestamps', () => {
    const events = [
      makeEvent('browser:console', { level: 'info', message: 'start' }, 0),
      makeEvent('browser:console', { level: 'info', message: 'after 100ms' }, 100),
    ];

    const timeline = builder.build(events);
    expect(timeline[0]!.relativeMs).toBe(0);
    expect(timeline[1]!.relativeMs).toBe(100);
  });

  it('should map layers correctly', () => {
    const events = [
      makeEvent('browser:console', { level: 'info', message: 'browser event' }),
      makeEvent('process:stdout', { line: 'server output' }),
      makeEvent('terminal:log', { source: 'watcher', line: 'file log' }),
    ];

    const timeline = builder.build(events);
    expect(timeline.find((e) => e.layer === 'browser')).toBeDefined();
    expect(timeline.find((e) => e.layer === 'server')).toBeDefined();
    expect(timeline.find((e) => e.layer === 'terminal')).toBeDefined();
  });

  it('should handle single event', () => {
    const timeline = builder.build([
      makeEvent('browser:network', { method: 'GET', url: '/api/test', status: 200 }),
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.event).toContain('GET /api/test');
  });

  it('should handle empty events array', () => {
    const timeline = builder.build([]);
    expect(timeline).toHaveLength(0);
  });

  it('should format network events with status detail', () => {
    const events = [
      makeEvent('browser:network', { method: 'POST', url: '/api/login', status: 500 }),
    ];
    const timeline = builder.build(events);
    expect(timeline[0]!.detail).toBe('Status: 500');
  });
});
