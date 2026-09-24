#!/usr/bin/env node
/**
 * check-links.mjs — every reference on every page resolves to something.
 *
 * The page declares files it never renders: a manifest, an apple-touch icon,
 * a preloaded font, a social card that only a scraper fetches. Nothing on
 * screen changes when one of those paths is wrong, so a typo ships and stays
 * shipped. The same is true of in-page anchors: a nav link to #questions that
 * no element answers to just does nothing when clicked.
 *
 * This resolves every local href, src and og/twitter image on all five pages
 * against the filesystem, and every fragment against the ids in its own
 * document. It deliberately does not touch the network — external links are
 * somebody else's uptime, not this repository's correctness.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, posix } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Read from the one place that chooses it, so this check cannot agree with a
   stale copy of the answer it is checking. */
const SITE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'build-i18n.mjs'), 'utf8')
  .match(/^const SITE = '([^']+)';/m)[1];

const PAGES = ['index.html', 'privacy.html', '404.html', 'zh/index.html', 'zh/privacy.html'];

const problems = [];
let refs = 0;
let anchors = 0;

for (const page of PAGES) {
  const html = readFileSync(join(root, page), 'utf8');
  const dir = dirname(page);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

  /* Where a relative path resolves FROM. A page in zh/ resolves against zh/;
     this is the check that would have caught the asset paths when `depth`
     was declared but never applied. */
  const localise = (url) => {
    if (url.startsWith(SITE)) return url.slice(SITE.length).replace(/^\//, '');
    if (url.startsWith('/')) return url.slice(1);
    return posix.normalize(posix.join(dir === '.' ? '' : dir, url));
  };

  const attrs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const metas = [...html.matchAll(/<meta\s+(?:property|name)="(?:og:image|twitter:image|og:url)"\s+content="([^"]+)"/g)]
    .map((m) => m[1]);

  for (const url of [...attrs, ...metas]) {
    if (/^(?:https?:)?\/\//.test(url) && !url.startsWith(SITE)) continue;   // off-site
    if (/^(?:mailto|tel|data):/.test(url)) continue;

    if (url.startsWith('#')) {
      anchors += 1;
      const id = decodeURIComponent(url.slice(1));
      if (id && !ids.has(id)) problems.push(`${page}: href="${url}" — no element with that id`);
      continue;
    }

    const rel = localise(url.split('#')[0].split('?')[0]);
    if (rel === '' || rel.endsWith('/')) continue;              // a directory URL the host resolves
    refs += 1;
    /* Cloudflare Pages serves /privacy from privacy.html ("pretty URLs") and
       308-redirects /privacy.html to /privacy. So a page is linked by the URL
       Pages serves; the .html form is a redirect every click or crawl pays. */
    if (!existsSync(resolve(root, rel)) && !existsSync(resolve(root, `${rel}.html`))) problems.push(`${page}: ${url} → ${rel} does not exist`);
    if (/\.html$/.test(rel) && !/(^|\/)(index|404)\.html$/.test(rel)) problems.push(`${page}: ${url} — Pages redirects this to /${rel.replace(/\.html$/, '')}; link the URL it serves`);
  }
}

/* _redirects may only point at things that are there. */
const redirects = readFileSync(join(root, '_redirects'), 'utf8');
for (const line of redirects.split('\n')) {
  const m = line.trim().match(/^(\S+)\s+(\S+)\s+\d{3}$/);
  if (!m || m[1].startsWith('#')) continue;
  const target = m[2].replace(/^\//, '').replace(':splat', '');
  if (!target || target.endsWith('/') || target.includes(':')) continue;
  refs += 1;
  if (!existsSync(resolve(root, target))) problems.push(`_redirects: ${m[1]} → /${target} does not exist`);
  /* Cloudflare Pages already serves /x from x.html, and redirects /x.html
     back to /x (308). A rule sending /x to /x.html therefore loops between
     the two forever — which is what /privacy and /zh/privacy did. */
  if (m[2].endsWith('.html') && m[2].replace(/\.html$/, '') === m[1].replace(/\/$/, '')) {
    problems.push(`_redirects: ${m[1]} → ${m[2]} loops on Cloudflare Pages, which redirects ${m[2]} back to ${m[1]}`);
  }
}

/* The SELF-REFERENTIAL urls — canonical, hreflang, og:url and the card
   images — must name the origin the build uses. A canonical tag pointing at a
   domain the site is not served from is invisible on screen and costs the
   whole index. Ordinary outbound links are somebody else's host and are left
   alone: the first version of this rule matched anything containing
   "boardx.us" and flagged the GitHub repo, the app and the developer portal,
   which are three different and correct destinations. */
const SELF_REF = /<(?:link rel="canonical"|link rel="alternate"|meta property="og:(?:url|image)"|meta name="twitter:image")[^>]*(?:href|content)="(https?:\/\/[^"]+)"/g;
for (const page of ['index.html', 'privacy.html', '404.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  for (const m of html.matchAll(SELF_REF)) {
    refs += 1;
    if (!m[1].startsWith(SITE)) problems.push(`${page}: ${m[1]} does not use SITE (${SITE})`);
  }
}

/* A card without alt text. Mutation testing found this: breaking og:image:alt
   changed nothing anybody could detect. The rule that looked like it covered
   it — check-html's "images without alt" — guards a population of zero,
   because this site has no <img> elements at all; the hero backdrop is a CSS
   background and everything else is inline SVG. The alt a social card carries
   is the only alt text on the site, and nothing read it. */
for (const page of ['index.html', 'privacy.html', '404.html', 'zh/index.html', 'zh/privacy.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  if (!/<meta property="og:image"/.test(html)) continue;
  for (const [attr, name] of [['property', 'og:image:alt'], ['name', 'twitter:image:alt']]) {
    refs += 1;
    const m = new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html);
    if (!m) problems.push(`${page}: declares og:image and no ${name}`);
    else if (m[1].trim().length < 10) problems.push(`${page}: ${name} is empty or too short`);
  }
}

/* og:locale is language_TERRITORY. hreflang is language-Script. They are two
   grammars for the same idea, and the page had the hreflang answer sitting in
   the og slot: `zh_Hans`, which no social crawler's locale list contains —
   they take zh_CN, zh_TW, zh_HK. `en` was the same mistake in the other
   direction. Nothing renders differently, which is why it survived: the card
   is built on somebody else's machine. */
for (const page of ['index.html', 'privacy.html', 'zh/index.html', 'zh/privacy.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  for (const m of html.matchAll(/<meta property="(og:locale(?::alternate)?)" content="([^"]*)"/g)) {
    refs += 1;
    if (!/^[a-z]{2}_[A-Z]{2}$/.test(m[2])) {
      problems.push(`${page}: ${m[1]} is "${m[2]}" — og:locale is language_TERRITORY (en_US, zh_CN), not a hreflang tag`);
    }
  }
  /* And the two grammars must not be confused the other way either. */
  for (const m of html.matchAll(/hreflang="([^"]*)"/g)) {
    if (/_/.test(m[1])) problems.push(`${page}: hreflang="${m[1]}" uses an underscore — hreflang is language-Script`);
  }
}

