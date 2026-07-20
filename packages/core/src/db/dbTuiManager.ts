import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { FennecLogger } from '../utils/logger.js';
import { getFennecDir } from '../config/paths.js';
import type { DbQueryResult, DbSchemaResult, DbTableInfo, DbExplainResult, DbStatsResult, DbConnectInfo, ConnectionInfo } from './types.js';

const AGENT_VERSION = '1.2.2';
const BINARY_NAME = process.platform === 'win32' ? 'dbTui.exe' : 'dbTui';
const GITHUB_REPO = 'farhank15/dbTui';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

let _instance: DbTuiManager | null = null;

export function getDbManager(): DbTuiManager {
  if (!_instance) _instance = new DbTuiManager();
  return _instance;
}

export function resetDbManager(): void {
  if (_instance) {
    _instance.kill();
    _instance = null;
  }
}

export class DbTuiManager {
  private proc: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private logger: FennecLogger | null = null;
  private startTime = 0;
  _connectedNames = new Set<string>();
  private _queryTimeout = 30000;
  private _schemaCache: { key: string; data: DbSchemaResult; timestamp: number } | null = null;
  private _schemaCacheTTL = 30000;

  setLogger(logger: FennecLogger): void { this.logger = logger; }

  setQueryTimeout(ms: number): void { this._queryTimeout = ms; }

  get connectedNames(): string[] { return [...this._connectedNames]; }

