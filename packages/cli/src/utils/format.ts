/**
 * Fennec CLI Formatting System
 *
 * Central module for all CLI output formatting.
 * Uses picocolors (7KB, zero dependencies) for coloring.
 *
 * Design principles:
 * - Minimal dependencies (picocolors only)
 * - Clean, modern, readable output
 * - Consistent spacing and alignment
 * - Fox-themed (🦊) but not overwhelming
 */

import { createInterface } from 'node:readline';
import pc from 'picocolors';
import CliTable3 from 'cli-table3';

// ─── Color Helpers ───────────────────────────────────────────────

/**
 * Custom hex color formatter.
 * picocolors has hex() at runtime but can be undefined on some Node.js
 * versions due to CJS/ESM interop issues. We detect and fall back.
 */
function hex(color: string): (s: string) => string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = pc as any;
  if (typeof pw.hex === 'function') {
    return pw.hex(color);
  }
  return (s: string) => s;
}

// Brand colors (runtime-safe, bypass TypeScript limitations)
const fennecOrange = hex('#FF6432');
const blueAccent = hex('#4A90D9');
const redAccent = hex('#E94560');

// ─── Color Palette ───────────────────────────────────────────────

export const colors = {
  // Brand colors
  primary: fennecOrange,
  secondary: blueAccent,
  accent: redAccent,

  // Semantic colors
  success: pc.green,
  error: pc.red,
  warning: pc.yellow,
  info: pc.cyan,
  muted: pc.dim,
  highlight: pc.bold,

  // Backgrounds
  bgSuccess: (s: string) => pc.bgGreen(pc.black(` ${s} `)),
  bgError: (s: string) => pc.bgRed(pc.white(` ${s} `)),
  bgWarning: (s: string) => pc.bgYellow(pc.black(` ${s} `)),
  bgInfo: (s: string) => pc.bgCyan(pc.black(` ${s} `)),
} as const;

// ─── Symbols ─────────────────────────────────────────────────────

export const symbols = {
  // Status
  active: pc.green('●'),
  inactive: pc.dim('○'),
  error: pc.red('✗'),
  warning: pc.yellow('⚠'),
  success: pc.green('✓'),
  info: pc.cyan('ℹ'),
  pending: pc.yellow('◌'),

  // UI
  bullet: pc.dim('│'),
  dot: pc.dim('·'),
  arrow: pc.cyan('→'),
  pointer: fennecOrange('▶'),
  separator: pc.dim('─'),

  // Fennec
  fox: '🦊',
  ears: '⏜',
} as const;

// ─── Status Badges ───────────────────────────────────────────────

export type ProcessStatus = 'running' | 'stopped' | 'error' | 'starting' | 'unknown';

export function statusBadge(status: ProcessStatus): string {
  switch (status) {
    case 'running':
      return pc.green('● running');
    case 'stopped':
      return pc.dim('○ stopped');
    case 'error':
      return pc.red('✗ error');
    case 'starting':
      return pc.yellow('◌ starting');
    case 'unknown':
      return pc.dim('? unknown');
  }
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

export function logLevel(label: string): string {
  const upper = label.toUpperCase().padEnd(5);
  switch (label.toLowerCase()) {
    case 'error':
      return pc.bgRed(pc.white(` ${upper} `));
    case 'warn':
      return pc.bgYellow(pc.black(` ${upper} `));
    case 'info':
      return pc.bgCyan(pc.black(` ${upper} `));
    case 'debug':
      return pc.dim(pc.italic(upper));
    case 'verbose':
      return pc.dim(pc.italic(upper));
    default:
      return pc.dim(upper);
  }
}

// ─── Table Renderer (cli-table3 powered) ────────────────────────

export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: number;
  format?: (value: unknown) => string;
}

export interface Row {
  [key: string]: unknown;
}

export function renderTable(
  columns: Column[],
  rows: Row[],
  options?: { padding?: number; compact?: boolean },
): string {
  const pad = options?.padding ?? 1;

  if (rows.length === 0) {
    return pc.dim('  (no data)');
  }

  // Build cli-table3 instance
  const table = new CliTable3({
    head: columns.map((c) => pc.bold(c.label)),
    colAligns: columns.map((c) => c.align ?? 'left'),
    style: {
      'padding-left': pad,
      'padding-right': pad,
      head: [], // reset default styles; our pc.bold is already applied
      border: [],
      compact: false,
    },
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
    truncate: '…',
  });

  for (const row of rows) {
    const values = columns.map((col) => {
      const raw = row[col.key];
      return col.format ? col.format(raw) : String(raw ?? '-');
    });
    table.push(values);
  }

  const output = table.toString();

  // Apply dim to all border lines (head, body, foot)
  const lines = output.split('\n');
  return lines
    .map((l) => {
      // Only dim border chars (lines that start with box-drawing chars)
      if (
        l.length > 0 &&
        (l[0] === '┌' || l[0] === '│' || l[0] === '├' || l[0] === '└' || l[0] === '─')
      ) {
        // Dim the border characters but keep cell content bright
        return l.replace(/^([│├└┌┐┤┴┬─]+)/, (m) => pc.dim(m));
      }
      return l;
    })
    .join('\n');
}

// ─── Key-Value Display ───────────────────────────────────────────