/* An anchor with two names. Round 32 found the hero's second button
   pointing at the market-thesis section while the footer had always called
   the loop "How it works" — two labels for one destination, and the reader
   cannot tell they are the same place. Round 47 found the next one by hand:
   the nav said "Open", the footer said "Open ecosystem", and the section had
   been renamed to "What is open, what is sold" in between.

   Rather than guess whether two labels mean the same thing, this reports
   every in-page anchor that is given more than one name. Agreeing is then a
   decision someone makes, which is the point — the allow-list is for the
   cases where two names really are right. */
/* Two refinements, both from the first run, which reported four anchors and
   was wrong about two of them:

   — A call to action is not a label. "See how it works" is a sentence in the
     hero; the nav and the footer are the two places that NAME a destination,
     and those two are what must agree. Buttons are excluded.
   — "Trust" and "Trust & evidence" are not two names, they are one name and
     a longer form of it. Only labels where neither contains the other are
     reported. */
const ANCHOR_ALIASES_ALLOWED = new Set([]);
const norm = (t) => t.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim().toLowerCase();
for (const page of ['index.html', 'zh/index.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  const names = new Map();
  for (const m of html.matchAll(/<a([^>]*)href="(#[\w-]+)"([^>]*)>([\s\S]*?)<\/a>/g)) {
    if (/class="[^"]*btn/.test(m[1] + m[3])) continue;
    const label = norm(m[4]);
    if (!label) continue;
    if (!names.has(m[2])) names.set(m[2], new Set());
    names.get(m[2]).add(label);
  }
  for (const [href, set] of names) {
    const labels = [...set];
    const related = labels.every((a) => labels.some((b) => a !== b && (b.includes(a) || a.includes(b))));
    if (labels.length > 1 && !related && !ANCHOR_ALIASES_ALLOWED.has(href)) {
      problems.push(`${page}: ${href} is called ${labels.map((n) => `"${n}"`).join(' and ')} — one destination, two names`);
    }
  }
}

/* The sitemap is what a crawler is told exists. A <loc> pointing at a page
   that does not, or a page that exists and is absent from the sitemap, are
   both silent: nothing on the site looks any different either way. */
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const asFile = (url) => {
  const rel = url.replace(SITE, '').replace(/^\//, '');
  if (rel === '' || rel.endsWith('/')) return `${rel}index.html`;
  return /\.[a-z]+$/.test(rel) ? rel : `${rel}.html`;
};
for (const loc of locs) {
  refs += 1;
  if (!existsSync(resolve(root, asFile(loc)))) problems.push(`sitemap.xml: <loc>${loc}</loc> does not exist`);
}
const listed = new Set(locs.map(asFile));
for (const page of PAGES) {
  if (page === '404.html') continue;                 // deliberately unlisted
  if (!listed.has(page)) problems.push(`sitemap.xml: ${page} exists but is not listed`);
}

if (problems.length) {
  console.error(`\n✗ references that resolve to nothing (${problems.length}):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ links resolve — ${refs} files, ${anchors} anchors, ${locs.length} sitemap urls`);
