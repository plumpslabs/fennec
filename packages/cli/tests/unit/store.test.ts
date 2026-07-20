import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { VERSION } from '../../src/utils/banner.js';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'fennec-unit-store-'));
const CLI = resolve(__dirname, '../../dist/index.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  out: string;
}

let exitCode = 0;
const originalExit = process.exit;
const originalError = console.error;
const captured: string[] = [];

function run(args: string[], stdin = ''): RunResult {
  exitCode = 0;
  captured.length = 0;
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const res = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
    input: stdin,
    env: { ...process.env, FENNEC_DATA_DIR: DATA_DIR, FENNEC_HOME: DATA_DIR },
  });
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  return { code: res.status ?? (res.error ? 1 : 0), stdout, stderr, out: stdout + stderr };
}

function mkSession(name: string, origin = 'https://example.com'): void {
  const dir = join(DATA_DIR, 'sessions', origin.replace(/[^a-zA-Z0-9._-]/g, '_'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify({
      name,
      origin,
      savedAt: '2026-07-17T00:00:00.000Z',
      cookies: [{ name: 'session_id', value: 'abc123', domain: origin.replace('https://', '') }],
      localStorage: { token: 'secret-token' },
      sessionStorage: {},
    }),
  );
}

function mkMultiOrigin(): void {
  mkSession('dup-name', 'https://alpha.com');
  mkSession('dup-name', 'https://beta.com');
}

function trackedPath(): string {
  return join(DATA_DIR, 'tracked.json');
}

function writeTracked(entries: any[]): void {
  writeFileSync(trackedPath(), JSON.stringify(entries, null, 2));
}

beforeAll(() => {
  expect(existsSync(CLI), 'Build CLI first: pnpm --filter @plumpslabs/fennec-cli build').toBe(true);
});

afterAll(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

describe('store session ls', () => {
  it('shows empty when no sessions', () => {
    const r = run(['store', 'session']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('No saved sessions found');
  });

  it('lists sessions', () => {
    mkSession('test-a');
    mkSession('test-b');
    const r = run(['store', 'session']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('test-a');
    expect(r.stderr).toContain('test-b');
    expect(r.stderr).toContain('2 session(s)');
  });

  it('accepts explicit ls action', () => {
    mkSession('test-a');
    const r = run(['store', 'session', 'ls']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('test-a');
  });

  it('works via sessions alias', () => {
    mkSession('test-a');
    const r = run(['sessions']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('test-a');
  });

  it('warns when --show-secrets used with ls', () => {
    mkSession('test-a');
    const r = run(['store', 'session', 'ls', '--show-secrets']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('--show-secrets only applies to the info action');
  });
});

describe('store session info', () => {
  it('shows session details', () => {
    mkSession('test-a');
    const r = run(['store', 'session', 'info', 'test-a']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('test-a');
    expect(r.stderr).toContain('example.com');
    expect(r.stderr).toContain('masked');
  });

  it('reveals secrets with --show-secrets', () => {
    mkSession('test-a');
    const r = run(['store', 'session', 'info', 'test-a', '--show-secrets']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('shown');
  });

  it('errors on missing session', () => {
    const r = run(['store', 'session', 'info', 'nonexistent']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Session not found');
  });

  it('errors when name omitted', () => {
    const r = run(['store', 'session', 'info']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Missing name');
  });
});

describe('store session rm', () => {
  it('deletes a session', () => {
    mkSession('test-a');
    const r = run(['store', 'session', 'rm', 'test-a', '-y']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('deleted');
    const list = run(['store', 'session']);
    expect(list.stderr).toContain('No saved sessions found');
  });

  it('deletes multiple sessions in bulk', () => {
    mkSession('test-a');
    mkSession('test-b');
    mkSession('test-c');
    const r = run(['store', 'session', 'rm', 'test-a', 'test-b', '-y']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('test-a deleted');
    expect(r.stderr).toContain('test-b deleted');
    expect(r.stderr).not.toContain('test-c deleted');
    const list = run(['store', 'session']);
    expect(list.stderr).toContain('test-c');
    expect(list.stderr).not.toContain('test-a');
  });

  it('reports not-found sessions', () => {
    mkSession('test-a');
    const r = run(['store', 'session', 'rm', 'test-a', 'missing-session', '-y']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('test-a deleted');
    expect(r.stderr).toContain('Session not found');
  });

  it('errors on missing name', () => {
    const r = run(['store', 'session', 'rm']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Missing name');
  });

  it('deletes sessions with same name from different origins', () => {
    mkMultiOrigin();
    const r = run(['store', 'session', 'rm', 'dup-name', '-y']);
    expect(r.code).toBe(0);
    const list = run(['store', 'session']);
    expect(list.stderr).toContain('No saved sessions found');
  });

  it('works via sessions alias', () => {
    mkSession('test-a');
    const r = run(['sessions', 'rm', 'test-a', '-y']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('deleted');
  });
});

describe('store overview', () => {
  it('shows store overview with no args', () => {
    mkdirSync(join(DATA_DIR, 'sessions'), { recursive: true });
    const r = run(['store']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Fennec Store');
  });

  it('shows local overview with --local', () => {
    const r = run(['store', '--local']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('(local');
  });

  it('errors on unknown kind', () => {
    const r = run(['store', 'invalid-kind']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown kind');
  });
});

describe('group command', () => {
  it('lists empty groups when no tracked apps', () => {
    const r = run(['group']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('No tracked processes');
  });

  it('assigns a group to a tracked app', () => {
    writeTracked([
      { name: 'web', pid: 12345, command: 'node server.js', startedAt: new Date().toISOString() },
    ]);
    const r = run(['group', 'web', 'backend']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('assigned to group');
    expect(r.stderr).toContain('backend');
    const tracked = JSON.parse(readFileSync(trackedPath(), 'utf-8'));
    expect(tracked[0].group).toBe('backend');
  });

  it('clears group with --unset', () => {
    writeTracked([
      {
        name: 'web',
        pid: 12345,
        command: 'node server.js',
        group: 'backend',
        startedAt: new Date().toISOString(),
      },
    ]);
    const r = run(['group', 'web', '--unset']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('removed from its group');
    const tracked = JSON.parse(readFileSync(trackedPath(), 'utf-8'));
    expect(tracked[0].group).toBeUndefined();
  });

  it('handles bulk group assignment', () => {
    writeTracked([
      { name: 'web', pid: 1, command: 'node web.js', startedAt: new Date().toISOString() },
      { name: 'api', pid: 2, command: 'node api.js', startedAt: new Date().toISOString() },
    ]);
    const r = run(['group', 'backend', 'web', 'api']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('web, api');
    expect(r.stderr).toContain('backend');
  });

  it('errors when assigning to unknown app', () => {
    const r = run(['group', 'nonexistent', 'backend']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('not found');
  });

  it('errors on missing --unset name', () => {
    const r = run(['group', '--unset']);
    expect(r.code).toBe(1);
  });
});

describe('doctor command', () => {
  it('runs without crashing and shows Fennec Doctor header', () => {
    const r = run(['doctor']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Fennec Doctor');
  });

  it('detects zombie PID 0 entries', () => {
    writeTracked([{ name: 'zombie', pid: 0, command: '', startedAt: new Date().toISOString() }]);
    const r = run(['doctor']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('PID 0');
  });

  it('fixes zombie entries with --fix', () => {
    writeTracked([{ name: 'zombie', pid: 0, command: '', startedAt: new Date().toISOString() }]);
    const r = run(['doctor', '--fix']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Cleaning');
    const tracked = JSON.parse(readFileSync(trackedPath(), 'utf-8'));
    expect(tracked.length).toBe(0);
  });
});

describe('export-import commands', () => {
  const exportPath = join(DATA_DIR, 'fennec-export.json');

  it('exports tracked apps', () => {
    writeTracked([
      {
        name: 'web',
        pid: 1,
        command: 'node web.js',
        cwd: '/app',
        port: 3000,
        startedAt: new Date().toISOString(),
      },
    ]);
    const r = run(['export', '--file', exportPath]);
    expect(r.code).toBe(0);
    expect(existsSync(exportPath)).toBe(true);
    const data = JSON.parse(readFileSync(exportPath, 'utf-8'));
    expect(data.length).toBe(1);
    expect(data[0].name).toBe('web');
  });

  it('imports tracked apps', () => {
    writeFileSync(
      exportPath,
      JSON.stringify([
        {
          name: 'imported',
          pid: -1,
          command: 'node app.js',
          port: 8080,
          cwd: '/app',
          startedAt: new Date().toISOString(),
        },
      ]),
    );
    // Pass empty stdin for the confirm prompt (defaults to yes)
    const r = run(['import', exportPath], '\n');
    expect(r.code).toBe(0);
    const tracked = JSON.parse(readFileSync(trackedPath(), 'utf-8'));
    expect(tracked.some((t: any) => t.name === 'imported')).toBe(true);
  });
});

describe('workflow command', () => {
  it('lists workflows (empty)', () => {
    const r = run(['workflow']);
    expect(r.code).toBe(0);
  });

  it('accepts workflow list', () => {
    const r = run(['workflow', 'list']);
    expect(r.code).toBe(0);
  });

  it('accepts workflow show with name (may error if not found)', () => {
    const r = run(['workflow', 'show', 'test-workflow']);
    // Workflow may not exist; command should not crash
    expect(r.stderr).toContain('workflow');
  });
});

describe('help system', () => {
  it('shows store --help', () => {
    const r = run(['store', '--help']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('store');
  });

  it('shows store session --help', () => {
    const r = run(['store', 'session', '--help']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('store session');
  });

  it('shows sessions rm --help', () => {
    const r = run(['sessions', 'rm', '--help']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('sessions rm');
  });

  it('shows sessions info --help', () => {
    const r = run(['sessions', 'info', '--help']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('sessions info');
  });

  it('shows version compact output', () => {
    const r = run(['version']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`Fennec v${VERSION}`);
    expect(r.stderr).not.toContain('███████');
  });

  it('shows --health alias', () => {
    const r = run(['--health']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Fennec Health Check');
  });
});
