#!/usr/bin/env node
/**
 * build-fonts.mjs — cuts the body face down to the weights the page uses.
 *
 * Inter ships as a variable font spanning weight 100–900. The stylesheets use
 * 400, 500, 600 and 700 and nothing else, so the other two-thirds of the axis
 * was downloaded by every visitor and never drawn: 48 KB of first load for
 * a 34 KB font. This pins the axis to 400–700, keeping it variable inside
 * that range, and changes nothing else — same glyphs, same features.
 *
 * Outfit is left alone: instancing re-encodes it LARGER (32 → 35 KB), because
 * its masters sit at the ends of the axis and the cut adds a new one.
 *
 * Sources: scripts/fonts-src/*.woff2, the files as they came from upstream.
 * check-assets fingerprints them, so replacing a source without re-running
 * this fails the build. If a rule ever asks for weight 300 or 800, it gets
 * the nearest weight in range — so check-css rejects one.
 *
 *   node scripts/build-fonts.mjs      (needs: pip install fonttools brotli)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WEIGHTS = [400, 700];
const FACES = ['inter-latin', 'inter-latin-ext'];

const tmp = mkdtempSync(join(tmpdir(), 'fonts-'));
try {
  for (const face of FACES) {
    const src = join(root, 'scripts/fonts-src', `${face}.woff2`);
    const ttf = join(tmp, `${face}.ttf`);
    const out = join(root, 'assets/fonts', `${face}.woff2`);
    execFileSync('fonttools', ['varLib.instancer', src, `wght=${WEIGHTS.join(':')}`, '-q', '-o', ttf]);
    execFileSync('fonttools', ['subset', ttf, '--unicodes=*', '--layout-features=*', '--name-IDs=*',
      '--flavor=woff2', `--output-file=${out}`]);
    console.log(`✓ wrote assets/fonts/${face}.woff2 — ${(statSync(src).size / 1024).toFixed(1)} → ${(statSync(out).size / 1024).toFixed(1)} KB, weight ${WEIGHTS.join('–')}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
