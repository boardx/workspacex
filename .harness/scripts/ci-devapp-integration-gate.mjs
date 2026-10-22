/** Read-only admission of the exact develop integration run before Devapp writes. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLookupApi } from './ci-lane-dedup.mjs';

export const INTEGRATION_CHECKS = ['verify-control-plane', 'verify-affected', 'verify-full-compile', 'full-regression-core', 'e2e-full'];
const WORKFLOW = '.github/workflows/harness-verify.yml';
export function integrationVerdict(run, jobs, { sha, workflowId, since }) {
  if (!run) return { state: 'pending', reason: 'integration_run_not_created' };
  if (run.head_sha !== sha || run.event !== 'push' || run.head_branch !== 'develop' || run.workflow_id !== workflowId || run.path !== WORKFLOW || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || !Number.isFinite(Date.parse(run.created_at)) || Date.parse(run.created_at) < since) throw new Error('INTEGRATION_IDENTITY_MISMATCH');
  if (!Array.isArray(jobs)) throw new Error('INVALID_INTEGRATION_JOBS');
  for (const name of INTEGRATION_CHECKS) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length > 1) throw new Error('AMBIGUOUS_INTEGRATION_CHECK');
    const job = matches[0];
    if (job && (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== sha)) throw new Error('INTEGRATION_JOB_IDENTITY_MISMATCH');
    if (job?.status === 'completed' && job.conclusion !== 'success') return { state: 'failure', reason: name };
    if (run.status === 'completed' && (!job || job.status !== 'completed')) return { state: 'failure', reason: `missing_${name}` };
  }
  if (run.status === 'completed') return run.conclusion === 'success'
    ? { state: 'success', reason: 'exact_integration_passed' }
    : { state: 'failure', reason: 'integration_workflow_failed' };
  return { state: 'pending', reason: 'integration_still_running' };
}

export async function inspectIntegration(api, { sha, since }) {
  const workflow = await api('/actions/workflows/harness-verify.yml');
  if (!Number.isSafeInteger(workflow.id) || workflow.path !== WORKFLOW || workflow.state !== 'active') throw new Error('INVALID_INTEGRATION_WORKFLOW');
  const response = await api(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=push&per_page=100`);
  if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count) || response.total_count > 100) throw new Error('INVALID_INTEGRATION_RUN_LIST');
  const runs = response.workflow_runs.filter(run => run.event === 'push' && run.head_branch === 'develop' && run.head_sha === sha && Date.parse(run.created_at) >= since);
  if (runs.some(run => !Number.isSafeInteger(run.id))) throw new Error('INVALID_INTEGRATION_RUN_ID');
  const run = runs.sort((a, b) => b.id - a.id)[0];
  if (!run) return { state: 'pending', reason: 'integration_run_not_created' };
  // Attempt-scoped jobs prevent old green attempts from authorizing a failed rerun.
  const jobs = await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs.jobs) || !Number.isInteger(jobs.total_count) || jobs.total_count > 100) throw new Error('INVALID_INTEGRATION_JOB_LIST');
  const identity = { sha, workflowId: workflow.id, since };
  const verdict = integrationVerdict(run, jobs.jobs, identity);
  if (verdict.state !== 'success') return verdict;
  const current = await api(`/actions/runs/${run.id}`);
  if (current.id !== run.id || current.run_attempt !== run.run_attempt) throw new Error('INTEGRATION_ATTEMPT_CHANGED');
  return integrationVerdict(current, jobs.jobs, identity);
}

export async function waitForIntegration({ apiFactory, sha, since, clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), budgetMs = 55 * 60_000 }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !Number.isFinite(since) || budgetMs < 1 || budgetMs > 55 * 60_000) throw new Error('INVALID_INTEGRATION_ADMISSION');
  const deadline = clock() + budgetMs;
  let previous;
  while (clock() < deadline) {
    const verdict = await inspectIntegration(apiFactory(), { sha, since });
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
    if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/develop') throw new Error('DEVELOP_PUSH_REQUIRED');
    const apiFactory = () => createLookupApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
    const own = await apiFactory()(`/actions/runs/${process.env.GITHUB_RUN_ID}`);
    if (own.head_sha !== process.env.GITHUB_SHA || own.event !== 'push' || own.head_branch !== 'develop' || !Number.isFinite(Date.parse(own.created_at))) throw new Error('INVALID_DEPLOYMENT_RUN');
    await waitForIntegration({ apiFactory, sha: process.env.GITHUB_SHA, since: Date.parse(own.created_at) - 60_000 });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Devapp admission: exact develop SHA ${process.env.GITHUB_SHA}, current integration attempt passed.\n`);
    console.log('Exact-source integration admission passed');
  } catch (error) {
    // Only our fixed failure codes are logged; never provider bodies or credentials.
    const code = /^([A-Z_]+)(?::[a-z_-]+)?$/.test(error.message ?? '') ? error.message : 'INTEGRATION_ADMISSION_UNAVAILABLE';
    console.error(code); process.exitCode = 1;
  }
}
