#!/usr/bin/env node
/**
 * check-all.mjs — everything that must pass before a commit.
 * Dependency-free; run it from apps/home.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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
  ['link integrity', 'check-links.mjs'],
  ['stated facts', 'check-sequence.mjs'],
  ['citations from the register', 'check-citations.mjs'],
  ['citation gate can fail', 'check-citations.mjs', '--self-test'],
  ['engine compatibility', 'check-compat.mjs'],
  ['deploy files', 'check-deploy.mjs'],
  ['documentation', 'check-docs.mjs'],
  ['css bundle up to date', 'build-css.mjs', '--check'],
  ['js bundle up to date', 'build-js.mjs', '--check'],
  ['zh page up to date', 'build-i18n.mjs', '--check'],
  ['brand mark up to date', 'build-brand.mjs', '--check'],
  ['generated assets up to date', 'check-assets.mjs'],
];

/* The browser suites need Playwright, which is a dev tool rather than a
   dependency of this project. They skip themselves when it is absent, so this
   command stays runnable on a bare checkout. */
const browserChecks = [
  ['browser behaviour', '../tests/browser.test.mjs'],
  ['scripted demo', '../tests/demo.test.mjs'],
  ['performance budget', '../tests/perf.test.mjs'],
  /* Safari's engine. Skips itself where WebKit is not installed; CI has it. */
  ['webkit (Safari)', '../tests/webkit.test.mjs'],
  /* The acceptance set: fifty measured cases, scored per language, the lower
     of the two is the score. Nine out of ten is the bar the owner set. */
  ['acceptance eval ≥ 9/10', '../tests/eval/eval.mjs', '--min', '9'],
];

/* ---- a gate on the gates -------------------------------------------------
   check-compat.mjs existed, was documented in the README's table, and was
   never in the list above — so it had never run as part of the standard
   verification. Writing a check and forgetting to call it is the same failure
   as writing a rule and never scripting it, one level up. */
const wired = new Set(checks.map(([, script]) => script));
const orphans = readdirSync(here)
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs') && f !== 'check-all.mjs')
  .filter((f) => !wired.has(f));
if (orphans.length) {
  console.error(`\n✗ checks that exist but nothing runs (${orphans.length}):`);
  orphans.forEach((f) => console.error(`    scripts/${f}`));
  process.exit(1);
}

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
  for (const [label, script, ...args] of browserChecks) {
    try {
      execFileSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit', cwd: root });
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
