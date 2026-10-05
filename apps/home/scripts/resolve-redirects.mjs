/* Shared by the site smoke check and the domain migration check. */
export async function resolveRedirects(start, { fetchImpl = fetch, maxHops = 3 } = {}) {
  const chain = [], visited = new Set();
  let url = new URL(start).href;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    visited.add(url);
    const res = await fetchImpl(url, { redirect: 'manual', headers: { 'user-agent': 'workspacex-live-check' } });
    chain.push(`${res.status} ${url}`);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect without Location: ${url}`);
      const next = new URL(location, url).href;
      if (visited.has(next)) return { res, chain, loop: next };
      url = next;
      continue;
    }
    return { res, chain, url };
  }
  return { res: null, chain, tooMany: true };
}
