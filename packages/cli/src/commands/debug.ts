/**
 * Command: debug — Attach/detach debug mode to tracked apps.
 *
 * Debug mode is a tracked.json flag consumed by MCP debug tools
 * (debug_get_errors, debug_set_breakpoint, debug_auto_report, etc.)
 * to know which level of debugging to apply to each process.
 *
 * Subcommands:
 *   attach <name|--group> [--mode log|breakpoint]  — enable debug
 *   detach <name|--group>                                 — disable debug
 *   status [name]                                         — show debug status
 *
 * If no subcommand is given, defaults to `attach`.
 */
import pc from 'picocolors';
import {
  symbols,
  renderError,
  renderKV,
  renderTable,
  type Column,
  type Row,
} from '../utils/format.js';
import {
  readTracked,
  saveTracked,
  resolveTargets,
  isTrackedRunning,
  extractFlagValue,
  getGroups,
  formatUptime,
} from './tracker.js';

const MODES = ['log', 'breakpoint'] as const;
type DebugMode = (typeof MODES)[number];

function isValidMode(s: string | undefined): s is DebugMode {
  return MODES.includes(s as DebugMode);
}

function modeLabel(mode: DebugMode): string {
  switch (mode) {
    case 'log':
      return pc.green('L');
    case 'breakpoint':
      return pc.yellow('B');
  }
}

function modeName(mode: DebugMode): string {
  switch (mode) {
    case 'log':
      return 'log';
    case 'breakpoint':
      return 'breakpoint';
  }
}

export async function debugCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === 'status') {
    await debugStatus(args.slice(1));
    return;
  }

  if (sub === 'detach') {
    await debugDetach(args.slice(1));
    return;
  }

  // Default to attach (also handles bare `fennec debug <name>`)
  await debugAttach(sub === 'attach' ? args.slice(1) : args);
}

/**
 * Attach debug mode to one or more tracked apps.
 * Usage: fennec debug attach <name> [--mode log|breakpoint]
 *        fennec debug attach --group <g> [--mode ...]
 *        fennec debug attach <name1> <name2> [--mode ...]
 *        fennec debug <name>                              ← shorthand
 */
async function debugAttach(args: string[]): Promise<void> {
  const modeArg = extractFlagValue(args, '--mode');
  const mode: DebugMode = isValidMode(modeArg) ? modeArg : 'log';
  const target = resolveTargets(args);

  if (target.kind === 'none') {
    console.error(renderError(
      'Missing target',
      'Usage: fennec debug attach <name|--group <g>> [--mode log|breakpoint]',
    ));
    process.exit(1);
  }

  const tracked = readTracked();
  let changed = 0;

  const setDebug = (name: string): boolean => {
    const idx = tracked.findIndex((t) => t.name === name);
    if (idx === -1) return false;
    tracked[idx] = { ...tracked[idx]!, debugMode: mode };
    changed++;
    return true;
  };

  if (target.kind === 'single') {
    if (!setDebug(target.value!)) {
      console.error(renderError('Not found', `No tracked app named "${target.value}".`));
      process.exit(1);
    }
  } else if (target.kind === 'names') {
    for (const name of target.values!) setDebug(name);
  } else if (target.kind === 'group') {
    const g = target.group!;
    for (const t of tracked) {
      if (t.group === g) {
        t.debugMode = mode;
        changed++;
      }
    }
    if (changed === 0) {
      console.error(renderError('Empty group', `No apps in group "${g}".`));
      process.exit(1);
    }
  } else if (target.kind === 'all') {
    for (const t of tracked) {
      t.debugMode = mode;
      changed++;
    }
  }

  saveTracked(tracked);
  const modeStr = modeName(mode);
  console.error(
    `  ${pc.green('✓')} ${pc.bold(`Debug ${modeStr}`)} ${pc.dim(`attached to ${changed} app(s)`)}`,
  );
  console.error();
}

