#!/usr/bin/env node
/**
 * Pin workspace: deps for `npm publish` (#151).
 *
 * `npm publish` (unlike `pnpm publish`) does NOT rewrite the `workspace:`
 * protocol, so publishing a manifest containing it leaks an unresolvable
 * spec to the registry. The dev manifest intentionally keeps `workspace:*`
 * (so pnpm links the local package); this script rewrites it to the exact
 * release version in the CI checkout right before `npm publish`.
 * The checkout is ephemeral — the repo itself is never polluted.
 *
 * Usage: node scripts/pin-workspace-deps.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_RE = /^(workspace:|link:|file:)/;

// package.json path -> its own version (the pin target).
const TARGETS = ['packages/core/package.json', 'packages/cli/package.json'];

for (const f of TARGETS) {
  const path = join(root, f);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  let changed = false;
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (typeof spec === 'string' && LOCAL_RE.test(spec)) {
        // Intra-monorepo @plumpslabs/* deps pin to THIS package's release
        // version (bump script keeps all workspace versions in sync).
        // Anything else is a hard error — fail, don't guess.
        if (!name.startsWith('@plumpslabs/')) {
          console.error(`REFUSE to pin non-monorepo dep ${name} = "${spec}" in ${f}`);
          process.exit(1);
        }
        pkg[section][name] = pkg.version;
        changed = true;
        console.log(`  ${f}: ${name} ${spec} -> ${pkg.version}`);
      }
    }
  }
  if (changed) writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}
console.log('Workspace deps pinned for publish.');
