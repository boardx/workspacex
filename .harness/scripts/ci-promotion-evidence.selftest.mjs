import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionIdentity, workflowEvidence } from './ci-promotion-evidence.mjs';
const sha = 'a'.repeat(40), tree = 'b'.repeat(40);
const pr = { head: { ref: 'develop', sha, repo: { full_name: 'o/r' } }, base: { ref: 'main', repo: { full_name: 'o/r' } } };
const input = { eventName: 'pull_request', repository: 'o/r', sha, event: { pull_request: pr }, candidateTree: tree, sourceTree: tree, mergeTree: tree, policyUnchanged: true };
test('only identical trusted same-repository promotion is admissible', () => {
  assert.deepEqual(promotionIdentity(input), { sourceSha: sha, target: 'main' });
  for (const patch of [{ policyUnchanged: false }, { mergeTree: sha }, { candidateTree: sha }, { eventName: 'merge_group' }, { event: { pull_request: { ...pr, head: { ...pr.head, repo: { full_name: 'fork/r' } } } } }]) assert.equal(promotionIdentity({ ...input, ...patch }), null);
});
test('current-attempt successful evidence cannot be skipped, stale or rerun', () => {
  const run = { id: 1, run_attempt: 2, head_sha: sha, event: 'push', head_branch: 'develop', workflow_id: 3, path: 'workflow', status: 'completed', conclusion: 'success', created_at: new Date(1000).toISOString() };
  const job = { name: 'required', run_id: 1, run_attempt: 2, head_sha: sha, status: 'completed', conclusion: 'success' };
  const evidence = { run, currentRun: { ...run }, jobs: [job], required: ['required'], workflowId: 3, path: 'workflow', sourceSha: sha, now: 2000 };
  assert.equal(workflowEvidence(evidence), true);
  for (const patch of [{ jobs: [] }, { jobs: [{ ...job, conclusion: 'skipped' }] }, { jobs: [{ ...job, run_attempt: 1 }] }, { currentRun: { ...run, run_attempt: 3 } }, { now: 100000000 }]) assert.equal(workflowEvidence({ ...evidence, ...patch }), false);
});
