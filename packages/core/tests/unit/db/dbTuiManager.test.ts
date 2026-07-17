import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../../src/config/paths.js', () => ({
  getFennecDir: () => '/tmp/fennec-test-dir',
}));

class MockStdout extends EventEmitter { }
class MockStderr extends EventEmitter { }

function createMockProc() {
  const proc = new EventEmitter() as any;
  proc.pid = 12345;
  proc.stdout = new MockStdout();
  proc.stderr = new MockStderr();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.exitCode = null;
  proc.kill = vi.fn(() => { proc.exitCode = 0; proc.emit('exit', 0); });
  return proc;
}

const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mockExecFileSync,
}));

// readline mock: createInterface captures the stdout stream and bridges data→line
vi.mock('node:readline', () => ({
  createInterface: vi.fn((input: any) => {
    const rl = new EventEmitter();
    if (input && typeof input.on === 'function') {
      input.on('data', (buf: Buffer) => {
        for (const line of buf.toString().split('\n').filter(Boolean)) {
          rl.emit('line', line);
        }
      });
    }
    return rl;
  }),
}));

const mockFs = { existsSync: vi.fn(), readFileSync: vi.fn(), chmodSync: vi.fn(), mkdirSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(), statSync: vi.fn() };
vi.mock('node:fs', () => mockFs);

const mockPromises = { mkdir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn() };
vi.mock('node:fs/promises', () => mockPromises);

/** Create a DbTuiManager that thinks it has a running agent. */
function createRunningManager(mod: any): { mgr: any; proc: any; rl: EventEmitter } {
  const proc = createMockProc();
  process.env = { ...process.env };
  const mgr = new mod.DbTuiManager();
  (mgr as any).proc = proc;
  (mgr as any).startTime = Date.now();
  const rl = new EventEmitter();
  rl.on('line', (line: string) => (mgr as any).handleLine(line));
  (mgr as any).rl = rl;
  return { mgr, proc, rl };
}

