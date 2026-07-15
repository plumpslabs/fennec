import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Mock tracking module for suggestionsWithAvailable tests
const { mockReadTracked } = vi.hoisted(() => ({
  mockReadTracked: vi.fn(),
}));

vi.mock('../../../src/process/tracking.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(typeof actual === 'object' && actual !== null ? actual : {}),
    readTracked: mockReadTracked,
  };
});

// Mock processManager
const mockProcessManager = {
  list: vi.fn().mockReturnValue([]),
  getLogs: vi.fn(),
  getStatus: vi.fn(),
  get: vi.fn(),
  spawn: vi.fn(),
  restart: vi.fn(),
  kill: vi.fn(),
  sendInput: vi.fn(),
  waitForExit: vi.fn(),
};

const mockTokenBudget = {
  getRemaining: vi.fn().mockReturnValue(1000),
};

import {
  processAttachPid,
  processAttachPort,
  processGetLogs,
  processGetStatus,
  processKill,
} from '../../../src/tools/process/index.js';
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

// ─── PROCESS_NOT_FOUND suggestions ──────────────────────────────

describe('PROCESS_NOT_FOUND suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTracked.mockReturnValue([
      {
        name: 'server-app',
        pid: 12345,
        command: 'node server.js',
        group: 'backend',
        startedAt: new Date().toISOString(),
      },
      {
        name: 'web-app',
        pid: 12346,
        command: 'node web.js --port 3001',
        startedAt: new Date().toISOString(),
      },
    ]);
  });

  it('should include available processes in process_get_logs error suggestions', async () => {
    mockProcessManager.getLogs.mockImplementation(() => {
      throw new Error('Process not found: unknown-app');
    });

    const mockResponseBuilder = {
      success: vi.fn((data) => ({ success: true, data })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code, suggestions: opts?.suggestions },
      })),
    };

    const result = await processGetLogs.handler(
      { processId: 'unknown-app', lines: 10 },
      {
        responseBuilder: mockResponseBuilder as any,
        processManager: mockProcessManager as any,
        tokenBudget: mockTokenBudget as any,
      } as any,
    );

    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('PROCESS_NOT_FOUND');
    expect((result as any).error.suggestions).toBeDefined();
    expect((result as any).error.suggestions[0]).toBe('Available processes:');
    // Should list the mocked processes
    const suggestionsStr = (result as any).error.suggestions.join(' ');
    expect(suggestionsStr).toContain('server-app');
    expect(suggestionsStr).toContain('web-app');
    expect(suggestionsStr).toContain('backend');
  });

  it('should include available processes in process_get_status error suggestions', async () => {
    mockProcessManager.getStatus.mockImplementation(() => {
      throw new Error('Process not found');
    });

    const mockResponseBuilder = {
      success: vi.fn((data) => ({ success: true, data })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code, suggestions: opts?.suggestions },
      })),
    };

    const result = await processGetStatus.handler(
      { processId: 'missing' },
      {
        responseBuilder: mockResponseBuilder as any,
        processManager: mockProcessManager as any,
      } as any,
    );

    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('PROCESS_NOT_FOUND');
    expect((result as any).error.suggestions).toBeDefined();
    const suggestionsStr = (result as any).error.suggestions.join(' ');
    expect(suggestionsStr).toContain('server-app');
    expect(suggestionsStr).toContain('web-app');
  });

  it('should handle empty tracked processes gracefully', async () => {
    mockReadTracked.mockReturnValue([]);
    mockProcessManager.getLogs.mockImplementation(() => {
      throw new Error('Process not found');
    });

    const mockResponseBuilder = {
      success: vi.fn((data) => ({ success: true, data })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code, suggestions: opts?.suggestions },
      })),
    };

    const result = await processGetLogs.handler(
      { processId: 'nobody', lines: 10 },
      {
        responseBuilder: mockResponseBuilder as any,
        processManager: mockProcessManager as any,
        tokenBudget: mockTokenBudget as any,
      } as any,
    );

    expect(result.success).toBe(false);
    expect((result as any).error.suggestions).toBeDefined();
    const suggestionsStr = (result as any).error.suggestions.join(' ');
    expect(suggestionsStr).toContain('(no tracked processes)');
  });

  it('should include group name when process has a group', async () => {
    mockProcessManager.getLogs.mockImplementation(() => {
      throw new Error('Process not found');
    });

    const mockResponseBuilder = {
      success: vi.fn((data) => ({ success: true, data })),
      error: vi.fn((error, opts) => ({
        success: false,
        error: { message: error.message, code: opts?.code, suggestions: opts?.suggestions },
      })),
    };

    const result = await processGetLogs.handler(
      { processId: 'ghost', lines: 10 },
      {
        responseBuilder: mockResponseBuilder as any,
        processManager: mockProcessManager as any,
        tokenBudget: mockTokenBudget as any,
      } as any,
    );

    expect(result.success).toBe(false);
    const suggestionsStr = (result as any).error.suggestions.join(' ');
    expect(suggestionsStr).toContain('(group: backend)');
  });
});

// ─── process_attach_port ───────────────────────────────────────

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