  get uptime(): string {
    if (!this.startTime) return '0s';
    const sec = Math.floor((Date.now() - this.startTime) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m${sec % 60}s`;
  }

  get isRunning(): boolean { return this.proc !== null && this.proc.exitCode === null; }

  get pid(): number | null { return this.proc?.pid ?? null; }

  getBinaryPath(): string {
    return join(getFennecDir(), 'bin', BINARY_NAME);
  }

  async ensureRunning(): Promise<void> {
    if (this.isRunning) {
      this.resetIdleTimer();
      return;
    }

    const binPath = this.getBinaryPath();
    if (!existsSync(binPath)) {
      this.log('Binary not found, downloading...');
      await this.download();
    } else if (this.shouldUpdate()) {
      this.log('Binary update available, downloading...');
      try { await this.download(true); } catch (err: any) {
        this.log(`Update check failed: ${err.message}`, 'warn');
      }
    }

    if (process.platform !== 'win32' && !(chmodSync as any)._isMock) {
      try { chmodSync(binPath, 0o755); } catch {}
    }

    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(binPath, ['--agent'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });
        this.startTime = Date.now();
        this.log(`dbTui agent started (pid=${this.proc.pid})`);

        const stdout = this.proc.stdout;
        if (!stdout) { reject(new Error('Agent process has no stdout')); return; }
        this.rl = createInterface(stdout);
        this.rl.on('line', (line: string) => this.handleLine(line));

        this.proc.on('exit', (code) => {
          this.log(`dbTui agent exited (code=${code})`, 'warn');
          this._connectedNames.clear();
          for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Agent process exited')); }
          this.pending.clear();
          this.proc = null;
          this.rl = null;
        });

        this.proc.on('error', (err) => { this.log(`Agent error: ${err.message}`, 'error'); reject(err); });

        this.proc.stderr?.on('data', (data: Buffer) => {
          this.log(`[dbTui] ${data.toString().trim()}`, 'debug');
        });

        resolve();
      } catch (err) { reject(err); }
    });
  }

  private handleLine(line: string): void {
    try {
      const resp = JSON.parse(line);
      const id = resp.id;
      if (typeof id === 'number' && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        clearTimeout(p.timer);
        this.pending.delete(id);
        if (resp.error) {
          const err = new Error(resp.error.message || 'Unknown error');
          (err as any).code = resp.error.code;
          (err as any).data = resp.error.data;
          p.reject(err);
        } else {
          p.resolve(resp.result);
        }
      }
    } catch {}
  }

  async request<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
    await this.ensureRunning();
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, this._queryTimeout);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc!.stdin!.write(JSON.stringify(req) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async ping(): Promise<{ ok: boolean; version: string; uptime: string }> {
    return this.request('ping');
  }

  async connect(name: string, url: string): Promise<DbConnectInfo> {
    const result = await this.request<any>('connect', { name, url });
    this._connectedNames.add(name);
    return result;
  }

  async disconnect(name: string): Promise<void> {
    await this.request('disconnect', { name });
    this._connectedNames.delete(name);
  }

  async query(name: string, sql: string, options?: { maxRows?: number; strict?: boolean }): Promise<DbQueryResult> {
    const currentId = this.nextId;
    const sigintHandler = () => {
      if (this.proc && this.proc.exitCode === null) {
        this.proc.kill('SIGINT');
        process.removeListener('SIGINT', sigintHandler);
      }
    };
    process.on('SIGINT', sigintHandler);
    try {
      return await this.request<DbQueryResult>('query', { name, sql, ...options });
    } finally {
      process.removeListener('SIGINT', sigintHandler);
    }
  }

  cancelQuery(name: string): Promise<any> {
    return this.request('cancel', { name });
  }

  async schema(name: string, database?: string): Promise<DbSchemaResult> {
    const key = `${name}:${database ?? ''}`;
    if (this._schemaCache && this._schemaCache.key === key && (Date.now() - this._schemaCache.timestamp) < this._schemaCacheTTL) {
      return this._schemaCache.data;
    }
    const result = await this.request<DbSchemaResult>('schema', { name, database });
    this._schemaCache = { key, data: result, timestamp: Date.now() };
    return result;
  }

  async tables(name: string, database?: string): Promise<DbTableInfo> {
    return this.request('tables', { name, database });
  }

  async explain(name: string, sql: string): Promise<DbExplainResult> {
    return this.request('explain', { name, sql });
  }

  async stats(name: string): Promise<DbStatsResult> {
    return this.request('stats', { name });
  }

  async listConnections(): Promise<ConnectionInfo[]> {
    const result = await this.request<{ connections: ConnectionInfo[] }>('list');
    return result.connections;
  }

  kill(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.proc && this.proc.exitCode === null) {
      this.log('Shutting down dbTui agent');
      this.proc.kill('SIGTERM');
      setTimeout(() => {
        if (this.proc && this.proc.exitCode === null) this.proc.kill('SIGKILL');
      }, 3000);
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.log('Idle timeout reached, killing agent');
      this.kill();
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref();
  }

  afterRequest(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.log('Idle timeout reached, killing agent');
      this.kill();
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref();
  }

  async download(force = false): Promise<string> {
    const binPath = this.getBinaryPath();
    const binDir = dirname(binPath);

    if (!force && existsSync(binPath)) return binPath;
    await mkdir(binDir, { recursive: true });

    const os = process.platform === 'linux' ? 'Linux' : process.platform === 'darwin' ? 'Darwin' : 'Windows';
    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
    const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
    const archiveName = `dbTui_${os}_${arch}${ext}`;

    this.log(`Downloading dbTui v${AGENT_VERSION}`);

    const archiveBuf = await this.downloadFile(`https://github.com/${GITHUB_REPO}/releases/download/v${AGENT_VERSION}/${archiveName}`);

    let expectedSha256: string | undefined;
    try {
      const checksumsBuf = await this.downloadFile(`https://github.com/${GITHUB_REPO}/releases/download/v${AGENT_VERSION}/checksums.txt`);
      const checksums = checksumsBuf.toString('utf-8');
      expectedSha256 = checksums
        .split('\n')
        .find(l => l.includes(BINARY_NAME))
        ?.split(/\s+/)[0];
      if (expectedSha256) {
        const actualSha256 = createHash('sha256').update(archiveBuf).digest('hex');
        if (actualSha256 !== expectedSha256) {
          throw new Error(`Checksum mismatch for ${archiveName}: expected ${expectedSha256}, got ${actualSha256}`);
        }
      }
    } catch (err: any) {
      this.log(`Checksum verification skipped: ${err.message}`, 'warn');
    }

    const tmpDir = join(binDir, '.tmp');
    await mkdir(tmpDir, { recursive: true });
    const archivePath = join(tmpDir, archiveName);
    await writeFile(archivePath, archiveBuf);

    try {
      if (process.platform === 'win32') {
        execFileSync('powershell', [
          '-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${tmpDir}" -Force`,
        ]);
      } else {
        execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir]);
      }

      const extracted = join(tmpDir, BINARY_NAME);
      if (!existsSync(extracted)) {
        throw new Error(`Binary not found in archive. Expected at: ${extracted}`);
      }

      const binaryBuf = await readFile(extracted);
      this.log(`Binary verified (SHA256: ${createHash('sha256').update(binaryBuf).digest('hex').slice(0, 16)}...)`);

      await writeFile(binPath, binaryBuf);
      if (process.platform !== 'win32') chmodSync(binPath, 0o755);

      const vPath = join(binDir, 'dbTui.version');
      await writeFile(vPath, AGENT_VERSION);

      this.log(`dbTui installed at ${binPath}`);
      return binPath;
    } finally {
      await readFile(join(tmpDir, '..', 'checksums.txt'), 'utf-8').catch(() => {});
    }
  }

  private async downloadFile(url: string): Promise<Buffer> {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  private shouldUpdate(): boolean {
    try {
      const vPath = join(dirname(this.getBinaryPath()), 'dbTui.version');
      if (!existsSync(vPath)) return true;
      const mtime = statSync(vPath).mtimeMs;
      return Date.now() - mtime > 7 * 24 * 60 * 60 * 1000;
    } catch { return false; }
  }

  verifyChecksum(binaryPath: string, expectedSha256: string): boolean {
    try {
      const data = readFileSync(binaryPath);
      return createHash('sha256').update(data).digest('hex') === expectedSha256;
    } catch { return false; }
  }

  private log(msg: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
    if (!this.logger) return;
    this.logger[level](`[DB] ${msg}`);
  }
}
