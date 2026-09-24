#!/usr/bin/env node
/**
 * build-brand.mjs — writes the web-app manifests from the pages they describe.
 *
 * The brand images themselves (header logo, favicon, home-screen icon) are
 * cut from the product's own files by build-logo.mjs. This used to draw a
 * site-only four-petal mark into the favicon and the social card as well;
 * the owner asked for the product's logo instead, and a site that invents a
 * second icon for the thing it sells is the drift this file existed to stop.
 *
 * What remains here is the manifest: its name and description come out of
 * each page's own <title> and meta description, its colours out of base.css.
 *
 *   node scripts/build-brand.mjs            rewrite the manifests
 *   node scripts/build-brand.mjs --check    fail if either is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const check = process.argv.includes('--check');

/* ---- the manifest, so an installed icon is not a screenshot -------------
   Its name comes out of the page's own <title> and its colours out of the
   token block, because a manifest is the classic place for a brand to be
   restated by hand and then quietly disagree with the site. It sits beside
   the assets so build-i18n's depth rewriting carries it into /zh/ unchanged,
   and its icon paths resolve relative to itself. */
const bg = read('assets/css/base.css').match(/--bg:\s*(#[0-9a-f]{3,8})/i)[1];
const meta = (page) => {
  const html = read(page);
  return {
    title: html.match(/<title>([^<]*)<\/title>/)[1],
    description: html.match(/<meta name="description" content="([^"]*)"/)[1],
    lang: html.match(/<html lang="([^"]*)"/)[1],
  };
};
/* One manifest per language. A single shared one meant a Chinese visitor who
   installed the site got an English name and an English description on their
   home screen — the one place the install prompt shows text at all, and the
   one page of the site that had no Chinese version of it. Both are read from
   the page they describe rather than typed here. */
const manifest = (page, start) => {
  const m = meta(page);
  return JSON.stringify({
    name: m.title,
    short_name: 'WorkspaceX',
    description: m.description,
    lang: m.lang,
    start_url: start,
    display: 'standalone',
    background_color: bg,
    theme_color: bg,
    icons: [
      { src: 'img/favicon.png', sizes: '32x32', type: 'image/png' },
      { src: 'img/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }, null, 2) + '\n';
};

const targets = [
  ['assets/site.webmanifest', null, manifest('index.html', '/')],
  ['assets/site.zh.webmanifest', null, manifest('zh/index.html', '/zh/')],
];

let stale = 0;
for (const [file, re, block] of targets) {
  /* A generated file may not exist yet — on a first run, or after someone
     deletes it. Missing counts as stale, not as a crash. */
  let before;
  try { before = read(file); } catch { before = ''; }
  const after = re ? before.replace(re, () => block) : block;
  if (re && !re.test(before)) {
    console.error(`✗ ${file}: no brand block found — the marker pattern moved`);
    process.exitCode = 1;
    continue;
  }
  if (after === before) continue;
  if (check) { console.error(`✗ ${file} is out of date with the brand source`); stale++; continue; }
  writeFileSync(join(root, file), after);
  console.log(`✓ wrote ${file}`);
}

if (check) {
  if (stale) { console.error(`\n${stale} file(s) stale — run node scripts/build-brand.mjs`); process.exit(1); }
  console.log(`✓ manifests match their sources — ${targets.length} documents`);
}
