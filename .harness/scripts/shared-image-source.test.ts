import { it as test } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { selectSharedImageSource } from './shared-image-source.mjs';
const sha = 'a'.repeat(40);
const repo = 'boardx/workspacex';
const completed = () => ({ workflow_run: {
  event: 'push', path: '.github/workflows/backend-gates.yml', head_sha: sha,
  head_branch: 'develop', head_repository: { full_name: repo },
  status: 'completed', conclusion: 'success',
} });
test('only successful develop push validation can produce shared images', () => {
  assert.equal(selectSharedImageSource('workflow_run', completed(), repo, 'refs/heads/develop'), sha);
  for (const [key, value] of [['event', 'pull_request'], ['head_branch', 'main-cn'],
    ['conclusion', 'failure'], ['conclusion', 'cancelled'], ['conclusion', 'skipped'],
    ['status', 'in_progress'], ['head_sha', 'develop'], ['path', '.github/workflows/other.yml'],
    ['head_repository', { full_name: 'foreign/repo' }]]) {
    const event = completed(); event.workflow_run[key] = value;
    assert.throws(() => selectSharedImageSource('workflow_run', event, repo, 'refs/heads/develop'), /SHARED_IMAGE_SOURCE_REJECTED/);
  }
});
test('manual build requires exact source and develop workflow; no PR or tag writes', () => {
  assert.equal(selectSharedImageSource('workflow_dispatch', { inputs: { source_sha: sha } }, repo, 'refs/heads/develop'), sha);
  for (const [event, payload, ref] of [
    ['workflow_dispatch', { inputs: { source_sha: 'develop' } }, 'refs/heads/develop'],
    ['workflow_dispatch', { inputs: { source_sha: sha } }, 'refs/heads/main-cn'],
    ['workflow_dispatch', { inputs: { source_sha: sha } }, 'refs/tags/v1'],
    ['pull_request', completed(), 'refs/heads/develop'],
    ['workflow_run', {}, 'refs/heads/develop'],
  ]) assert.throws(() => selectSharedImageSource(event, payload, repo, ref), /SHARED_IMAGE_SOURCE_REJECTED/);
});

test('one producer is reused; no deployment or alternate build is introduced', () => {
  const workflow = parse(readFileSync('.github/workflows/shared-release-images.yml', 'utf8'));
  assert.deepEqual(workflow.on.workflow_run.workflows, ['backend-gates']);
  assert.deepEqual(workflow.on.workflow_run.branches, ['develop']);
  assert.equal(workflow.jobs.build.uses, './.github/workflows/build-cn-release-artifacts.yml');
  assert.equal(workflow.jobs.build.with.source_branch, 'develop');
  assert.equal(workflow.jobs.build.with.release_sha, '${{ needs.admit.outputs.source_sha }}');
  assert.match(workflow.jobs.admit.if, /WSX_SHARED_IMAGES_ENABLED/);
  assert.match(workflow.jobs.admit.if, /conclusion == 'success'/);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['admit', 'build']);
  const producer = parse(readFileSync('.github/workflows/build-cn-release-artifacts.yml', 'utf8'));
  assert.equal(producer.on.workflow_call.inputs.source_branch.default, 'main');
  assert.equal(producer.jobs.validate.steps.find(step => step.id === 'plan').env.SOURCE_BRANCH,
    '${{ inputs.source_branch }}');
});

test('manual and automatic builds recheck the latest backend attempt read-only', async () => {
  const { admitSharedImageSource } = await import('./shared-image-source.mjs');
  const good = { ...completed().workflow_run, id: 12, workflow_id: 9, run_attempt: 2 };
  const manual = { inputs: { source_sha: sha } };
  const api = (run: typeof good | null) => async (path: string) => {
    if (path === '/actions/workflows/backend-gates.yml') return { id: 9, path: '.github/workflows/backend-gates.yml', state: 'active' };
    if (path.includes('/runs?')) return { total_count: run ? 1 : 0, workflow_runs: run ? [run] : [] };
    return run;
  };
  assert.equal(await admitSharedImageSource('workflow_dispatch', manual, repo, 'refs/heads/develop', api(good)), sha);
  for (const run of [null, { ...good, conclusion: 'failure' }, { ...good, status: 'in_progress' },
    { ...good, conclusion: 'cancelled' }, { ...good, workflow_id: 8 }]) {
    await assert.rejects(() => admitSharedImageSource('workflow_dispatch', manual, repo, 'refs/heads/develop', api(run)), /SHARED_IMAGE/);
  }
  await assert.rejects(() => admitSharedImageSource('workflow_run', { workflow_run: good }, repo,
    'refs/heads/develop', api({ ...good, run_attempt: 3 })), /SHARED_IMAGE/);
});
