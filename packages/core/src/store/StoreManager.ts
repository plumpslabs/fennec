/**
 * StoreManager — single source of truth for WHERE Fennec persists state.
 *
 * Two scopes:
 *   - global (default): `FENNEC_HOME` | `FENNEC_DATA_DIR` | `~/.fennec`
 *     Used so `fennec store` / `fennec ps` work from ANY directory,
 *     not just the project that created the data. Process tracking already
 *     lived here (`process/tracking.ts`); this unifies sessions + exports too.
 *   - local (opt-in, `--local`): `./.fennec` in the current working dir.
 *     For secrets you intentionally bundle with a project (still gitignored).
 *
 * Also enforces restricted permissions (0700) on the store dir and exposes
 * `scan()` for the `fennec store` overview + `fennec doctor` checks.
 */
import { homedir, platform } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { SessionStore, type SavedSession } from '../session/SessionStore.js';

export type StoreKind = 'session' | 'process' | 'workflow' | 'plugin' | 'config' | 'export';

const KIND_DIR: Record<StoreKind, string> = {
  session: 'sessions',
  process: '', // tracked.json at base
  workflow: 'workflows',
  plugin: 'plugins',
  config: '', // config.json at base
  export: 'exports',
};

export interface StoreScanEntry {
  kind: StoreKind;
  path: string;
  count: number;
  sizeBytes: number;
  oldestMs: number;
}

export class StoreManager {
  /** Global base dir. Honors FENNEC_HOME, then FENNEC_DATA_DIR, then ~/.fennec. */
  static globalBase(): string {
    const env = process.env.FENNEC_HOME ?? process.env.FENNEC_DATA_DIR;
    if (env) return resolve(env);
    return resolve(homedir(), '.fennec');
  }

  /** Local (per-project) base dir. */
  static localBase(): string {
    return join(process.cwd(), '.fennec');
  }

  /** True when a sync tool (chezmoi/yadm/Dropbox/...) likely mirrors this dir. */
  static isSynced(base: string): boolean {
    return base
      .split(sep)
      .some((p) =>
        ['chezmoi', '.yadm', 'Dropbox', 'OneDrive', 'Nextcloud', 'Sync', '.sync'].includes(p),
      );
  }

  constructor(private local = false) {}

  get base(): string {
    return this.local ? StoreManager.localBase() : StoreManager.globalBase();
  }

  /** Directory holding `kind` artifacts (base itself for process/config files). */
  dirFor(kind: StoreKind): string {
    const sub = KIND_DIR[kind];
    return sub ? join(this.base, sub) : this.base;
  }

  /** Absolute path of a named artifact, or the singleton file for process/config. */
  fileFor(kind: StoreKind, name: string): string {
    const fileName =
      kind === 'process' ? 'tracked.json' : kind === 'config' ? 'config.json' : `${name}.json`;
    return join(this.dirFor(kind), fileName);
  }

  /** Create the base dir + lock it down (0700) on POSIX. Best-effort. */
  ensure(): void {
    const base = this.base;
    try {
      if (!existsSync(base)) mkdirSync(base, { recursive: true });
      if (platform() !== 'win32' && existsSync(base)) chmodSync(base, 0o700);
    } catch {
      // permission/FS restrictions are non-fatal here
    }
  }

  /** Recursively list `*.json` paths for a kind's directory (origin subdirs included). */
  listFiles(kind: StoreKind): string[] {
    const dir = this.dirFor(kind);
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.json')) out.push(p);
      }
    };
    walk(dir);
    return out;
  }

  /** Overview of every kind stored under the base dir. */
  scan(): StoreScanEntry[] {
    return (Object.keys(KIND_DIR) as StoreKind[]).map((kind) => {
      let count = 0;
      let size = 0;
      let oldest = 0;
      if (kind === 'process' || kind === 'config') {
        const p = this.fileFor(kind, '');
        if (existsSync(p)) {
          const s = statSync(p);
          count = 1;
          size = s.size;
          oldest = Date.now() - (s.birthtimeMs || s.mtimeMs);
        }
      } else {
        for (const f of this.listFiles(kind)) {
          const p = f;
          try {
            const s = statSync(p);
            size += s.size;
            const age = Date.now() - (s.birthtimeMs || s.mtimeMs);
            if (age > oldest) oldest = age;
            count++;
          } catch {
            // skip unreadable entries
          }
        }
      }
      return {
        kind,
        path: this.dirFor(kind),
        count,
        sizeBytes: size,
        oldestMs: count ? oldest : 0,
      };
    });
  }

  /** POSIX: true only when group/other have zero access (no secret leakage). */
  permsSafe(): boolean {
    if (platform() === 'win32') return true;
    try {
      const st = statSync(this.base);
      return (st.mode & 0o077) === 0;
    } catch {
      return true;
    }
  }

  /** A SessionStore scoped to this manager's session directory. */
  sessionStore(): SessionStore {
    return new SessionStore(this.dirFor('session'));
  }
}

/** Mask cookie/localStorage/storage VALUES (keep keys, domains, names). */
export function redactSession(session: SavedSession): SavedSession {
  const mask = (v: unknown): unknown => '***';
  return {
    ...session,
    cookies: (session.cookies as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      value: '***',
    })),
    localStorage: Object.fromEntries(Object.keys(session.localStorage ?? {}).map((k) => [k, '***'])),
    sessionStorage: Object.fromEntries(Object.keys(session.sessionStorage ?? {}).map((k) => [k, '***'])),
  };
}
