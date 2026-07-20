/**
 * Fennec CLI Banner
 *
 * Pure-text ASCII art banner using picocolors only.
 * No external font libraries — avoids ESM/CJS interop issues
 * (cfonts uses dynamic require("os") which crashes in ESM bundles).
 *
 * Falls back to a compact fox icon for non-TTY environments.
 * All picocolors-based, no additional dependencies.
 */

import pc from 'picocolors';

// ─── Hex color helper ──────────────────────────────────────────

export function hexColor(color: string): (s: string) => string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = pc as any;
  if (typeof pw.hex === 'function') {
    return pw.hex(color);
  }
  return (s: string) => s;
}

const fennecOrange = hexColor('#FF6432');
const fennecGold = hexColor('#FFB347');

// ─── Version ────────────────────────────────────────────────────

export const VERSION = '1.16.3';

// ─── Banner generation ──────────────────────────────────────────

let cachedBanner: string | null = null;
let cachedCompact: string | null = null;

/**
 * Generate the full FENNEC ASCII art banner.
 * Pure-text — no external font library needed.
 * Cached after first call.
 */
function generateBanner(): string {
  if (cachedBanner) return cachedBanner;

  const logo = [
    '███████╗███████╗███╗   ██╗███╗   ██╗███████╗ ██████╗',
    '██╔════╝██╔════╝████╗  ██║████╗  ██║██╔════╝██╔════╝',
    '█████╗  █████╗  ██╔██╗ ██║██╔██╗ ██║█████╗  ██║     ',
    '██╔══╝  ██╔══╝  ██║╚██╗██║██║╚██╗██║██╔══╝  ██║     ',
    '██║     ███████╗██║ ╚████║██║ ╚████║███████╗╚██████╗',
    '╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝',
  ];

  // Apply gradient: orange → gold
  const gradientSteps = logo.length;
  const bannerStr = logo
    .map((line, i) => {
      const ratio = i / (gradientSteps - 1);
      const color = ratio < 0.5 ? fennecOrange : fennecGold;
      return color(line);
    })
    .join('\n');

  const tagline = pc.dim('ears everywhere in your stack.') + pc.dim(` v${VERSION}`);

  cachedBanner = `\n${bannerStr}\n  ${tagline}\n`;
  return cachedBanner;
}

/**
 * Compact banner for non-TTY or quick commands.
 */
function generateCompactBanner(): string {
  if (cachedCompact) return cachedCompact;
  cachedCompact = `${pc.redBright('  🦊')} ${pc.bold('Fennec')} ${pc.dim(`v${VERSION}`)}`;
  return cachedCompact;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Print the full FENNEC banner (ASCII art) to stderr.
 * Uses full logo in TTY mode, compact in non-TTY.
 */
export function printBanner(): void {
  if (process.stdout.isTTY) {
    console.error(generateBanner());
  } else {
    console.error(generateCompactBanner());
  }
}

// ─── Exports for reuse ──────────────────────────────────────────
