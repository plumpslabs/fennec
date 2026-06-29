import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FennecServer } from '../../src/server.js';

// Mock all dependencies
vi.mock('../../src/session/SessionManager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    setEventBus: vi.fn(),
    getOrDefault: vi.fn().mockReturnValue({
      id: 'sess_test',
      page: { url: vi.fn().mockReturnValue('https://example.com'), screenshot: vi.fn() },
      context: { cookies: vi.fn().mockResolvedValue([]) },
      consoleBuffer: [],
      networkBuffer: [],
    }),
    getSession: vi.fn(),
    buildMeta: vi.fn().mockReturnValue({ elapsed: 0, sessionId: 'sess_test', timestamp: new Date().toISOString() }),
    addConsoleEvent: vi.fn(),
    addNetworkEvent: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    destroyAll: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/session/SessionStore.js', () => ({
  SessionStore: vi.fn().mockImplementation(() => ({
    save: vi.fn(),
    load: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  })),
}));

vi.mock('../../src/response/ResponseBuilder.js', () => ({
  ResponseBuilder: vi.fn().mockImplementation(() => ({
    success: vi.fn().mockImplementation((data) => ({ success: true, data })),
    error: vi.fn().mockImplementation((err, opts) => ({ success: false, error: { code: opts?.code ?? 'UNKNOWN', message: err.message } })),
  })),
}));

vi.mock('../../src/correlation/EventBus.js', () => ({
  EventBus: vi.fn().mockImplementation(() => ({
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    getHistory: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  })),
}));

vi.mock('../../src/config/ConfigLoader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    getConfig: vi.fn().mockReturnValue({
      browser: { type: 'chromium', headless: true, slowMo: 0, defaultTimeout: 30000, viewport: { width: 1280, height: 720 }, userAgent: null, locale: 'en-US', timezone: 'Asia/Jakarta', ignoreHTTPSErrors: false },
      session: { maxSessions: 10, idleTimeoutSecs: 1800, persistPath: './.fennec/sessions' },
      process: { maxProcesses: 10, logBufferLines: 2000, spawnAllowlist: ['npm', 'node'] },
      terminal: { logBufferLines: 2000, watchDebounceMs: 50 },
      network: { bufferSize: 1000, captureRequestBody: true, captureResponseBody: true, captureHeaders: true, slowRequestThresholdMs: 1000 },
      console: { bufferSize: 500, levels: ['log', 'info', 'warn', 'error', 'debug'] },
      correlation: { windowMs: 500, enableRootCauseInference: true, minConfidence: 0.7 },
      security: { sandbox: true, allowProcessSpawn: true, allowProcessKill: false, allowedDomains: [], blockedDomains: [], allowFileProtocol: false, allowCDPRawAccess: false, allowJSEvaluation: true, exportPath: './.fennec/exports', maxExportSizeMB: 10 },
      transport: { type: 'stdio', port: 3333, host: '127.0.0.1' },
      logging: { level: 'info', format: 'pretty', file: null },
    }),
  })),
}));

vi.mock('../../src/config/defaults.js', () => ({ defaultConfig: {} }));
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(),
  getLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../src/middleware/Pipeline.js', () => ({
  Pipeline: vi.fn().mockImplementation(() => ({
    use: vi.fn(),
    execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
  })),
}));

