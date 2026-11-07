import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLookupApi } from './ci-lane-dedup.mjs';
import {sourceBranchMatches} from './ci-devapp-integration-gate.mjs';

/** Build identity comes from the successful integration run, never a moving branch. */
export function selectSharedImageSource(eventName, event, repository, ref, expectedEvent = 'push') {
  let sha;
  if (eventName === 'workflow_run') {
    const run = event?.workflow_run;
    if (run?.event === expectedEvent && run.path === '.github/workflows/backend-gates.yml' &&
        sourceBranchMatches(run.head_branch,expectedEvent) && run.head_repository?.full_name === repository &&
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
export async function admitSharedImageSource(eventName, event, repository, ref, api, expectedEvent = 'push') {
  if(!['push','merge_group'].includes(expectedEvent))throw Error('SHARED_IMAGE_SOURCE_REJECTED');
  const sha = selectSharedImageSource(eventName, event, repository, ref, expectedEvent);
  const workflow = await api('/actions/workflows/backend-gates.yml');
  if (!Number.isSafeInteger(workflow?.id) || workflow.path !== '.github/workflows/backend-gates.yml' ||
      workflow.state !== 'active') throw new Error('SHARED_IMAGE_WORKFLOW_REJECTED');
  let original = event?.workflow_run;
  if (eventName === 'workflow_dispatch') {
    const response = await api(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=${expectedEvent}&per_page=100`);
    if (!Array.isArray(response?.workflow_runs) || !Number.isInteger(response.total_count) ||
        response.total_count > 100 || response.total_count < 0) throw new Error('SHARED_IMAGE_RUN_LIST_REJECTED');
    const matches = response.workflow_runs.filter(run => run.head_sha === sha && sourceBranchMatches(run.head_branch,expectedEvent) && run.event === expectedEvent);
    if (matches.some(run => !Number.isSafeInteger(run.id))) throw new Error('SHARED_IMAGE_RUN_LIST_REJECTED');
    original = matches.sort((a, b) => b.id - a.id)[0];
  }
  if (!Number.isSafeInteger(original?.id) || !Number.isSafeInteger(original.run_attempt) ||
      original.run_attempt < 1 || original.workflow_id !== workflow.id) throw new Error('SHARED_IMAGE_RUN_REJECTED');
  const current = await api(`/actions/runs/${original.id}`);
  if (current?.id !== original.id || current.workflow_id !== workflow.id ||
      current.run_attempt !== original.run_attempt ||
      selectSharedImageSource('workflow_run', { workflow_run: current }, repository, ref, expectedEvent) !== sha) {
    throw new Error('SHARED_IMAGE_ATTEMPT_CHANGED');
  }
  return sha;
}

export async function readSourceEvent(repository,source,token,fetchImpl=fetch){
  if(repository!=='boardx/workspacex'||!/^[a-f0-9]{40}$/.test(source??''))throw Error('SHARED_IMAGE_SOURCE_REJECTED');
  const response=await fetchImpl(`https://api.github.com/repos/${repository}/contents/.harness/config/ci-check-policy.json?ref=${source}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('SHARED_IMAGE_POLICY_REJECTED');
  const body=await response.text();if(body.length>262144)throw Error('SHARED_IMAGE_POLICY_REJECTED');
  const file=JSON.parse(body);
  if(file.type!=='file'||file.path!=='.harness/config/ci-check-policy.json'||file.encoding!=='base64'||typeof file.content!=='string'||!/^[A-Za-z0-9+/=\s]+$/.test(file.content))throw Error('SHARED_IMAGE_POLICY_REJECTED');
  const policy=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
  const event=Object.hasOwn(policy,'sourceVerificationEvent')?policy.sourceVerificationEvent:'push';
  if(!['push','merge_group'].includes(event))throw Error('SHARED_IMAGE_POLICY_REJECTED');
  return event;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const selected=selectSharedImageSource(process.env.GITHUB_EVENT_NAME,event,process.env.GITHUB_REPOSITORY,process.env.GITHUB_REF);
  const mode=await readSourceEvent(process.env.GITHUB_REPOSITORY,selected,process.env.GH_TOKEN);
  const source = await admitSharedImageSource(process.env.GITHUB_EVENT_NAME,
    event,process.env.GITHUB_REPOSITORY, process.env.GITHUB_REF,
    createLookupApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }),mode);
  appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${source}\n`);
}
