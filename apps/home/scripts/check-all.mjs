#!/usr/bin/env node
/**
 * check-all.mjs — everything that must pass before a commit.
 * Dependency-free; run it from apps/home.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const checks = [
  ['i18n parity', 'check-i18n.mjs'],
  ['html structure', 'check-html.mjs'],
  ['css dead code', 'check-css.mjs'],
  ['copy typography', 'check-copy.mjs'],
  ['css bundle up to date', 'build-css.mjs', '--check'],
  ['zh page up to date', 'build-i18n.mjs', '--check'],
];

let failed = 0;
for (const [label, script, ...args] of checks) {
  try {
    execFileSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit' });
  } catch {
    failed += 1;
    console.error(`  ↳ ${label} failed`);
  }
}
if (failed) {
  console.error(`\n${failed} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`\nall ${checks.length} checks passed`);
