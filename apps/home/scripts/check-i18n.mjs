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

/* ---- the built page actually carries the translation ---------------------
   Every check above reads the dictionary by importing it. The builder read it
   with its own line-anchored regex, which saw only the FIRST key on each
   line: twenty-one keys that sat second on a line were defined, passed every
   check here, and shipped in English on /zh/ ("a business result, not a
   transcript" under the heading 结果). Two readers of one file disagreed and
   the gate asked the one that was right. This asks the output. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BUILT = [['index.html', 'zh/index.html'], ['privacy.html', 'zh/privacy.html'], ['404.html', 'zh/404.html']];
const notApplied = [];
for (const [, out] of BUILT) {
  let built; try { built = readFileSync(join(root, out), 'utf8'); } catch { continue; }
  for (const m of built.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n="([\w.]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, , key, body] = m;
    if (key in zh && body.replace(/\u200b/g, '') !== esc(zh[key])) notApplied.push(`${out}: ${key} → "${body.slice(0, 40)}"`);
  }
}

/* ---- a text key over markup ----------------------------------------------
   `data-i18n` replaces an element's content with TEXT. Put it on an element
   whose English contains a link, and the Chinese page gets the words and
   loses the link: the privacy page's security and contact addresses were
   plain text on /zh/ and mailto links on /. Markup inside a translated
   element must use data-i18n-html. */
const textOverMarkup = [];
for (const src of SOURCES) {
  const body = readFileSync(join(root, src), 'utf8');
  for (const m of body.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n="([\w.]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (/<(a|b|em|strong|code|br)\b/.test(m[3])) textOverMarkup.push(`${src}: ${m[2]}`);
  }
}

/* ---- the scripted demo --------------------------------------------------
   Its copy lives in assets/js/demo.js, both languages side by side, because
   it is data a script replays rather than markup a page carries. The rules
   are the ones a reader would catch: the same scenario must have the same
   shape in both languages (a source, step or claim in one and not the other
   is a different demo), every citation must point at a source that exists,
   the verdicts must agree, the demo must contain a withdrawn claim (that is
   its point), and the English must be typeset like the rest of the page. */