export function renderKV(
  key: string,
  value: string,
  options?: { indent?: number; separator?: string },
): string {
  const indent = options?.indent ?? 2;
  const sep = options?.separator ?? ':';
  const pad = ' '.repeat(indent);
  return `${pad}${pc.dim(key + sep)} ${value}`;
}

export function renderKVColor(
  key: string,
  value: string,
  color: (s: string) => string = pc.bold,
): string {
  return `  ${pc.dim(key + ':')} ${color(value)}`;
}

export function renderSection(title: string, content: string): string {
  const line = pc.dim('─'.repeat(40));
  return `\n  ${pc.bold(title)}\n  ${line}\n${content}\n`;
}

// ─── Box Renderer ────────────────────────────────────────────────

export function renderBox(
  title: string,
  content: string,
  options?: {
    width?: number;
    borderColor?: (s: string) => string;
    titleColor?: (s: string) => string;
  },
): string {
  const width = options?.width ?? 50;
  const border = options?.borderColor ?? pc.dim;
  const titleColor = options?.titleColor ?? pc.bold;

  const lines = content.split('\n');
  const wrapped = lines.map((l) => {
    const clean = l.replace(/\x1b\[[0-9;]*m/g, '');
    return l + ' '.repeat(Math.max(0, width - clean.length - 2));
  });

  const top = border(
    `┌─ ${titleColor(title)} ${'─'.repeat(Math.max(0, width - title.length - 4))}┐`,
  );
  const mid = wrapped.map((l) => border('│ ') + l + border(' │')).join('\n');
  const bot = border(`└${'─'.repeat(width)}┘`);

  return `\n${top}\n${mid}\n${bot}\n`;
}

// ─── Spinner (minimal, no dependencies) ──────────────────────────

export interface Spinner {
  update(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  warn(text: string): void;
  stop(): void;
}

export function createSpinner(text: string): Spinner {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let running = true;

  const interval = setInterval(() => {
    if (!running) return;
    process.stderr.write(`\r${pc.cyan(frames[i])} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);

  return {
    update(newText: string) {
      if (!running) return;
      process.stderr.write(`\r${pc.cyan(frames[i])} ${newText}`);
    },
    succeed(msg: string) {
      running = false;
      clearInterval(interval);
      process.stderr.write(`\r${pc.green('✓')} ${msg}\n`);
    },
    fail(msg: string) {
      running = false;
      clearInterval(interval);
      process.stderr.write(`\r${pc.red('✗')} ${msg}\n`);
    },
    warn(msg: string) {
      running = false;
      clearInterval(interval);
      process.stderr.write(`\r${pc.yellow('⚠')} ${msg}\n`);
    },
    stop() {
      running = false;
      clearInterval(interval);
    },
  };
}

// ─── Interactive Select (enhanced) ───────────────────────────────

export async function selectPrompt<T extends string>(
  message: string,
  options: { value: T; label: string; description?: string }[],
): Promise<T | null> {
  console.log(`\n  ${pc.bold(message)}\n`);
  options.forEach((opt, i) => {
    const num = pc.cyan(`  ${i + 1}`);
    console.log(`${num}  ${opt.label}`);
    if (opt.description) {
      console.log(`     ${pc.dim(opt.description)}`);
    }
  });
  console.log(`  ${pc.dim('0)  Cancel')}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`  ${pc.bold('Enter number')} ${pc.dim('(0-' + options.length + ')')}: `, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  const num = parseInt(answer, 10);
  if (isNaN(num) || num === 0) return null;
  const selected = options[num - 1];
  if (!selected) {
    console.log(`  ${pc.red('Invalid selection.')}`);
    return null;
  }
  return selected.value;
}

export async function confirmPrompt(message: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? pc.bold('Y') + pc.dim('/n') : pc.dim('y/') + pc.bold('N');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\n  ${message} ${pc.dim('(' + hint + ')')}: `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

// ─── Divider ─────────────────────────────────────────────────────

export function divider(text?: string): string {
  if (text) {
    const len = 50 - text.length - 2;
    const left = Math.floor(len / 2);
    const right = len - left;
    return pc.dim('─'.repeat(left) + ` ${text} ` + '─'.repeat(right));
  }
  return pc.dim('─'.repeat(50));
}

// ─── Timestamp ───────────────────────────────────────────────────

export function timestamp(date?: Date): string {
  const d = date ?? new Date();
  const time = d.toLocaleTimeString('en-US', { hour12: false });
  return pc.dim(`[${time}]`);
}

// ─── Command Line ────────────────────────────────────────────────

export function renderCommand(cmd: string): string {
  return fennecOrange(`$ ${cmd}`);
}

export function renderAppName(name: string): string {
  return fennecOrange(pc.bold(name));
}

// ─── Error Display ───────────────────────────────────────────────

export function renderError(title: string, details?: string, suggestions?: string[]): string {
  const lines: string[] = [];
  lines.push(`\n  ${pc.bgRed(pc.white(' ERROR '))} ${pc.bold(title)}`);
  if (details) {
    lines.push(`  ${pc.dim(details)}`);
  }
  if (suggestions && suggestions.length > 0) {
    lines.push(`\n  ${pc.bold('Suggestions:')}`);
    for (const s of suggestions) {
      lines.push(`  ${pc.cyan('→')} ${s}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function renderSuccess(message: string): string {
  return `  ${pc.green('✓')} ${message}`;
}

export function renderWarning(message: string): string {
  return `  ${pc.yellow('⚠')} ${message}`;
}
