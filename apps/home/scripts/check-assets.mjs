#!/usr/bin/env node
/**
 * check-assets.mjs — the generated BINARIES match the sources they came from.
 *
 * `build-css`, `build-i18n` and `build-brand` all have `--check`: edit a
 * source, forget to rebuild, and the build fails. The three builders that emit
 * binaries had none. Edit `og-card.html` or the palette and forget to run
 * `build-og.mjs`, and the committed card keeps showing the old brand — which
 * is exactly what happened in round 22, where the favicon was generated before
 * the palette swap and stayed orange/pink/violet.
 *
 * Byte-comparing the output is not an option: JPEG and PNG encoders are not
 * reproducible across versions. So this records a hash of each asset's INPUTS
 * and fails when they move without the asset being regenerated. The builders
 * rewrite the record; nobody edits it by hand.
 *
 *   node scripts/check-assets.mjs            fail if an asset is out of date
 *   node scripts/check-assets.mjs --update   record the current sources
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = join(root, 'assets/img/.sources.json');

/* What each generated binary is a function of. The brand mark reaches these
   through base.css and brand.mjs, which is why both are listed for every one
   of them: a palette change invalidates all three. */
const ASSETS = {
  'og.jpg': ['scripts/og-card.html', 'assets/css/base.css', 'assets/css/fonts.css', 'scripts/build-og.mjs'],
  'og-zh.jpg': ['scripts/og-card.html', 'assets/css/base.css', 'assets/css/fonts.css', 'scripts/build-og.mjs'],
  'apple-touch-icon.png': ['assets/img/favicon.svg', 'scripts/build-og.mjs'],
  'aurora.jpg': ['assets/css/base.css', 'scripts/build-aurora.mjs'],
};

const fingerprint = (sources) => createHash('sha256')
  .update(sources.map((f) => readFileSync(join(root, f))).join('\0'))
  .digest('hex')
  .slice(0, 16);

const current = Object.fromEntries(
  Object.entries(ASSETS).map(([asset, sources]) => [asset, fingerprint(sources)]));

if (process.argv.includes('--update')) {
  writeFileSync(RECORD, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`✓ recorded the sources of ${Object.keys(current).length} generated assets`);
  process.exit(0);
}

let recorded = {};
try { recorded = JSON.parse(readFileSync(RECORD, 'utf8')); } catch { /* first run */ }

const stale = Object.keys(ASSETS).filter((a) => recorded[a] !== current[a]);
const missing = Object.keys(ASSETS).filter((a) => !existsSync(join(root, 'assets/img', a)));

if (missing.length || stale.length) {
  if (missing.length) {
    console.error(`\n✗ generated assets that are not there (${missing.length}):`);
    missing.forEach((a) => console.error(`    assets/img/${a}`));
  }
  if (stale.length) {
    console.error(`\n✗ generated assets older than their sources (${stale.length}):`);
    stale.forEach((a) => console.error(`    assets/img/${a} — rebuild it, then: node scripts/check-assets.mjs --update`));
  }
  process.exit(1);
}
console.log(`✓ generated assets match their sources — ${Object.keys(ASSETS).length} binaries`);