const demo = await import(join(root, 'assets/js/demo.js'));
const demoProblems = [];
const words = (v) => (typeof v === 'function' ? v(1, 4) : String(v ?? ''));
for (const s of demo.SCENARIOS) {
  const { en, zh: z } = s;
  if (!en || !z) { demoProblems.push(`${s.id}: missing a language`); continue; }
  for (const part of ['sources', 'steps', 'claims']) {
    if (en[part]?.length !== z[part]?.length) demoProblems.push(`${s.id}: ${part} — en has ${en[part]?.length}, zh has ${z[part]?.length}`);
  }
  en.claims.forEach((c, i) => {
    const zc = z.claims[i]; if (!zc) return;
    if (c.ok !== zc.ok) demoProblems.push(`${s.id}: claim ${i + 1} is ${c.ok ? 'verified' : 'withdrawn'} in English, not in Chinese`);
    if (String(c.cites) !== String(zc.cites)) demoProblems.push(`${s.id}: claim ${i + 1} cites ${c.cites} in English, ${zc.cites} in Chinese`);
    if (c.ok && !c.cites.length) demoProblems.push(`${s.id}: claim ${i + 1} is marked verified with no source`);
  });
  en.steps.forEach((st, i) => {
    if (String(st.uses) !== String(z.steps[i]?.uses)) demoProblems.push(`${s.id}: step ${i + 1} reads different sources in the two languages`);
  });
  for (const [lang, v] of [['en', en], ['zh', z]]) {
    const refs = [...v.claims.flatMap((c) => c.cites), ...v.steps.flatMap((st) => st.uses)];
    refs.filter((r) => !v.sources[r]).forEach((r) => demoProblems.push(`${s.id} [${lang}]: cites S${r + 1}, which does not exist`));
    if (!v.claims.some((c) => !c.ok)) demoProblems.push(`${s.id} [${lang}]: no withdrawn claim — the demo has nothing to show`);
    const strings = [v.tab, v.who, v.ask, v.role, v.stakes, v.task, v.headline, v.so, v.yours, ...v.sources.flatMap((x) => [x.who, x.text]), ...v.steps.flatMap((x) => [x.agent, x.did]), ...v.claims.flatMap((x) => [x.text, x.why])];
    strings.filter((x) => !String(x ?? '').trim()).forEach(() => demoProblems.push(`${s.id} [${lang}]: an empty string`));
    /* Every number the answer states must come from somewhere on the page:
       a source, the brief, or arithmetic written out in the same line
       ("six hours × forty contracts = 240 hours"). A demo whose point is
       that every claim is traceable cannot itself carry a number that is
       not. Plan periods ("months 4–9") are ranges, not data. */
    /* The role and the task set the scene ("a 600-person firm"). The stakes
       line used to count as given too, which is how "slid from 31% to 22%"
       and "contacts are up a third" reached the page with no source under
       them — a reader briefed as a CFO found both. It is checked now. */
    const given = [v.role, v.task, ...v.sources.flatMap((x) => [x.who, x.text])].join(' ');
    const nums = (t) => (String(t).replace(/\d+–\d+/g, '').match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
    const known = new Set(nums(given));
    /* A withdrawn claim's own number is unsourced by definition — that is
       why it was withdrawn. The reason given for withdrawing it is not. */
    const lines = [[v.stakes, ''], [v.headline, ''], [v.so, ''], [v.yours, ''], ...v.claims.flatMap((c) => [[c.ok ? c.text : '', c.why], [c.why, c.why]])];
    for (const [line, why] of lines) {
      const computed = new Set(/×/.test(why) ? nums(why.split(/[=≈]/).pop()) : []);
      nums(line).filter((n) => !known.has(n) && !computed.has(n))
        .forEach((n) => demoProblems.push(`${s.id} [${lang}]: "${n}" appears in the answer but in no source — "${line.slice(0, 50)}"`));
    }
    if (lang === 'zh') strings.filter((x) => !/[\u4e00-\u9fff]/.test(x)).forEach((x) => demoProblems.push(`${s.id} [zh]: untranslated — "${x}"`));
    if (lang === 'en') strings.filter((x) => /"|[A-Za-z]'[A-Za-z]/.test(x)).forEach((x) => demoProblems.push(`${s.id} [en]: straight quote — "${x.slice(0, 50)}"`));
  }
}
const uiKeys = (l) => Object.keys(demo.UI[l] ?? {}).sort().join();
if (uiKeys('en') !== uiKeys('zh')) demoProblems.push('UI: the two languages define different words');
for (const [k, v] of Object.entries(demo.UI.zh)) if (!/[\u4e00-\u9fff]/.test(words(v))) demoProblems.push(`UI.zh.${k}: untranslated`);
/* The primary button must say what every other button to the app says. */
const heroCta = (/data-i18n="hero.cta1">([^<]+)</.exec(html) ?? [])[1];
if (demo.UI.en.cta !== heroCta) demoProblems.push(`UI.en.cta is "${demo.UI.en.cta}", the hero says "${heroCta}"`);
if (demo.UI.zh.cta !== zh['hero.cta1']) demoProblems.push(`UI.zh.cta is "${demo.UI.zh.cta}", the hero says "${zh['hero.cta1']}"`);
/* The static no-script list names the same scenarios the script draws. */
demo.SCENARIOS.forEach((s, i) => {
  const key = `demo.s${i + 1}`;
  const enStatic = (new RegExp(`data-i18n="${key}">([^<]+)<`).exec(html) ?? [])[1]?.replace(/&amp;/g, '&');
  if (enStatic !== s.en.tab) demoProblems.push(`${key}: the page lists "${enStatic}", the demo draws "${s.en.tab}"`);
  if (zh[key] !== s.zh.tab) demoProblems.push(`${key}: zh.js lists "${zh[key]}", the demo draws "${s.zh.tab}"`);
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
report('keys defined but not applied in the built Chinese page', notApplied);
report('data-i18n (text) on an element containing markup — the translation drops it; use data-i18n-html', textOverMarkup);
report('diagram keys missing a language', dBlank);
report('diagram keys no drawing code can reach', dOrphan);
report('diagram keys that look untranslated', dUntranslated);
report('scripted demo (assets/js/demo.js)', demoProblems);

if (failed) process.exit(1);
console.log(`✓ i18n in sync — ${used.size} page keys + ${Object.keys(strings).length} diagram keys + ${demo.SCENARIOS.length} demo scenarios, en + zh`);
