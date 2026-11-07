/** Read-only admission of the exact develop integration run before Devapp writes. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLookupApi } from './ci-lane-dedup.mjs';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';

export const SOURCE_VERIFICATION_PROFILES = {
  legacy_push: [
    {workflowPath: '.github/workflows/harness-verify.yml', checks: ['verify-control-plane', 'verify-affected', 'verify-full-compile', 'full-regression-core', 'e2e-full']},
    {workflowPath: '.github/workflows/backend-gates.yml', checks: ['gates-fast', 'gates-runtime', 'e2e-core-loop']},
  ],
  push: [
    {workflowPath: '.github/workflows/harness-verify.yml', checks: ['verify-control-plane', 'verify-affected']},
    {workflowPath: '.github/workflows/harness-acceptance.yml', checks: ['verify-full-compile', 'full-regression-core', 'e2e-full']},
    {workflowPath: '.github/workflows/backend-gates.yml', checks: ['gates-fast', 'gates-runtime', 'e2e-core-loop']},
  ],
  merge_group: [
    {workflowPath: '.github/workflows/harness-verify.yml', checks: ['verify-control-plane', 'verify-affected', 'verify-full-compile']},
    {workflowPath: '.github/workflows/harness-acceptance.yml', checks: ['full-regression-core', 'e2e-full', 'queue-ready']},
    {workflowPath: '.github/workflows/backend-gates.yml', checks: ['gates-fast', 'gates-runtime', 'e2e-core-loop']},
  ],
};
export const SOURCE_VERIFICATION_EVENT = CURRENT_POLICY.sourceVerificationEvent ?? 'push';
export const INTEGRATION_WORKFLOWS = SOURCE_VERIFICATION_PROFILES[SOURCE_VERIFICATION_EVENT];
export const INTEGRATION_CHECKS = SOURCE_VERIFICATION_PROFILES.push[1].checks;
const WORKFLOW = '.github/workflows/harness-acceptance.yml';
export const sourceBranchMatches = (branch,event) => event === 'push' ? branch === 'develop' : event === 'merge_group' && /^gh-readonly-queue\/develop\/pr-[1-9]\d*-[a-f0-9]{7,40}$/.test(branch ?? '');
// Numeric tags are emitted only by the image-release producer. Resolve the original
// build attempt and require successful exact-source admission plus all five builds.
// A later deploy-only retry may authorize the same bytes; it cannot mint new bytes.
export async function resolveVerifiedTagSource(api, tag) {
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(tag ?? '');
  if (!match || !match.slice(1).every(x=>Number.isSafeInteger(Number(x)))) throw Error('DEVAPP_TAG_SOURCE_UNVERIFIED');
  const runId=Number(match[1]), buildAttempt=Number(match[2]);
  const workflow=await api('/actions/workflows/image-release.yml');
  const current=await api(`/actions/runs/${runId}`);
  const original=await api(`/actions/runs/${runId}/attempts/${buildAttempt}`);
  const valid = run => run.id===runId && run.workflow_id===workflow.id && run.path==='.github/workflows/image-release.yml' && run.head_branch==='develop' && ['push','workflow_dispatch'].includes(run.event) && /^[a-f0-9]{40}$/.test(run.head_sha ?? '');
  if (!Number.isSafeInteger(workflow.id) || workflow.path!=='.github/workflows/image-release.yml' || workflow.state!=='active' || !valid(current) || !valid(original) || current.head_sha!==original.head_sha || original.run_attempt!==buildAttempt || !Number.isSafeInteger(current.run_attempt) || current.run_attempt<buildAttempt || current.status!=='completed' || current.conclusion!=='success') throw Error('DEVAPP_TAG_PRODUCER_UNVERIFIED');
  const response=await api(`/actions/runs/${runId}/attempts/${buildAttempt}/jobs?per_page=100`);
  if (!Array.isArray(response.jobs) || response.total_count!==response.jobs.length || response.total_count>100) throw Error('DEVAPP_TAG_JOBS_UNVERIFIED');
  for (const name of ['plan','admission','manifest','build (api)','build (web)','build (agent)','build (sandbox)','build (postgres)']) {
    const rows=response.jobs.filter(j=>j.name===name);
    if(rows.length!==1 || rows[0].run_id!==runId || rows[0].head_sha!==current.head_sha || rows[0].run_attempt!==buildAttempt || rows[0].status!=='completed' || rows[0].conclusion!=='success') throw Error('DEVAPP_TAG_JOBS_UNVERIFIED');
  }
  if (current.run_attempt!==buildAttempt) {
    const retry=await api(`/actions/runs/${runId}/attempts/${current.run_attempt}/jobs?per_page=100`);
    if (!Array.isArray(retry.jobs) || retry.total_count!==retry.jobs.length || retry.total_count>100) throw Error('DEVAPP_TAG_RETRY_UNVERIFIED');
    for (const job of retry.jobs) {
      if(job.run_id!==runId || job.run_attempt!==current.run_attempt || job.head_sha!==current.head_sha || job.status!=='completed' || !['success','skipped'].includes(job.conclusion)) throw Error('DEVAPP_TAG_RETRY_UNVERIFIED');
    }
    const deploy=retry.jobs.filter(j=>j.name==='deploy');
    if(deploy.length!==1 || deploy[0].conclusion!=='success') throw Error('DEVAPP_TAG_RETRY_UNVERIFIED');
  }
  const after=await api(`/actions/runs/${runId}`);
  if(after.run_attempt!==current.run_attempt || after.status!=='completed' || after.conclusion!=='success' || after.head_sha!==current.head_sha) throw Error('INTEGRATION_ATTEMPT_CHANGED');
  return {sha:original.head_sha,runId,attempt:current.run_attempt};
}
export function assertReleaseSource({event, ref, sha, tag, verifiedTag}) {
  if (!['push', 'workflow_dispatch'].includes(event) || ref !== 'refs/heads/develop' || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('DEVELOP_SOURCE_REQUIRED');
  // Existing tags need their own trusted source manifest, never today's branch green.
  if (event === 'workflow_dispatch' && tag && (!verifiedTag || !/^[a-f0-9]{40}$/.test(verifiedTag.sha ?? ''))) throw new Error('DEVAPP_TAG_SOURCE_UNVERIFIED');
}
export function integrationVerdict(run, jobs, { sha, workflowId, since, workflowPath = WORKFLOW, checks = INTEGRATION_CHECKS, event = 'push', allowRunning = false }) {
  if (!run) return { state: 'pending', reason: 'integration_run_not_created' };
  if (run.head_sha !== sha || run.event !== event || !sourceBranchMatches(run.head_branch,event) || run.workflow_id !== workflowId || run.path !== workflowPath || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || !Number.isFinite(Date.parse(run.created_at)) || Date.parse(run.created_at) < since) throw new Error('INTEGRATION_IDENTITY_MISMATCH');
  if (!Array.isArray(jobs)) throw new Error('INVALID_INTEGRATION_JOBS');
  for (const name of checks) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length > 1) throw new Error('AMBIGUOUS_INTEGRATION_CHECK');
    const job = matches[0];
    if (job && (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== sha)) throw new Error('INTEGRATION_JOB_IDENTITY_MISMATCH');
    if (job?.status === 'completed' && job.conclusion !== 'success') return { state: 'failure', reason: name };
    if (run.status === 'completed' && (!job || job.status !== 'completed')) return { state: 'failure', reason: `missing_${name}` };
  }
  if (allowRunning && run.status === 'in_progress' && run.conclusion === null && checks.every(name => jobs.some(j=>j.name===name && j.status==='completed' && j.conclusion==='success'))) return {state:'success',reason:'selected_source_checks_passed'};
  if (run.status === 'completed') return run.conclusion === 'success'
    ? { state: 'success', reason: 'exact_integration_passed' }
    : { state: 'failure', reason: 'integration_workflow_failed' };
  return { state: 'pending', reason: 'integration_still_running' };
}

export async function inspectIntegration(api, { sha, since, workflowPath = WORKFLOW, checks = INTEGRATION_CHECKS, event = 'push', allowRunning = false }) {
  const workflow = await api(`/actions/workflows/${workflowPath.split('/').at(-1)}`);
  if (!Number.isSafeInteger(workflow.id) || workflow.path !== workflowPath || workflow.state !== 'active') throw new Error('INVALID_INTEGRATION_WORKFLOW');
  const response = await api(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=${event}&per_page=100`);
  if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count) || response.total_count > 100) throw new Error('INVALID_INTEGRATION_RUN_LIST');
  const runs = response.workflow_runs.filter(run => run.event === event && sourceBranchMatches(run.head_branch,event) && run.head_sha === sha && Date.parse(run.created_at) >= since);
  if (runs.some(run => !Number.isSafeInteger(run.id))) throw new Error('INVALID_INTEGRATION_RUN_ID');
  const run = runs.sort((a, b) => b.id - a.id)[0];
  if (!run) return { state: 'pending', reason: 'integration_run_not_created' };
  // Attempt-scoped jobs prevent old green attempts from authorizing a failed rerun.
  const jobs = await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs.jobs) || !Number.isInteger(jobs.total_count) || jobs.total_count > 100) throw new Error('INVALID_INTEGRATION_JOB_LIST');
  const identity = { sha, workflowId: workflow.id, since, workflowPath, checks, event, allowRunning };
  const verdict = integrationVerdict(run, jobs.jobs, identity);
  if (verdict.state !== 'success') return verdict;
  const current = await api(`/actions/runs/${run.id}`);
  if (current.id !== run.id || current.run_attempt !== run.run_attempt) throw new Error('INTEGRATION_ATTEMPT_CHANGED');
  return integrationVerdict(current, jobs.jobs, identity);
}

export async function waitForIntegration({ apiFactory, sha, since, clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), budgetMs = 55 * 60_000, mode = SOURCE_VERIFICATION_EVENT, onlyCompile = false, onlyControlPlane = false }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !Number.isFinite(since) || budgetMs < 1 || budgetMs > 55 * 60_000) throw new Error('INVALID_INTEGRATION_ADMISSION');
  if (!Object.hasOwn(SOURCE_VERIFICATION_PROFILES,mode)) throw new Error('INVALID_SOURCE_EVENT');
  const specs = onlyCompile || onlyControlPlane ? [{workflowPath:'.github/workflows/harness-verify.yml',checks:[onlyControlPlane?'verify-control-plane':'verify-full-compile'],allowRunning:true}] : SOURCE_VERIFICATION_PROFILES[mode];
  const deadline = clock() + budgetMs;
  let previous;
  while (clock() < deadline) {
    const verdicts = await Promise.all(specs.map(spec => inspectIntegration(apiFactory(), {sha, since, event:mode==='legacy_push'?'push':mode, ...spec})));
    const verdict = verdicts.find(v => v.state === 'failure') ?? verdicts.find(v => v.state !== 'success') ?? {state: 'success', reason: 'exact_integration_passed'};
    if (clock() >= deadline) break;
    if (verdict.state === 'success') return verdict;
    if (verdict.state === 'failure') throw new Error(`INTEGRATION_REJECTED:${verdict.reason}`);
    if (verdict.reason !== previous) console.log(`Waiting for exact-source integration: ${verdict.reason}`);
    previous = verdict.reason;
    await sleep(Math.min(15_000, Math.max(0, deadline - clock())));
  }
  throw new Error('INTEGRATION_ADMISSION_TIMEOUT');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const apiFactory = () => createLookupApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
    const verifiedTag = process.env.GITHUB_EVENT_NAME==='workflow_dispatch' && process.env.CI_RELEASE_TAG ? await resolveVerifiedTagSource(apiFactory(),process.env.CI_RELEASE_TAG) : undefined;
    assertReleaseSource({event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,tag:process.env.CI_RELEASE_TAG,verifiedTag});
    const own = await apiFactory()(`/actions/runs/${process.env.GITHUB_RUN_ID}`);
    if (own.head_sha !== process.env.GITHUB_SHA || own.event !== process.env.GITHUB_EVENT_NAME || own.head_branch !== 'develop' || !Number.isFinite(Date.parse(own.created_at))) throw new Error('INVALID_DEPLOYMENT_RUN');
    if (!verifiedTag) await waitForIntegration({ apiFactory, sha: process.env.GITHUB_SHA, since: SOURCE_VERIFICATION_EVENT === 'push' && process.env.GITHUB_EVENT_NAME === 'push' ? Date.parse(own.created_at) - 60_000 : 0 });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Devapp admission: exact image source SHA ${verifiedTag?.sha ?? process.env.GITHUB_SHA}, current integration attempt passed.\n`);
    console.log('Exact-source integration admission passed');
  } catch (error) {
    // Only our fixed failure codes are logged; never provider bodies or credentials.
    const code = /^([A-Z_]+)(?::[a-z_-]+)?$/.test(error.message ?? '') ? error.message : 'INTEGRATION_ADMISSION_UNAVAILABLE';
    console.error(code); process.exitCode = 1;
  }
}
