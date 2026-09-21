#!/usr/bin/env node
/**
 * check-css.mjs — dead-code gate for the stylesheets.
 *
 * A hand-written site accumulates classes and tokens that nothing references,
 * and they are invisible: the page looks identical either way. This fails the
 * build on a class defined in CSS but present nowhere in the markup or the
 * scripts, on a custom property that is declared and never read, and on a
 * `var()` that reads a property nobody declares — the last one is a real bug,
 * not tidiness, because it silently falls back to nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const list = (dir, ext) => readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

const html = read('index.html');
const js = list('assets/js', '.js').map(read).join('\n');
const cssFiles = list('assets/css', '.css');
const consumers = html + js;

/* Values a stylesheet legitimately reads but only JS ever writes. */
const JS_WRITTEN = new Set(['--i', '--e', '--p', '--c', '--dscale', '--scene-track']);

const classes = new Map();
let css = '';
for (const file of cssFiles) {
  const body = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  css += body;
  for (const m of body.matchAll(/\.([A-Za-z][\w-]*)/g)) {
    if (!classes.has(m[1])) classes.set(m[1], basename(file));
  }
}

const unusedClasses = [...classes.keys()].filter((c) => !consumers.includes(c));
const declared = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
const referenced = new Set([...(css + js).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
const unusedTokens = [...declared].filter((t) => !referenced.has(t));
const dangling = [...referenced].filter((t) => !declared.has(t) && !JS_WRITTEN.has(t));

let failed = false;
const report = (label, items, format = (x) => x) => {
  if (!items.length) return;
  failed = true;
  console.error(`\n✗ ${label} (${items.length}):`);
  items.forEach((i) => console.error(`    ${format(i)}`));
};

report('classes defined in CSS but used nowhere', unusedClasses, (c) => `.${c}  (${classes.get(c)})`);
report('custom properties declared but never read', unusedTokens);
report('var() reading a property nothing declares', dangling);

if (failed) process.exit(1);
console.log(`✓ css clean — ${classes.size} classes, ${declared.size} tokens, all referenced`);
