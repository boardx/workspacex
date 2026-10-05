/** Bootstrap facts are independently read, but the in-progress pilot has NO final authority. */
import { githubPages } from './ci-candidate-github.mjs';

export const PILOT_WORKFLOW_PATH = '.github/workflows/ci-candidate-runtime-pilot.yml';
export const PILOT_JOB_NAME = 'protected-pilot';
export const PILOT_SUPERVISOR_STEP = 'Start trusted runtime supervisor';
const SHA = /^[a-f0-9]{40}$/;
const integer = value => Number.isSafeInteger(value) && value > 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
const requireFact = (value, reason) => { if (!value) { const error = new Error(reason); error.reason = reason; throw error; } };

function runIdentity(run, repository, options) {
  requireFact(run?.repository?.id === repository.id && run.repository.full_name === repository.full_name && run.head_repository?.id === repository.id && run.head_repository.full_name === repository.full_name, 'pilot_foreign_repository');
  requireFact(run.id === options.runId && run.run_attempt === options.runAttempt && integer(run.workflow_id) && run.path === PILOT_WORKFLOW_PATH, 'pilot_run_or_attempt_mismatch');
  requireFact(run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.head_sha === options.expectedSha && run.status === 'in_progress' && run.conclusion === null, 'pilot_run_not_protected_main_dispatch');
  requireFact(validTime(run.run_started_at) && Date.parse(run.run_started_at) <= options.now, 'pilot_run_time_invalid');
}

/**
 * apiBootstrapVerified refers only to the protected controller start identity.
 * apiVerified/protectedVerified remain false until an external observer checks
 * the completed protected job, actual receipt/artifact digest and execution facts.
 * No code, Git fetch, dependency install, container or artifact read happens here.
 */
export async function verifyPilotBootstrap(input = {}) {
  const result = { schemaVersion: 1, bootstrapVerified: false, apiVerified: false, protectedVerified: false, runFull: true, skip: false, reasons: [], authority: null, repository: null };
  try {
    const options = { now: Date.now(), ...input };
    const { api, repositoryName, actualCheckout, expectedSha, runnerName } = options;
    requireFact(typeof api === 'function' && /^[\w.-]+\/[\w.-]+$/.test(repositoryName ?? '') && integer(options.runId) && integer(options.runAttempt) && integer(options.sourceRunId), 'pilot_bootstrap_inputs_invalid');
    requireFact(options.ref === 'refs/heads/main' && options.event === 'workflow_dispatch' && options.runnerEnvironment === 'github-hosted' && typeof runnerName === 'string' && runnerName.length > 0, 'pilot_bootstrap_environment_invalid');
    requireFact(Number.isFinite(options.now) && SHA.test(expectedSha ?? '') && actualCheckout?.sha === expectedSha && SHA.test(actualCheckout.tree ?? '') && Array.isArray(actualCheckout.parents) && actualCheckout.parents.every(parent => SHA.test(parent)), 'pilot_actual_controller_checkout_invalid');
    const repository = await api('');
    requireFact(integer(repository?.id) && repository.full_name === repositoryName && repository.default_branch === 'main', 'pilot_repository_or_default_branch_invalid');
    const run = await api(`/actions/runs/${options.runId}`);
    runIdentity(run, repository, options);
    const workflow = await api(`/actions/workflows/${run.workflow_id}`);
    requireFact(workflow?.id === run.workflow_id && workflow.path === PILOT_WORKFLOW_PATH && workflow.state === 'active', 'pilot_workflow_definition_invalid');
    const attempt = await api(`/actions/runs/${options.runId}/attempts/${options.runAttempt}`);
    runIdentity(attempt, repository, options);
    requireFact(attempt.workflow_id === run.workflow_id && attempt.run_started_at === run.run_started_at, 'pilot_latest_attempt_changed');
    const commit = await api(`/git/commits/${expectedSha}`);
    requireFact(commit?.sha === expectedSha && commit.tree?.sha === actualCheckout.tree && Array.isArray(commit.parents) && same(commit.parents.map(parent => parent.sha), actualCheckout.parents), 'pilot_controller_git_object_mismatch');
    const definition = await api(`/contents/${PILOT_WORKFLOW_PATH}?ref=${expectedSha}`);
    requireFact(definition?.type === 'file' && definition.path === PILOT_WORKFLOW_PATH && SHA.test(definition.sha ?? '') && definition.size > 0, 'pilot_protected_workflow_missing');
    const jobs = await githubPages(api, `/actions/runs/${options.runId}/attempts/${options.runAttempt}/jobs`, 'jobs');
    const matching = jobs.filter(job => job.name === PILOT_JOB_NAME);
    requireFact(matching.length === 1, 'pilot_job_missing_or_ambiguous');
    const job = matching[0];
    requireFact(integer(job.id) && job.run_id === run.id && job.status === 'in_progress' && job.conclusion === null && validTime(job.started_at) && Date.parse(job.started_at) >= Date.parse(run.run_started_at) && Date.parse(job.started_at) <= options.now, 'pilot_job_not_current_execution');
    requireFact(integer(job.runner_id) && Number.isSafeInteger(job.runner_group_id) && job.runner_group_id >= 0 && job.runner_name === runnerName && Array.isArray(job.labels) && job.labels.length > 0 && !job.labels.includes('self-hosted'), 'pilot_runner_identity_missing_or_mismatch');
    const capture = job.steps?.filter(step => step.name === PILOT_SUPERVISOR_STEP);
    requireFact(Array.isArray(capture) && capture.length === 1 && integer(capture[0].number) && capture[0].status === 'in_progress' && capture[0].conclusion === null && validTime(capture[0].started_at) && Date.parse(capture[0].started_at) >= Date.parse(job.started_at) && Date.parse(capture[0].started_at) <= options.now, 'pilot_supervisor_step_not_current');
    result.bootstrapVerified = true;
    result.repository = { id: repository.id, fullName: repository.full_name, defaultBranch: repository.default_branch, public: repository.private === false };
    result.authority = {
      source: 'protected-pilot-bootstrap', apiBootstrapVerified: true,
      apiVerified: false, protectedVerified: false, definitionTrusted: true,
      repositoryId: repository.id, workflowId: run.workflow_id, path: workflow.path,
      ref: 'refs/heads/main', event: run.event, headSha: run.head_sha,
      workflowSha: expectedSha, checkoutSha: actualCheckout.sha,
      controllerTree: actualCheckout.tree, definitionBlob: definition.sha,
      runId: run.id, runAttempt: run.run_attempt, jobId: job.id,
      jobName: job.name, jobStartedAt: job.started_at,
      runnerId: job.runner_id, runnerGroupId: job.runner_group_id, runnerName: job.runner_name,
      runnerEnvironment: 'github-hosted', sourceRunId: options.sourceRunId,
      supervisorStep: { name: capture[0].name, number: capture[0].number, startedAt: capture[0].started_at },
      observedAt: new Date(options.now).toISOString(),
    };
  } catch (error) {
    result.reasons.push(typeof error?.reason === 'string' && /^[a-z0-9_:-]{1,120}$/.test(error.reason) ? error.reason : 'pilot_bootstrap_api_or_validation_exception');
  }
  return result;
}
