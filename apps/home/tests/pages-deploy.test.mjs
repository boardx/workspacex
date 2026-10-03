import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cutover } from '../scripts/deploy-pages.mjs';

const sha = 'a'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, CLOUDFLARE_ACCOUNT_ID: 'cc39c0447db8c730182cfd075fe91bf7', CLOUDFLARE_API_TOKEN: 'fixture-only' };
const old = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', latest_stage: { status: 'success' } };
const next = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: 'https://new.workspacex-home.pages.dev', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha } } };
function fixture({ badDomain = false, smokeFails = false, wrongPublicSha = false, competingPublisher = false, sameShaPublisher = false, noOwnId = false, propagationDelay = false } = {}) {
  let current = old;
  const calls = [], records = [];
  let releaseReads = 0;
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.method]);
    if (url.endsWith('/rollback')) current = old;
    if (url.includes('/workspacex-release.json')) return Response.json({ commit: wrongPublicSha || (propagationDelay && releaseReads++ < 2) ? 'b'.repeat(40) : sha });
    return Response.json({ success: true, result: { name: 'workspacex-home', production_branch: 'main', domains: [badDomain ? 'other.example' : 'www.boardx.us'], canonical_deployment: current } });
  };
  const run = (command, args, options) => {
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
  const f = fixture({ badDomain: true }); await assert.rejects(cutover({ env, ...f }), /mismatch/); assert.equal(f.calls.length, 1);
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
    const index = join(home, 'index.html'); writeFileSync(index, '<link rel="canonical" href="https://www.boardx.us/">');
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
