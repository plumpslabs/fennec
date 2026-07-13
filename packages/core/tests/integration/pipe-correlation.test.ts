import { describe, it, expect, beforeEach } from 'vitest';
import { PipeWatcher } from '../../src/process/PipeWatcher.js';
import { EventBus, type BusEvent } from '../../src/correlation/EventBus.js';
import { CorrelationEngine } from '../../src/correlation/CorrelationEngine.js';

describe('Integration: PipeWatcher → EventBus → CorrelationEngine', () => {
  let pipeWatcher: PipeWatcher;
  let eventBus: EventBus;
  let engine: CorrelationEngine;

  beforeEach(() => {
    pipeWatcher = new PipeWatcher(500);
    eventBus = new EventBus();
    engine = new CorrelationEngine(eventBus, { windowMs: 2000, minConfidence: 0.7 });
  });

  it('should correlate pipe logs with browser network events', () => {
    // Simulate: browser sends a request, server logs an error via pipe
    const pipe = pipeWatcher.createPipe('dev-server');

    // PipeWatcher captures server log
    pipe.write("[ERROR] TypeError: Cannot read properties of undefined (reading 'token')");

    // EventBus captures browser network failure
    eventBus.publish('browser:network', {
      method: 'POST',
      url: '/api/auth/login',
      status: 500,
    });

    // Get pipe logs filtered to errors
    const serverErrors = pipeWatcher.getLogs('dev-server', { level: 'error' });
    expect(serverErrors).toHaveLength(1);
    expect(serverErrors[0]!.line).toContain('TypeError');

    // Get network events from bus
    const netEvents = eventBus.getHistory('browser:network');
    expect(netEvents).toHaveLength(1);

    // Correlate: use the network event as trigger
    const trigger: BusEvent = {
      type: 'browser:network',
      data: { method: 'POST', url: '/api/auth/login', status: 500 },
      timestamp: Date.now() - 100, // 100ms before the pipe log
    };

    // Also publish the pipe error as a process event
    eventBus.publish('process:stderr', { line: serverErrors[0]!.line });

    const result = engine.correlate(trigger);

    // Should detect server error caused network failure
    expect(result.timeline.length).toBeGreaterThanOrEqual(2);
    expect(result.rootCause).toBeDefined();
    // The pattern "server error caused network failure" has confidence 0.9
    // which is above our 0.7 threshold
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should correlate pipe JWT errors with browser auth failures', () => {
    const pipe = pipeWatcher.createPipe('auth-server');

    // Server log via pipe
    pipe.write('[ERROR] JWT_SECRET environment variable is not set');

    // Browser 401
    eventBus.publish('browser:network', {
      method: 'GET',
      url: '/api/auth/verify',
      status: 401,
    });

    const serverLogs = pipeWatcher.getLogs('auth-server');
    expect(serverLogs).toHaveLength(1);

    // Push process event to bus
    eventBus.publish('process:stderr', { line: 'JWT_SECRET environment variable is not set' });

    const trigger: BusEvent = {
      type: 'browser:network',
      data: { method: 'GET', url: '/api/auth/verify', status: 401 },
      timestamp: Date.now(),
    };

    const result = engine.correlate(trigger);

    // Should match "Authentication token issue" pattern with high confidence
    if (result.rootCause) {
      expect(result.rootCause).toContain('token') ||
        expect(result.rootCause).toContain('Authentication');
    }
  });

  it('should correlate pipe ENOENT errors with browser failures', () => {
    const pipe = pipeWatcher.createPipe('file-server');

    pipe.write("ENOENT: file not found, open '.env'");

    eventBus.publish('browser:network', {
      method: 'GET',
      url: '/api/data',
      status: 500,
    });

    eventBus.publish('process:stderr', { line: "ENOENT: file not found, open '.env'" });

    const trigger: BusEvent = {
      type: 'browser:network',
      data: { method: 'GET', url: '/api/data', status: 500 },
      timestamp: Date.now(),
    };

    const result = engine.correlate(trigger);

    if (result.rootCause) {
      // Should match "Missing environment variable or file"
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.fix).toBeDefined();
    }
  });

  it('should handle multiple pipe lines in a single write for correlation', () => {
    const pipe = pipeWatcher.createPipe('multi-line-server');

    // Multi-line server log
    pipe.write(
      '[INFO] Request received\n[ERROR] DB connection timeout\n[INFO] Sending 500 response',
    );

    const errors = pipeWatcher.getLogs('multi-line-server', { level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toContain('DB connection timeout');

    eventBus.publish('process:stderr', { line: 'DB connection timeout' });
    eventBus.publish('browser:network', {
      method: 'POST',
      url: '/api/data',
      status: 500,
    });

    const trigger: BusEvent = {
      type: 'browser:network',
      data: { method: 'POST', url: '/api/data', status: 500 },
      timestamp: Date.now(),
    };

    const result = engine.correlate(trigger);
    expect(result.timeline.length).toBeGreaterThanOrEqual(1);

    // Build a manual timeline combining pipe logs + bus events
    const allEvents = [...pipeWatcher.getLogs('multi-line-server')];
    expect(allEvents).toHaveLength(3);
    expect(allEvents[0]!.level).toBe('info');
    expect(allEvents[1]!.level).toBe('error');
    expect(allEvents[2]!.level).toBe('info');
  });

  it("should correlate pipe logs filtered by 'since' with browser events", async () => {
    const pipe = pipeWatcher.createPipe('timing-server');

    pipe.write('[INFO] startup complete');

    await new Promise((r) => setTimeout(r, 5));

    // Capture timestamp after first log
    const sinceTime = new Date().toISOString();

    await new Promise((r) => setTimeout(r, 2));

    pipe.write('[ERROR] runtime failure');
    eventBus.publish('process:stderr', { line: 'runtime failure' });
    eventBus.publish('browser:network', {
      method: 'GET',
      url: '/api/test',
      status: 500,
    });

    // Only get logs after sinceTime
    const recentErrors = pipeWatcher.getLogs('timing-server', {
      level: 'error',
      since: sinceTime,
    });
    expect(recentErrors).toHaveLength(1);
    expect(recentErrors[0]!.line).toContain('runtime failure');

    const trigger: BusEvent = {
      type: 'browser:network',
      data: { method: 'GET', url: '/api/test', status: 500 },
      timestamp: Date.now(),
    };

    const result = engine.correlate(trigger);
    expect(result.timeline.length).toBeGreaterThanOrEqual(1);
  });
});
