import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, backendObligations } from './ci-promotion-lookup.mjs';
const sha = 'a'.repeat(40), tree = 'b'.repeat(40), base = 'c'.repeat(40);
const pr = { head: { sha, ref: 'develop', repo: { full_name: 'o/r' } }, base: { sha: base, ref: 'main', repo: { full_name: 'o/r' } } };
const input = { repository: 'o/r', sha, eventName: 'pull_request', event: { number: 1, pull_request: pr }, git: args => args[0] === 'diff' ? '' : tree, now: 10000 };
function api(path) {
  if (path === '/pulls/1') return pr;
  const harness = path.includes('harness-verify');
  if (path.includes('/workflows/') && !path.includes('/runs?')) return { id: harness ? 1 : 2, path: `.github/workflows/${harness ? 'harness-verify' : 'backend-gates'}.yml`, state: 'active' };
  const run = id => ({ id, run_attempt: 1, head_sha: sha, event: 'push', head_branch: 'develop', workflow_id: id, path: `.github/workflows/${id === 1 ? 'harness-verify' : 'backend-gates'}.yml`, status: 'completed', conclusion: 'success', created_at: new Date(1000).toISOString() });
  if (path.includes('/runs?')) return { workflow_runs: [run(harness ? 1 : 2)] };
  const id = Number(path.split('/')[3]);
  if (path.includes('/jobs?')) {
    const names = id === 1 ? ['verify-control-plane', 'verify-affected', 'verify-full-compile', 'full-regression-core', 'e2e-full'] : ['gates-fast', ...Array.from({length: 8}, (_,i) => `gates-test (${i+1})`), 'native-document-chain', 'native-runtime-lane', 'gates-runtime', 'e2e-core-loop', 'prototype-audit', 'design-loop-e2e'];
    return { total_count: names.length, jobs: names.map((name, i) => ({ id: i + 1, name, run_id: id, run_attempt: 1, head_sha: sha, status: 'completed', conclusion: 'success' })) };
  }
  if (path.includes('/artifacts?')) {
    const prefixes = id === 1 ? ['phase-01-fullstack-smoke-evidence-', 'phase-01-directory-smoke-evidence-', 'phase-01-board-smoke-evidence-', 'phase-01-e2e-full-evidence-', 'phase-01-chat-read-evidence-', 'phase-01-self-service-profile-evidence-'] : ['backend-gates-core-loop-evidence-', 'prototype-audit-', 'design-loop-e2e-'];
    return { total_count: prefixes.length, artifacts: prefixes.map(prefix => ({ name: `${prefix}${id}`, expired: false, expires_at: new Date(20000).toISOString() })) };
  }
  return run(id);
}
test('accepts complete independent evidence', async () => assert.equal((await lookup({ ...input, api })).reuse, true));
test('API errors fail closed', async () => assert.deepEqual(await lookup({ ...input, api: () => { throw Error('secret'); } }), { reuse: false, blocked: true }));
test('policy changes fail closed', async () => assert.equal((await lookup({ ...input, api, git: args => args[0] === 'diff' ? 'policy.mjs' : tree })).reuse, false));
for (const mode of ['missing', 'failed', 'attempt', 'expired', 'stale']) test(`${mode} evidence fails closed`, async () => {
  const modified = path => { const data = api(path); if (path.includes('/jobs?')) { if (mode === 'missing') data.jobs.pop(); if (mode === 'failed') data.jobs[0].conclusion = 'failure'; if (mode === 'attempt') data.jobs[0].run_attempt = 2; } if (mode === 'expired' && data.artifacts) data.artifacts[0].expired = true; if (mode === 'stale' && data.workflow_runs) data.workflow_runs[0].created_at = 'invalid'; return data; };
  assert.equal((await lookup({ ...input, api: modified })).reuse, false);
});
for (const mode of ['artifact-missing', 'artifact-ambiguous', 'duplicate-jobs', 'partial-matrix', 'workflow-disabled']) test(`${mode} rejected`, async () => {
  const modified = path => { const data = api(path); if (data.artifacts && mode === 'artifact-missing') data.artifacts = []; if (data.artifacts && mode === 'artifact-ambiguous') data.artifacts.push(data.artifacts[0]); if (data.jobs && mode === 'duplicate-jobs') data.jobs[1].id = data.jobs[0].id; if (data.jobs && mode === 'partial-matrix' && path.includes('/runs/2/')) { data.jobs.splice(1, 1); data.total_count--; } if (mode === 'workflow-disabled' && data.state) data.state = 'disabled'; return data; };
  assert.equal((await lookup({...input, api: modified})).reuse, false);
});
test('unrelated conditional skipped job permitted', async () => {
  const modified = path => { const data = api(path); if (data.jobs) { data.jobs.push({...data.jobs[0], id: 100, name: 'conditional', conclusion: 'skipped'}); data.total_count++; } return data; };
  assert.equal((await lookup({...input, api: modified})).reuse, true);
});
test('stale PR payload rejected', async () => assert.equal((await lookup({...input, api, event: {...input.event, pull_request: {...pr, head: {...pr.head, sha: base}}}})).reuse, false));

for (const mode of ['interleaved-rerun', 'new-failed-run']) test(`${mode} rejected at final admission`, async () => {
  let reads = 0;
  const modified = path => { const data = api(path); if (path.includes('backend-gates.yml/runs?')) reads++; if (reads && path === '/actions/runs/1' && mode === 'interleaved-rerun') { data.run_attempt = 2; data.status = 'in_progress'; data.conclusion = null; } if (reads && path.includes('harness-verify.yml/runs?') && mode === 'new-failed-run') { data.workflow_runs[0].id = 99; data.workflow_runs[0].conclusion = 'failure'; } return data; };
  assert.equal((await lookup({...input, api: modified})).reuse, false);
});
test('artifact count overflow rejected', async () => {
  assert.equal((await lookup({...input, api: path => { const data = api(path); if (data.artifacts) data.total_count = 101; return data; }})).reuse, false);
});

test('pending producer blocks promotion', async () => {
  const result = await lookup({...input, api: path => { const data = api(path); if (data.workflow_runs) { data.workflow_runs[0].status = 'in_progress'; data.workflow_runs[0].conclusion = null; } return data; }});
  assert.deepEqual(result, {reuse: false, blocked: true});
});
test('failed producer blocks promotion', async () => {
  const result = await lookup({...input, api: path => { const data = api(path); if (data.jobs) data.jobs[0].conclusion = 'failure'; return data; }});
  assert.deepEqual(result, {reuse: false, blocked: true});
});
test('changed policy permits full fallback', async () => {
  assert.deepEqual(await lookup({...input, api, git: args => args[0] === 'diff' ? 'changed' : tree}), {reuse: false});
});
test('changed tree permits full fallback', async () => {
  assert.deepEqual(await lookup({...input, api, git: args => args[0] === 'diff' ? '' : args[1] === `${sha}^{tree}` ? base : tree}), {reuse: false});
});

test('backend obligations come from the versioned aggregate policy', () => {
 const policy = {aggregates: {'backend-required': ['new-policy-gate']}};
 assert.deepEqual(backendObligations(policy), ['new-policy-gate']);
});
