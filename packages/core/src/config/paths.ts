import { resolve } from 'node:path';
import { homedir } from 'node:os';

export function getFennecDir(): string {
  const env = process.env.FENNEC_HOME ?? process.env.FENNEC_DATA_DIR;
  if (env) return resolve(env);
  return resolve(homedir(), '.fennec');
}