// Mock resource modules
vi.mock('../../src/resource/ResourceManager.js', () => ({
  ResourceManager: vi.fn().mockImplementation(() => ({
    startAutoCleanup: vi.fn(),
    startHealthChecks: vi.fn(),
    stopAutoCleanup: vi.fn(),
    stopHealthChecks: vi.fn(),
    releaseAll: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/state/index.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    setActiveSession: vi.fn(),
    getActiveSessionInfo: vi.fn(),
    getAllStates: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../../src/capability/Detector.js', () => ({
  CapabilityDetector: vi.fn(),
}));

vi.mock('../../src/planner/Planner.js', () => ({
  Planner: vi.fn(),
}));

vi.mock('../../src/workflow/WorkflowEngine.js', () => ({
  WorkflowEngine: vi.fn().mockImplementation(() => ({
    createDebugWorkflow: vi.fn(),
    createLoginWorkflow: vi.fn(),
    findByTag: vi.fn().mockReturnValue([]),
    setToolExecutor: vi.fn(),
    planToWorkflow: vi.fn(),
    executePlan: vi.fn().mockResolvedValue({ id: 'exec_test', status: 'completed', stepResults: [] }),
  })),
}));

vi.mock('../../src/recorder/Recorder.js', () => ({
  Recorder: vi.fn(),
}));

vi.mock('../../src/scheduler/WorkflowScheduler.js', () => ({
  WorkflowScheduler: vi.fn().mockImplementation(() => ({
    setToolExecutor: vi.fn(),
    addRules: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
    getLastScheduledResult: vi.fn(),
    listRules: vi.fn().mockReturnValue([]),
  })),
  // Static method
  default: { createDefaultRules: vi.fn().mockReturnValue([]) },
}));

vi.mock('../../src/utils/PerformanceMetrics.js', () => ({
  PerformanceMetrics: vi.fn().mockImplementation(() => ({
    startMemoryMonitoring: vi.fn(),
    stopMemoryMonitoring: vi.fn(),
    recordToolCall: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock('../../src/middleware/AuditLog.js', () => ({
  createAuditLog: vi.fn().mockReturnValue({
    middleware: vi.fn(),
    getAuditLog: vi.fn().mockReturnValue([]),
    clearAuditLog: vi.fn(),
  }),
}));

vi.mock('../../src/middleware/index.js', async (importOriginal) => {
  // Get the Pipeline mock from the Pipeline-specific mock
  const actual = await importOriginal();
  return {
    ...actual,
    Pipeline: vi.fn().mockImplementation(() => ({
      use: vi.fn(),
      execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
      getMiddlewares: vi.fn().mockReturnValue([]),
      insertBefore: vi.fn().mockReturnValue(true),
      insertAfter: vi.fn().mockReturnValue(true),
      remove: vi.fn().mockReturnValue(true),
      clear: vi.fn(),
    })),
    createPermissionGuard: vi.fn().mockReturnValue(vi.fn()),
    createRetryHandler: vi.fn().mockReturnValue(vi.fn()),
    createTelemetryMiddleware: vi.fn().mockReturnValue(vi.fn()),
    createSmartHook: vi.fn().mockReturnValue(vi.fn()),
    createAuditLog: vi.fn().mockReturnValue({ middleware: vi.fn(), getAuditLog: vi.fn().mockReturnValue([]), clearAuditLog: vi.fn() }),
  };
});

// Also mock WorkflowScheduler.createDefaultRules static
vi.mock('../../src/scheduler/index.js', () => ({
  WorkflowScheduler: vi.fn(),
}));

describe('FennecServer', () => {
  let server: FennecServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Set the static method on WorkflowScheduler mock via dynamic import
    const wfModule = await import('../../src/scheduler/WorkflowScheduler.js');
    wfModule.WorkflowScheduler.createDefaultRules = vi.fn().mockReturnValue([]);
    server = new FennecServer();
  });

  it('should initialize without error', () => {
    expect(server).toBeInstanceOf(FennecServer);
  });

  it('should register all tools', () => {
    // Verify via tool registry
    const registry = (server as any).toolRegistry;
    const tools = registry.getAll();
    // We need to check the mock registry
  });

  it('should have pipeline middleware registered', () => {
    // Pipeline should have been configured
    const pipeline = (server as any).pipeline;
    expect(pipeline).toBeDefined();
  });

  it('should have performance metrics running', () => {
    const metrics = (server as any).performanceMetrics;
    expect(metrics.startMemoryMonitoring).toHaveBeenCalled();
  });

  it('should have audit log created', () => {
    const auditLog = (server as any).auditLog;
    expect(auditLog).toBeDefined();
    expect(auditLog.getAuditLog).toBeDefined();
  });
});
