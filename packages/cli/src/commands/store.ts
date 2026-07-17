/**
 * Command: store — unified view of everything Fennec persists.
 *
 *   fennec store                      overview (global ~/.fennec)
 *   fennec store --local             overview of ./fennec (project)
 *   fennec store session            list saved auth sessions
 *   fennec store session info <n>  show a session (values masked)
 *   fennec store session rm <n>     delete a session (confirm)
 *
 * Sessions default to the GLOBAL store (~/.fennec) so they're manageable
 * from any directory. `--local` targets the per-project ./.fennec instead.
 */
import { StoreManager, redactSession } from '@plumpslabs/fennec-core';
import { SessionStore } from '@plumpslabs/fennec-core';
import pc from 'picocolors';
import { renderError, confirmPrompt, renderSection, renderKV } from '../utils/format.js';
import { symbols, renderTable, type Column, type Row } from '../utils/format.js';

const KINDS = ['session', 'process', 'workflow', 'plugin', 'config', 'export'] as const;
type Kind = (typeof KINDS)[number];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export async function storeCommand(args: string[]): Promise<void> {
  const local = args.includes('--local');
  const showSecrets = args.includes('--show-secrets');
  const yes = args.includes('-y') || args.includes('--yes');

  const positional: string[] = [];
  for (const a of args) {
    if (a.startsWith('--') || a === '-y') continue;
    positional.push(a);
  }
  const kind = positional[0] as Kind | undefined;
  const action = positional[1];
  const name = positional[2];

  const mgr = new StoreManager(local);
  mgr.ensure();

  // `fennec store` (no kind) -> overview scan
  if (!kind) {
    const scan = mgr.scan();
    console.error(
      `\n  ${symbols.fox} ${pc.bold('Fennec Store')} ${pc.dim(local ? '(local ./.fennec)' : '(global)')}\n`,
    );
    const columns: Column[] = [
      { key: 'kind', label: 'Kind', format: (v) => pc.bold(String(v)) },
      { key: 'count', label: 'Items', format: (v) => pc.cyan(String(v)) },
      { key: 'size', label: 'Size', format: (v) => pc.dim(formatBytes(Number(v))) },
      { key: 'oldest', label: 'Oldest', format: (v) => pc.dim(formatAge(Number(v))) },
    ];
    const rows: Row[] = scan.map((e) => ({
      kind: e.kind,
      count: e.count,
      size: e.sizeBytes,
      oldest: e.oldestMs,
    }));
    console.error(renderTable(columns, rows));
    console.error(`  ${pc.dim(mgr.base)}\n`);
    return;
  }

  if (!KINDS.includes(kind)) {
    console.error(renderError('Unknown kind', `Kind must be one of: ${KINDS.join(', ')}`));
    process.exit(1);
  }

  if (kind !== 'session') {
    // Phase 1: only sessions have write actions. Others are visible via
    // overview; dedicated commands already manage them (fennec ps, etc.).
    const entry = mgr.scan().find((e) => e.kind === kind);
    console.error(`\n  ${pc.bold(kind)} ${pc.dim(`(${entry?.count ?? 0} item(s))`)}\n`);
    console.error(`  ${pc.dim(mgr.dirFor(kind))}\n`);
    const tip =
      kind === 'process'
        ? 'Managed via `fennec ps` / `fennec kill` / `fennec restart`.'
        : kind === 'export'
          ? 'Created by `fennec export` / `fennec import`.'
          : 'Read-only in this view (Phase 2).';
    console.error(`  ${pc.dim(tip)}\n`);
    return;
  }

  // ---- session ----
  const store: SessionStore = mgr.sessionStore();

  if (!action || action === 'ls' || action === 'list') {
    const sessions = store.list();
    if (sessions.length === 0) {
      console.error(
        `\n  ${pc.dim(`No saved sessions found${local ? ' in ./.fennec/sessions' : ' in the global store'}.`)}\n`,
      );
      return;
    }
    const columns: Column[] = [
      { key: 'name', label: 'Name', format: (v) => pc.bold(String(v)) },
      { key: 'origin', label: 'Origin' },
      { key: 'savedAt', label: 'Saved', format: (v) => pc.dim(String(v)) },
    ];
    const rows: Row[] = sessions.map((s) => ({
      name: s.name,
      origin: s.origin,
      savedAt: new Date(s.savedAt).toLocaleString(),
    }));
    console.error(`\n  ${symbols.fox} ${pc.bold('Saved Sessions')}\n`);
    console.error(renderTable(columns, rows));
    console.error(`  ${pc.dim(`${sessions.length} session(s)`)}\n`);
    return;
  }

  if (action === 'info') {
    if (!name) {
      console.error(
        renderError('Missing name', 'Usage: fennec store session info <name> [--show-secrets]'),
      );
      process.exit(1);
    }
    const session = store.load(name);
    if (!session) {
      console.error(
        renderError(
          'Session not found',
          `No session named "${name}". Use 'fennec store session' to list.`,
        ),
      );
      process.exit(1);
    }
    const shown = showSecrets ? session : redactSession(session);
    const cookieDomains = (shown.cookies as Array<Record<string, unknown>>)
      .map((c) => String(c.domain ?? c.name ?? '?'))
      .filter((v, i, a) => a.indexOf(v) === i);
    let body = '';
    body += renderKV('Name', shown.name);
    body += renderKV('Origin', shown.origin);
    body += renderKV('Saved', new Date(shown.savedAt).toLocaleString());
    if (shown.metadata) {
      for (const [k, v] of Object.entries(shown.metadata)) body += renderKV(k, String(v));
    }
    body += renderKV(
      'Cookies',
      `${shown.cookies.length} (domains: ${cookieDomains.join(', ') || '-'})`,
    );
    body += renderKV('localStorage keys', String(Object.keys(shown.localStorage).length));
    body += renderKV('Values', showSecrets ? 'shown' : pc.dim('masked — use --show-secrets'));
    console.error(`\n  ${pc.bold(`Session: ${shown.name}`)}\n`);
    console.error(renderSection('Details', body));
    return;
  }

  if (action === 'rm' || action === 'remove' || action === 'delete') {
    const names = positional.slice(2).filter(Boolean);
    if (names.length === 0) {
      console.error(renderError('Missing name(s)', 'Usage: fennec store session rm <name...>'));
      process.exit(1);
    }

    const notFound: string[] = [];
    const found: string[] = [];
    for (const n of names) {
      if (store.load(n)) found.push(n);
      else notFound.push(n);
    }

    if (notFound.length > 0) {
      for (const n of notFound) {
        console.error(renderError('Session not found', `No session named "${n}".`));
      }
      if (found.length === 0) process.exit(1);
    }

    const confirmed =
      yes || (await confirmPrompt(`Delete ${found.length} session(s): ${found.map((n) => pc.bold(n)).join(', ')}?`, false));
    if (!confirmed) {
      console.error(`  ${pc.dim('Cancelled')}`);
      return;
    }

    let deleted = 0;
    for (const n of found) {
      if (store.delete(n)) {
        console.error(`  ${pc.green('✓')} ${pc.bold(n)} deleted`);
        deleted++;
      } else {
        console.error(`  ${pc.red('✗')} failed to delete ${pc.bold(n)}`);
      }
    }
    console.error();
    return;
  }

  console.error(renderError('Unknown action', `Actions: ls | info <name> | rm <name...>`));
  process.exit(1);
}
