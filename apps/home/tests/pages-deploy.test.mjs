import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cutover } from '../scripts/deploy-pages.mjs';
import { resolveRedirects } from '../scripts/resolve-redirects.mjs';
import { verifyDomainRedirect } from '../scripts/verify-domain-redirects.mjs';

const sha = 'a'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, CLOUDFLARE_ACCOUNT_ID: 'cc39c0447db8c730182cfd075fe91bf7', CLOUDFLARE_API_TOKEN: 'fixture-only' };
const old = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', latest_stage: { status: 'success' } };
const next = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: 'https://new.workspacex-home.pages.dev', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha } } };
function fixture({ badDomain = false, smokeFails = false, wrongPublicSha = false, competingPublisher = false, sameShaPublisher = false, noOwnId = false, propagationDelay = false, lastMarkerReplacement = null } = {}) {
  let current = old;
  const calls = [], records = [];
  let releaseReads = 0;
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.method]);
    if (url.endsWith('/rollback')) current = old;
    if (url.includes('/workspacex-release.json')) {
      releaseReads++;
      if (releaseReads === 2 && lastMarkerReplacement) current = { ...next, ...lastMarkerReplacement };
      return Response.json({ commit: wrongPublicSha || (propagationDelay && releaseReads <= 2) ? 'b'.repeat(40) : sha });
    }
    return Response.json({ success: true, result: { name: 'workspacex-home', production_branch: 'main', domains: [badDomain ? (typeof badDomain === 'string' ? badDomain : 'other.example') : 'workspacex.us'], canonical_deployment: current } });
  };
  const run = (command, args, options) => {
    assert.equal(options.killSignal, 'SIGKILL');
    assert.ok(options.timeout > 0 && options.timeout <= (command === 'npm' ? 300000 : 120000));
    if (command === 'npm') {
      if (!noOwnId) writeFileSync(options.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({ type: 'pages-deploy', version: 1, pages_project: 'workspacex-home', deployment_id: next.id, url: next.url }) + '\n');
      current = competingPublisher ? { ...next, deployment_trigger: { metadata: { commit_hash: 'c'.repeat(40) } } } : sameShaPublisher ? { ...next, id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' } : next;
      assert.ok(args.includes('--commit-hash')); assert.ok(args.includes(sha)); assert.ok(args.includes('workspacex-home')); return { status: 0 };
    }
    return { status: smokeFails ? 1 : 0 };
  };
  return { fetchImpl, run, pause: async () => {}, output: '/fixture', record: r => records.push(structuredClone(r)), calls, records };
}

