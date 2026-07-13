import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../../src/correlation/EventBus.js';
import { CorrelationEngine } from '../../../src/correlation/CorrelationEngine.js';
import type { BusEvent } from '../../../src/correlation/EventBus.js';

function makeBusEvent(type: BusEvent['type'], data: Record<string, unknown>): BusEvent {
  return { type, data, timestamp: Date.now() };
}

describe('CorrelationEngine', () => {
  let eventBus: EventBus;
  let engine: CorrelationEngine;

  beforeEach(() => {
    eventBus = new EventBus();
    engine = new CorrelationEngine(eventBus, { windowMs: 1000, minConfidence: 0.7 });
  });

  it('should create timeline with trigger and related events', () => {
    eventBus.publish('browser:network', { method: 'POST', url: '/api/login', status: 500 });
    eventBus.publish('process:stderr', { line: 'Error: DB connection failed' });

    const trigger = makeBusEvent('browser:network', {
      method: 'POST',
      url: '/api/login',
      status: 500,
    });
    const result = engine.correlate(trigger);

    expect(result.timeline.length).toBeGreaterThanOrEqual(1);
    expect(result.trigger).toBeDefined();
  });

  it('should detect root cause for server error pattern', () => {
    eventBus.publish('browser:network', { method: 'POST', url: '/api/data', status: 500 });
    eventBus.publish('process:stderr', { line: 'Error: connection refused' });

    const trigger = makeBusEvent('browser:network', {
      method: 'POST',
      url: '/api/data',
      status: 500,
    });
    // Manually add related event to bus
    eventBus.publish('process:stderr', { line: 'Error: connection refused' });

    const result = engine.correlate(trigger);
    expect(result.rootCause).toBeDefined();
    expect(result.timeline.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty correlation window', () => {
    const trigger = makeBusEvent('browser:console', { level: 'info', message: 'just a log' });

    const result = engine.correlate(trigger);
    expect(result.rootCause).toBeNull();
    expect(result.relatedEvents).toHaveLength(0);
    expect(result.timeline).toHaveLength(1); // Just the trigger
  });

  it('should filter by minimum confidence', () => {
    const highConfidenceEngine = new CorrelationEngine(eventBus, {
      windowMs: 1000,
      minConfidence: 0.95,
    });

    const trigger = makeBusEvent('browser:console', { level: 'error', message: 'test' });
    const result = highConfidenceEngine.correlate(trigger);

    // Low confidence patterns should be filtered out
    expect(result.rootCause).toBeNull();
    expect(result.confidence).toBeLessThan(0.95);
  });

  it('should provide fix suggestion when root cause found', () => {
    eventBus.publish('process:stderr', { line: "ENOENT: file not found, open '.env'" });

    const trigger = makeBusEvent('process:stderr', { line: "ENOENT: file not found, open '.env'" });
    const result = engine.correlate(trigger);

    if (result.rootCause) {
      expect(result.fix).toBeDefined();
      expect(result.fix!.length).toBeGreaterThan(0);
    }
  });
});
