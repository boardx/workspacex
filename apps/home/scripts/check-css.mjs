#!/usr/bin/env node
/**
 * check-css.mjs — dead-code gate for the stylesheets.
 *
 * A hand-written site accumulates classes and tokens that nothing references,
 * and they are invisible: the page looks identical either way. This fails the
 * build on a class defined in CSS but present nowhere in the markup or the
 * scripts, on a custom property that is declared and never read, and on a
 * `var()` that reads a property nobody declares — the last one is a real bug,
 * not tidiness, because it silently falls back to nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const list = (dir, ext) => readdirSync(join(root, dir))
  .filter((f) => f.endsWith(ext) && f !== 'site.css')   // generated bundle, not a source
  .map((f) => `${dir}/${f}`);

const html = ['index.html', 'privacy.html', '404.html'].map(read).join('\n');
const js = list('assets/js', '.js').map(read).join('\n');
const cssFiles = list('assets/css', '.css');
const consumers = html + js;

/* Values a stylesheet legitimately reads but only JS ever writes. */
const JS_WRITTEN = new Set(['--hint-h', '--i', '--e', '--p', '--c', '--dscale', '--scene-track', '--read']);

const classes = new Map();
let css = '';
for (const file of cssFiles) {
  /* Strip comments and url() payloads before looking for class names:
     `url("../img/aurora.webp")` otherwise reads as a class called `.jpg`. */
  const body = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, 'url()');
  css += body;
  for (const m of body.matchAll(/\.([A-Za-z][\w-]*)/g)) {
    if (!classes.has(m[1])) classes.set(m[1], basename(file));
  }
}