test('PRs, non-main refs and wrong account never reach Cloudflare', async () => {
  for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/dev' }, { CLOUDFLARE_ACCOUNT_ID: 'wrong' }]) {
    await assert.rejects(cutover({ env: { ...env, ...change }, fetchImpl: () => { throw new Error('must not contact Cloudflare'); } }), /production requires|identity/);
  }
});
test('domain mismatch refuses to publish', async () => {
  for (const badDomain of [true, 'www.boardx.us', 'boardx.us']) {
    const f = fixture({ badDomain }); await assert.rejects(cutover({ env, ...f }), /mismatch/); assert.equal(f.calls.length, 1);
  }
});
test('success records exact SHA, new deployment and previous rollback target', async () => {
  const f = fixture(); const result = await cutover({ env, ...f }); assert.equal(result.status, 'verified'); assert.equal(result.previous_deployment, old.id); assert.equal(result.deployment_id, next.id); assert.equal(result.commit, sha);
});
for (const scenario of [{ smokeFails: true }, { wrongPublicSha: true }]) test(`failed verification rolls back own deployment: ${JSON.stringify(scenario)}`, async () => {
  const f = fixture(scenario); await assert.rejects(cutover({ env, ...f })); assert.ok(f.calls.some(([url, method]) => url.endsWith(`/${old.id}/rollback`) && method === 'POST')); assert.equal(f.records.at(-1).rollback, old.id);
});
test('a competing publisher is never rolled back', async () => {
  const f = fixture({ competingPublisher: true }); await assert.rejects(cutover({ env, ...f }), /not confirmed/); assert.ok(!f.calls.some(([url]) => url.endsWith('/rollback')));
});
test('a different publisher of the same SHA and another deployment ID is never rolled back', async () => {
  const f = fixture({ sameShaPublisher: true }); await assert.rejects(cutover({ env, ...f }), /not confirmed/); assert.ok(!f.calls.some(([url]) => url.endsWith('/rollback')));
});
test('unknown own deployment ID fails closed without rollback', async () => {
  const f = fixture({ noOwnId: true }); await assert.rejects(cutover({ env, ...f }), /own deployment ID unavailable/); assert.ok(!f.calls.some(([url]) => url.endsWith('/rollback')));
});
test('packaging rejects a real dirty tracked home source from its nested working directory', () => {
  const repo = mkdtempSync(join(tmpdir(), 'home-package-test-'));
  try {
    const home = join(repo, 'apps/home'); mkdirSync(join(home, 'scripts'), { recursive: true });
    const script = join(home, 'scripts/package-pages.mjs'); writeFileSync(script, readFileSync(new URL('../scripts/package-pages.mjs', import.meta.url)));
    const index = join(home, 'index.html'); writeFileSync(index, '<link rel="canonical" href="https://workspacex.us/">');
    const git = args => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git(['init']); git(['add', 'apps/home']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    writeFileSync(index, readFileSync(index, 'utf8') + '\nDirty tracked edit');
    const fixtureSha = git(['rev-parse', 'HEAD']).toString().trim();
    const result = spawnSync(process.execPath, [script, join(repo, 'package')], { cwd: home, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: fixtureSha } });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /tracked home sources are dirty/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
test('workflow permits production only for main push, validates first, retains evidence', () => {
  const source = readFileSync(new URL('../../../.github/workflows/deploy-home.yml', import.meta.url), 'utf8');
  assert.match(source, /branches: \[main\]/); assert.match(source, /needs: validate/); assert.match(source, /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/); assert.match(source, /ref: \$\{\{ github.sha \}\}/); assert.match(source, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/); assert.ok(!source.includes('workflow_dispatch')); assert.ok(!source.includes('pull_request_target'));
  const paths = [...source.matchAll(/^      - '([^']+)'$/gm)].map(m => m[1]);
  const triggers = path => paths.some(pattern => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
  for (const path of ['apps/home/index.html', 'apps/home/assets/js/main.js', 'apps/web/public/workspacex-logo.png', '.github/workflows/deploy-home.yml']) assert.ok(triggers(path), path);
  for (const path of ['apps/api/src/index.ts', 'apps/web/components/interview.tsx', 'docs/reports/notes.md', 'pnpm-lock.yaml']) assert.ok(!triggers(path), path);
});

test('custom-domain propagation retries within a bounded budget before success', async () => {
  const f = fixture({ propagationDelay: true }); const result = await cutover({ env, ...f });
  assert.equal(result.status, 'verified'); assert.equal(f.calls.filter(([url]) => url.includes('/workspacex-release.json')).length, 4);
});

for (const replacement of [
  { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
  { deployment_trigger: { metadata: { commit_hash: 'c'.repeat(40) } } },
  { latest_stage: { status: 'failure' } },
]) test(`last marker concurrent production mutation cannot report verified: ${JSON.stringify(replacement)}`, async () => {
  const f = fixture({ lastMarkerReplacement: replacement });
  await assert.rejects(cutover({ env, ...f }), /changed after public verification/);
  assert.ok(!f.records.some(r => r.status === 'verified'));
  if (replacement.id || replacement.deployment_trigger) assert.ok(!f.calls.some(([url]) => url.endsWith('/rollback')));
});
test('shared verification deadline expires across origins and preserves rollback budget', async () => {
  const f = fixture(); let clock = 0, markerReads = 0;
  const fetchImpl = async (url, init) => {
    const response = await f.fetchImpl(url, init);
    if (url.includes('/workspacex-release.json')) { markerReads++; clock += 210001; }
    return response;
  };
  await assert.rejects(cutover({ env, ...f, fetchImpl, now: () => clock }), /deadline exhausted/);
  assert.equal(markerReads, 2);
  assert.equal(f.records.at(-1).rollback, old.id);
  assert.ok(!f.records.some(r => r.status === 'verified'));
});

test('synchronous subprocess receives remaining shared budget and hard termination', async () => {
  const f = fixture(); let clock = 0; const timeouts = [];
  const run = (command, args, options) => {
    timeouts.push([command, options.timeout, options.killSignal]);
    const result = f.run(command, args, options);
    clock += command === 'npm' ? 350000 : 0;
    return result;
  };
  await cutover({ env, ...f, run, now: () => clock });
  assert.deepEqual(timeouts, [['npm', 300000, 'SIGKILL'], [process.execPath, 70000, 'SIGKILL']]);
});

test('wall clock rollback cannot extend the production deadline or rollback reserve', async () => {
  const original = Date.now;
  let wall = original(), wallReads = 0;
  Date.now = () => { wallReads++; return wall; };
  try {
    const f = fixture(); const timeouts = [];
    const run = (command, args, options) => {
      timeouts.push(options.timeout);
      wall -= 3600000; // Simulate an NTP/system-clock correction during deploy.
      return f.run(command, args, options);
    };
    const result = await cutover({ env, ...f, run });
    assert.equal(result.status, 'verified');
    assert.equal(wallReads, 0, 'elapsed deadline must never consult the wall clock');
    assert.ok(timeouts[0] <= 300000 && timeouts[1] <= 120000);
  } finally { Date.now = original; }
});

/* Domain migration must not weaken redirect loop detection. */

const redirected = location => new Response(null, { status: 301, headers: { location } });
test('same path across domains is valid; repeated full URL is a loop', async () => {
  const source = 'https://www.boardx.us/privacy?next=%2Fmanual%2F';
  const target = 'https://workspacex.us/privacy?next=%2Fmanual%2F';
  const success = await resolveRedirects(source, { fetchImpl: async url => url === source ? redirected(target) : new Response('ok') });
  assert.equal(success.res.status, 200); assert.equal(success.url, target); assert.equal(success.chain.length, 2);
  const loop = await resolveRedirects(source, { fetchImpl: async url => redirected(url === source ? target : source) });
  assert.equal(loop.loop, source);
});
test('query changes are distinct URLs; relative loops and hop budget remain failures', async () => {
  const result = await resolveRedirects('https://workspacex.us/?a=1', { fetchImpl: async url => url.endsWith('a=1') ? redirected('?a=2') : new Response('ok') });
  assert.equal(result.res.status, 200);
  const loop = await resolveRedirects('https://workspacex.us/a', { fetchImpl: async () => redirected('/a') });
  assert.equal(loop.loop, 'https://workspacex.us/a');
  let count = 0;
  const exhausted = await resolveRedirects('https://workspacex.us/a', { fetchImpl: async () => redirected(`/hop${++count}`) });
  assert.equal(exhausted.tooMany, true); assert.equal(count, 4);
});
test('domain verification rejects lost path/query, temporary redirects and target loops', async () => {
  const source = 'https://boardx.us/manual/?utm_source=test&next=%2Fprivacy';
  const target = 'https://workspacex.us/manual/?utm_source=test&next=%2Fprivacy';
  await verifyDomainRedirect(source, 'https://workspacex.us', { fetchImpl: async url => url === source ? redirected(target) : new Response('ok') });
  for (const location of ['https://workspacex.us/', 'https://workspacex.us/manual/', 'https://devapp.boardx.us/manual/?utm_source=test&next=%2Fprivacy']) {
    await assert.rejects(verifyDomainRedirect(source, 'https://workspacex.us', { fetchImpl: async () => redirected(location) }), /path\/query/);
  }
  await assert.rejects(verifyDomainRedirect(source, 'https://workspacex.us', { fetchImpl: async () => new Response(null, { status: 302, headers: { location: target } }) }), /permanent/);
  await assert.rejects(verifyDomainRedirect(source, 'https://workspacex.us', { fetchImpl: async () => redirected(target) }), /target failed/);
});

test('publication verifies the new custom domain, not just the deployment URL', async () => {
  const f = fixture(); await cutover({ env, ...f });
  assert.ok(f.calls.some(([url]) => url.startsWith('https://workspacex.us/.well-known/workspacex-release.json')));
  assert.ok(!f.calls.some(([url]) => url.startsWith('https://www.boardx.us/')));
});

for (const [name, finalURL] of [
  ['query removed', 'https://workspacex.us/manual/'],
  ['old domain returned', 'https://www.boardx.us/manual/?next=%2Fprivacy'],
  ['HTTPS downgraded', 'http://workspacex.us/manual/?next=%2Fprivacy'],
]) test(`domain verification rejects a later 200 after ${name}`, async () => {
  const source = 'https://boardx.us/manual/?next=%2Fprivacy';
  const target = 'https://workspacex.us/manual/?next=%2Fprivacy';
  const requested = [];
  await assert.rejects(verifyDomainRedirect(source, 'https://workspacex.us', { fetchImpl: async url => {
    requested.push(url);
    return url === source ? redirected(target) : url === target ? redirected(finalURL) : new Response('ok');
  } }), /path\/query or target origin changed in redirect chain/);
  assert.deepEqual(requested, [source, target], 'reject before requesting the changed URL');
});
test('domain verification preserves encoded paths and query byte representation', async () => {
  const source = 'https://www.boardx.us/manual/a%2Fb%20c?next=%2Fprivacy&tag=a%2Bb&tag=c';
  const target = 'https://workspacex.us/manual/a%2Fb%20c?next=%2Fprivacy&tag=a%2Bb&tag=c';
  const requested = [];
  await verifyDomainRedirect(source, 'https://workspacex.us', { fetchImpl: async url => {
    requested.push(url); return url === source ? redirected(target) : new Response('ok');
  } });
  assert.deepEqual(requested, [source, target]);
  await assert.rejects(verifyDomainRedirect(source, 'http://workspacex.us'), /HTTPS/);
});
