#!/usr/bin/env node
/**
 * live-check.mjs — asks the deployed site, not the repository.
 *
 * Every other check reads files. Some things only the host decides: whether
 * /privacy resolves or loops (round 66 removed two _redirects rules that, by
 * Cloudflare Pages' documented behavior, sent it round in a circle — a
 * conclusion that could not be tested from the machine that made it), whether
 * the headers in _headers are actually sent, whether every sitemap URL
 * answers. This follows each redirect by hand, so a loop is a named failure
 * rather than a hung request.
 *
 * Not part of check-all: it needs the network and a deployment. It runs in
 * .github/workflows/home-live.yml, daily and on demand.
 *
 *   node scripts/live-check.mjs                     against the production origin
 *   node scripts/live-check.mjs --base http://…     against any other origin
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = readFileSync(join(root, 'scripts/build-i18n.mjs'), 'utf8').match(/^const SITE = '([^']+)';/m)[1];
const args = process.argv.slice(2);
const BASE = (args.includes('--base') ? args[args.indexOf('--base') + 1] : SITE).replace(/\/$/, '');
const MAX_HOPS = 3;

/* Follow redirects one at a time; report the chain, a loop, or too many hops. */
async function resolve(path) {
  const chain = [];
  let url = new URL(path, BASE).href;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'workspacex-live-check' } });
    chain.push(`${res.status} ${new URL(url).pathname}`);
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location'), url).href;
      if (chain.some((c) => c.endsWith(` ${new URL(next).pathname}`))) return { res, chain, loop: next };
      url = next;
      continue;
    }
    return { res, chain };
  }
  return { res: null, chain, tooMany: true };
}

const problems = [];
const pages = ['/', '/zh/', '/privacy', '/zh/privacy'];
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const extra = ['/privacy.html', '/zh/privacy.html', '/.well-known/security.txt', '/zh', '/security.txt'];

for (const path of [...new Set([...pages, ...locs, ...extra])]) {
  try {
    const { res, chain, loop, tooMany } = await resolve(path);
    const route = chain.join(' → ');
    if (loop) problems.push(`${path}: redirect LOOP — ${route} → back to ${new URL(loop).pathname}`);
    else if (tooMany) problems.push(`${path}: more than ${MAX_HOPS} redirects — ${route}`);
    else if (res.status !== 200) problems.push(`${path}: ends at ${res.status} — ${route}`);
    /* A page the site links to directly should answer without a hop. */
    else if ((pages.includes(path) || locs.includes(path)) && chain.length > 1) problems.push(`${path}: linked directly but redirects — ${route}`);
    else console.log(`  ✓ ${path.padEnd(28)} ${route}`);
    if (path === '/' && res?.status === 200 && !res.headers.get('content-security-policy')) {
      problems.push('/: no Content-Security-Policy header — _headers is not being applied');
    }
  } catch (e) {
    problems.push(`${path}: request failed — ${e.message}`);
  }
}

if (problems.length) {
  console.error(`\n✗ ${BASE}: ${problems.length} problem(s)`);
  problems.forEach((p) => console.error(`    ${p}`));
  process.exit(1);
}
console.log(`\n✓ ${BASE} answers as the repository says it should`);