const unusedClasses = [...classes.keys()].filter((c) => !consumers.includes(c));
const declared = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
const referenced = new Set([...(css + js).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
/* A property read by COMPUTED name never appears in a var(), so the dead-token
   rule would call it dead. mq.js reads `--bp-${name}`; the prefix is what makes
   that legible here rather than a magic exception. */
const DYNAMIC = /getPropertyValue\(`(--[\w-]+)\$\{/g;
const dynamicPrefixes = [...js.matchAll(DYNAMIC)].map((m) => m[1]);
const readDynamically = (t) => dynamicPrefixes.some((p) => t.startsWith(p));
const unusedTokens = [...declared].filter((t) => !referenced.has(t) && !readDynamically(t));
const dangling = [...referenced].filter((t) => !declared.has(t) && !JS_WRITTEN.has(t));

let failed = false;
const report = (label, items, format = (x) => x) => {
  if (!items.length) return;
  failed = true;
  console.error(`\n✗ ${label} (${items.length}):`);
  items.forEach((i) => console.error(`    ${format(i)}`));
};

/* --- the scales must stay scales ---------------------------------------
   Twelve radii and seventeen font sizes had accumulated outside the token
   system before anyone looked. Each one arrived reasonably — a component
   needed "just a bit smaller" — and together they are why a page stops
   feeling designed. Literals are allowed only where the token block itself
   declares them, and in print.css, which is measured in points on purpose. */
const SCALE_EXEMPT = /print\.css|fonts\.css/;
const offScale = [];
for (const file of cssFiles) {
  if (SCALE_EXEMPT.test(file)) continue;
  const body = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  // skip the :root block, which is where the scales are defined
  const scoped = body.replace(/:root\s*\{[\s\S]*?\}/g, '');
  for (const m of scoped.matchAll(/(?<![\w-])(border-radius|font-size)\s*:\s*([^;}]+);/g)) {
    const value = m[2].trim();
    if (/var\(|calc\(|clamp\(|inherit|currentColor/.test(value)) continue;
    if (value === '0' || value === '0px') continue;
    offScale.push(`${basename(file)}: ${m[1]}: ${value}`);
  }
}

/* --- the brand palette has one home ------------------------------------
   Its three stops were restated in four places: base.css, diagrams.js, the
   inline sprite in each page, and the social card. Changing the palette then
   means finding all four, and missing one ships two brands on one page. The
   token block declares them; everything else reads them. */
const BRAND_LITERAL = new RegExp([
  '#(?:ff7a18|ff2e73|b14bff)\\b',                  // hex, as the sprite and the card wrote it
  '\\b255\\s*[, ]\\s*122\\s*[, ]\\s*24\\b',          // and the same three as channels, which is
  '\\b255\\s*[, ]\\s*46\\s*[, ]\\s*115\\b',          // how twenty-two translucent glows and
  '\\b177\\s*[, ]\\s*75\\s*[, ]\\s*255\\b',          // borders used to restate them
].join('|'), 'i');
const brandLeaks = [];
for (const file of ['index.html', 'privacy.html', '404.html', 'scripts/og-card.html',
                    ...list('assets/js', '.js'), ...cssFiles,
                    ...list('scripts', '.mjs').filter((f) => !f.endsWith('check-css.mjs'))]) {
  let body;
  try { body = read(file); } catch { continue; }
  body = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (basename(file) === 'base.css') {
    // the declaration itself lives here; only look outside the token block
    body = body.replace(/:root\s*\{[\s\S]*?\n\}/, '');
  }
  body.split('\n').forEach((line, i) => {
    if (BRAND_LITERAL.test(line)) brandLeaks.push(`${file}:${i + 1}: ${line.trim().slice(0, 70)}`);
  });
}

/* --- a breakpoint token must govern a real query ------------------------
   The --bp-* values exist so JavaScript can read the numbers the stylesheets
   use instead of carrying its own copies. That only holds while each token
   actually matches a media query; a token nothing queries is a number JS
   trusts and CSS ignores. */
const bpLeaks = [];
for (const m of css.matchAll(/^\s*(--bp-[\w-]+):\s*([^;]+);/gm)) {
  const value = m[2].trim();
  if (!new RegExp(`\\(\\s*(?:max|min)-width:\\s*${value.replace('.', '\\.')}\\s*\\)`).test(css)) {
    bpLeaks.push(`${m[1]}: ${value} — no media query uses it`);
  }
}
/* --- the CJK tail of the font stacks ------------------------------------
   Both real faces are latin-only, so every Han character on the Chinese page
   is resolved by the fallback list. A platform missing from it does not
   degrade to a different sans — it degrades to the browser default, which on
   a Chinese Windows is SimSun, a serif. Nothing on the English page changes
   when this list is wrong, which is exactly why it went unnoticed: these
   stacks named no Windows face at all, and named Noto by its WEB font name
   rather than the one Linux and Android install. */
const CJK_PLATFORMS = [
  ['macOS / iOS', ['PingFang SC', 'Heiti SC']],
  ['older macOS', ['Hiragino Sans GB']],
  ['Windows', ['Microsoft YaHei', 'SimHei']],
  ['Linux / Android', ['Noto Sans CJK SC', 'Source Han Sans SC']],
];
const cjkGaps = [];
for (const m of css.matchAll(/^\s*(--font-(?:display|body|mono)):\s*([^;]+);/gm)) {
  for (const [platform, families] of CJK_PLATFORMS) {
    if (!families.some((f) => m[2].includes(`"${f}"`))) {
      cjkGaps.push(`${m[1]}: nothing for ${platform} — expected one of ${families.join(', ')}`);
    }
  }
}
report('font stacks with no CJK face for a platform', cjkGaps);
/* --- tracking that does not know which script it is tracking -------------
   Every letter-spacing on this site is a Latin convention — wide on small
   uppercase labels, tight on display type — and both are wrong for Han. They
   now multiply by --track-open / --track-tight, which the Chinese page
   redefines once. A literal em value written tomorrow would quietly bring
   Latin tracking back onto sixty-odd Chinese labels, and nothing on the
   English page would look any different. */
const trackLeaks = [];
for (const file of cssFiles.filter((f) => !f.endsWith('site.css') && !f.endsWith('print.css'))) {
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((line, i) => {
    const m = /letter-spacing:\s*([^;]+)/.exec(line);
    if (!m) return;
    const v = m[1].trim();
    if (/^(0|normal)$/.test(v) || /var\(--track-(open|tight)\)/.test(v)) return;
    trackLeaks.push(`${basename(file)}:${i + 1}: letter-spacing: ${v}`);
  });
}
report('tracking that ignores the page language — multiply by var(--track-open) or var(--track-tight)', trackLeaks);
/* --- hover on devices that cannot hover ----------------------------------
   On a touch screen, :hover is applied by a tap and stays until the next tap
   somewhere else. None of this site's 21 hover rules asked whether the device
   could hover, so on a phone every tapped control kept its hover styling —
   and on the loop rail, the step you had tapped stayed lit while the scroll
   moved the real current step on: two steps that both looked current. */
const hoverLeaks = [];
for (const file of cssFiles.filter((f) => !f.endsWith('site.css') && !f.endsWith('print.css'))) {
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((line, i) => {
    if (!line.includes(':hover')) return;
    if (/@media\s*\(hover:\s*hover\)/.test(line)) return;
    hoverLeaks.push(`${basename(file)}:${i + 1}: ${line.trim().slice(0, 70)}`);
  });
}
report(':hover outside @media (hover: hover) — it sticks after a tap on a phone', hoverLeaks);
/* --- weights the fonts no longer carry -----------------------------------
   build-fonts.mjs cut Inter's weight axis to 400–700, because nothing used
   the rest. A rule asking for 300 or 800 would silently render the nearest
   weight in range — so the range is read out of fonts.css and enforced. */
const [wMin, wMax] = (/font-family: 'Inter';[\s\S]*?font-weight:\s*(\d+)\s+(\d+)/.exec(read('assets/css/fonts.css')) || [0, 1, 1000]).slice(1).map(Number);
const weightLeaks = [];
for (const file of cssFiles.filter((f) => !f.endsWith('site.css') && !f.endsWith('fonts.css'))) {
  read(file).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/font-weight:\s*(\d+)/g)) {
      if (+m[1] < wMin || +m[1] > wMax) weightLeaks.push(`${basename(file)}:${i + 1}: font-weight: ${m[1]} (the fonts carry ${wMin}–${wMax})`);
    }
  });
}
report('font weights outside what build-fonts.mjs keeps', weightLeaks);
report('breakpoint tokens that govern nothing', bpLeaks);
report('brand colours written literally outside the token block', brandLeaks);
report('values set outside the radius / type scales', offScale);
report('classes defined in CSS but used nowhere', unusedClasses, (c) => `.${c}  (${classes.get(c)})`);
report('custom properties declared but never read', unusedTokens);
report('var() reading a property nothing declares', dangling);

if (failed) process.exit(1);
console.log(`✓ css clean — ${classes.size} classes, ${declared.size} tokens, all referenced`);
