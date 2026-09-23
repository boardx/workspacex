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
    if (!existsSync(resolve(root, rel))) problems.push(`${page}: ${url} → ${rel} does not exist`);
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

/* The sitemap is what a crawler is told exists. A <loc> pointing at a page
   that does not, or a page that exists and is absent from the sitemap, are
   both silent: nothing on the site looks any different either way. */
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const asFile = (url) => {
  const rel = url.replace(SITE, '').replace(/^\//, '');
  return rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel;
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
