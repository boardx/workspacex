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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

/* ---- what the site says about the repository ----------------------------
   The page makes claims about a repository that lives four directories up,
   and nothing connected the two. The FAQ said "Open core … the source is on
   GitHub", which reads as a licence grant; the repository has no LICENSE file
   at all, so it grants nothing. Public and open source are different facts,
   and only one of them was true.

   Both directions are checked, and the second is the one that will actually
   fire: the day someone adds a LICENSE, the page must stop saying there is
   none. A sentence that was true when it was written is exactly the kind of
   static trace this repository has a rule about. */
const repoRoot = (() => {
  let dir = root;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = join(dir, '..');
  }
  return null;
})();

if (!repoRoot) problems.push('cannot find the repository root — the licence claims are unchecked');
else {
  const hasLicense = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']
    .some((f) => existsSync(join(repoRoot, f)));
  /* Per language, not concatenated. The first version joined both files and
     asked whether the disclosure appeared anywhere in the result, so deleting
     it from the English page passed as long as the Chinese one still had it —
     which is the one case the site has twice been bitten by. */
  const LANGS = [['index.html', 'en'], ['assets/js/zh.js', 'zh']];
  const copy = LANGS.map(([f]) => readFileSync(join(root, f), 'utf8')).join('\n');

  /* A named licence is a promise with a legal meaning; it may only appear
     once the file it names exists. */
  const named = /\b(Apache[- ]?2\.0|MIT licen[cs]e|AGPL|GPL-?3|BSD-3|MPL-?2)\b/i.exec(copy);
  if (named && !hasLicense) {
    problems.push(`the site names the ${named[1]} licence, and the repository has no LICENSE file`);
  }
  /* And the licence it names must be the one in the file. Existence alone
     would let the page keep saying Apache-2.0 after the file became MIT. */
  if (named && hasLicense) {
    const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].map((f) => join(repoRoot, f)).find(existsSync);
    const text = readFileSync(file, 'utf8');
    const FILE_SAYS = [[/Apache License\s+Version 2\.0/i, /Apache[- ]?2\.0/i], [/^MIT License/m, /MIT/i],
      [/GNU AFFERO GENERAL PUBLIC LICENSE/, /AGPL/i], [/Mozilla Public License Version 2\.0/, /MPL/i]];
    const actual = FILE_SAYS.find(([inFile]) => inFile.test(text));
    for (const m of copy.matchAll(new RegExp(named[0].replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'))) {
      if (!actual || !actual[1].test(m[0])) { problems.push(`the site names ${m[0]}, and LICENSE is something else`); break; }
    }
  }

  /* Each language states the absence as a fact, in its own file.
     Rounds 42–50 put five such statements on the page, and by round 50 the
     licence rule had been copied once already. Written as a table instead:
     a sentence the page asserts about the repository, and the file whose
     presence makes it false. Every row fires in the useful direction — when
     somebody does the work, the page has to stop saying it is undone. */
  const ABSENCE_CLAIMS = [
    {
      what: 'a LICENSE',
      present: () => hasLicense,
      says: /no LICENSE file|还没有 LICENSE 文件/,
      where: 'faq.a5 and the exit-freedom block',
    },
    {
      what: 'a one-command setup',
      present: () => ['docker-compose.yml', 'compose.yml', 'docker-compose.yaml']
        .some((f) => existsSync(join(repoRoot, f))),
      says: /no one-command setup|没有一条命令的安装/,
      where: 'the second door in the closing section',
    },
    {
      what: 'a contributor guide',
      present: () => ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'CONTRIBUTING.markdown']
        .some((f) => existsSync(join(repoRoot, f))),
      says: /no contributor guide|没有贡献指南/,
      where: 'proof.note',
    },
  ];

  for (const [file, lang] of LANGS) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const claim of ABSENCE_CLAIMS) {
      if (claim.present() && claim.says.test(text)) {
        problems.push(`${file}: the repository now has ${claim.what}, but the ${lang} copy still tells the reader it does not — update ${claim.where}`);
      }
    }
    /* The one claim that runs the other way: open core is only sayable while
       the page also says the licence is missing. */
    if (!hasLicense && /open core|开放内核/i.test(text) && !ABSENCE_CLAIMS[0].says.test(text)) {
      problems.push(`${file}: the ${lang} copy claims open core while the repository has no LICENSE, and does not say so`);
    }
  }
}

if (problems.length) {
  console.error(`\n✗ stated facts that disagree with reality (${problems.length}):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ stated facts agree — ${keys.length} numbered sections in two languages, and the privacy page's date`);
