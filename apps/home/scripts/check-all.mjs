#!/usr/bin/env node
/**
 * check-all.mjs — everything that must pass before a commit.
 * Dependency-free; run it from apps/home.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* Static gates first: they are fast, need nothing installed, and a failure
   there makes the browser run pointless. */
const checks = [
  ['i18n parity', 'check-i18n.mjs'],
  ['html structure', 'check-html.mjs'],
  ['css dead code', 'check-css.mjs'],
  ['copy typography', 'check-copy.mjs'],
  ['css bundle up to date', 'build-css.mjs', '--check'],
  ['zh page up to date', 'build-i18n.mjs', '--check'],
];

/* The browser suites need Playwright, which is a dev tool rather than a
   dependency of this project. They skip themselves when it is absent, so this
   command stays runnable on a bare checkout. */
const browserChecks = [
  ['browser behaviour', '../tests/browser.test.mjs'],
  ['performance budget', '../tests/perf.test.mjs'],
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
if (!process.argv.includes('--static-only')) {
  for (const [label, script] of browserChecks) {
    try {
      execFileSync(process.execPath, [join(here, script)], { stdio: 'inherit', cwd: root });
    } catch {
      failed += 1;
      console.error(`  ↳ ${label} failed`);
    }
  }
}

const total = checks.length + (process.argv.includes('--static-only') ? 0 : browserChecks.length);
if (failed) {
  console.error(`\n${failed} of ${total} checks failed`);
  process.exit(1);
}
console.log(`\nall ${total} checks passed`);