/**
 * Detach debug mode from one or more tracked apps.
 * Usage: fennec debug detach <name|--group>
 *        fennec debug detach <name1> <name2>
 */
async function debugDetach(args: string[]): Promise<void> {
  const target = resolveTargets(args);

  if (target.kind === 'none') {
    console.error(renderError(
      'Missing target',
      'Usage: fennec debug detach <name|--group <g>>',
    ));
    process.exit(1);
  }

  const tracked = readTracked();
  let changed = 0;

  const clearDebug = (name: string): boolean => {
    const idx = tracked.findIndex((t) => t.name === name);
    if (idx === -1) return false;
    if (!tracked[idx]!.debugMode) return false;
    tracked[idx] = { ...tracked[idx]!, debugMode: undefined };
    changed++;
    return true;
  };

  if (target.kind === 'single') {
    if (!clearDebug(target.value!)) {
      console.error(
        `  ${pc.yellow('⚠')} ${pc.bold(target.value)} ${pc.dim('has no debug mode attached, or not found.')}`,
      );
      process.exit(1);
    }
  } else if (target.kind === 'names') {
    for (const name of target.values!) clearDebug(name);
  } else if (target.kind === 'group') {
    const g = target.group!;
    for (const t of tracked) {
      if (t.group === g && t.debugMode) {
        t.debugMode = undefined;
        changed++;
      }
    }
  } else if (target.kind === 'all') {
    for (const t of tracked) {
      if (t.debugMode) {
        t.debugMode = undefined;
        changed++;
      }
    }
  }

  saveTracked(tracked);
  console.error(
    `  ${pc.green('✓')} ${pc.bold('Debug detached')} ${pc.dim(`from ${changed} app(s)`)}`,
  );
  console.error();
}

/**
 * Show debug status for all or one tracked app.
 * Usage: fennec debug status [name]
 */
async function debugStatus(args: string[]): Promise<void> {
  const nameFilter = args[0];
  const tracked = readTracked();
  const filtered = nameFilter
    ? tracked.filter((t) => t.name === nameFilter)
    : tracked.filter((t) => t.debugMode);

  if (filtered.length === 0) {
    if (nameFilter) {
      console.error(`\n  ${pc.dim(`No debug status for "${nameFilter}".`)}`);
      console.error(`  ${pc.dim('Use')} ${pc.cyan(`fennec debug attach ${nameFilter} --mode log`)} ${pc.dim('to enable debug.')}`);
    } else {
      console.error(`\n  ${pc.dim('No apps have debug mode attached.')}`);
      console.error(`  ${pc.dim('Use')} ${pc.cyan('fennec debug attach <name> [--mode log|breakpoint]')}`);
    }
    console.error();
    return;
  }

  const columns: Column[] = [
    { key: 'name', label: 'App', format: (v) => pc.bold(String(v)) },
    {
      key: 'mode',
      label: 'Mode',
      format: (v) => {
        const m = v as string;
        return m === 'log' ? pc.green('log') :
               m === 'breakpoint' ? pc.yellow('breakpoint') :
               pc.dim('-');
      },
    },
    { key: 'status', label: 'Status', format: (v) => {
      const s = v as string;
      return s === 'running' ? pc.green('● running') : pc.red('○ stopped');
    }},
    { key: 'group', label: 'Group', format: (v) => {
      const g = String(v);
      return g === '-' ? pc.dim('-') : pc.cyan(g);
    }},
    { key: 'pid', label: 'PID', align: 'right', format: (v) => pc.dim(String(v).padStart(6)) },
  ];

  const rows: Row[] = filtered.map((t) => ({
    name: t.name,
    mode: t.debugMode ?? '-',
    status: isTrackedRunning(t) ? 'running' : 'stopped',
    group: t.group ?? '-',
    pid: t.pid,
  }));

  console.error(`\n  ${symbols.fox} ${pc.bold('Debug Status')} ${pc.dim(`(${filtered.length} app(s) with debug)`)}\n`);
  console.error(renderTable(columns, rows));
  console.error();
}
