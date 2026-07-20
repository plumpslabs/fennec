import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '../../../src/tools/_registry.js';
import type { FennecLogger } from '../../../src/utils/logger.js';

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockListConnections = vi.fn();
const mockQuery = vi.fn();
const mockSchema = vi.fn();
const mockTables = vi.fn();
const mockExplain = vi.fn();
const mockStats = vi.fn();
const mockSetLogger = vi.fn();
const mockAfterRequest = vi.fn();

vi.mock('../../../src/db/dbTuiManager.js', () => ({
  getDbManager: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    listConnections: mockListConnections,
    query: mockQuery,
    schema: mockSchema,
    tables: mockTables,
    explain: mockExplain,
    stats: mockStats,
    setLogger: mockSetLogger,
    afterRequest: mockAfterRequest,
  }),
}));

vi.mock('../../../src/db/credentials.js', () => ({
  getConnection: vi.fn(),
  addConnection: vi.fn(),
  removeConnection: vi.fn(),
  credentialStore: { save: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));

const mockMeta = { sessionId: 'test', elapsed: 0, timestamp: new Date().toISOString() };
const mockResponseBuilder = {
  success: vi.fn((data: any) => ({ success: true as const, data, meta: mockMeta })),
  error: vi.fn((err: any, opts?: any) => ({
    success: false as const,
    error: {
      code: opts?.code || 'UNKNOWN',
      message: err.message,
      suggestions: opts?.suggestions || [],
      context: {},
    },
    meta: mockMeta,
  })),
};

function createMockLogger(): FennecLogger {
  return {
    level: 'info' as const,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as FennecLogger;
}

const mockLogger = createMockLogger();

function mockContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionManager: {} as any,
    responseBuilder: mockResponseBuilder as any,
    config: {} as any,
    logger: mockLogger,
    processManager: {} as any,
    logWatcher: {} as any,
    sessionStore: {} as any,
    resourceManager: {} as any,
    stateManager: {} as any,
    capabilityDetector: {} as any,
    planner: {} as any,
    workflowEngine: {} as any,
    pluginSystem: {} as any,
    recorder: {} as any,
    workflowScheduler: {} as any,
    eventBus: {} as any,
    lazyContext: {} as any,
    incidentEngine: {} as any,
    performanceMetrics: {} as any,
    ...overrides,
  };
}

describe('db tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function loadTools() {
    return import('../../../src/tools/db/index.js');
  }

  describe('db_connect', () => {
    it('should connect and save credentials', async () => {
      mockConnect.mockResolvedValue({ type: 'postgresql', database: 'mydb', version: '15' });
      const { dbConnect } = await loadTools();
      const result = await dbConnect.handler(
        { name: 'testdb', url: 'postgres://localhost/mydb', save: true },
        mockContext(),
      );
      expect(mockConnect).toHaveBeenCalledWith('testdb', 'postgres://localhost/mydb');
      expect(mockAfterRequest).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle connection error', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));
      const { dbConnect } = await loadTools();
      const result: any = await dbConnect.handler(
        { name: 'testdb', url: 'postgres://localhost/mydb', save: true },
        mockContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('DB_CONNECT_ERROR');
    });
  });

  describe('db_disconnect', () => {
    it('should disconnect', async () => {
      mockDisconnect.mockResolvedValue(undefined);
      const { dbDisconnect } = await loadTools();
      const result = await dbDisconnect.handler({ name: 'testdb' }, mockContext());
      expect(mockDisconnect).toHaveBeenCalledWith('testdb');
      expect(result.success).toBe(true);
    });
  });

  describe('db_list', () => {
    it('should list connections', async () => {
      mockListConnections.mockResolvedValue([{ name: 'testdb', connected: true }]);
      const { dbList } = await loadTools();
      const result: any = await dbList.handler({}, mockContext());
      expect((result as any).data.connections).toEqual([{ name: 'testdb', connected: true }]);
    });
  });

  describe('db_query', () => {
    it('should execute query with defaults', async () => {
      mockQuery.mockResolvedValue({ columns: ['id'], rows: [[1]], duration: '2ms', rowCount: 1 });
      const { dbQuery } = await loadTools();
      const result: any = await dbQuery.handler(
        { name: 'testdb', sql: 'SELECT 1', maxRows: 1000, strict: true },
        mockContext(),
      );
      expect(mockQuery).toHaveBeenCalledWith('testdb', 'SELECT 1', { maxRows: 1000, strict: true });
      expect((result as any).data.rowCount).toBe(1);
    });

    it('should handle query error', async () => {
      mockQuery.mockRejectedValue(new Error('syntax error'));
      const { dbQuery } = await loadTools();
      const result: any = await dbQuery.handler(
        { name: 'testdb', sql: 'SELECT INVALID' },
        mockContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('DB_QUERY_ERROR');
    });
  });

  describe('db_schema', () => {
    it('should fetch schema', async () => {
      mockSchema.mockResolvedValue({ databases: [] });
      const { dbSchema } = await loadTools();
      const result = await dbSchema.handler({ name: 'testdb' }, mockContext());
      expect(mockSchema).toHaveBeenCalledWith('testdb', undefined);
      expect(result.success).toBe(true);
    });
  });

  describe('db_tables', () => {
    it('should list tables', async () => {
      mockTables.mockResolvedValue({ tables: [{ name: 'users', rowCount: 100 }] });
      const { dbTables } = await loadTools();
      const result: any = await dbTables.handler(
        { name: 'testdb', database: 'mydb' },
        mockContext(),
      );
      expect(mockTables).toHaveBeenCalledWith('testdb', 'mydb');
      expect((result as any).data.tables).toHaveLength(1);
    });
  });

  describe('db_ping', () => {
    it('should ping and return latency', async () => {
      mockQuery.mockResolvedValue({ duration: '3ms' });
      const { dbPing } = await loadTools();
      const result: any = await dbPing.handler({ name: 'testdb' }, mockContext());
      expect(mockQuery).toHaveBeenCalledWith('testdb', 'SELECT 1');
      expect((result as any).data.latency).toBe('3ms');
    });
  });

  describe('db_explain', () => {
    it('should get query plan', async () => {
      mockExplain.mockResolvedValue({ plan: 'Seq Scan on users', duration: '1ms' });
      const { dbExplain } = await loadTools();
      const result: any = await dbExplain.handler(
        { name: 'testdb', sql: 'SELECT * FROM users' },
        mockContext(),
      );
      expect(mockExplain).toHaveBeenCalledWith('testdb', 'SELECT * FROM users');
      expect((result as any).data.plan).toBe('Seq Scan on users');
    });
  });

  describe('db_stats', () => {
    it('should get database stats', async () => {
      mockStats.mockResolvedValue({
        database: 'mydb',
        sizeMB: 10.5,
        tableCount: 15,
        activeConnections: 3,
      });
      const { dbStats } = await loadTools();
      const result: any = await dbStats.handler({ name: 'testdb' }, mockContext());
      expect(mockStats).toHaveBeenCalledWith('testdb');
      expect((result as any).data.sizeMB).toBe(10.5);
    });
  });
});
