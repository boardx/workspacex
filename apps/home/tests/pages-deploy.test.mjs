import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cutover } from '../scripts/deploy-pages.mjs';

const sha = 'a'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, CLOUDFLARE_ACCOUNT_ID: 'cc39c0447db8c730182cfd075fe91bf7', CLOUDFLARE_API_TOKEN: 'fixture-only' };
const old = { id: 'old', latest_stage: { status: 'success' } };
const next = { id: 'new', url: 'https://new.workspacex-home.pages.dev', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha } } };
function fixture({ badDomain = false, smokeFails = false, wrongPublicSha = false, competingPublisher = false } = {}) {
  let current = old;
  const calls = [], records = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.method]);
    if (url.endsWith('/rollback')) current = old;
    if (url.endsWith('/workspacex-release.json')) return Response.json({ commit: wrongPublicSha ? 'b'.repeat(40) : sha });
    return Response.json({ success: true, result: { name: 'workspacex-home', production_branch: 'main', domains: [badDomain ? 'other.example' : 'www.boardx.us'], canonical_deployment: current } });
  };
  const run = (command, args) => {
    if (command === 'npm') { current = competingPublisher ? { ...next, deployment_trigger: { metadata: { commit_hash: 'c'.repeat(40) } } } : next; assert.ok(args.includes('--commit-hash')); assert.ok(args.includes(sha)); assert.ok(args.includes('workspacex-home')); return { status: 0 }; }
    return { status: smokeFails ? 1 : 0 };
  };
  return { fetchImpl, run, output: '/fixture', record: r => records.push(structuredClone(r)), calls, records };
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
  const f = fixture(); const result = await cutover({ env, ...f }); assert.equal(result.status, 'verified'); assert.equal(result.previous_deployment, 'old'); assert.equal(result.deployment_id, 'new'); assert.equal(result.commit, sha);
});
for (const scenario of [{ smokeFails: true }, { wrongPublicSha: true }]) test(`failed verification rolls back own deployment: ${JSON.stringify(scenario)}`, async () => {
  const f = fixture(scenario); await assert.rejects(cutover({ env, ...f })); assert.ok(f.calls.some(([url, method]) => url.endsWith('/old/rollback') && method === 'POST')); assert.equal(f.records.at(-1).rollback, 'old');
});
test('a competing publisher is never rolled back', async () => {
  const f = fixture({ competingPublisher: true }); await assert.rejects(cutover({ env, ...f }), /not confirmed/); assert.ok(!f.calls.some(([url]) => url.endsWith('/rollback')));
});
test('workflow permits production only for main push, validates first, retains evidence', () => {
  const source = readFileSync(new URL('../../../.github/workflows/deploy-home.yml', import.meta.url), 'utf8');
  assert.match(source, /branches: \[main\]/); assert.match(source, /needs: validate/); assert.match(source, /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/); assert.match(source, /ref: \$\{\{ github.sha \}\}/); assert.match(source, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/); assert.ok(!source.includes('workflow_dispatch')); assert.ok(!source.includes('pull_request_target'));
  const paths = [...source.matchAll(/^      - '([^']+)'$/gm)].map(m => m[1]);
  const triggers = path => paths.some(pattern => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
  for (const path of ['apps/home/index.html', 'apps/home/assets/js/main.js', 'apps/web/public/workspacex-logo.png', '.github/workflows/deploy-home.yml']) assert.ok(triggers(path), path);
  for (const path of ['apps/api/src/index.ts', 'apps/web/components/interview.tsx', 'docs/reports/notes.md', 'pnpm-lock.yaml']) assert.ok(!triggers(path), path);
});
