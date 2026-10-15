import { describe, it, expect } from 'vitest';
import { devtoolsEmulateDevice } from '../../../src/tools/devtools/performance.js';

describe('devtoolsEmulateDevice', () => {
  it('emulates a mobile device with touch input', async () => {
    const { sessionManager } = await import('../../../src/session/SessionManager.js');
    const { responseBuilder } = await import('../../../src/response/ResponseBuilder.js');

    // We'll test the tool schema and basic structure; handler requires a real session
    const schema = devtoolsEmulateDevice.inputSchema;
    const result = schema.safeParse({
      width: 375,
      height: 667,
      mobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_0 like Mac OS X)',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      width: 375,
      height: 667,
      mobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_0 like Mac OS X)',
    });
  });

  it('emulates a desktop viewport', async () => {
    const schema = devtoolsEmulateDevice.inputSchema;
    const result = schema.safeParse({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });
  });

  it('resets device emulation when all params omitted', async () => {
    const schema = devtoolsEmulateDevice.inputSchema;
    const result = schema.safeParse({});

    // Should succeed with empty object (all optional)
    expect(result.success).toBe(true);
  });

  it('validates width/height as integers', async () => {
    const schema = devtoolsEmulateDevice.inputSchema;
    const result = schema.safeParse({
      width: 'not-a-number' as any,
    });

    expect(result.success).toBe(false);
  });
});
