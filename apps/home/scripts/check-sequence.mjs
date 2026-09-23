#!/usr/bin/env node
/**
 * check-sequence.mjs — the numbered things are actually a sequence.
 *
 * Fourteen sections carry an eyebrow numbered 01..14, in two languages. The
 * Chinese one for `proof` said 11, which is also `open`'s number — so the
 * Chinese page ran 01…11, 11, 13, 14, with no 12 at all. Every existing gate
 * was happy: the key existed, it was translated, it contained Han characters,
 * its punctuation was right. None of them read the number.
 *
 * A number written into prose is a fact declared twice — once by the order of
 * the sections and once by the digits — which is the shape this project keeps
 * getting wrong. The digits are checked against the order here.
 *
 * Same shape, second case: the privacy page carries a hand-typed "Last updated"
 * date, on a page whose own closing line argues that its git history is the
 * change log. Nothing kept the two honest. Rather than deriving the date from
 * git — which makes the check fail between a commit and a rebuild, forever
 * chasing itself — the page's prose is fingerprinted beside the date: change
 * the words without moving the date and this fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const zh = (await import(join(root, 'assets/js/zh.js'))).default;

/* In document order, which is the order a reader meets them in. */
const keys = [...html.matchAll(/<span class="eyebrow[^"]*"[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)</g)]
  .map((m) => ({ key: m[1], en: m[2] }));

const numberOf = (text) => {
  const m = /^\s*(\d+)\s*—/.exec(text ?? '');
  return m ? Number(m[1]) : null;
};

const problems = [];
keys.forEach(({ key, en }, i) => {
  const expected = i + 1;
  const enNum = numberOf(en);
  const zhNum = numberOf(zh[key]);
  if (enNum === null) problems.push(`${key}: the English eyebrow carries no number — "${en}"`);
  else if (enNum !== expected) problems.push(`${key}: English reads ${String(enNum).padStart(2, '0')}, but it is section ${String(expected).padStart(2, '0')}`);
  if (zh[key] === undefined) return;                    // check-i18n owns missing keys
  if (zhNum === null) problems.push(`${key}: the Chinese eyebrow carries no number — "${zh[key]}"`);
  else if (zhNum !== expected) problems.push(`${key}: Chinese reads ${String(zhNum).padStart(2, '0')}, but it is section ${String(expected).padStart(2, '0')}`);
});

/* ---- the privacy page's own date ---------------------------------------- */
const STAMP = join(root, 'docs/.privacy-stamp.json');
const privacy = readFileSync(join(root, 'privacy.html'), 'utf8');
const dateMatch = /<p class="doc__meta">[\s\S]*?·\s*(\d{4}-\d{2}-\d{2})\s*·/.exec(privacy);
if (!dateMatch) problems.push('privacy.html: no "Last updated · YYYY-MM-DD ·" line to check');
else {
  const date = dateMatch[1];
  /* The POLICY, not the file. This hashed the whole document minus the date
     line, so adding a social-card <meta> to the <head> — which changes nothing
     a reader of the policy can see — demanded a new "Last updated" date. A
     gate that forces a false date is worse than no gate: this file's whole
     purpose is to keep stated facts true. Scoped to <main>, minus the date
     line, so re-dating alone is not a change and a change is not masked by
     re-dating. */
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(privacy);
  if (!main) problems.push('privacy.html: no <main> to fingerprint');
  const prose = createHash('sha256')
    .update((main?.[1] ?? '').replace(/<p class="doc__meta">[\s\S]*?<\/p>/, ''))
    .digest('hex').slice(0, 16);

  if (process.argv.includes('--update')) {
    writeFileSync(STAMP, `${JSON.stringify({ date, prose }, null, 2)}\n`);
    console.log(`✓ stamped privacy.html as ${date}`);
  } else {
    let stamp = {};
    try { stamp = JSON.parse(readFileSync(STAMP, 'utf8')); } catch { /* first run */ }
    if (stamp.prose !== prose && stamp.date === date) {
      problems.push(`privacy.html: the text changed but "Last updated" still reads ${date} — set today's date, then: node scripts/check-sequence.mjs --update`);
    } else if (stamp.prose !== prose || stamp.date !== date) {
      problems.push(`privacy.html: re-dated to ${date} but not recorded — run: node scripts/check-sequence.mjs --update`);
    }
  }
}

if (problems.length) {
  console.error(`\n✗ stated facts that disagree with reality (${problems.length}):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ stated facts agree — ${keys.length} numbered sections in two languages, and the privacy page's date`);
