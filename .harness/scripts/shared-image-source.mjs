import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLookupApi } from './ci-lane-dedup.mjs';

/** Build identity comes from the successful integration run, never a moving branch. */
export function selectSharedImageSource(eventName, event, repository, ref) {
  let sha;
  if (eventName === 'workflow_run') {
    const run = event?.workflow_run;
    if (run?.event === 'push' && run.path === '.github/workflows/backend-gates.yml' &&
        run.head_branch === 'develop' && run.head_repository?.full_name === repository &&
        run.status === 'completed' && run.conclusion === 'success') sha = run.head_sha;
  } else if (eventName === 'workflow_dispatch' && ref === 'refs/heads/develop') {
    sha = event?.inputs?.source_sha;
  }
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('SHARED_IMAGE_SOURCE_REJECTED');
  }
  return sha;
}

/** Event payloads can become stale after a rerun. Re-read the current attempt. */
export async function admitSharedImageSource(eventName, event, repository, ref, api) {
  const sha = selectSharedImageSource(eventName, event, repository, ref);
  const workflow = await api('/actions/workflows/backend-gates.yml');
  if (!Number.isSafeInteger(workflow?.id) || workflow.path !== '.github/workflows/backend-gates.yml' ||
      workflow.state !== 'active') throw new Error('SHARED_IMAGE_WORKFLOW_REJECTED');
  let original = event?.workflow_run;
  if (eventName === 'workflow_dispatch') {
    const response = await api(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=push&per_page=100`);
    if (!Array.isArray(response?.workflow_runs) || !Number.isInteger(response.total_count) ||
        response.total_count > 100 || response.total_count < 0) throw new Error('SHARED_IMAGE_RUN_LIST_REJECTED');
    const matches = response.workflow_runs.filter(run => run.head_sha === sha && run.head_branch === 'develop' && run.event === 'push');
    if (matches.some(run => !Number.isSafeInteger(run.id))) throw new Error('SHARED_IMAGE_RUN_LIST_REJECTED');
    original = matches.sort((a, b) => b.id - a.id)[0];
  }
  if (!Number.isSafeInteger(original?.id) || !Number.isSafeInteger(original.run_attempt) ||
      original.run_attempt < 1 || original.workflow_id !== workflow.id) throw new Error('SHARED_IMAGE_RUN_REJECTED');
  const current = await api(`/actions/runs/${original.id}`);
  if (current?.id !== original.id || current.workflow_id !== workflow.id ||
      current.run_attempt !== original.run_attempt ||
      selectSharedImageSource('workflow_run', { workflow_run: current }, repository, ref) !== sha) {
    throw new Error('SHARED_IMAGE_ATTEMPT_CHANGED');
  }
  return sha;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = await admitSharedImageSource(process.env.GITHUB_EVENT_NAME,
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    process.env.GITHUB_REPOSITORY, process.env.GITHUB_REF,
    createLookupApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }));
  appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${source}\n`);
}
