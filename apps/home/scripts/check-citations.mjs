#!/usr/bin/env node
/**
 * check-citations.mjs — a report is quoted on this site only as it printed it.
 *
 * The demo's scenarios are sample material, labeled as such. A scenario may
 * also carry one real finding — "What the research says" — and that line is
 * the opposite: a sentence from a named report, which a reader will take as
 * fact. The site's whole argument is that every claim traces to its source,
 * so this is where it most has to.
 *
 * The register is docs/sources/index.json, and only scripts/add-source.py
 * writes to it: it admits a sentence after finding it word for word in the
 * report's own file, and records the page and the file's SHA-256. This check
 * holds the page to the register:
 *
 *   - every quote shown on the page is in the register, verbatim;
 *   - the firm, title, date, URL and page shown beside it are the register's;
 *   - both languages show the same quote (it stays in the report's language;
 *     the Chinese page adds a translation, marked as one);
 *   - every register entry is well-formed: https URL, a date, a 64-hex hash,
 *     at least one quote with a page.
 *
 *   node scripts/check-citations.mjs              check the page
 *   node scripts/check-citations.mjs --self-test  prove each rule can fail
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(root, 'docs/sources/index.json');
const HAN = /[一-鿿]/;

export function validate(index, scenarios) {
  const problems = [];
  const ids = new Set();
  for (const e of index) {
    const at = `source "${e.id}"`;
    if (!e.id || ids.has(e.id)) problems.push(`${at}: missing or duplicate id`);
    ids.add(e.id);
    for (const k of ['firm', 'title', 'date', 'url', 'sha256']) if (!e[k]) problems.push(`${at}: no ${k}`);
    if (e.url && !e.url.startsWith('https://')) problems.push(`${at}: url is not https`);
    if (e.date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(e.date)) problems.push(`${at}: date "${e.date}" is not YYYY[-MM[-DD]]`);
    if (e.sha256 && !/^[0-9a-f]{64}$/.test(e.sha256)) problems.push(`${at}: sha256 is not a hash`);
    if (!Array.isArray(e.quotes) || !e.quotes.length) problems.push(`${at}: no quotes`);
    for (const q of e.quotes ?? []) {
      if (!q.text?.trim() || !Number.isInteger(q.page) || q.page < 1) problems.push(`${at}: a quote without text or page`);
    }
  }
  const byId = new Map(index.map((e) => [e.id, e]));
  for (const s of scenarios) {
    const en = s.en?.research; const zh = s.zh?.research;
    if (!en && !zh) continue;
    const at = `scenario "${s.id}"`;
    if (!en || !zh) { problems.push(`${at}: research in one language only`); continue; }
    for (const [lang, r] of [['en', en], ['zh', zh]]) {
      const src = byId.get(r.src);
      if (!src) { problems.push(`${at} [${lang}]: cites "${r.src}", which is not in the register`); continue; }
      const q = src.quotes.find((x) => x.text === r.quote);
      if (!q) problems.push(`${at} [${lang}]: the quote is not in the register for ${r.src}, word for word — "${String(r.quote).slice(0, 60)}"`);
      for (const k of ['firm', 'title', 'date', 'url']) {
        if (r[k] !== src[k]) problems.push(`${at} [${lang}]: ${k} shown as "${r[k]}", the register says "${src[k]}"`);
      }
      if (q && r.page !== q.page) problems.push(`${at} [${lang}]: page shown as ${r.page}, the register says ${q.page}`);
    }
    if (en.quote !== zh.quote || en.src !== zh.src) problems.push(`${at}: the two languages quote differently — the quote stays in the report's own words`);
    if (!zh.gloss || !HAN.test(zh.gloss)) problems.push(`${at} [zh]: no Chinese translation beside the quote`);
    if (en.gloss) problems.push(`${at} [en]: a gloss on the English page — the quote is already in the reader's language`);
  }
  return problems;
}

function selfTest() {
  const good = { id: 'x', firm: 'F', title: 'T', date: '2026-08', url: 'https://e.com/r', sha256: 'a'.repeat(64), quotes: [{ text: 'Only 37 percent report EBIT impact.', page: 3 }] };
  const show = { src: 'x', quote: 'Only 37 percent report EBIT impact.', firm: 'F', title: 'T', date: '2026-08', url: 'https://e.com/r', page: 3 };
  const scen = (en, zh) => [{ id: 's', en: { research: en }, zh: { research: zh } }];
  const cases = [
    ['a clean citation passes', validate([good], scen(show, { ...show, gloss: '只有 37% 报告了息税前利润影响。' })), 0],
    ['a changed number fails', validate([good], scen({ ...show, quote: 'Only 39 percent report EBIT impact.' }, { ...show, quote: 'Only 39 percent report EBIT impact.', gloss: '译' })), 2],
    ['a wrong page fails', validate([good], scen({ ...show, page: 4 }, { ...show, page: 4, gloss: '译' })), 2],
    ['a wrong date fails', validate([good], scen({ ...show, date: '2025' }, { ...show, gloss: '译' })), 1],
    ['an unregistered source fails', validate([], scen(show, { ...show, gloss: '译' })), 2],
    ['a missing translation fails', validate([good], scen(show, { ...show })), 1],
    ['one language only fails', validate([good], [{ id: 's', en: { research: show }, zh: {} }]), 1],
    ['an http url fails', validate([{ ...good, url: 'http://e.com' }], []), 1],
    ['a missing hash fails', validate([{ ...good, sha256: '' }], []), 1],
  ];
  let ok = true;
  for (const [name, problems, expected] of cases) {
    const pass = problems.length === expected;
    ok = ok && pass;
    console.log(`${pass ? '✓' : '✗'} ${name} — ${problems.length} problem(s)${pass ? '' : `, expected ${expected}: ${problems.join(' | ')}`}`);
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
const { SCENARIOS } = await import(join(root, 'assets/js/demo.js'));
const problems = validate(index, SCENARIOS);
if (problems.length) {
  console.error(`\n✗ ${problems.length} citation problem(s):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
const cited = SCENARIOS.filter((s) => s.en.research).length;
console.log(`✓ citations hold — ${index.length} source(s) registered, ${cited} scenario(s) quoting one`);
