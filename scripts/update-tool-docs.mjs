#!/usr/bin/env node
/**
 * Recompute & sync Fennec tool counts everywhere from ONE source of truth:
 * the per-category tables in docs/tools/README.md.
 *
 * Run after adding/removing a tool (you only edit the catalog table once):
 *   node scripts/update-tool-docs.mjs
 *
 * Updates:
 *   - docs/tools/README.md  : header total + "(N tools)" per category + Quick Stats table + footer
 *   - README.md             : "all N tools documented"
 *   - packages/core/README.md : "N+ MCP tool definitions"
 *
 * Tools registered in core but NOT in the curated catalog (ai / mobile internal
 * helpers) are bridged by INTERNAL_EXTRA so the core README stays honest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const INTERNAL_EXTRA = 22; // core-only tools (ai helpers + mobile/ADB) not in docs/tools catalog

const catalogPath = join(root, "docs/tools/README.md");
const rootReadme = join(root, "README.md");
const coreReadme = join(root, "packages/core/README.md");

const CAT_HEADER = /^### \[([^\]]+)\]\([^)]+\)\s*\(\d+\s*tools\)/;
const TOOL_ROW = /^\| `([^`]+)` \|/;
const QUICK_ROW = /^\| (.+?) \| (\d+) \| (.+?) \|$/;
const TOTAL_ROW = /^\| \*\*Total\*\* \| \*\*(\d+)\*\* \|/;

// Normalize a category label so the catalog header ("Terminal / Log Watcher",
// "DevTools — Console") matches the shorter Quick Stats row ("Terminal",
// "DevTools Console"). This is exactly the kind of drift this script removes.
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\s*\/\s*.*$/, "") // drop " / Log Watcher" suffix
    .replace(/[—–]/g, " ") // em/en dash -> space
    .replace(/\s+/g, " ")
    .trim();

function parseCatalog() {
  const lines = readFileSync(catalogPath, "utf8").split("\n");
  const counts = {};
  let current = null;
  for (const line of lines) {
    const m = line.match(CAT_HEADER);
    if (m) {
      current = norm(m[1]);
      counts[current] = 0;
      continue;
    }
    if (line.startsWith("### ") || line.startsWith("---")) {
      current = null;
      continue;
    }
    if (current && TOOL_ROW.test(line)) counts[current]++;
  }
  return counts;
}

function rewriteCatalog(counts) {
  let text = readFileSync(catalogPath, "utf8");
  const names = Object.keys(counts);
  const total = names.reduce((s, n) => s + counts[n], 0);

  text = text.replace(
    /Fennec provides \*\*(\d+) MCP tools\*\* organized into \*\*(\d+) categories\*\*/,
    `Fennec provides **${total} MCP tools** organized into **${names.length} categories**`
  );

  // Preserve the original link — only swap the "(N tools)" count.
  text = text.replace(new RegExp("^" + CAT_HEADER.source, "gm"), (full, name) => {
    const n = counts[name.trim()];
    return n === undefined ? full : full.replace(/\(\d+\s*tools\)$/, `(${n} tools)`);
  });

  const lines = text.split("\n");
  const out = [];
  let withoutBrowser = 0;
  for (const line of lines) {
    const q = line.match(QUICK_ROW);
    if (q) {
      const name = norm(q[1]);
      const n = counts[name];
      if (n !== undefined) {
        const flag = q[3];
        if (flag.includes("❌") || flag.includes("⚠️") || /partial/i.test(flag))
          withoutBrowser += n;
        out.push(line.replace(/\| (\d+) \|/, `| ${n} |`));
        continue;
      }
    }
    const t = line.match(TOTAL_ROW);
    if (t) {
      out.push(line.replace(/\*\*(\d+)\*\*/, `**${total}**`));
      continue;
    }
    out.push(line);
  }
  text = out.join("\n");

  // Keep the "Total" row's trailing "N without browser" note in sync too.
  text = text.replace(/\*\*(\d+) without browser\*\*/, `**${withoutBrowser} without browser**`);
  text = text.replace(/\*\*(\d+) tools work without [^*]+\*\*/, `**${withoutBrowser} tools work without Playwright/browser engines**`);

  writeFileSync(catalogPath, text);
  return { total, categories: names.length, withoutBrowser };
}

function rewriteReadmes(total) {
  let r = readFileSync(rootReadme, "utf8");
  r = r.replace(/all \d+ tools documented/, `all ${total} tools documented`);
  writeFileSync(rootReadme, r);

  let c = readFileSync(coreReadme, "utf8");
  c = c.replace(/(\d+)\+ MCP tool definitions/, `${total + INTERNAL_EXTRA}+ MCP tool definitions`);
  writeFileSync(coreReadme, c);
}

const counts = parseCatalog();
const { total, categories, withoutBrowser } = rewriteCatalog(counts);
rewriteReadmes(total);

console.log("Tool counts synced:");
for (const [n, c] of Object.entries(counts)) console.log(`  ${n}: ${c}`);
console.log(`\nTotal: ${total} tools across ${categories} categories (${withoutBrowser} without browser)`);
console.log(`Core README: ${total + INTERNAL_EXTRA}+ MCP tool definitions`);
