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

import { createInterface } from "node:readline";
import pc from "picocolors";

// ─── Color Helpers ───────────────────────────────────────────────

/**
 * Custom hex color formatter.
 * picocolors has hex() at runtime but can be undefined on some Node.js
 * versions due to CJS/ESM interop issues. We detect and fall back.
 */
function hex(color: string): (s: string) => string {
  if (typeof (pc as any).hex === "function") {
    return (pc as any).hex(color);
  }
  return (s: string) => s;
}

// Brand colors (runtime-safe, bypass TypeScript limitations)
const fennecOrange = hex("#FF6432");
const blueAccent = hex("#4A90D9");
const redAccent = hex("#E94560");

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
  active: pc.green("●"),
  inactive: pc.dim("○"),
  error: pc.red("✗"),
  warning: pc.yellow("⚠"),
  success: pc.green("✓"),
  info: pc.cyan("ℹ"),
  pending: pc.yellow("◌"),

  // UI
  bullet: pc.dim("│"),
  dot: pc.dim("·"),
  arrow: pc.cyan("→"),
  pointer: fennecOrange("▶"),
  separator: pc.dim("─"),

  // Fennec
  fox: "🦊",
  ears: "⏜",
} as const;

// ─── Status Badges ───────────────────────────────────────────────

export type ProcessStatus = "running" | "stopped" | "error" | "starting" | "unknown";

export function statusBadge(status: ProcessStatus): string {
  switch (status) {
    case "running":  return pc.green("● running");
    case "stopped":  return pc.dim("○ stopped");
    case "error":    return pc.red("✗ error");
    case "starting": return pc.yellow("◌ starting");
    case "unknown":  return pc.dim("? unknown");
  }
}

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";

export function logLevel(label: string): string {
  const upper = label.toUpperCase().padEnd(5);
  switch (label.toLowerCase()) {
    case "error":   return pc.bgRed(pc.white(` ${upper} `));
    case "warn":    return pc.bgYellow(pc.black(` ${upper} `));
    case "info":    return pc.bgCyan(pc.black(` ${upper} `));
    case "debug":   return pc.dim(pc.italic(upper));
    case "verbose": return pc.dim(pc.italic(upper));
    default:        return pc.dim(upper);
  }
}

// ─── Table Renderer ──────────────────────────────────────────────

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: number;
  format?: (value: unknown) => string;
}

export interface Row {
  [key: string]: unknown;
}

export function renderTable(columns: Column[], rows: Row[], options?: { padding?: number; compact?: boolean }): string {
  const pad = options?.padding ?? 1;
  const isCompact = options?.compact ?? false;

  if (rows.length === 0) {
    return pc.dim("  (no data)");
  }

  // Calculate column widths
  const widths: number[] = columns.map((col) => {
    const headerLen = col.label.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "-");
      return Math.max(max, val.length);
    }, 0);
    return Math.max(headerLen, maxDataLen, col.width ?? 0) + pad * 2;
  });

  // ─── Helpers ────────────────────────────────────────
  const hLine = (left: string, mid: string, right: string, fill = "─") => {
    return pc.dim(
      left + widths.map((w) => fill.repeat(w)).join(mid) + right,
    );
  };

  const formatCell = (text: string, colIdx: number) => {
    const col = columns[colIdx]!;
    const w = widths[colIdx]!;

    // Truncate if too long
    const display = text.length > w ? text.slice(0, w - 1) + "…" : text;
    const padded = display.padEnd(w);

    const align = col.align ?? "left";
    if (align === "right") return padded.padStart(w);
    if (align === "center") {
      const leftPad = Math.floor((w - display.length) / 2);
      return " ".repeat(leftPad) + display + " ".repeat(w - display.length - leftPad);
    }
    return padded;
  };

  const renderRow = (row: Row): string => {
    const cells = columns.map((col, i) => {
      const raw = row[col.key];
      const formatted = col.format ? col.format(raw) : String(raw ?? "-");
      return formatCell(formatted, i);
    });
    return pc.dim("│") + cells.join(pc.dim("│")) + pc.dim("│");
  };

  // ─── Build table ────────────────────────────────────
  const lines: string[] = [];

  if (!isCompact) {
    lines.push(hLine("┌", "┬", "┐"));
  }

  // Header row
  const headerCells = columns.map((col, i) => {
    return formatCell(pc.bold(col.label), i);
  });
  lines.push(pc.dim("│") + headerCells.join(pc.dim("│")) + pc.dim("│"));

  if (!isCompact) {
    lines.push(hLine("├", "┼", "┤"));
  } else {
    lines.push(pc.dim("├") + widths.map((w) => pc.dim("─").repeat(w)).join(pc.dim("┼")) + pc.dim("┤"));
  }

  // Data rows
  for (const row of rows) {
    const rendered = renderRow(row);
    // Highlight if row has an error
    if (row._error) {
      lines.push(colors.error(rendered));
    } else {
      lines.push(rendered);
    }
  }

  if (!isCompact) {
    lines.push(hLine("└", "┴", "┘"));
  }

  return lines.join("\n");
}

