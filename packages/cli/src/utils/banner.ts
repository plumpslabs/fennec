/**
 * Fennec CLI Banner
 *
 * Generates a big, pixel-style "FENNEC" logo using cfonts
 * with an orange-to-gold gradient. Falls back to a compact
 * fox icon for non-TTY environments.
 */

import pc from "picocolors";
import CFonts from "cfonts";

// ─── Hex color helper (for fallback styling) ────────────────────

export function hexColor(color: string): (s: string) => string {
  if (typeof (pc as any).hex === "function") {
    return (pc as any).hex(color);
  }
  return (s: string) => s;
}

const fennecOrange = hexColor("#FF6432");
const fennecGold = hexColor("#FFB347");

// ─── Version ────────────────────────────────────────────────────

export const VERSION = "1.11.2";

// ─── Banner generation ──────────────────────────────────────────

let cachedBanner: string | null = null;
let cachedCompact: string | null = null;

/**
 * Generate the full FENNEC ASCII art banner using cfonts.
 * Cached after first call.
 */
function generateBanner(): string {
  if (cachedBanner) return cachedBanner;

  const result = CFonts.render("FENNEC", {
    font: "block",
    align: "left",
    gradient: ["#FF6432", "#FFB347", "#FFD700"],
    independentGradient: false,
    transitionGradient: true,
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: "0",
    env: "node",
  });

  const tagline = pc.dim("ears everywhere in your stack.") + pc.dim(` v${VERSION}`);

  const bannerStr = typeof result !== "boolean" ? result.string : "🦊 Fennec";
  cachedBanner = `\n${bannerStr}\n  ${tagline}\n`;
  return cachedBanner;
}

/**
 * Compact banner for non-TTY or quick commands.
 */
function generateCompactBanner(): string {
  if (cachedCompact) return cachedCompact;
  cachedCompact = `${pc.redBright("  🦊")} ${pc.bold("Fennec")} ${pc.dim(`v${VERSION}`)}`;
  return cachedCompact;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Print the full FENNEC banner (pixel-art style) to stderr.
 * Uses full cfonts-generated logo in TTY mode, compact in non-TTY.
 */
export function printBanner(): void {
  if (process.stdout.isTTY) {
    console.error(generateBanner());
  } else {
    console.error(generateCompactBanner());
  }
}

/**
 * Print a mini/compact banner (fox icon + version only).
 * Suitable for quick commands like ps, status, kill.
 */
export function printMiniBanner(): void {
  console.error(generateCompactBanner());
}

// ─── Exports for reuse ──────────────────────────────────────────

export const FOX = generateBanner();
export const FOX_COMPACT = generateCompactBanner();
