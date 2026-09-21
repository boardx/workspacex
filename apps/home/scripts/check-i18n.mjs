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

const html = readFileSync(join(root, 'index.html'), 'utf8');
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

if (failed) process.exit(1);
console.log(`✓ i18n in sync — ${used.size} keys, en + zh`);
