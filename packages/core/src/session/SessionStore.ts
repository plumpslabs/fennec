import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SavedSession {
  name: string;
  savedAt: string;
  cookies: unknown[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  origin: string;
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

  save(name: string, data: Omit<SavedSession, "name" | "savedAt">): void {
    this.ensureDir();
    const session: SavedSession = {
      name,
      savedAt: new Date().toISOString(),
      ...data,
    };
    const filePath = join(this.persistPath, `${name}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /** Absolute path where a named session is (or would be) stored. */
  pathFor(name: string): string {
    return join(this.persistPath, `${name}.json`);
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

  /** Save a session to an arbitrary file path (in addition to / instead of the store). */
  saveToPath(name: string, data: Omit<SavedSession, "name" | "savedAt">, filePath: string): void {
    const session: SavedSession = {
      name,
      savedAt: new Date().toISOString(),
      ...data,
    };
    writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  load(name: string): SavedSession | null {
    const filePath = join(this.persistPath, `${name}.json`);
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SavedSession;
    } catch {
      return null;
    }
  }

  list(): SavedSession[] {
    this.ensureDir();
    const files = readdirSync(this.persistPath).filter((f) => f.endsWith(".json"));
    const sessions: SavedSession[] = [];
    for (const file of files) {
      const parsed = this.loadFromPath(join(this.persistPath, file));
      if (parsed) sessions.push(parsed);
    }
    return sessions;
  }

  /** List sessions from an arbitrary directory (used for cwd `.fennec/sessions` discovery). */
  listFromDir(dir: string): SavedSession[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const sessions: SavedSession[] = [];
    for (const file of files) {
      const parsed = this.loadFromPath(join(dir, file));
      if (parsed) sessions.push(parsed);
    }
    return sessions;
  }

  delete(name: string): boolean {
    const filePath = join(this.persistPath, `${name}.json`);
    if (existsSync(filePath)) {
      rmSync(filePath);
      return true;
    }
    return false;
  }
}
