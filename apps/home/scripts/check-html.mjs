#!/usr/bin/env node
/**
 * check-html.mjs — targeted structural lint for index.html.
 *
 * Not a full validator (the W3C service is not reachable from every
 * environment, and a real parser would mean a dependency). It checks the
 * specific mistakes this page is actually prone to — ones that a browser
 * silently repairs, so they never show up as a visible bug until a screen
 * reader or an older engine hits them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const problems = [];
const lineOf = (index) => html.slice(0, index).split('\n').length;

/* --- 1. flow content inside <button>: invalid, and browsers reparent it --- */
for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
  const bad = m[1].match(/<(div|p|ul|ol|li|h[1-6]|section|article|button|a)\b/);
  if (bad) problems.push(`line ${lineOf(m.index)}: <${bad[1]}> inside <button> — buttons take phrasing content only`);
}

/* --- 2. nested anchors: silently split by the parser --------------------- */
for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
  if (/<a\b/.test(m[1])) problems.push(`line ${lineOf(m.index)}: nested <a>`);
}

/* --- 3. duplicate ids ----------------------------------------------------- */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
[...new Set(dupes)].forEach((id) => problems.push(`duplicate id="${id}"`));

/* --- 4. heading order ----------------------------------------------------- */
let previous = 0;
for (const m of html.matchAll(/<h([1-6])\b/g)) {
  const level = Number(m[1]);
  if (previous && level > previous + 1) {
    problems.push(`line ${lineOf(m.index)}: h${previous} followed by h${level} — skips a level`);
  }
  previous = level;
}

/* --- 5. anchors that point at nothing ------------------------------------- */
const targets = new Set(ids);
for (const m of html.matchAll(/href="#([^"]+)"/g)) {
  if (!targets.has(m[1])) problems.push(`line ${lineOf(m.index)}: href="#${m[1]}" has no matching id`);
}

/* --- 6. aria-labelledby that points at nothing ---------------------------- */
for (const m of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((id) => {
    if (!targets.has(id)) problems.push(`line ${lineOf(m.index)}: aria-labelledby="${id}" has no matching id`);
  });
}

/* --- 7. images without alt text ------------------------------------------- */
for (const m of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\salt=/.test(m[0])) problems.push(`line ${lineOf(m.index)}: <img> without alt`);
}

/* --- 8. external links that can reach window.opener ----------------------- */
for (const m of html.matchAll(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/g)) {
  if (/target="_blank"/.test(m[0]) && !/rel="[^"]*noopener/.test(m[0])) {
    problems.push(`line ${lineOf(m.index)}: target="_blank" without rel="noopener"`);
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} structural problem(s):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ html structure clean — ${ids.length} ids, ${[...html.matchAll(/<h[1-6]\b/g)].length} headings`);
