/**
 * Command: group — Tag existing tracked entries with a logical group, or
 * list group membership. Groups let bulk ops (kill/spawn/stop/ps) target a
 * subset instead of everything (--all).
 *
 *   fennec group                        → list all entries with their group
 *   fennec group <name> <grp>          → assign group <grp> to ONE app
 *   fennec group <grp> <name...>      → assign group <grp> to MANY apps (bulk)
 *   fennec group <name> --unset         → clear the group on ONE app
 *
 * Bulk is auto-detected: with 2 names where the FIRST matches a known
 * app it is treated as single (name first); otherwise the first token is
 * the group and the rest are app names.
 */
import pc from 'picocolors';
import { renderError, renderTable, type Column, type Row } from '../utils/format.js';
import { readTracked, setGroup, getGroups } from './tracker.js';

export async function groupCommand(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith('-') && !a.includes('='));
  const unset = args.includes('--unset');

  // No args → list every entry with its group
  if (positional.length === 0) {
    const tracked = readTracked();
    if (tracked.length === 0) {
      console.error(`\n  ${pc.dim('No tracked processes.')}\n`);
      return;
    }
    const columns: Column[] = [
      { key: 'name', label: 'App', format: (v) => pc.bold(String(v)) },
      {
        key: 'group',
        label: 'Group',
        format: (v) => {
          const g = String(v);
          return g === '-' ? pc.dim('-') : pc.cyan(g);
        },
      },
      {
        key: 'command',
        label: 'Command',
        format: (v) => {
          const c = String(v);
          return c.length > 50 ? c.slice(0, 50) + '…' : c;
        },
      },
    ];
    const rows: Row[] = tracked.map((t) => ({
      name: t.name,
      group: t.group ?? '-',
      command: t.command,
    }));
    console.error(
      `\n  ${pc.bold('Fennec Apps by Group')} ${pc.dim(`(${getGroups().length} group(s))`)}\n`,
    );
    console.error(renderTable(columns, rows));
    console.error(`  ${pc.dim('Assign one:')} ${pc.cyan('fennec group <name> <group>')}`);
    console.error(
      `  ${pc.dim('Assign bulk:')} ${pc.cyan('fennec group <group> <name...>')}  ${pc.dim('Clear:')} ${pc.cyan('fennec group <name> --unset')}`,
    );
    console.error();
    return;
  }

  // Single clear: fennec group <name> --unset
  if (unset) {
    const name = positional[0]!;
    const ok = setGroup(name, undefined);
    if (!ok) {
      console.error(renderError('Not found', `No tracked process named "${name}".`));
      process.exit(1);
    }
    console.error(`\n  ${pc.green('✓')} ${pc.bold(name)} ${pc.dim('removed from its group')}\n`);
    return;
  }

  // Resolve single vs bulk.
  //  - 3+ tokens → bulk (first = group, rest = app names)
  //  - 2 tokens:
  //      * first matches a known app  → single (name first)  [backward compat]
  //      * else                           → bulk (group first)
  let group: string;
  let names: string[];
  if (positional.length >= 3) {
    group = positional[0]!;
    names = positional.slice(1);
  } else {
    const [a, b] = positional;
    const tracked = readTracked();
    const aIsApp = tracked.some((t) => t.name === a);
    if (aIsApp) {
      // legacy single form: name=a, group=b
      names = [a!];
      group = b!;
    } else {
      // bulk form: group=a, names=[b]
      group = a!;
      names = [b!];
    }
  }

  const okNames: string[] = [];
  const failed: string[] = [];
  for (const n of names) {
    if (setGroup(n, group)) okNames.push(n);
    else failed.push(n);
  }

  if (okNames.length > 0) {
    console.error(
      `\n  ${pc.green('✓')} ${pc.bold(okNames.join(', '))} ${pc.dim(`assigned to group`)} ${pc.cyan(group)}`,
    );
  }
  if (failed.length > 0) {
    console.error(`  ${pc.red('✗')} ${pc.dim(`not found: ${failed.join(', ')}`)}`);
  }
  if (okNames.length === 0 && failed.length > 0) process.exit(1);
  console.error();
}
