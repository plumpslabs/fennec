import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

let resolveMod: typeof import('../../../src/process/resolve.js');

describe('ProcessResolver (#144)', () => {
  let dir: string;
  let prevDataDir: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fennec-resolve-'));
    prevDataDir = process.env.FENNEC_DATA_DIR;
    process.env.FENNEC_DATA_DIR = dir;
    resolveMod = await import('../../../src/process/resolve.js');
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.FENNEC_DATA_DIR;
    else process.env.FENNEC_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  const fakePm = (names: string[] = []) => ({
    get: (id: string) => {
      const i = names.indexOf(id);
      if (i === -1) throw new Error(`Process not found: ${id}`);
      return { processId: id, running: true } as never;
    },
    getLogs: (id: string) => {
      if (!names.includes(id)) throw new Error(`Process not found: ${id}`);
      return [{ line: 'ready on port 3000', level: 'info', timestamp: new Date().toISOString() }];
    },
  });

  it('resolves live processes with buffer logs', () => {
    const pm = fakePm(['web']);
    const r = resolveMod.resolveProcess(pm as never, 'web');
    expect(r.kind).toBe('live');
    expect(r.running).toBe(true);
    const logs = resolveMod.readUnifiedLogs(pm as never, 'web', { lines: 10 });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('resolves tracked-only names from the on-disk file (#135)', async () => {
    const { saveTracked } = await import('../../../src/process/tracking.js');
    const { logPathFor } = await import('../../../src/process/tracking.js');
    saveTracked([
      {
        name: 'cli-app',
        pid: 1,
        command: 'node server.js',
        startedAt: new Date().toISOString(),
      },
    ]);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(logPathFor('cli-app'), 'Worker Service Starting\nok\n', 'utf-8');
    const pm = fakePm([]);
    const r = resolveMod.resolveProcess(pm as never, 'cli-app');
    expect(['tracked', 'file']).toContain(r.kind);
    const logs = resolveMod.readUnifiedLogs(pm as never, 'cli-app', { lines: 10 });
    expect(logs.some((l) => l.line.includes('Worker Service Starting'))).toBe(true);
  });

  it('throws a single canonical error for unknown names', () => {
    const pm = fakePm([]);
    expect(resolveMod.resolveProcess(pm as never, 'nope').kind).toBe('missing');
    expect(() => resolveMod.readUnifiedLogs(pm as never, 'nope')).toThrow(/Process not found: nope/);
  });
});
