import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../../src/correlation/EventBus.js';
import { IncidentEngine } from '../../../src/incident/IncidentEngine.js';

const now = () => Date.now();

describe('IncidentEngine — network:0 root-cause', () => {
  let bus: EventBus;
  let engine: IncidentEngine;

  beforeEach(() => {
    bus = new EventBus();
    engine = new IncidentEngine(bus, { windowMs: 1000, minConfidence: 0.7 });
  });

  it('classifies a lone status:0 request as ambiguous at lower confidence (not CORS)', () => {
    bus.publish('browser:network', {
      method: 'GET',
      url: 'http://localhost:5173/@vite/client',
      status: 0,
      statusText: '',
      duration: 0,
      type: 'fetch',
    });

    const incidents = engine.getActiveIncidents();
    expect(incidents).toHaveLength(1);
    const inc = incidents[0]!;
    expect(inc.confidence).toBe(0.7);
    expect(inc.rootCause).not.toMatch(/CORS or mixed-content blocked request/i);
    expect(inc.rootCause).toMatch(/cause ambiguous/i);
  });

  it('classifies a status:0 request with a CORS console error as CORS/mixed-content at higher confidence', () => {
    // console error arrives first, network failure follows (within window)
    bus.publish('browser:console', {
      level: 'error',
      message:
        "Access to fetch at 'http://api' from origin 'http://app' has been blocked by CORS policy",
      source: 'http://app',
    });
    bus.publish('browser:network', {
      method: 'GET',
      url: 'http://api/resource',
      status: 0,
      statusText: '',
      duration: 0,
      type: 'fetch',
    });

    const incidents = engine.getActiveIncidents();
    expect(incidents).toHaveLength(1);
    const inc = incidents[0]!;
    expect(inc.confidence).toBe(0.9);
    expect(inc.rootCause).toMatch(/CORS or mixed-content blocked request/i);
  });

  it('does not classify a Vite HMR websocket error as CORS (no console confirmation)', () => {
    // Simulate the report: a websocket request fails (status 0) but the console
    // error has been filtered out (ignorePatterns). Only the network event remains.
    bus.publish('browser:network', {
      method: 'GET',
      url: 'ws://localhost:5173/',
      status: 0,
      statusText: '',
      duration: 0,
      type: 'websocket',
    });

    const incidents = engine.getActiveIncidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.rootCause).not.toMatch(/CORS or mixed-content blocked request/i);
  });

  it('attaches raw evidence to the incident', () => {
    bus.publish('browser:network', {
      method: 'GET',
      url: 'http://localhost:5173/x',
      status: 0,
      statusText: '',
      duration: 0,
      type: 'fetch',
    });

    const inc = engine.getActiveIncidents()[0]!;
    expect(inc.evidence).toBeDefined();
    expect(inc.evidence.trigger.type).toBe('browser:network');
    expect(inc.evidence.related).toBeInstanceOf(Array);
  });
});
