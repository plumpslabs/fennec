#!/usr/bin/env node
/**
 * Bump the Fennec version across every place that hardcodes it.
 *
 * Usage:
 *   node scripts/bump-version.mjs 1.14.2        # set explicit version
 *   node scripts/bump-version.mjs patch          # 1.14.1 -> 1.14.2
 *   node scripts/bump-version.mjs minor          # 1.14.1 -> 1.15.0
 *   node scripts/bump-version.mjs major          # 1.14.1 -> 2.0.0
 *
 * Keeps package.json (root), packages/cli/package.json,
 * packages/core/package.json, and the CLI banner VERSION in sync.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  { file: "package.json", type: "json", key: "version" },
  { file: "packages/cli/package.json", type: "json", key: "version" },
  { file: "packages/core/package.json", type: "json", key: "version" },
  {
    file: "packages/cli/src/utils/banner.ts",
    type: "banner",
    re: /(export const VERSION = ")[^"]+(";)/,
  },
];

function readVersion() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return pkg.version;
}

function bump(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  return kind; // explicit version string
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node scripts/bump-version.mjs <version|patch|minor|major>");
    process.exit(1);
  }
  const current = readVersion();
  const next = bump(current, arg);
  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error(`Invalid target version: "${next}"`);
    process.exit(1);
  }
  if (next === current) {
    console.log(`Version already ${current} — nothing to do.`);
    return;
  }

  for (const t of TARGETS) {
    const path = join(root, t.file);
    let content = readFileSync(path, "utf8");
    if (t.type === "json") {
      const json = JSON.parse(content);
      json[t.key] = next;
      content = JSON.stringify(json, null, 2) + "\n";
    } else {
      content = content.replace(t.re, `$1${next}$2`);
    }
    writeFileSync(path, content);
    console.log(`  ${t.file} -> ${next}`);
  }
  console.log(`\nBumped ${current} -> ${next}. Remember to commit, tag v${next}, and run scripts/release.`);
}

main();
