#!/usr/bin/env node
/**
 * check-deploy.mjs — the files nobody runs.
 *
 * `_headers` carries the Content-Security-Policy, HSTS, COOP, CORP, nosniff,
 * the referrer policy, the frame policy and the media type that makes the
 * manifest readable at all. `.well-known/security.txt` carries the address a
 * security researcher writes to, and an expiry date after which RFC 9116 says
 * the file is invalid.
 *
 * Both are plain text interpreted by somebody else's machine. Nothing here
 * had ever read either one: a header name misspelt, a rule indented wrong, a
 * path pattern that matches nothing, an expiry quietly passing — all of them
 * ship green and change nothing anybody can see from this repository.
 *
 * The expiry is the sharpest of them. It is a date in a text file that is
 * correct today and wrong later, with no commit in between.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SITE = readFileSync(join(here, 'build-i18n.mjs'), 'utf8').match(/^const SITE = '([^']+)';/m)[1];

const problems = [];

/* ---- _headers ------------------------------------------------------------ */
const rules = [];
let current = null;
readFileSync(join(root, '_headers'), 'utf8').split('\n').forEach((raw, i) => {
  const line = raw.replace(/\s+$/, '');
  if (!line.trim() || line.trim().startsWith('#')) return;
  if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: {}, line: i + 1 }; rules.push(current); return; }
  const m = /^\s+([A-Za-z0-9-]+):\s*(.+)$/.exec(line);
  /* An indented line that is not `Name: value` is not a header — Cloudflare
     drops it, and so does every reader except the person who wrote it. */
  if (!m) { problems.push(`_headers:${i + 1}: not a header line — "${line.trim().slice(0, 50)}"`); return; }
  if (!current) { problems.push(`_headers:${i + 1}: a header before any path pattern`); return; }
  if (current.headers[m[1].toLowerCase()]) problems.push(`_headers:${i + 1}: ${m[1]} declared twice for ${current.pattern}`);
  current.headers[m[1].toLowerCase()] = m[2].trim();
});

for (const rule of rules) {
  if (!Object.keys(rule.headers).length) problems.push(`_headers:${rule.line}: ${rule.pattern} sets no headers`);
  if (!rule.pattern.startsWith('/')) problems.push(`_headers:${rule.line}: "${rule.pattern}" is not a path`);
  /* A pattern that matches nothing on disk is a rule that will never fire. */
  const fixed = rule.pattern.split('*')[0].replace(/^\//, '');
  const dir = fixed.endsWith('/') ? fixed : dirname(fixed);
  if (dir && dir !== '.' && !existsSync(join(root, dir))) {
    problems.push(`_headers:${rule.line}: ${rule.pattern} — no such directory as ${dir}/`);
  }
  if (rule.pattern.includes('*') && fixed && existsSync(join(root, dir))) {
    const stem = fixed.slice(dir.length + (dir === '.' ? 0 : 1));
    const tail = rule.pattern.split('*').pop();
    const hit = readdirSync(join(root, dir))
      .some((f) => f.startsWith(stem) && f.endsWith(tail === '' ? '' : tail));
    if (!hit) problems.push(`_headers:${rule.line}: ${rule.pattern} matches no file`);
  }
}

const site = rules.find((r) => r.pattern === '/*');
if (!site) problems.push('_headers: no /* rule — the site-wide security headers are the point of this file');
else {
  const REQUIRED = [
    'content-security-policy', 'strict-transport-security', 'x-content-type-options',
    'referrer-policy', 'x-frame-options', 'permissions-policy',
    'cross-origin-opener-policy', 'cross-origin-resource-policy',
  ];
  REQUIRED.filter((h) => !site.headers[h]).forEach((h) => problems.push(`_headers: /* does not set ${h}`));

  const csp = site.headers['content-security-policy'] ?? '';
  const directive = (name) => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(csp)?.[1] ?? '').trim();
  for (const name of ['default-src', 'script-src', 'style-src', 'img-src', 'font-src',
    'connect-src', 'base-uri', 'form-action', 'frame-ancestors', 'object-src']) {
    if (!directive(name)) problems.push(`_headers: the CSP declares no ${name}`);
  }
  /* The one line in this file that must never relax. The page's only inline
     <script> is an ld+json data block, which script-src does not govern. */
  if (/'unsafe-inline'|'unsafe-eval'/.test(directive('script-src'))) {
    problems.push("_headers: script-src has gained 'unsafe-inline' or 'unsafe-eval'");
  }
  if (directive('object-src') !== "'none'") problems.push("_headers: object-src should be 'none'");
  if (directive('base-uri') !== "'none'") problems.push("_headers: base-uri should be 'none'");
}

/* The manifest is ignored outright when it is not served as JSON. */
const manifestRule = rules.find((r) => /webmanifest/.test(r.pattern));
if (!manifestRule) problems.push('_headers: nothing sets a content type for the manifests');
else if (manifestRule.headers['content-type'] !== 'application/manifest+json') {
  problems.push(`_headers: manifests served as ${manifestRule.headers['content-type']}`);
}

/* ---- security.txt (RFC 9116) --------------------------------------------- */
const sec = readFileSync(join(root, '.well-known/security.txt'), 'utf8');
const field = (name) => (new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(sec)?.[1] ?? '').trim();

['Contact', 'Expires', 'Canonical'].filter((f) => !field(f))
  .forEach((f) => problems.push(`security.txt: no ${f} field — RFC 9116 requires it`));

const expires = new Date(field('Expires'));
if (Number.isNaN(expires.getTime())) problems.push(`security.txt: Expires is not a date — "${field('Expires')}"`);
else {
  const days = (expires - Date.now()) / 86_400_000;
  /* Expired is invalid, and RFC 9116 says the value SHOULD be less than a
     year out. Thirty days of warning, so the fix is a commit and not an
     incident. */
  if (days < 0) problems.push(`security.txt: Expires passed ${Math.abs(Math.round(days))} days ago — the file is invalid`);
  else if (days < 30) problems.push(`security.txt: Expires in ${Math.round(days)} days — renew it now`);
  if (days > 366) problems.push(`security.txt: Expires is ${Math.round(days)} days out — RFC 9116 asks for less than a year`);
}

const canonical = field('Canonical');
if (canonical && canonical !== `${SITE}/.well-known/security.txt`) {
  problems.push(`security.txt: Canonical is ${canonical}, but the site is ${SITE}`);
}
for (const [name, path] of [['Policy', field('Policy')]]) {
  if (!path) continue;
  if (!path.startsWith(SITE)) { problems.push(`security.txt: ${name} points off-site — ${path}`); continue; }
  const local = path.slice(SITE.length).replace(/^\//, '') || 'index.html';
  if (!existsSync(join(root, local))) problems.push(`security.txt: ${name} → /${local} does not exist`);
}

if (problems.length) {
  console.error(`\n✗ deploy files that will not do what they say (${problems.length}):`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`✓ deploy files agree — ${rules.length} header rules, security.txt valid for ${Math.round((expires - Date.now()) / 86_400_000)} more days`);
