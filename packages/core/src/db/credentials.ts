import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getFennecDir } from '../config/paths.js';
import type { ConnectionMetadata } from './types.js';

const CONNECTIONS_FILE = 'connections.json';
const SECRETS_FILE = '.credentials.json';

let _keytar: any = null;
try {
  _keytar = require('@aspect-build/aspect-keytar');
} catch {}

export interface CredentialStore {
  save(name: string, url: string): Promise<void>;
  get(name: string): Promise<string | null>;
  delete(name: string): Promise<void>;
}

class KeytarStore implements CredentialStore {
  async save(name: string, url: string): Promise<void> {
    await _keytar.setPassword('fennec-db', name, url);
  }
  async get(name: string): Promise<string | null> {
    return _keytar.getPassword('fennec-db', name) ?? null;
  }
  async delete(name: string): Promise<void> {
    await _keytar.deletePassword('fennec-db', name);
  }
}

class FileStore implements CredentialStore {
  private get path(): string {
    return join(getFennecDir(), SECRETS_FILE);
  }

  private read(): Record<string, string> {
    try {
      if (existsSync(this.path)) {
        return JSON.parse(readFileSync(this.path, 'utf-8'));
      }
    } catch {}
    return {};
  }

  private write(data: Record<string, string>): void {
    const dir = getFennecDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600, encoding: 'utf-8' });
  }

  async save(name: string, url: string): Promise<void> {
    const data = this.read();
    data[name] = url;
    this.write(data);
  }

  async get(name: string): Promise<string | null> {
    return this.read()[name] ?? null;
  }

  async delete(name: string): Promise<void> {
    const data = this.read();
    delete data[name];
    this.write(data);
  }
}

function createStore(): CredentialStore {
  if (_keytar) return new KeytarStore();
  try {
    const plat = process.platform;
    if (plat === 'darwin') {
      execSync('which security', { stdio: 'ignore' });
      return new CliStore('macos');
    }
    if (plat === 'linux') {
      execSync('which secret-tool', { stdio: 'ignore' });
      return new CliStore('linux');
    }
    if (plat === 'win32') {
      execSync('powershell -Command "Get-Command wincred"', { stdio: 'ignore' });
      return new CliStore('win32');
    }
  } catch {}
  return new FileStore();
}

class CliStore implements CredentialStore {
  private plat: 'macos' | 'linux' | 'win32';

  constructor(plat: 'macos' | 'linux' | 'win32') {
    this.plat = plat;
  }

  async save(name: string, url: string): Promise<void> {
    if (this.plat === 'macos') {
      execSync(`security add-generic-password -s "fennec-db" -a "${name}" -w "${url.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    } else if (this.plat === 'linux') {
      execSync(`secret-tool store --label="Fennec DB" service "fennec-db" account "${name}"`, { input: url, stdio: ['pipe', 'ignore', 'ignore'] });
    } else {
      execSync(`powershell -Command " CredWrite 'fennec-db-${name}' '${url.replace(/'/g, "''")}' "`, { stdio: 'ignore' });
    }
  }

  async get(name: string): Promise<string | null> {
    try {
      if (this.plat === 'macos') {
        return execSync(`security find-generic-password -s "fennec-db" -a "${name}" -w`, { stdio: 'pipe' }).toString().trim();
      } else if (this.plat === 'linux') {
        return execSync(`secret-tool lookup service "fennec-db" account "${name}"`, { stdio: 'pipe' }).toString().trim();
      } else {
        return execSync(`powershell -Command " CredRead 'fennec-db-${name}' "`, { stdio: 'pipe' }).toString().trim();
      }
    } catch { return null; }
  }

  async delete(name: string): Promise<void> {
    try {
      if (this.plat === 'macos') {
        execSync(`security delete-generic-password -s "fennec-db" -a "${name}"`, { stdio: 'ignore' });
      } else if (this.plat === 'linux') {
        execSync(`secret-tool clear service "fennec-db" account "${name}"`, { stdio: 'ignore' });
      } else {
        execSync(`powershell -Command " CredDelete 'fennec-db-${name}' "`, { stdio: 'ignore' });
      }
    } catch {}
  }
}

export const credentialStore = createStore();

export function getConnectionsPath(): string {
  return join(getFennecDir(), CONNECTIONS_FILE);
}

export function readConnections(): ConnectionMetadata[] {
  const path = getConnectionsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return raw.connections || [];
  } catch { return []; }
}

export function saveConnections(connections: ConnectionMetadata[]): void {
  const dir = getFennecDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConnectionsPath(), JSON.stringify({ connections }, null, 2), { mode: 0o700, encoding: 'utf-8' });
}

export function addConnection(meta: ConnectionMetadata): void {
  const list = readConnections().filter(c => c.name !== meta.name);
  list.push({ ...meta, lastUsed: new Date().toISOString() });
  saveConnections(list);
}

export function removeConnection(name: string): void {
  saveConnections(readConnections().filter(c => c.name !== name));
}

export function getConnection(name: string): ConnectionMetadata | undefined {
  return readConnections().find(c => c.name === name);
}
