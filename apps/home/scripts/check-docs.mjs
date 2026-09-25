#!/usr/bin/env node
/**
 * check-docs.mjs — the README describes this directory, and must still.
 *
 * `check-all.mjs` already fails on a `check-*.mjs` that exists and nothing
 * runs. That gate covers the RUNNER and not the DESCRIPTION, so two scripts
 * were added, wired in, proved red and shipped without ever appearing in the
 * table that claims to list them — and the suite table said fifteen when
 * twenty-one were running.
 *
 * Worse, the drift ran the other way too. The Fonts section named Microsoft
 * YaHei for Windows while `base.css` did not, so the documentation described a
 * fix nobody had made and a Chinese reader on Windows got a serif. A README
 * that is checked is documentation; one that is not is a second, unversioned
 * opinion about the code.
 *
 * So: every row in each table must name something real, and everything real
 * must have a row. Both directions — a row for a deleted script is as wrong as
 * a script with no row.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const problems = [];

const rows = (re) => [...readme.matchAll(re)].map((m) => m[1]);

/* ---- the script table ---------------------------------------------------- */
const documented = new Set(rows(/^\| `([\w.-]+\.mjs)[^`]*` \|/gm));
const onDisk = readdirSync(join(root, 'scripts'))
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs') && f !== 'check-all.mjs');
const checked = readFileSync(join(root, 'scripts/check-all.mjs'), 'utf8');
const runWithCheckFlag = [...checked.matchAll(/'(build-[\w-]+\.mjs)',\s*'--check'/g)].map((m) => m[1]);

for (const script of [...onDisk, ...runWithCheckFlag]) {
  if (!documented.has(script)) problems.push(`README: no row for scripts/${script}`);
}
for (const script of documented) {
  if (script.startsWith('check-') || script.startsWith('build-')) {
    if (![...onDisk, ...runWithCheckFlag].includes(script) && script !== 'check-all.mjs') {
      problems.push(`README: a row for scripts/${script}, which no check runs`);
    }
  }
}

/* ---- the suite table ----------------------------------------------------- */
/* Suite names are the first word of each reporter's label, which is also the
   first cell of each row. `×2` marks the ones that run per language. */
const suiteSource = readFileSync(join(root, 'tests/browser.test.mjs'), 'utf8');
const live = new Map();
for (const m of suiteSource.matchAll(/reporter\((?:'([^']+)'|`([^`]+)`)\)/g)) {
  const label = (m[1] ?? m[2]);
  /* Per language is `[${lang}]` in the label, not merely a template literal:
     the responsive suite interpolates its own width count and runs once. */
  const perLang = /\[\$\{lang\}\]/.test(label);
  const name = label.replace(/\[\$\{[^}]*\}\]/g, '').split(/ [—-] /)[0].trim();
  live.set(name, (live.get(name) ?? 0) + (perLang ? 2 : 1));
}
/* Only the suite table: its header cell is "Suite", and the script table's
   first column is always a `backticked` filename. Without this the header row
   of the other table read as a suite called "script". */
const suiteTable = readme.slice(readme.indexOf('| Suite |'));
const tableRows = new Map(
  [...suiteTable.matchAll(/^\| ([a-z][a-z ]*?)( ×2)? \| [^|]+\|$/gm)].map((m) => [m[1].trim(), m[2] ? 2 : 1]),
);
for (const [name, n] of live) {
  if (!tableRows.has(name)) { problems.push(`README: no row for the "${name}" suite`); continue; }
  if (tableRows.get(name) !== n) {
    problems.push(`README: "${name}" is marked ${tableRows.get(name) === 2 ? '×2' : 'single'} but runs ${n === 2 ? 'per language' : 'once'}`);
  }
}
for (const name of tableRows.keys()) {
  if (!live.has(name)) problems.push(`README: a row for a "${name}" suite that does not exist`);
}

/* ---- the count in the prose --------------------------------------------- */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five'];
const total = [...live.values()].reduce((a, b) => a + b, 0);
const claimed = /and ([a-z-]+) suites in\s*\npractice/.exec(readme)?.[1];
if (claimed !== WORDS[total]) {
  problems.push(`README: says "${claimed} suites in practice"; ${WORDS[total] ?? total} run`);
}

if (problems.length) {
  console.error(`\n✗ the README describes a directory that is not this one (${problems.length}):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ README matches — ${documented.size} scripts documented, ${live.size} suites, ${total} runs`);
