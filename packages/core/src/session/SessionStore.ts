import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

export interface SavedSession {
  name: string;
  savedAt: string;
  cookies: unknown[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  origin: string;
  /** Free-form metadata captured at save time (user, role, workspace, notes, etc.). */
  metadata?: Record<string, unknown>;
}

/** Recursively collect every *.json path under `dir` (origin subdirs included). */
function walkJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export class SessionStore {
  private persistPath: string;

  constructor(persistPath: string) {
    this.persistPath = resolve(persistPath);
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.persistPath)) {
      mkdirSync(this.persistPath, { recursive: true });
    }
  }

  /** Filesystem-safe dir name for an origin (no slashes/colons — safe on Windows too). */
  private encodeOrigin(origin: string): string {
    return origin.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  /** <dir>/<encodedOrigin>/<name>.json — namespaced so sessions from different origins never collide. */
  private filePathFor(name: string, origin: string): string {
    return join(this.persistPath, this.encodeOrigin(origin), `${name}.json`);
  }

  save(name: string, data: Omit<SavedSession, "name" | "savedAt">): string {
    this.ensureDir();
    const session: SavedSession = {
      name,
      savedAt: new Date().toISOString(),
      ...data,
    };
    const target = this.filePathFor(name, data.origin);
    // Migrate a legacy flat file (<dir>/<name>.json) into the origin subdir on first re-save,
    // so pre-namespacing sessions keep working without duplicates.
    const legacy = join(this.persistPath, `${name}.json`);
    if (existsSync(legacy) && !existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      renameSync(legacy, target);
      return target;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(session, null, 2), "utf-8");
    return target;
  }

  /** Path where a session lives (or would live). Pass `origin` for the namespaced location. */
  pathFor(name: string, origin?: string): string {
    return origin ? this.filePathFor(name, origin) : join(this.persistPath, `${name}.json`);
  }

  /** Read a session from an arbitrary file path (e.g. a user-supplied filePath). */
  loadFromPath(filePath: string): SavedSession | null {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SavedSession;
    } catch {
      return null;
    }
  }

  /** Save a session to an arbitrary file path (custom filePath; bypasses namespacing). */
  saveToPath(name: string, data: Omit<SavedSession, "name" | "savedAt">, filePath: string): void {
    const session: SavedSession = {
      name,
      savedAt: new Date().toISOString(),
      ...data,
    };
    writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /** Find a session by name (recursive across origins + legacy flat files). */
  load(name: string): SavedSession | null {
    for (const f of walkJson(this.persistPath)) {
      const s = this.loadFromPath(f);
      if (s && s.name === name) return s;
    }
    return null;
  }

  list(): SavedSession[] {
    this.ensureDir();
    const sessions: SavedSession[] = [];
    for (const f of walkJson(this.persistPath)) {
      const s = this.loadFromPath(f);
      if (s) sessions.push(s);
    }
    return sessions;
  }

  /** List sessions from an arbitrary directory (used for cwd `.fennec/sessions` discovery). */
  listFromDir(dir: string): SavedSession[] {
    const sessions: SavedSession[] = [];
    for (const f of walkJson(dir)) {
      const s = this.loadFromPath(f);
      if (s) sessions.push(s);
    }
    return sessions;
  }

  /** Load a session by name from a specific directory (recursive). */
  loadFromDir(dir: string, name: string): SavedSession | null {
    for (const f of walkJson(dir)) {
      const s = this.loadFromPath(f);
      if (s && s.name === name) return s;
    }
    return null;
  }

  delete(name: string): boolean {
    for (const f of walkJson(this.persistPath)) {
      const s = this.loadFromPath(f);
      if (s && s.name === name) {
        rmSync(f);
        return true;
      }
    }
    return false;
  }
}
