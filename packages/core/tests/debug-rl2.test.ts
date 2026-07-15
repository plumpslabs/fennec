import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/correlation/EventBus.js';
import { IncidentEngine } from '../src/incident/IncidentEngine.js';

describe('DEBUG v2', () => {
  it('trace mixed', () => {
    const bus = new EventBus();
    const engine = new IncidentEngine(bus, {
      windowMs: 1000,
      minConfidence: 0.7,
      unclassifiedCooldownMs: 0,
      maxUnclassifiedPerType: 10,
    });

    bus.publish('browser:console', { level: 'log', message: 'app log', source: 'http://app' });
    console.log('after console:', engine.getActiveIncidents().length, JSON.stringify(engine.getActiveIncidents().map(i => i.title)));

    bus.publish('process:stderr', { line: 'custom error' });
    console.log('after stderr:', engine.getActiveIncidents().length, JSON.stringify(engine.getActiveIncidents().map(i => i.title)));

    bus.publish('browser:network', { method: 'GET', url: 'http://localhost/x', status: 404, statusText: 'Not Found', duration: 0, type: 'fetch' });
    console.log('after network:', engine.getActiveIncidents().length, JSON.stringify(engine.getActiveIncidents().map(i => i.title)));

    bus.publish('process:exit', { code: 0, signal: null });
    console.log('after exit:', engine.getActiveIncidents().length, JSON.stringify(engine.getActiveIncidents().map(i => i.title)));

    // Try standalone process:exit
    const bus2 = new EventBus();
    const engine2 = new IncidentEngine(bus2, {
      windowMs: 1000, minConfidence: 0.7, unclassifiedCooldownMs: 0, maxUnclassifiedPerType: 10,
    });
    bus2.publish('process:exit', { code: 1, signal: 'SIGTERM' });
    console.log('standalone exit:', engine2.getActiveIncidents().length, JSON.stringify(engine2.getActiveIncidents().map(i => i.title)));

    // browser:console → NOISY, suppressed (browser:network also NOISY, suppressed)
    // browser:network:404 → NOISY, suppressed
    // process:stderr 'custom error' → no inference rule match, unclassified counter incremented
    // process:exit code 0 → related events include browser:network:404 → matches rule 'browser:network:404'
    // browser:network:404 itself matches inference rule → 1 incident
    expect(engine.getActiveIncidents()).toHaveLength(1);
  });

  it('trace exit standalone', () => {
    const bus = new EventBus();
    const engine = new IncidentEngine(bus, {
      windowMs: 1000, minConfidence: 0.7, unclassifiedCooldownMs: 0, maxUnclassifiedPerType: 10,
    });
    bus.publish('process:exit', { code: 1, signal: 'SIGTERM' });
    console.log('exit only:', engine.getActiveIncidents().length, JSON.stringify(engine.getActiveIncidents().map(i => ({title: i.title, tags: i.tags}))));
    expect(engine.getActiveIncidents()).toHaveLength(0);
  });
});
