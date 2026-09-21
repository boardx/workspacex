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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const html = read('index.html');
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
}

/* ---- Chinese: values in the two dictionaries ----------------------------- */
const zhValues = [];
for (const m of zhSource.matchAll(/^\s*'[\w.]+':\s*'((?:[^'\\]|\\.)*)'/gm)) zhValues.push(m[1]);
for (const m of diagramSource.matchAll(/zh:\s*'((?:[^'\\]|\\.)*)'/g)) zhValues.push(m[1]);

for (const value of zhValues) {
  if (/"/.test(value) && !/class=/.test(value)) add('straight quote in Chinese copy — use “ ”', value);
  if (/[一-鿿][,;:!?][一-鿿]/.test(value)) add('half-width punctuation between Han characters', value);
  if (/[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/.test(value)) {
    add('missing space where Chinese meets latin or a digit', value);
  }
  if (/\.\.\./.test(value)) add('three dots instead of ……', value);
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} copy problem(s):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ copy clean — ${zhValues.length} Chinese values checked`);
