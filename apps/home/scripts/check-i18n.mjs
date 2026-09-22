#!/usr/bin/env node
/**
 * check-i18n.mjs — the mechanical gate that keeps EN and ZH from drifting.
 *
 * Fails if index.html declares a key the Chinese dictionary does not define,
 * or if the dictionary defines a key nothing in the page uses. Run it before
 * every commit; it needs no dependencies.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* Every hand-authored page. Naming one input is how privacy.html reached
   production without a single gate having looked at it. */
const SOURCES = ['index.html', 'privacy.html', '404.html'];
const html = SOURCES.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
const used = new Set(
  [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]),
);

const zh = (await import(join(root, 'assets/js/zh.js'))).default;
const defined = new Set(Object.keys(zh));

const missing = [...used].filter((k) => !defined.has(k));
const orphan = [...defined].filter((k) => !used.has(k));

// An empty or whitespace-only translation renders as a blank element — the
// failure mode that looks like a layout bug and gets debugged for an hour.
const blank = [...defined].filter((k) => String(zh[k]).trim() === '');

// Stray Cyrillic in the Chinese copy: a real slip that happened while writing
// this file, and one no reviewer of a 200-key dictionary reliably catches.
const cyrillic = [...defined].filter((k) => /[\u0400-\u04FF]/.test(String(zh[k])));

// Chinese that is still entirely English usually means a key was copied over
// and never translated. Punctuation-only and brand-name values are exempt.
const EXEMPT = new Set(['footer.l5', 'footer.l8', 'nav.github']);
const untranslated = [...defined].filter((k) => {
  if (EXEMPT.has(k)) return false;
  const v = String(zh[k]);
  return /[A-Za-z]/.test(v) && !/[\u4e00-\u9fff]/.test(v) && !/^[\s\p{P}A-Za-z0-9/&·+—-]+$/u.test(v);
});

let failed = false;
const report = (label, list) => {
  if (!list.length) return;
  failed = true;
  console.error(`\n✗ ${label} (${list.length}):`);
  list.forEach((k) => console.error(`    ${k}`));
};

report('keys used in index.html but missing from zh.js', missing);
report('keys defined in zh.js but unused in index.html', orphan);
report('keys with an empty translation', blank);
report('Chinese values containing Cyrillic characters', cyrillic);
report('keys that look untranslated (no Han characters)', untranslated);

if (failed) process.exit(1);
console.log(`✓ i18n in sync — ${used.size} keys, en + zh`);
