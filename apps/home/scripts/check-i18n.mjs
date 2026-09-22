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
  [...html.matchAll(/data-i18n(?:-html|-aria)?="([^"]+)"/g)].map((m) => m[1]),
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

/* ---- diagram labels ------------------------------------------------------
   `diagram-strings.js` says in its own header that this file fails on a
   missing diagram key. It did not: this check imported zh.js and nothing
   else, so fifty-four keys drawn into the SVGs had no gate at all. A rule
   with no script is not a rule — this project's own words.

   Most of the keys are built as `t(`d.chain.${key}`)`, which no static reader
   can resolve, so the static half checks what it can — both languages
   present and non-empty, and no key outside a prefix the drawing code
   actually uses — and the browser suite asserts at runtime that no label
   rendered as its own key, which is what `t()` falls back to. */
const diagramSource = readFileSync(join(root, 'assets/js/diagrams.js'), 'utf8');
const strings = (await import(join(root, 'assets/js/diagram-strings.js'))).default;

const prefixes = [...diagramSource.matchAll(/t\(`([^`$]*)\$\{/g)].map((m) => m[1]);
const literals = new Set([...diagramSource.matchAll(/t\('([^']+)'\)/g)].map((m) => m[1]));

const dBlank = Object.entries(strings)
  .filter(([, v]) => !String(v?.en ?? '').trim() || !String(v?.zh ?? '').trim())
  .map(([k]) => k);
const dOrphan = Object.keys(strings)
  .filter((k) => !literals.has(k) && !prefixes.some((p) => k.startsWith(p)));
const dUntranslated = Object.entries(strings)
  .filter(([, v]) => /[A-Za-z]/.test(v.zh) && !/[\u4e00-\u9fff]/.test(v.zh)
                  && !/^[\s\p{P}A-Za-z0-9/&·+—-]+$/u.test(v.zh))
  .map(([k]) => k);

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
report('diagram keys missing a language', dBlank);
report('diagram keys no drawing code can reach', dOrphan);
report('diagram keys that look untranslated', dUntranslated);

if (failed) process.exit(1);
console.log(`✓ i18n in sync — ${used.size} page keys + ${Object.keys(strings).length} diagram keys, en + zh`);
