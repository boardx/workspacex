#!/usr/bin/env node
/* Run after the authorized owner configures the old-domain redirect rule. */
import { pathToFileURL } from 'node:url';
import { resolveRedirects } from './resolve-redirects.mjs';

export async function verifyDomainRedirect(source, target, { fetchImpl = fetch } = {}) {
  const origin = new URL(target);
  if (origin.protocol !== 'https:') throw new Error('target must use HTTPS');
  const expected = new URL(source);
  expected.protocol = origin.protocol;
  expected.host = origin.host;
  const first = await fetchImpl(source, { redirect: 'manual' });
  if (![301, 308].includes(first.status)) throw new Error(`${source}: expected permanent redirect, got ${first.status}`);
  const location = first.headers.get('location');
  if (!location || new URL(location, source).href !== expected.href) throw new Error(`${source}: path/query or target origin changed: ${location}`);
  /* Every request after the old-host redirect must keep the complete target
     URL. A later 200 on a different origin or with lost query is not success. */
  const validateURL = url => {
    if (url !== expected.href) throw new Error(`${source}: path/query or target origin changed in redirect chain: ${url}`);
  };
  const result = await resolveRedirects(expected.href, { fetchImpl, validateURL });
  if (result.loop || result.tooMany || result.res.status !== 200) throw new Error(`${source}: target failed: ${result.chain.join(' → ')}`);
  validateURL(result.url);
  return `${first.status} ${source} → ${result.chain.join(' → ')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = ['/', '/zh/', '/privacy', '/zh/privacy', '/manual/', '/.well-known/security.txt'];
  for (const origin of ['https://boardx.us', 'https://www.boardx.us']) {
    for (const path of paths) {
      console.log(await verifyDomainRedirect(`${origin}${path}?utm_source=domain-migration&next=%2Fmanual%2F`, 'https://workspacex.us'));
    }
  }
}
