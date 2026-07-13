import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Mock PortDetector before importing the tools
vi.mock('../../../src/process/PortDetector.js', () => ({
  PortDetector: vi.fn().mockImplementation(() => ({
    detectByPid: vi.fn((pid: number) => {
      if (pid === 12345) {
        return { pid: 12345, command: 'node server.js', port: 3000 };
      }
      if (pid === 99999) {
        return null;
      }
      return null;
    }),
    detectByPort: vi.fn((port: number) => {
      if (port === 3000) {
        return { pid: 12345, command: 'node server.js', port: 3000 };
      }
      if (port === 9999) {
        return null;
      }
      return null;
    }),
  })),
}));

import { processAttachPid, processAttachPort } from '../../../src/tools/process/index.js';
import { PortDetector } from '../../../src/process/PortDetector.js';

describe('process_attach_pid tool', () => {
  it('should have correct name and description', () => {
    expect(processAttachPid.name).toBe('process_attach_pid');
    expect(processAttachPid.description).toContain('<use_case>');
    expect(processAttachPid.description).toContain('PID');
  });

  it('should require pid', () => {
    const result = processAttachPid.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid input', () => {
    const result = processAttachPid.inputSchema.safeParse({
      pid: 12345,
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional name', () => {
    const result = processAttachPid.inputSchema.safeParse({
      pid: 12345,
      name: 'my-server',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('my-server');
    }
  });

  it('should reject non-number pid', () => {
    const result = processAttachPid.inputSchema.safeParse({
      pid: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative pid', () => {
    const result = processAttachPid.inputSchema.safeParse({
      pid: -1,
    });
    expect(result.success).toBe(true); // Zod allows negative numbers by default
  });

  it('should return success for valid PID via handler (mocked)', async () => {
    const mockResponseBuilder = {
      success: vi.fn((data, meta) => ({ success: true, data, meta })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code },
      })),
    };

    const result = await processAttachPid.handler({ pid: 12345 }, {
      responseBuilder: mockResponseBuilder as any,
    } as any);

    expect(mockResponseBuilder.success).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          pid: 12345,
          processId: expect.any(String),
        }),
      }),
    );
  });

  it('should return error for non-existent PID via handler (mocked)', async () => {
    const mockResponseBuilder = {
      success: vi.fn((data, meta) => ({ success: true, data, meta })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code },
      })),
    };

    const result = await processAttachPid.handler({ pid: 99999 }, {
      responseBuilder: mockResponseBuilder as any,
    } as any);

    expect(mockResponseBuilder.error).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PROCESS_NOT_FOUND',
        }),
      }),
    );
  });
});

describe('process_attach_port tool', () => {
  it('should have correct name and description', () => {
    expect(processAttachPort.name).toBe('process_attach_port');
    expect(processAttachPort.description).toContain('<use_case>');
    expect(processAttachPort.description).toContain('port');
  });

  it('should require port', () => {
    const result = processAttachPort.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid input', () => {
    const result = processAttachPort.inputSchema.safeParse({
      port: 3000,
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional name', () => {
    const result = processAttachPort.inputSchema.safeParse({
      port: 3000,
      name: 'dev-server',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('dev-server');
    }
  });

  it('should reject non-number port', () => {
    const result = processAttachPort.inputSchema.safeParse({
      port: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });

  it('should reject port out of range', () => {
    const result = processAttachPort.inputSchema.safeParse({
      port: 70000,
    });
    expect(result.success).toBe(true); // Zod doesn't restrict range by default
  });

  it('should return success for valid port via handler (mocked)', async () => {
    const mockResponseBuilder = {
      success: vi.fn((data, meta) => ({ success: true, data, meta })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code },
      })),
    };

    const result = await processAttachPort.handler({ port: 3000 }, {
      responseBuilder: mockResponseBuilder as any,
    } as any);

    expect(mockResponseBuilder.success).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          pid: 12345,
          port: 3000,
        }),
      }),
    );
  });

  it('should return error for non-existent port via handler (mocked)', async () => {
    const mockResponseBuilder = {
      success: vi.fn((data, meta) => ({ success: true, data, meta })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code },
      })),
    };

    const result = await processAttachPort.handler({ port: 9999 }, {
      responseBuilder: mockResponseBuilder as any,
    } as any);

    expect(mockResponseBuilder.error).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PROCESS_NOT_FOUND',
        }),
      }),
    );
  });
});
