/** Read-only GitHub adapter; candidate code is never executed. Bounded artifact transport returns data only. */
import { buildCandidateManifest, evaluateShadow, fingerprint, fingerprintEntries } from './ci-candidate-evidence.mjs';
import { withConsistentCandidateHistory } from './ci-candidate-history.mjs';

export const IDENTITY_STEP = 'Record candidate checkout and runtime identity';
export const IDENTITY_PREFIX = 'CI_CANDIDATE_IDENTITY_V1:';
const IDENTITY_ACTION = '.github/actions/ci-candidate-identity/action.yml';
const OBSERVER_PATH = '.github/workflows/ci-candidate-shadow.yml';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_AGE = 86_400_000;
const successful = value => value?.status === 'completed' && value?.conclusion === 'success';
const integer = value => Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;

export class EvidenceReadError extends Error {
  constructor(reason) { super(reason); this.name = 'EvidenceReadError'; this.reason = reason; }
}
const requireFact = (condition, reason) => { if (!condition) throw new EvidenceReadError(reason); };
const fallback = (reason, details = {}) => ({ schemaVersion: 1, mode: 'shadow', skip: false, runFull: true, wouldReuse: false, reasons: [reason], sourceRun: null, evidenceFingerprint: null, ...details });

/** Logs may redirect to signed storage. Never send the token to that host. */
export function createGitHubApi({ repository, token, fetchImpl = fetch }) {
  requireFact(/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') && typeof token === 'string' && token.length > 0, 'github_connection_missing');
  return async (path, { raw = false, binary = false } = {}) => {
    requireFact(typeof path === 'string' && (path === '' || path.startsWith('/')) && !path.startsWith('//') && !/[\r\n]/.test(path), 'invalid_api_path');
    requireFact(!(raw && binary), 'ambiguous_api_response_mode');
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000), redirect: 'manual',
    });
    let actual = response;
    if ((raw || binary) && response.status === 302) {
      const destination = new URL(response.headers.get('location'));
      requireFact(destination.protocol === 'https:' && !destination.username && !destination.password, 'unsafe_log_redirect');
      actual = await fetchImpl(destination.href, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    }
    requireFact(actual.ok, `github_api_http_${actual.status}`);
    if (binary) {
      const declared = Number(actual.headers.get('content-length'));
      requireFact(!Number.isFinite(declared) || declared <= 20_000_000, 'artifact_archive_too_large');
      requireFact(actual.body, 'artifact_archive_body_missing');
      const chunks = []; let size = 0;
      for await (const chunk of actual.body) {
        size += chunk.byteLength;
        requireFact(size <= 20_000_000, 'artifact_archive_too_large');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    if (!raw) return actual.json();
    const body = await actual.text();
    requireFact(Buffer.byteLength(body) <= 20_000_000, 'job_logs_too_large');
    return body;
  };
}

/** Exhaust ALL advertised pages; an arbitrary first page can conceal a newer failure. */
export async function githubPages(api, path, key, maxPages = 20) {
  const result = [];
  let total;
  for (let page = 1; page <= maxPages; page++) {
    const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    requireFact(Array.isArray(data?.[key]) && Number.isSafeInteger(data.total_count) && data.total_count >= 0, 'invalid_paginated_response');
    requireFact(total === undefined || data.total_count === total, 'pagination_changed_during_observation');
    total = data.total_count;
    result.push(...data[key]);
    requireFact(result.length <= total, 'pagination_count_mismatch');
    if (result.length === total) {
      const ids = result.map(item => item.id);
      requireFact(ids.every(integer) && new Set(ids).size === ids.length, 'pagination_duplicate_or_invalid_id');
      return result;
    }
    requireFact(data[key].length > 0, 'incomplete_pagination');
  }
  throw new EvidenceReadError('pagination_limit_exceeded');
}

/** Window + unique real marker + trusted pre-identity closure; timestamps alone are not signatures. */
export function parseCheckoutIdentity(logs, job) {
  const steps = job?.steps?.filter(step => step.name === IDENTITY_STEP);
  requireFact(Array.isArray(steps) && steps.length === 1 && successful(steps[0]), 'identity_step_missing_or_not_successful');
  const prefix = job.steps.slice(0, job.steps.indexOf(steps[0]));
  // Checkout is the existing explicit name in some trusted workflow jobs.
  // Full definition/closure validation below proves what these named steps use.
  const checkoutNames = ['Run actions/checkout@v5', 'Checkout'];
  requireFact(prefix.filter(step => checkoutNames.includes(step.name)).length === 1 && prefix.every(step => ['Set up job', ...checkoutNames].includes(step.name) && successful(step)), 'pre_identity_candidate_execution');
  const start = time(steps[0].started_at);
  const end = time(steps[0].completed_at);
  requireFact(Number.isFinite(start) && Number.isFinite(end) && end - start >= 2_000, 'invalid_identity_step_window');
  const matches = [];
  const pattern = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z) CI_CANDIDATE_IDENTITY_V1:([A-Za-z0-9+/]+={0,2})\r?$/;
  for (const line of String(logs).split('\n')) {
    const match = pattern.exec(line);
    if (!match) continue;
    const stamp = time(match[1]);
    // API step times are second-resolution. Padding excludes both boundary seconds.
    if (stamp >= start + 1_000 && stamp < Math.floor(end / 1_000) * 1_000) matches.push(match[2]);
  }
  requireFact(matches.length === 1, 'identity_marker_missing_or_ambiguous');
  const encoded = matches[0];
  requireFact(encoded.length < 16_384 && Buffer.from(encoded, 'base64').toString('base64') === encoded, 'invalid_identity_encoding');
  let value;
  try { value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { throw new EvidenceReadError('invalid_identity_json'); }
  requireFact(value?.schemaVersion === 1 && SHA.test(value.sha ?? '') && SHA.test(value.tree ?? '') && Array.isArray(value.parents) && value.parents.length >= 1 && value.parents.length <= 2 && value.parents.every(parent => SHA.test(parent)), 'invalid_checkout_identity');
  requireFact(SHA.test(value.workflowSha ?? '') && typeof value.workflowRef === 'string' && value.workflowRef.length < 512, 'invalid_workflow_identity');
  for (const [field, keys] of [['toolchain', ['node', 'pnpm', 'python', 'docker']], ['environment', ['platform', 'arch', 'imageOS', 'imageVersion', 'runnerEnvironment', 'runnerOS']]]) {
    requireFact(value[field] && Object.keys(value[field]).length === keys.length && keys.every(key => typeof value[field][key] === 'string' && value[field][key].length > 0 && value[field][key].length < 512), `invalid_${field}_identity`);
  }
  requireFact(value.environment.runnerEnvironment === 'github-hosted' && value.environment.platform === 'linux' && value.environment.runnerOS === 'Linux' && value.environment.imageVersion.length > 0, 'untrusted_runner_environment');
  // GitHub-hosted jobs report group 0 (the default group), unlike positive job/run IDs.
  requireFact(integer(job.runner_id) && Number.isSafeInteger(job.runner_group_id) && job.runner_group_id >= 0 && Array.isArray(job.labels) && job.labels.length > 0, 'runner_identity_missing');
  requireFact(value.candidate && Object.keys(value.candidate).length === 3, 'invalid_candidate_marker');
  return value;
}

function sameRepository(run, repository) {
  requireFact(run?.repository?.id === repository.id && run.repository.full_name === repository.full_name && run?.head_repository?.id === repository.id && run.head_repository.full_name === repository.full_name, 'foreign_run_repository');
  requireFact(integer(run.id) && integer(run.run_attempt) && integer(run.workflow_id) && SHA.test(run.head_sha ?? ''), 'invalid_run_identity');
}

/** Git tree reads bind blob paths/modes, not the untrusted contents of manifests. */
function gitReader(api) {
  const commits = new Map();
  const trees = new Map();
  const commit = async sha => {
    requireFact(SHA.test(sha ?? ''), 'invalid_commit_sha');
    if (!commits.has(sha)) commits.set(sha, (async () => {
      const value = await api(`/git/commits/${sha}`);
      requireFact(value?.sha === sha && SHA.test(value.tree?.sha ?? '') && Array.isArray(value.parents) && value.parents.every(parent => SHA.test(parent.sha ?? '')), 'invalid_git_commit_response');
      return { sha, tree: value.tree.sha, parents: value.parents.map(parent => parent.sha) };
    })());
    return commits.get(sha);
  };
  const tree = async sha => {
    const object = await commit(sha);
    if (!trees.has(object.tree)) trees.set(object.tree, (async () => {
      const value = await api(`/git/trees/${object.tree}?recursive=1`);
      requireFact(value?.sha === object.tree && value.truncated === false && Array.isArray(value.tree), 'truncated_or_invalid_git_tree');
      const entries = value.tree.filter(entry => ['blob', 'commit'].includes(entry.type)).map(entry => ({ path: entry.path, oid: entry.sha, mode: entry.mode }));
      // fingerprintEntries also validates duplicate paths, mode and oid syntax.
      fingerprintEntries(entries);
      return entries;
    })());
    return trees.get(object.tree);
  };
  return { commit, tree };
}

async function trustedDefinitions(git, { baseSha, checkoutSha, protectedSha, workflowSha, path }) {
  const all = await Promise.all([baseSha, checkoutSha, protectedSha, workflowSha].map(sha => git.tree(sha)));
  for (const requiredPath of [path, IDENTITY_ACTION]) {
    const entries = all.map(tree => tree.find(entry => entry.path === requiredPath));
    requireFact(entries.every(entry => entry && entry.mode === '100644') && entries.every(entry => entry.oid === entries[0].oid), `untrusted_definition:${requiredPath}`);
  }
  // Some existing lanes run scope/dedup scripts before this identity step.
  // Those scripts can alter the worktree, PATH or environment. Trust their
  // entire control-plane closure, including install/setup inputs, from base.
  const setupInputs = new Set(['package.json', '.npmrc', 'pnpm-workspace.yaml', '.nvmrc', 'pnpm-lock.yaml']);
  const closure = all.map(tree => tree.filter(entry => entry.path.startsWith('.harness/') || entry.path.startsWith('.github/') || setupInputs.has(entry.path)));
  const trusted = fingerprintEntries(closure[0]);
  requireFact(closure.every(entries => fingerprintEntries(entries) === trusted), 'pre_identity_definition_closure_changed');
}

async function checkoutProof({ api, git, job, run, repository, path, protectedSha, candidate = false }) {
  const identity = parseCheckoutIdentity(await api(`/actions/jobs/${job.id}/logs`, { raw: true }), job);
  const identityStep = job.steps.find(step => step.name === IDENTITY_STEP);
  requireFact(time(identityStep.started_at) >= time(run.run_started_at) && time(identityStep.completed_at) <= time(run.updated_at), 'identity_step_outside_run_window');
  requireFact(identity.workflowRef.startsWith(`${repository.full_name}/${path}@refs/`), 'workflow_ref_mismatch');
  const object = await git.commit(identity.sha);
  requireFact(object.tree === identity.tree && JSON.stringify(object.parents) === JSON.stringify(identity.parents), 'checkout_git_object_mismatch');
  let baseSha = identity.parents[0];
  let headSha = identity.parents[1] ?? null;
  if (candidate) {
    requireFact(identity.parents.length === 2 && SHA.test(identity.candidate.baseSha ?? '') && identity.candidate.baseSha === baseSha, 'candidate_base_parent_mismatch');
    if (run.event === 'pull_request') {
      requireFact(integer(identity.candidate.prNumber) && identity.candidate.headSha === headSha && run.head_sha === headSha, 'candidate_head_parent_mismatch');
      requireFact(identity.workflowRef === `${repository.full_name}/${path}@refs/pull/${identity.candidate.prNumber}/merge`, 'candidate_workflow_ref_mismatch');
    } else {
      // Single-PR merge groups only: reconstruct the actual parents, not a PR's JSON.
      requireFact(run.event === 'merge_group' && run.head_sha === identity.sha && identity.candidate.headSha === identity.sha, 'merge_group_checkout_mismatch');
    }
  } else {
    requireFact(identity.sha === run.head_sha && identity.workflowRef === `${repository.full_name}/${path}@refs/heads/main`, 'main_checkout_mismatch');
  }
  await trustedDefinitions(git, { baseSha, checkoutSha: identity.sha, protectedSha, workflowSha: identity.workflowSha, path });
  return { identity, proof: { verified: true, source: 'github-job-log', sha: identity.sha, tree: identity.tree, parents: identity.parents, baseSha, headSha } };
}

async function checkoutFingerprints(git, identity, config) {
  const tree = await git.tree(identity.sha);
  const locks = config.identityPaths.map(path => tree.find(entry => entry.path === path));
  requireFact(locks.every(Boolean), 'identity_lock_file_missing');
  // Entire tree is a conservative definition closure. A source change can never hide behind a path filter.
  return { definitions: fingerprintEntries(tree), locks: fingerprintEntries(locks), toolchain: fingerprint(identity.toolchain), environment: fingerprint(identity.environment) };
}

function selectedJob(jobs, suite) {
  const matches = jobs.filter(job => job.name === suite.owner.job);
  requireFact(matches.length === 1, `required_job_missing_or_ambiguous:${suite.owner.job}`);
  const job = matches[0];
  requireFact(integer(job.id) && successful(job), `required_job_not_successful:${suite.owner.job}`);
  requireFact(Array.isArray(job.steps) && new Set(job.steps.map(step => step.name)).size === job.steps.length, 'ambiguous_job_steps');
  // A job-level continue-on-error can mask a failing upload/cleanup step.
  // Keep ordinary conditional skips, but never accept that masked failure as
  // successful source evidence even when the selected test steps passed.
  requireFact(job.steps.every(step => step.status === 'completed' && ['success', 'skipped'].includes(step.conclusion)), 'source_job_step_not_successful');
  const stepNames = [...suite.execution.actualStepNames];
  for (const pattern of suite.execution.actualStepNamePatterns ?? []) {
    const matches = job.steps.filter(step => new RegExp(pattern).test(step.name));
    requireFact(matches.length > 0, 'required_execution_pattern_missing');
    stepNames.push(...matches.map(step => step.name));
  }
  requireFact(stepNames.length > 0 && stepNames.every(name => successful(job.steps.find(step => step.name === name))), `actual_execution_not_successful:${suite.id}`);
  return { job, stepNames: [...new Set(stepNames)] };
}

function selectedArtifacts(artifacts, suite, run) {
  const patterns = suite.execution.artifactNamePatterns.map(pattern => new RegExp(pattern));
  requireFact(patterns.length > 0 && patterns.every(pattern => artifacts.some(artifact => pattern.test(artifact.name))), 'required_artifact_missing');
  const matching = artifacts.filter(artifact => patterns.some(pattern => pattern.test(artifact.name)));
  requireFact(new Set(matching.map(artifact => artifact.name)).size === matching.length, 'ambiguous_artifact_names');
  return matching.map(artifact => {
    requireFact(integer(artifact.id) && artifact.expired === false && integer(artifact.size_in_bytes) && DIGEST.test(artifact.digest ?? '') && artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === run.head_sha, 'artifact_unverified_or_expired');
    requireFact(time(artifact.created_at) >= time(run.run_started_at) && time(artifact.created_at) <= time(run.updated_at), 'artifact_not_from_current_attempt');
    return { id: artifact.id, name: artifact.name, digest: artifact.digest, sizeInBytes: artifact.size_in_bytes, expired: false, apiVerified: true, runId: run.id, runAttempt: run.run_attempt };
  });
}

async function candidateFromCheckout(api, run, checkout, repository) {
  let number = checkout.identity.candidate.prNumber;
  if (run.event === 'merge_group') {
    const pulls = await api(`/commits/${checkout.proof.headSha}/pulls?per_page=100`);
    requireFact(Array.isArray(pulls) && pulls.length === 1 && integer(pulls[0].number), 'merge_group_multiple_or_unknown_candidates');
    number = pulls[0].number;
  } else {
    requireFact(Array.isArray(run.pull_requests) && run.pull_requests.length === 1 && run.pull_requests[0].number === number, 'run_candidate_missing_or_ambiguous');
  }
  const pull = await api(`/pulls/${number}`);
  requireFact(pull?.number === number && pull.base?.repo?.id === repository.id && pull.head?.repo?.id === repository.id && pull.base.ref === 'main', 'foreign_candidate_repository_or_base');
  requireFact(pull.head.sha === checkout.proof.headSha, 'candidate_head_changed');
  requireFact(pull.merged === true || (pull.state === 'open' && pull.mergeable === true && pull.base.sha === checkout.proof.baseSha && (run.event === 'merge_group' || pull.merge_commit_sha === checkout.proof.sha)), 'candidate_conflict_or_base_changed');
  return { prNumber: number, baseSha: checkout.proof.baseSha, headSha: checkout.proof.headSha, mergeSha: checkout.proof.sha, sourceTree: checkout.proof.tree, parents: checkout.proof.parents, mergeable: true, headCurrent: true };
}

async function observerAuthority(api, repository, observerRunId, actualCheckout, expectedSha, git) {
  const own = await api(`/actions/runs/${observerRunId}`);
  sameRepository(own, repository);
  const workflow = await api(`/actions/workflows/${own.workflow_id}`);
  requireFact(repository.default_branch === 'main' && own.head_branch === 'main' && workflow?.path === OBSERVER_PATH && own.path === OBSERVER_PATH && own.head_sha === actualCheckout.sha && own.head_sha === expectedSha && ['workflow_run', 'workflow_dispatch'].includes(own.event), 'untrusted_observer_checkout');
  const object = await git.commit(own.head_sha);
  requireFact(object.tree === actualCheckout.tree && JSON.stringify(object.parents) === JSON.stringify(actualCheckout.parents), 'observer_actual_git_mismatch');
  const tree = await git.tree(own.head_sha);
  requireFact(tree.some(entry => entry.path === OBSERVER_PATH && entry.mode === '100644'), 'observer_definition_missing');
  return { source: 'protected-workflow-run-observer', apiVerified: true, definitionTrusted: true, event: own.event, ref: 'refs/heads/main', workflowId: own.workflow_id, path: OBSERVER_PATH, repositoryId: repository.id, runId: own.id, runAttempt: own.run_attempt, headSha: own.head_sha, checkoutSha: actualCheckout.sha };
}

async function runData(api, id, repository) {
  const run = await api(`/actions/runs/${id}`);
  sameRepository(run, repository);
  const workflow = await api(`/actions/workflows/${run.workflow_id}`);
  requireFact(workflow?.path === run.path && /^\.github\/workflows\/[\w.-]+\.yml$/.test(workflow.path), 'source_workflow_identity_mismatch');
  const jobs = await githubPages(api, `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  return { run, jobs, path: workflow.path };
}

async function createEvidence({ api, git, repository, config, suite, data, authority, now }) {
  const { run, jobs, path } = data;
  requireFact(suite.eligibleSourceEvents.includes(run.event) && successful(run), 'source_event_or_conclusion_not_eligible');
  requireFact(time(run.updated_at) <= now && now - time(run.updated_at) < MAX_AGE && time(run.run_started_at) <= time(run.updated_at), 'source_run_expired_or_time_invalid');
  const { job, stepNames } = selectedJob(jobs, suite);
  const checkout = await checkoutProof({ api, git, job, run, repository, path, protectedSha: authority.headSha, candidate: true });
  const candidate = await candidateFromCheckout(api, run, checkout, repository);
  const rawArtifacts = await githubPages(api, `/actions/runs/${run.id}/artifacts`, 'artifacts');
  const artifacts = selectedArtifacts(rawArtifacts, suite, run);
  const policy = { repositoryId: repository.id, repository: repository.full_name, suite: suite.id, observer: { workflowId: authority.workflowId, path: authority.path, ref: authority.ref }, producer: { workflowId: run.workflow_id, path, events: suite.eligibleSourceEvents }, jobs: [{ name: job.name, executeSteps: stepNames, artifactNames: artifacts.map(artifact => artifact.name) }], maxAgeMs: MAX_AGE };
  const manifest = buildCandidateManifest({ repository: { id: repository.id, fullName: repository.full_name }, suite: suite.id, observer: authority, producer: { apiVerified: true, definitionTrusted: true, repositoryId: repository.id, workflowId: run.workflow_id, path, event: run.event, runId: run.id, runAttempt: run.run_attempt, headSha: run.head_sha, status: run.status, conclusion: run.conclusion, startedAt: run.run_started_at, completedAt: run.updated_at, runtimeAttested: { verified: false, source: 'pre-install-host-only' }, jobs: [{ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, steps: job.steps.map(step => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion })), checkout: checkout.proof }] }, candidate, fingerprints: await checkoutFingerprints(git, checkout.identity, config), artifacts, observedAt: new Date(now).toISOString() });
  return { manifest, policy, candidate, checkout };
}

/** Bracket fresh API/log/Git measurement, rather than checking a previously built JSON. */
async function consistentEvidence(options) {
  const { api, repository, suite, data, authority, now } = options;
  // Resolve actual checkout parents first. This provisional result is never consumed:
  // the callback must reconstruct it from fresh APIs and a fresh Git-object reader.
  const provisional = await createEvidence(options);
  const history = await withConsistentCandidateHistory({
    api, repository: { id: repository.id, fullName: repository.full_name },
    workflowId: data.run.workflow_id, workflowPath: data.path,
    prNumber: provisional.candidate.prNumber, sourceRunId: data.run.id,
    sourceRunAttempt: data.run.run_attempt, eligibleEvents: suite.eligibleSourceEvents,
    suite: suite.id, expectedCandidate: provisional.candidate, now,
    measure: async () => {
      const fresh = await runData(api, data.run.id, repository);
      requireFact(fresh.run.run_attempt === data.run.run_attempt && fresh.path === data.path, 'source_attempt_changed_during_observation');
      return createEvidence({ ...options, git: gitReader(api), data: fresh, authority });
    },
  });
  requireFact(history.readStatus === 'ok' && history.stableDuringRead && history.measurementBound,
    history.reasons[0] || 'history_measurement_unstable');
  return { ...history.measurement, historyObservation: {
    stableDuringRead: true, measurementBound: true, skipAuthorization: false,
    snapshotFingerprints: history.snapshots.map(snapshot => snapshot.fingerprint),
    reads: history.reads, retries: history.retries,
    statistics: history.snapshots[0].statistics,
    latestAttempts: history.snapshots[0].latestAttempts,
    indexCompletenessVerified: false, atomicLease: false,
    residualRace: 'a new run, rerun, or failure can start after the last read',
  }, latestAttempts: history.snapshots[0].latestAttempts };
}

/**
 * Input-only resolver for the separate protected manual pilot. Its bootstrap
 * independently verifies the controller's API identity before calling here.
 * This does not promote source runtime metadata or authorize any reuse.
 */
export async function resolvePilotCandidate({ api, repositoryName, sourceRunId, authority, config, now = Date.now() }) {
  requireFact(integer(sourceRunId) && authority?.apiBootstrapVerified === true && authority.definitionTrusted === true &&
    authority.path === '.github/workflows/ci-candidate-runtime-pilot.yml' && authority.ref === 'refs/heads/main' &&
    SHA.test(authority.headSha ?? ''), 'pilot_controller_authority_missing');
  const repository = await api('');
  requireFact(repository?.default_branch === 'main' && repository.full_name === repositoryName && repository.id === authority.repositoryId,
    'pilot_repository_identity_mismatch');
  const data = await runData(api, sourceRunId, repository);
  requireFact(data.path === '.github/workflows/harness-verify.yml' && ['pull_request', 'merge_group'].includes(data.run.event),
    'pilot_source_workflow_or_event_invalid');
  const suite = config.suites.find(item => item.id === 'fullstack-smoke' && item.owner.workflow === data.path && item.owner.job === 'fullstack-smoke');
  requireFact(suite, 'pilot_checkout_suite_missing');
  const source = await consistentEvidence({ api, git: gitReader(api), repository, config, suite, data, authority, now });
  return {
    candidate: source.candidate, checkout: source.checkout.proof,
    producer: { runId: data.run.id, runAttempt: data.run.run_attempt, workflowId: data.run.workflow_id, path: data.path, event: data.run.event, headSha: data.run.head_sha },
    historyObservation: source.historyObservation,
    runFull: true, skip: false, protectedVerified: false,
  };
}

/**
 * Observe one candidate or reconstruct a source for main. These are snapshots,
 * never skip authorization: a new failure may start after the history read.
 * Future activation additionally requires consistent fresh source/PR/history
 * checks or a lease and independently attested post-install runtime identity.
 */
export async function observeCandidateRun({ api, repositoryName, sourceRunId, observerRunId, actualCheckout, expectedObserverSha, config, mode = 'shadow', freshRun = false, now = Date.now() }) {
  const report = { schemaVersion: 1, mode, skip: false, runFull: true, sourceRunId, observerRunId, observedAt: new Date(now).toISOString(), suites: [] };
  if (mode !== 'shadow') { report.suites.push(fallback(mode === 'off' ? 'reuse_disabled' : 'reuse_not_approved', { mode })); return report; }
  if (freshRun) { report.suites.push(fallback('fresh_run_requested')); return report; }
  try {
    requireFact(Number.isFinite(now) && integer(sourceRunId) && integer(observerRunId), 'invalid_observation_inputs');
    const repository = await api('');
    requireFact(integer(repository?.id) && repository.full_name === repositoryName, 'repository_identity_mismatch');
    const git = gitReader(api);
    const authority = await observerAuthority(api, repository, observerRunId, actualCheckout, expectedObserverSha, git);
    const data = await runData(api, sourceRunId, repository);
    const suites = config.suites.filter(suite => suite.owner.workflow === data.path && suite.eligibleSourceEvents.length > 0);
    requireFact(suites.length > 0, 'source_workflow_has_no_observable_suite');
    for (const suite of suites) {
      try {
        if (['pull_request', 'merge_group'].includes(data.run.event)) {
          const source = await consistentEvidence({ api, git, repository, config, suite, data, authority, now });
          report.suites.push(fallback('awaiting_main_comparison', { suite: suite.id, candidateEvidenceGenerated: true, manifest: source.manifest, historyObservation: source.historyObservation }));
          continue;
        }
        requireFact(data.run.event === 'push' && data.run.head_branch === 'main' && successful(data.run), 'not_successful_main_validation');
        const { job } = selectedJob(data.jobs, suite);
        const main = await checkoutProof({ api, git, job, run: data.run, repository, path: data.path, protectedSha: authority.headSha });
        const pulls = await api(`/commits/${main.proof.sha}/pulls?per_page=100`);
        requireFact(Array.isArray(pulls) && pulls.length === 1 && integer(pulls[0].number) && pulls[0].merged === true && pulls[0].merge_commit_sha === main.proof.sha, 'main_merged_candidate_missing_or_ambiguous');
        const pull = await api(`/pulls/${pulls[0].number}`);
        requireFact(pull?.head?.repo?.id === repository.id && pull.base?.repo?.id === repository.id && pull.base.ref === 'main' && SHA.test(pull.head.sha ?? ''), 'foreign_merged_candidate');
        // created_at is immutable across reruns: a date filter can hide an old
        // run rerun to failure today. Read all pages or retain full execution.
        const runs = await githubPages(api, `/actions/workflows/${data.run.workflow_id}/runs`, 'workflow_runs');
        const eligible = [];
        for (const listed of runs.filter(run => suite.eligibleSourceEvents.includes(run.event))) {
          requireFact(integer(listed.run_attempt), 'history_attempt_identity_missing');
          const run = listed.run_attempt > 1 ? await api(`/actions/runs/${listed.id}/attempts/${listed.run_attempt}`) : listed;
          sameRepository(run, repository);
          requireFact(run.id === listed.id && run.run_attempt === listed.run_attempt && run.workflow_id === data.run.workflow_id && Number.isFinite(time(run.run_started_at)), 'history_attempt_changed_or_time_unknown');
          eligible.push(run);
        }
        const sorted = eligible.sort((a, b) => time(b.run_started_at ?? b.created_at) - time(a.run_started_at ?? a.created_at) || b.id - a.id);
        // Unknown candidate identity can conceal a changed head or failed newer attempt.
        requireFact(sorted.every(run => Array.isArray(run.pull_requests) && run.pull_requests.length === 1), 'history_candidate_identity_unknown');
        const matching = sorted.filter(run => run.pull_requests[0].number === pull.number);
        requireFact(matching.length > 0, 'candidate_source_missing');
        const latest = matching[0];
        requireFact(successful(latest) && latest.head_sha === (latest.event === 'pull_request' ? pull.head.sha : latest.head_sha), 'newer_attempt_not_successful_or_head_changed');
        const sourceData = await runData(api, latest.id, repository);
        requireFact(sourceData.run.run_attempt === latest.run_attempt && sourceData.run.status === latest.status && sourceData.run.conclusion === latest.conclusion && sourceData.run.workflow_id === data.run.workflow_id && sourceData.path === data.path, 'source_attempt_changed_during_observation');
        const source = await consistentEvidence({ api, git, repository, config, suite, data: sourceData, authority, now });
        const history = source.latestAttempts;
        // Source identity is additionally proven by actual checkout parents + current PR API.
        const sourceHistory = history.find(run => run.runId === sourceData.run.id && run.runAttempt === sourceData.run.run_attempt);
        requireFact(sourceHistory && sourceHistory.candidate.headSha === source.candidate.headSha && sourceHistory.candidate.baseSha === source.candidate.baseSha, 'history_source_candidate_mismatch');
        // Re-read observer API independently; do not treat manifest.observer as an authority receipt.
        const currentAuthority = await observerAuthority(api, repository, observerRunId, actualCheckout, expectedObserverSha, git);
        const current = { repositoryId: repository.id, suite: suite.id, candidate: { ...source.candidate, prNumber: pull.number, headSha: pull.head.sha, baseSha: main.proof.parents[0], headCurrent: true, mergeable: pull.merged === true }, checkout: main.proof, runtimeAttested: { verified: false, source: 'pre-install-host-only' }, fingerprints: await checkoutFingerprints(git, main.identity, config) };
        const verdict = evaluateShadow({ mode, evidence: source.manifest, current, policy: source.policy, authority: currentAuthority, latestAttempts: history, readStatus: 'ok', now });
        report.suites.push({ suite: suite.id, ...verdict, manifest: source.manifest, historyObservation: source.historyObservation });
      } catch (error) {
        report.suites.push(fallback(error instanceof EvidenceReadError ? error.reason : 'evidence_lookup_or_validation_exception', { suite: suite.id }));
      }
    }
  } catch (error) {
    report.suites.push(fallback(error instanceof EvidenceReadError ? error.reason : 'evidence_lookup_or_validation_exception'));
  }
  return report;
}
