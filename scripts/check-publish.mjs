#!/usr/bin/env node
/**
 * Publish gate (#151): simulate what `pin-workspace-deps.mjs` will produce
 * and fail the release if anything unresolvable would reach the registry.
 * Safe to run on a clean tree (workspace:* is expected pre-pin).
 *
 * Usage: node scripts/check-publish.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_RE = /^(workspace:|link:|file:)/;

// Only packages that get published to a registry.
const PUBLISHED = ['packages/core/package.json', 'packages/cli/package.json'];

const pkgs = new Map(
  PUBLISHED.map((f) => [f, JSON.parse(readFileSync(join(root, f), 'utf8'))]),
);

// All workspace versions must move in lockstep — the pin step stamps the
// *dependent's own* version, so a skew would publish a core version that
// doesn't exist on the registry.
const versions = new Set([...pkgs.values()].map((p) => p.version));
if (versions.size > 1) {
  console.error(
    `BLOCKED: workspace package versions out of sync: ${[...pkgs.entries()].map(([f, p]) => `${f}@${p.version}`).join(', ')} — run the bump script`,
  );
  process.exit(1);
}

let failed = false;
for (const [f, pkg] of pkgs) {
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (typeof spec !== 'string' || !LOCAL_RE.test(spec)) continue;
      // @plumpslabs/* workspace deps are pinned to the release version by
      // pin-workspace-deps.mjs — resolvable. Anything else would leak.
      if (!name.startsWith('@plumpslabs/')) {
        console.error(`BLOCKED ${f}: ${section}.${name} = "${spec}" — unresolvable from a registry`);
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error('\nPublish gate FAILED — fix the metadata above, never publish workspace: leaks.');
  process.exit(1);
}
console.log(`Publish gate OK (release ${[...versions][0]}; workspace: deps pin cleanly).`);