// ─── Key-Value Display ───────────────────────────────────────────

export function renderKV(key: string, value: string, options?: { indent?: number; separator?: string }): string {
  const indent = options?.indent ?? 2;
  const sep = options?.separator ?? ":";
  const pad = " ".repeat(indent);
  return `${pad}${pc.dim(key + sep)} ${value}`;
}

export function renderKVColor(key: string, value: string, color: (s: string) => string = pc.bold): string {
  return `  ${pc.dim(key + ":")} ${color(value)}`;
}

export function renderSection(title: string, content: string): string {
  const line = pc.dim("─".repeat(40));
  return `\n  ${pc.bold(title)}\n  ${line}\n${content}\n`;
}

// ─── Box Renderer ────────────────────────────────────────────────

export function renderBox(title: string, content: string, options?: {
  width?: number;
  borderColor?: (s: string) => string;
  titleColor?: (s: string) => string;
}): string {
  const width = options?.width ?? 50;
  const border = options?.borderColor ?? pc.dim;
  const titleColor = options?.titleColor ?? pc.bold;

  const lines = content.split("\n");
  const wrapped = lines.map((l) => {
    const clean = l.replace(/\x1b\[[0-9;]*m/g, "");
    return l + " ".repeat(Math.max(0, width - clean.length - 2));
  });

  const top = border(`┌─ ${titleColor(title)} ${"─".repeat(Math.max(0, width - title.length - 4))}┐`);
  const mid = wrapped.map((l) => border("│ ") + l + border(" │")).join("\n");
  const bot = border(`└${"─".repeat(width)}┘`);

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
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let running = true;

  const interval = setInterval(() => {
    if (!running) return;
    process.stdout.write(`\r${pc.cyan(frames[i])} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);

  return {
    update(newText: string) {
      if (!running) return;
      process.stdout.write(`\r${pc.cyan(frames[i])} ${newText}`);
    },
    succeed(msg: string) {
      running = false;
      clearInterval(interval);
      process.stdout.write(`\r${pc.green("✓")} ${msg}\n`);
    },
    fail(msg: string) {
      running = false;
      clearInterval(interval);
      process.stdout.write(`\r${pc.red("✗")} ${msg}\n`);
    },
    warn(msg: string) {
      running = false;
      clearInterval(interval);
      process.stdout.write(`\r${pc.yellow("⚠")} ${msg}\n`);
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
  console.log(`  ${pc.dim("0)  Cancel")}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`  ${pc.bold("Enter number")} ${pc.dim("(0-" + options.length + ")")}: `, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  const num = parseInt(answer, 10);
  if (isNaN(num) || num === 0) return null;
  const selected = options[num - 1];
  if (!selected) {
    console.log(`  ${pc.red("Invalid selection.")}`);
    return null;
  }
  return selected.value;
}

export async function confirmPrompt(message: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? pc.bold("Y") + pc.dim("/n") : pc.dim("y/") + pc.bold("N");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\n  ${message} ${pc.dim("(" + hint + ")")}: `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

// ─── Divider ─────────────────────────────────────────────────────

export function divider(text?: string): string {
  if (text) {
    const len = 50 - text.length - 2;
    const left = Math.floor(len / 2);
    const right = len - left;
    return pc.dim("─".repeat(left) + ` ${text} ` + "─".repeat(right));
  }
  return pc.dim("─".repeat(50));
}

// ─── Timestamp ───────────────────────────────────────────────────

export function timestamp(date?: Date): string {
  const d = date ?? new Date();
  const time = d.toLocaleTimeString("en-US", { hour12: false });
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
  lines.push(`\n  ${pc.bgRed(pc.white(" ERROR "))} ${pc.bold(title)}`);
  if (details) {
    lines.push(`  ${pc.dim(details)}`);
  }
  if (suggestions && suggestions.length > 0) {
    lines.push(`\n  ${pc.bold("Suggestions:")}`);
    for (const s of suggestions) {
      lines.push(`  ${pc.cyan("→")} ${s}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function renderSuccess(message: string): string {
  return `  ${pc.green("✓")} ${message}`;
}

export function renderWarning(message: string): string {
  return `  ${pc.yellow("⚠")} ${message}`;
}