describe('DbTuiManager', () => {
  let DbTuiManager: any;
  let getDbManager: any;
  let resetDbManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/db/dbTuiManager.js');
    DbTuiManager = mod.DbTuiManager;
    getDbManager = mod.getDbManager;
    resetDbManager = mod.resetDbManager;
    resetDbManager();
  });

  afterEach(() => {
    if (resetDbManager) resetDbManager();
  });

  describe('getBinaryPath', () => {
    it('should return path under fennec bin dir', () => {
      const mgr = new DbTuiManager();
      expect(mgr.getBinaryPath()).toContain('/tmp/fennec-test-dir/bin/dbTui');
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      expect(getDbManager()).toBe(getDbManager());
    });

    it('reset should create new instance', () => {
      const a = getDbManager();
      resetDbManager();
      expect(getDbManager()).not.toBe(a);
    });
  });

  describe('ensureRunning', () => {
    it('should spawn agent process on first call', async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      mockFs.existsSync.mockReturnValue(true);

      const mgr = new DbTuiManager();
      const promise = mgr.ensureRunning();
      proc.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 999, result: { version: '1.0.0' } }) + '\n'));

      await expect(promise).resolves.toBeUndefined();
      expect(mgr.isRunning).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(expect.stringContaining('dbTui'), ['--agent'], expect.any(Object));
    });

    it('should return immediately if already running', async () => {
      const { mgr } = createRunningManager({ DbTuiManager });
      const origProc = (mgr as any).proc;
      mockSpawn.mockClear();

      await mgr.ensureRunning();
      expect(mockSpawn).not.toHaveBeenCalled();
      expect((mgr as any).proc).toBe(origProc);
    });

    it('should throw if binary not found and download fails', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const mgr = new DbTuiManager();
      vi.spyOn(mgr as any, 'download').mockRejectedValue(new Error('dbTui binary not found'));
      await expect(mgr.ensureRunning()).rejects.toThrow('dbTui binary not found');
    });
  });

  describe('request', () => {
    it('should write JSON-RPC and resolve on matching id', async () => {
      const { mgr, proc, rl } = createRunningManager({ DbTuiManager });
      await mgr.ensureRunning();
      rl.setMaxListeners(20);

      const p = mgr.request('ping');

      // Wait for async microtask to complete (request's await this.ensureRunning())
      await new Promise(r => process.nextTick(r));

      const writeSpy = proc.stdin.write;
      expect(writeSpy).toHaveBeenCalled();
      const sent = JSON.parse(writeSpy.mock.calls[0][0]);
      expect(sent.method).toBe('ping');
      expect(sent.jsonrpc).toBe('2.0');
      expect(typeof sent.id).toBe('number');

      rl.emit('line', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { ok: true } }));
      const result = await p;
      expect(result).toEqual({ ok: true });
    });

    it('should reject on error response', async () => {
      const { mgr, proc, rl } = createRunningManager({ DbTuiManager });
      await mgr.ensureRunning();
      rl.setMaxListeners(20);

      const promise = mgr.request('connect', { name: 'x', url: 'bad://' });
      await new Promise(r => process.nextTick(r));

      expect(proc.stdin.write).toHaveBeenCalled();
      const sent = JSON.parse(proc.stdin.write.mock.calls[0][0]);

      rl.emit('line', JSON.stringify({ jsonrpc: '2.0', id: sent.id, error: { code: -32000, message: 'Connection refused' } }));
      await expect(promise).rejects.toThrow('Connection refused');
    });
  });

  describe('convenience methods', () => {
    it('connect should call request and track name', async () => {
      const mgr = new DbTuiManager();
      const req = vi.spyOn(mgr, 'request').mockResolvedValue({ type: 'postgresql', database: 'mydb' });

      const result = await mgr.connect('testdb', 'postgres://localhost/mydb');
      expect(req).toHaveBeenCalledWith('connect', { name: 'testdb', url: 'postgres://localhost/mydb' });
      expect(result.type).toBe('postgresql');
    });

    it('disconnect should call request and remove tracking', async () => {
      const mgr = new DbTuiManager();
      mgr._connectedNames.add('testdb');
      const req = vi.spyOn(mgr, 'request').mockResolvedValue(undefined);

      await mgr.disconnect('testdb');
      expect(req).toHaveBeenCalledWith('disconnect', { name: 'testdb' });
      expect(mgr.connectedNames).not.toContain('testdb');
    });

    it('query should pass options through', async () => {
      const mgr = new DbTuiManager();
      const req = vi.spyOn(mgr, 'request').mockResolvedValue({});

      await mgr.query('testdb', 'SELECT 1', { maxRows: 50, strict: false });
      expect(req).toHaveBeenCalledWith('query', { name: 'testdb', sql: 'SELECT 1', maxRows: 50, strict: false });
    });

    it('schema should include optional database', async () => {
      const mgr = new DbTuiManager();
      const req = vi.spyOn(mgr, 'request').mockResolvedValue({ databases: [] });

      await mgr.schema('testdb', 'mydb');
      expect(req).toHaveBeenCalledWith('schema', { name: 'testdb', database: 'mydb' });
    });

    it('tables should list tables', async () => {
      const mgr = new DbTuiManager();
      vi.spyOn(mgr, 'request').mockResolvedValue({ tables: [{ name: 'users' }] });

      const result = await mgr.tables('testdb');
      expect(result.tables).toHaveLength(1);
    });

    it('explain should return query plan', async () => {
      const mgr = new DbTuiManager();
      vi.spyOn(mgr, 'request').mockResolvedValue({ plan: 'Seq Scan' });

      const result = await mgr.explain('testdb', 'SELECT * FROM t');
      expect(result.plan).toBe('Seq Scan');
    });

    it('stats should return database stats', async () => {
      const mgr = new DbTuiManager();
      vi.spyOn(mgr, 'request').mockResolvedValue({ database: 'mydb', sizeMB: 5.2, tableCount: 10, activeConnections: 2 });

      const result = await mgr.stats('testdb');
      expect(result.sizeMB).toBe(5.2);
    });

    it('listConnections should extract from response', async () => {
      const mgr = new DbTuiManager();
      vi.spyOn(mgr, 'request').mockResolvedValue({ connections: [{ name: 'testdb', connected: true }] });

      const result = await mgr.listConnections();
      expect(result).toEqual([{ name: 'testdb', connected: true }]);
    });

    it('ping should return status', async () => {
      const mgr = new DbTuiManager();
      vi.spyOn(mgr, 'request').mockResolvedValue({ ok: true, version: '1.0.0', uptime: '10s' });

      const result = await mgr.ping();
      expect(result.ok).toBe(true);
    });
  });

  describe('kill', () => {
    it('should send SIGTERM and update state', async () => {
      const { mgr, proc } = createRunningManager({ DbTuiManager });

      mgr.kill();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mgr.isRunning).toBe(false);
    });
  });

  describe('afterRequest', () => {
    it('should set idle timer', () => {
      const mgr = new DbTuiManager();
      mgr.afterRequest();
      expect(mgr.idleTimer).toBeDefined();
    });
  });

  describe('download', () => {
    const origFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
    });

    it('should skip if binary exists (not forced)', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mgr = new DbTuiManager();
      const result = await mgr.download();
      expect(result).toBe(mgr.getBinaryPath());
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should fetch release archive', async () => {
      mockFs.existsSync.mockReturnValue(false);
      (globalThis.fetch as any).mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });

      const mgr = new DbTuiManager();
      await expect(mgr.download(true)).rejects.toThrow();
      expect(globalThis.fetch).toHaveBeenCalled();
      expect(mockPromises.mkdir).toHaveBeenCalled();
    });

    it('should throw on HTTP error', async () => {
      mockFs.existsSync.mockReturnValue(false);
      (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

      const mgr = new DbTuiManager();
      await expect(mgr.download(true)).rejects.toThrow('Download failed: 404 Not Found');
    });
  });

  describe('verifyChecksum', () => {
    it('should return true for matching hash', () => {
      const mgr = new DbTuiManager();
      const data = Buffer.from('test-data');
      const hash = require('node:crypto').createHash('sha256').update(data).digest('hex');
      mockFs.readFileSync.mockReturnValue(data);

      expect(mgr.verifyChecksum('/fake/path', hash)).toBe(true);
    });

    it('should return false for mismatched hash', () => {
      const mgr = new DbTuiManager();
      mockFs.readFileSync.mockReturnValue(Buffer.from('data'));

      expect(mgr.verifyChecksum('/fake/path', 'badhash')).toBe(false);
    });
  });
});
