import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { getFennecDir } from '../config/paths.js';

export interface DevCredential {
  origin: string;
  username: string;
  /** literal password (encrypted at rest) — omit when using passwordEnv */
  password?: string;
  /** env var name holding the password (preferred, nothing secret on disk) */
  passwordEnv?: string;
  loginUrl?: string;
  loginPath?: string;
  account?: string;
  updatedAt: string;
}

const VAULT_FILE = 'dev-credentials.enc.json';

function vaultPath(): string {
  return join(getFennecDir(), VAULT_FILE);
}

function vaultKey(): Buffer {
  const raw =
    process.env.FENNEC_VAULT_KEY ??
    `${process.env.USER ?? process.env.USERNAME ?? 'fennec'}-${process.platform}-${process.arch}`;
  return createHash('sha256').update(String(raw)).digest();
}

function encrypt(plain: string): { iv: string; tag: string; data: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(enc: { iv: string; tag: string; data: string }): string {
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(enc.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function readAll(): Record<string, DevCredential> {
  try {
    if (!existsSync(vaultPath())) return {};
    const raw = JSON.parse(readFileSync(vaultPath(), 'utf-8'));
    const out: Record<string, DevCredential> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const e = v as { iv: string; tag: string; data: string };
      if (!e?.iv || !e?.data) continue;
      try {
        out[k] = JSON.parse(decrypt(e)) as DevCredential;
      } catch {
        /* wrong key / corrupt entry — skip */
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, DevCredential>): void {
  const dir = getFennecDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const enc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) enc[k] = encrypt(JSON.stringify(v));
  writeFileSync(vaultPath(), JSON.stringify(enc, null, 2), { mode: 0o600, encoding: 'utf-8' });
}

export function vaultKeyFor(origin: string, account = 'default'): string {
  let o: string;
  try {
    o = new URL(origin).origin;
  } catch {
    o = origin;
  }
  return `${o}::${account}`;
}

export function saveDevCredential(cred: Omit<DevCredential, 'updatedAt'>): void {
  const all = readAll();
  all[vaultKeyFor(cred.origin, cred.account ?? 'default')] = {
    ...cred,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
}

export function getDevCredential(origin: string, account = 'default'): DevCredential | null {
  return readAll()[vaultKeyFor(origin, account)] ?? null;
}

export function listDevCredentials(): Array<
  Omit<DevCredential, 'password'> & { account: string; hasPassword: boolean; usesEnv: boolean }
> {
  return Object.entries(readAll()).map(([k, v]) => ({
    origin: v.origin,
    username: v.username,
    loginUrl: v.loginUrl,
    loginPath: v.loginPath,
    account: k.split('::')[1] ?? 'default',
    updatedAt: v.updatedAt,
    hasPassword: !!v.password,
    usesEnv: !!v.passwordEnv,
  }));
}

export function deleteDevCredential(origin: string, account = 'default'): boolean {
  const all = readAll();
  const k = vaultKeyFor(origin, account);
  if (!(k in all)) return false;
  delete all[k];
  writeAll(all);
  return true;
}

/** Resolve the actual password: env var first, then vault literal. Never logged. */
export function resolvePassword(cred: DevCredential): string | null {
  if (cred.passwordEnv) {
    const v = process.env[cred.passwordEnv];
    if (v) return v;
  }
  if (cred.password) return cred.password;
  return null;
}

export function getVaultPath(): string {
  return vaultPath();
}
