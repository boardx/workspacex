#!/usr/bin/env node
/* Run after the authorized owner configures the old-domain redirect rule. */
import { pathToFileURL } from 'node:url';
import { resolveRedirects } from './resolve-redirects.mjs';

export async function verifyDomainRedirect(source, target, { fetchImpl = fetch } = {}) {
  const expected = new URL(source);
  expected.protocol = new URL(target).protocol;
  expected.host = new URL(target).host;
  const first = await fetchImpl(source, { redirect: 'manual' });
  if (![301, 308].includes(first.status)) throw new Error(`${source}: expected permanent redirect, got ${first.status}`);
  const location = first.headers.get('location');
  if (!location || new URL(location, source).href !== expected.href) throw new Error(`${source}: path/query or target origin changed: ${location}`);
  const result = await resolveRedirects(expected.href, { fetchImpl });
  if (result.loop || result.tooMany || result.res.status !== 200) throw new Error(`${source}: target failed: ${result.chain.join(' → ')}`);
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
