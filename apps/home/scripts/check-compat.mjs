#!/usr/bin/env node
/**
 * check-compat.mjs — engine-support gate.
 *
 * This project can only be run against Chromium in its build environment, so
 * the other two engines have to be reasoned about rather than exercised. That
 * is a weak position, and the way to make it less weak is to write down which
 * features need a guard and fail the build when one appears without it —
 * rather than relying on whoever adds the next CSS property to remember what
 * Safari 15 does with it.
 *
 * Each rule: a pattern that needs a guard, and a pattern that counts as one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const files = (dir, ext) => readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

/* Comments describe problems; they are not problems. Stripping them keeps the
   gate from flagging the note that explains a fix as the thing it fixed. */
const strip = (body) => body.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const css = files('assets/css', '.css')
  .filter((f) => !f.endsWith('site.css'))   // generated bundle; its sources are checked
  .map((f) => [basename(f), strip(read(f))]);
const js = files('assets/js', '.js')
  .map((f) => [basename(f), strip(read(f))])
  .concat([['index.html', strip(read('index.html'))]]);

const CSS_RULES = [
  {
    name: 'backdrop-filter without the -webkit- prefix (Safari < 18 needs it)',
    needs: /(?<!-webkit-)backdrop-filter\s*:/g,
    guardedBy: (body, index) => body.slice(Math.max(0, index - 200), index + 200).includes('-webkit-backdrop-filter'),
  },
  {
    name: 'mask-image without the -webkit- prefix (Safari needs it)',
    needs: /(?<!-webkit-)mask-image\s*:/g,
    guardedBy: (body, index) => body.slice(Math.max(0, index - 200), index + 200).includes('-webkit-mask-image'),
  },
  {
    name: 'user-select without the -webkit- prefix (Safari needs it)',
    needs: /(?<!-webkit-)user-select\s*:/g,
    guardedBy: (body, index) => body.slice(Math.max(0, index - 120), index + 120).includes('-webkit-user-select'),
  },
  {
    name: 'overflow: clip without a fallback (Safari gained it only in 16.4)',
    needs: /overflow(?:-x|-y)?\s*:\s*clip/g,
    guardedBy: (body) => body.includes('@supports not (overflow: clip)'),
  },
];

const JS_RULES = [
  {
    name: "MediaQueryList.addEventListener without a fallback (Safari < 14 throws)",
    needs: /matchMedia\([^)]*\)\s*\.addEventListener|\bmql\.addEventListener/g,
    guardedBy: (body) => body.includes("typeof mql.addEventListener === 'function'"),
  },
];

const problems = [];
const lineOf = (body, i) => body.slice(0, i).split('\n').length;

for (const [name, body] of css) {
  if (name === 'print.css') continue;
  for (const rule of CSS_RULES) {
    for (const m of body.matchAll(rule.needs)) {
      if (!rule.guardedBy(body, m.index)) problems.push(`${name}:${lineOf(body, m.index)} — ${rule.name}`);
    }
  }
}
for (const [name, body] of js) {
  for (const rule of JS_RULES) {
    for (const m of body.matchAll(rule.needs)) {
      if (!rule.guardedBy(body, m.index)) problems.push(`${name}:${lineOf(body, m.index)} — ${rule.name}`);
    }
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} unguarded compatibility risk(s):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ compat clean — ${CSS_RULES.length + JS_RULES.length} rules, ${css.length + js.length} files`);
