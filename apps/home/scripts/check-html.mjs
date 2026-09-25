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

/* Every hand-authored page, not just the home page. `privacy.html` was added
   later and every gate here silently ignored it, which is the failure mode of
   any check that names its input instead of discovering it. Generated pages
   (zh/) are excluded: build-i18n.mjs already guarantees they match. */
const SOURCES = ['index.html', 'privacy.html', '404.html'];
const problems = [];
let html = '';
const lineOf = (index) => html.slice(0, index).split('\n').length;

for (const file of SOURCES) {
html = readFileSync(join(root, file), 'utf8');
const where = (i) => `${file}:${lineOf(i)}`;

/* --- 1. flow content inside <button>: invalid, and browsers reparent it --- */
for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
  const bad = m[1].match(/<(div|p|ul|ol|li|h[1-6]|section|article|button|a)\b/);
  if (bad) problems.push(`${where(m.index)}: <${bad[1]}> inside <button> — buttons take phrasing content only`);
}

/* --- 2. nested anchors: silently split by the parser ---------------------
   Depth counting, not a non-greedy match: `<a>…<a>…</a>…</a>` matches up to
   the FIRST `</a>`, so the inner anchor never appears in the captured body
   and the rule reports nothing. That is exactly how a nested anchor survived
   in the nav for four rounds while this check reported clean. */
{
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)a\b[^>]*>/g)) {
    if (m[1] === '/') { depth = Math.max(0, depth - 1); continue; }
    depth += 1;
    if (depth > 1) problems.push(`${where(m.index)}: nested <a> inside another <a>`);
  }
}

/* --- 3. duplicate ids ----------------------------------------------------- */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
[...new Set(dupes)].forEach((id) => problems.push(`${file}: duplicate id="${id}"`));

/* --- 4. heading order ----------------------------------------------------- */
let previous = 0;
for (const m of html.matchAll(/<h([1-6])\b/g)) {
  const level = Number(m[1]);
  if (previous && level > previous + 1) {
    problems.push(`${where(m.index)}: h${previous} followed by h${level} — skips a level`);
  }
  previous = level;
}

/* --- 5. (retired) anchors that point at nothing -------------------------
   check-links.mjs does this across all FIVE pages, including the generated
   Chinese ones this file deliberately skips, and resolves file references
   in the same pass. Two gates asserting one fact is the duplication this
   project keeps paying for. The id set it built is still needed below. */
const targets = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

/* --- 5b. aria-* attributes that do not exist --------------------------------
   Rule 6 checks where aria-labelledby points; it never noticed when a
   spelling sweep renamed all fourteen of them aria-labeledby. An attribute
   the spec does not define is silently ignored, so every diagram and tab
   panel lost its accessible name and only axe, three gates later, said so. */
const ARIA = new Set(['activedescendant', 'atomic', 'autocomplete', 'busy', 'checked', 'colcount', 'colindex', 'colspan', 'controls', 'current', 'describedby', 'description', 'details', 'disabled', 'errormessage', 'expanded', 'flowto', 'haspopup', 'hidden', 'invalid', 'keyshortcuts', 'label', 'labelledby', 'level', 'live', 'modal', 'multiline', 'multiselectable', 'orientation', 'owns', 'placeholder', 'posinset', 'pressed', 'readonly', 'relevant', 'required', 'roledescription', 'rowcount', 'rowindex', 'rowspan', 'selected', 'setsize', 'sort', 'valuemax', 'valuemin', 'valuenow', 'valuetext']);
for (const m of html.matchAll(/\saria-([a-z]+)=/g)) {
  if (!ARIA.has(m[1])) problems.push(`${where(m.index)}: aria-${m[1]} is not an ARIA attribute — it is ignored`);
}

/* --- 5c. inline tags that do not balance ------------------------------------
   A scripted copy edit that stopped at the first </b> inside a list item
   replaced only the bold lead and left the old tail behind it — two roadmap
   items shipped with a stray </b> and their old sentence repeated after the
   new one. The browser repairs the markup silently, so nothing looked broken
   in the source view anyone would glance at. Per line, every inline tag that
   opens must close. */
html.split('\n').forEach((line, i) => {
  for (const tag of ['b', 'em', 'strong', 'i', 'a', 'span', 'code']) {
    const open = (line.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const shut = (line.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== shut && /<\/(li|p|dd|h[1-6])>\s*$/.test(line)) problems.push(`line ${i + 1}: <${tag}> opens ${open}× and closes ${shut}× in one element`);
  }
});

/* --- 6. aria-labelledby that points at nothing ---------------------------- */
for (const m of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((id) => {
    if (!targets.has(id)) problems.push(`${where(m.index)}: aria-labelledby="${id}" has no matching id`);
  });
}

/* --- 7. images without alt text ------------------------------------------- */
for (const m of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\salt=/.test(m[0])) problems.push(`${where(m.index)}: <img> without alt`);
}

/* --- 8. external links that can reach window.opener ----------------------- */
for (const m of html.matchAll(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/g)) {
  if (/target="_blank"/.test(m[0]) && !/rel="[^"]*noopener/.test(m[0])) {
    problems.push(`${where(m.index)}: target="_blank" without rel="noopener"`);
  }
}

}

/* --- 9. generated pages must not send the reader back to the other language -
   The Chinese home page linked to the English privacy page, and the Chinese
   privacy page's "back to the site" landed in English. Both shipped, because
   nothing checked that a translated page keeps the reader in its language.
   The language switch is exempt: pointing at the other language is its job. */
for (const file of ['zh/index.html', 'zh/privacy.html']) {
  let body;
  try { body = readFileSync(join(root, file), 'utf8'); } catch { continue; }
  for (const m of body.matchAll(/<a\b[^>]*>/g)) {
    if (m[0].includes('langswitch__btn')) continue;
    const href = m[0].match(/href="(\/[^"]*)"/)?.[1];
    if (href && !href.startsWith('/zh/')) {
      problems.push(`${file}:${body.slice(0, m.index).split('\n').length}: links to ${href}, outside its own language`);
    }
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} structural problem(s):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ html structure clean — ${SOURCES.length} pages checked`);
