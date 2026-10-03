import {
  saveDevCredential,
  listDevCredentials,
  deleteDevCredential,
  getVaultPath,
} from '@plumpslabs/fennec-core';
import pc from 'picocolors';

function getArg(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n && i + 1 < args.length) return args[i + 1];
      const m = args[i]!.match(new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(.*)$`));
      if (m) return m[1];
    }
  }
  return undefined;
}

export async function authVaultCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === 'save') {
    const origin = getArg(rest, '--origin');
    const username = getArg(rest, '--username', '--user', '-u');
    const password = getArg(rest, '--password', '-p');
    const passwordEnv = getArg(rest, '--password-env');
    const loginUrl = getArg(rest, '--login-url');
    const loginPath = getArg(rest, '--login-path');
    const account = getArg(rest, '--account') ?? 'default';
    const devOnly = rest.includes('--dev-only');
    if (!origin || !username || (!password && !passwordEnv) || !devOnly) {
      console.error(
        'Usage: fennec auth save --origin https://staging.example.com --username user@example.com (--password ... | --password-env STAGING_PASS) [--login-path /login] [--account admin] --dev-only',
      );
      process.exit(1);
    }
    saveDevCredential({
      origin,
      username,
      ...(password ? { password } : {}),
      ...(passwordEnv ? { passwordEnv } : {}),
      ...(loginUrl ? { loginUrl } : {}),
      ...(loginPath ? { loginPath } : {}),
      account,
    });
    console.error(
      `${pc.green('✓')} Saved dev credential for ${origin} (account ${account}). Vault: ${getVaultPath()}`,
    );
    return;
  }
  if (sub === 'ls' || sub === 'list') {
    const entries = listDevCredentials();
    if (entries.length === 0) {
      console.error('No dev credentials saved.');
      return;
    }
    for (const e of entries)
      console.error(
        `- ${e.origin} [${e.account}] ${e.username} ${e.usesEnv ? '(env:' + 'passwordEnv' + ')' : '(encrypted literal)'}`,
      );
    return;
  }
  if (sub === 'rm') {
    const origin = getArg(rest, '--origin') ?? rest[0];
    const account = getArg(rest, '--account') ?? 'default';
    if (!origin) {
      console.error('Usage: fennec auth rm --origin https://... [--account admin]');
      process.exit(1);
    }
    const ok = deleteDevCredential(origin, account);
    console.error(ok ? `${pc.green('✓')} Deleted.` : 'Not found.');
    return;
  }
  console.error('Usage: fennec auth <save|ls|rm> ...');
  process.exit(1);
}
