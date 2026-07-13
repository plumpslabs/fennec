import { describe, it, expect } from 'vitest';
import { ErrorEnricher } from '../../../src/response/ErrorEnricher.js';

describe('ErrorEnricher', () => {
  const enricher = new ErrorEnricher();

  it('should return empty context when session is null', async () => {
    const context = await enricher.enrich(null);
    expect(context).toEqual({});
  });

  it('should not include server logs when session is null', async () => {
    // The enrich method returns early when session is null,
    // so serverLogs from extra won't be included
    const context = await enricher.enrich(null, {
      serverLogs: ['Error: DB connection failed'],
    });
    expect(context.serverLogs).toBeUndefined();
  });

  it('should gracefully handle null extra parameter', async () => {
    const context = await enricher.enrich(null);
    expect(context).toEqual({});
  });
});
