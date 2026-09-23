#!/usr/bin/env node
/**
 * check-copy.mjs — typographic gate over the copy in both languages.
 *
 * These are the mistakes that make a page read as unfinished even when nobody
 * can say why: a straight quote next to a curly one, an ASCII apostrophe in an
 * otherwise typeset paragraph, half-width punctuation between Han characters,
 * or a missing space where Chinese meets latin. None of them are visible to a
 * spell checker and all of them survive every functional test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const html = ['index.html', 'privacy.html', '404.html'].map(read).join('\n');
const zhSource = read('assets/js/zh.js');
const diagramSource = read('assets/js/diagram-strings.js');

const problems = [];
const add = (rule, sample) => problems.push(`${rule}\n        ${sample.trim().slice(0, 110)}`);

/* ---- English: authored inline, so pull the text out of the elements ------ */
for (const m of html.matchAll(/data-i18n(?:-html)?="[^"]+"[^>]*>([^<]+)</g)) {
  const text = m[1];
  if (/"/.test(text)) add('straight double quote in English copy', text);
  // an ASCII apostrophe between letters is a contraction or possessive
  if (/[A-Za-z]'[A-Za-z]/.test(text)) add('straight apostrophe in English copy', text);
  if (/ -- /.test(text)) add('double hyphen instead of an em dash', text);
  if (/\s{2,}\S/.test(text)) add('doubled space in English copy', text);
  /* One spelling. The page says organization, center and color, and it also
     said licence, programme, labelled and behaviour — six British forms in an
     otherwise American page, which reads as two writers. */
  const uk = text.match(/\b(licence|programmes?|labell(?:ed|ing)|modell(?:ed|ing)|behaviours?|colours?|organis(?:ation|e|ed|ing)s?|centres?|favou?rite|catalogue|judgement|artefacts?)\b/i);
  if (uk && !/^(favorite)$/i.test(uk[1])) add(`British spelling "${uk[1]}" — the page is written in American English`, text);
}

/* ---- Chinese: every source that contains any, not two named files -------
   Naming the inputs is how a gate goes quietly out of date. This one read
   zh.js and diagram-strings.js; 496 Han characters lived elsewhere and had
   never been checked — the 404 page, the social card, lang.js, and the META
   block in build-i18n.mjs that holds every Chinese <title> and description,
   which is the first Chinese a searcher ever sees. Generated files are
   excluded: they are projections of these. */
const HAN = /[\u4e00-\u9fff]/;
const sources = [
  'index.html', 'privacy.html', '404.html', 'scripts/og-card.html',
  ...readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`),
  ...readdirSync(join(root, 'assets/js')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`),
];

const zhValues = [];
for (const file of sources) {
  const body = read(file);
  if (!HAN.test(body)) continue;
  /* Quoted strings and HTML text nodes — anything that reaches a reader. */
  for (const m of body.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|>([^<>\n]+)</g)) {
    const value = m[1] ?? m[2] ?? m[3];
    if (value && HAN.test(value)) zhValues.push(value);
  }
}

for (const value of zhValues) {
  if (/"/.test(value) && !/class=/.test(value)) add('straight quote in Chinese copy — use “ ”', value);
  /* One quotation style. The page had 10 “ ” and 22 「 」 — both correct
     somewhere, but mainland copy (GB/T 15834) uses “ ”, and mixing them on
     one page reads as two translators. */
  if (/[「」『』]/.test(value)) add('corner brackets in Chinese copy — this site quotes with “ ”', value);
  /* Between Han characters, and also where a clause ENDS on one: the first
     version of this rule needed Han on both sides, so a trailing half-width
     comma after Chinese went straight through — found by writing a probe
     that failed to fail. */
  if (/[一-鿿][,;:!?][一-鿿]/.test(value)) add('half-width punctuation between Han characters', value);
  if (/[一-鿿][,;:!?](?:\s|$)/.test(value)) add('half-width punctuation closing a Chinese clause', value);
  if (/[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/.test(value)) {
    add('missing space where Chinese meets latin or a digit', value);
  }
  if (/\.\.\./.test(value)) add('three dots instead of ……', value);
}

/* ---- acronyms the reader has never met ----------------------------------
   Round 43 put "MAAU runtime" and "The MAAU format spec" on the page. The
   term appears nowhere else on the site, is never expanded, and the plan it
   came from flags it as 一词两义 — two meanings inside the repository,
   unresolved. It was caught by rendering the section and reading it, which is
   not a method that scales.

   So: a bare acronym may appear only if a reader could be expected to know it
   already, or if the page expands it somewhere. The allow-list is deliberately
   short and boring; adding to it should feel like a decision. */
const KNOWN = new Set([
  'AI', 'API', 'APIs', 'CI', 'CRM', 'ERP', 'SSO', 'SCIM', 'SBOM', 'PDF', 'URL',
  'HTML', 'CSS', 'SVG', 'JSON', 'SDK', 'LLM', 'LLMs', 'CRDT', 'SLA', 'GPU',
  'CPU', 'RAM', 'SaaS', 'POC', 'IT', 'HR', 'PR', 'PRs', 'UI', 'UX', 'OKR',
  'FAQ', 'MCP', 'SOC', 'GDPR', 'ISO', 'XR', 'VR', 'WebXR', 'OpenUSD', 'WebRTC',
  /* The name of the standard, in the sentence that cites it. Spelling it
     out would be less precise, not more: the citation is the point. */
  'WCAG',
  'LiveKit', 'GitHub', 'M365', 'LICENSE',
]);
const acronyms = new Map();
for (const file of ['index.html', 'privacy.html', 'assets/js/zh.js']) {
  const raw = readFileSync(join(root, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ');
  for (const m of raw.matchAll(/\b([A-Z][A-Z0-9]{2,})\b/g)) {
    if (KNOWN.has(m[1])) continue;
    /* An expansion anywhere on the page earns it: "a work unit (MAAU)". */
    if (new RegExp(`\\(${m[1]}\\)|${m[1]}\\s*[——-]\\s*\\w`).test(raw)) continue;
    acronyms.set(m[1], (acronyms.get(m[1]) ?? 0) + 1);
  }
}
for (const [word, n] of acronyms) {
  add(`an unexplained acronym, ${n}× — either expand "${word}" on the page or use words`, word);
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} copy problem(s):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ copy clean — ${zhValues.length} Chinese values checked`);
