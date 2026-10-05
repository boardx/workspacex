/**
 * Two independent read-only GitHub snapshots. Equal snapshots are observations,
 * not an atomic lease, immutable history or permission to skip future validation.
 * The caller supplies a fresh API function; cached JSON/manifest facts are not API receipts.
 */
import { fingerprint } from './ci-candidate-evidence.mjs';

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const WORKFLOW = /^\.github\/workflows\/[\w.-]+\.ya?ml$/;
const MAX_AGE = 86_400_000;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const MAX_RUNS = MAX_PAGES * PAGE_SIZE;
const integer = value => Number.isSafeInteger(value) && value > 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const successful = value => value?.status === 'completed' && value?.conclusion === 'success';
const equal = (first, second) => fingerprint(first) === fingerprint(second);

function freezeFacts(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeFacts(child);
    Object.freeze(value);
  }
  return value;
}

export class CandidateHistoryReadError extends Error {
  constructor(reason) { super(reason); this.name = 'CandidateHistoryReadError'; this.reason = reason; }
}
const requireFact = (condition, reason) => { if (!condition) throw new CandidateHistoryReadError(reason); };

function readError(error) {
  const reason = error?.reason;
  // Preserve only bounded machine reasons, never arbitrary exception text/token-bearing URLs.
  if (typeof reason === 'string' && /^[a-z0-9_:-]{1,120}$/.test(reason)) return reason;
  return 'history_lookup_or_validation_exception';
}

function runIdentity(run, options) {
  const { repository, workflowId, workflowPath } = options;
  requireFact(integer(run?.id) && integer(run?.run_attempt) && run.workflow_id === workflowId && run.path === workflowPath, 'history_run_identity_invalid');
  requireFact(run.repository?.id === repository.id && run.repository.full_name === repository.fullName && run.head_repository?.id === repository.id && run.head_repository.full_name === repository.fullName, 'history_foreign_repository');
  requireFact(SHA.test(run.head_sha ?? '') && typeof run.event === 'string' && typeof run.head_branch === 'string' && validTime(run.created_at) && validTime(run.run_started_at) && validTime(run.updated_at), 'history_run_metadata_invalid');
  requireFact(typeof run.status === 'string' && (run.conclusion === null || typeof run.conclusion === 'string') && Array.isArray(run.pull_requests), 'history_run_status_or_candidates_invalid');
  const pulls = run.pull_requests.map(pull => {
    requireFact(integer(pull?.number) && SHA.test(pull.base?.sha ?? '') && SHA.test(pull.head?.sha ?? ''), 'history_candidate_identity_unknown');
    return { number: pull.number, baseSha: pull.base.sha, headSha: pull.head.sha };
  });
  requireFact(new Set(pulls.map(pull => pull.number)).size === pulls.length, 'history_candidate_identity_ambiguous');
  return {
    id: run.id, runAttempt: run.run_attempt, workflowId: run.workflow_id, path: run.path,
    event: run.event, headSha: run.head_sha, headBranch: run.head_branch,
    repositoryId: run.repository.id, headRepositoryId: run.head_repository.id,
    status: run.status, conclusion: run.conclusion, createdAt: run.created_at,
    startedAt: run.run_started_at, updatedAt: run.updated_at, pulls,
    actorId: run.actor?.id ?? null, triggeringActorId: run.triggering_actor?.id ?? null,
  };
}

function pullIdentity(pull, options) {
  const { repository, prNumber } = options;
  requireFact(pull?.number === prNumber && pull.base?.repo?.id === repository.id && pull.head?.repo?.id === repository.id && pull.base.ref === 'main', 'history_pr_identity_invalid');
  requireFact(SHA.test(pull.base.sha ?? '') && SHA.test(pull.head.sha ?? '') && ['open', 'closed'].includes(pull.state) && typeof pull.merged === 'boolean', 'history_pr_metadata_invalid');
  requireFact([null, true, false].includes(pull.mergeable) && (pull.merge_commit_sha === null || SHA.test(pull.merge_commit_sha ?? '')) && validTime(pull.updated_at), 'history_pr_merge_state_unknown');
  return { number: pull.number, baseSha: pull.base.sha, headSha: pull.head.sha, baseRef: pull.base.ref, baseRepositoryId: pull.base.repo.id, headRepositoryId: pull.head.repo.id, state: pull.state, merged: pull.merged, mergeable: pull.mergeable, mergeCommitSha: pull.merge_commit_sha, updatedAt: pull.updated_at };
}

function jobIdentity(job, source) {
  requireFact(integer(job?.id) && job.run_id === source.id && typeof job.name === 'string' && job.name.length > 0 && typeof job.status === 'string' && (job.conclusion === null || typeof job.conclusion === 'string'), 'history_job_identity_invalid');
  requireFact(Array.isArray(job.steps) && (job.started_at === null || validTime(job.started_at)) && (job.completed_at === null || validTime(job.completed_at)), 'history_job_metadata_invalid');
  const steps = job.steps.map(step => {
    requireFact(integer(step?.number) && typeof step.name === 'string' && typeof step.status === 'string' && (step.conclusion === null || typeof step.conclusion === 'string'), 'history_step_identity_invalid');
    requireFact((step.started_at === null || validTime(step.started_at)) && (step.completed_at === null || validTime(step.completed_at)), 'history_step_metadata_invalid');
    return { number: step.number, name: step.name, status: step.status, conclusion: step.conclusion, startedAt: step.started_at, completedAt: step.completed_at };
  });
  requireFact(new Set(steps.map(step => step.number)).size === steps.length && steps.every((step, index) => index === 0 || step.number > steps[index - 1].number), 'history_steps_ambiguous_or_reordered');
  return { id: job.id, runId: job.run_id, name: job.name, status: job.status, conclusion: job.conclusion, startedAt: job.started_at, completedAt: job.completed_at, runnerId: job.runner_id ?? null, runnerGroupId: job.runner_group_id ?? null, labels: job.labels ?? [], steps };
}

function artifactIdentity(artifact, source) {
  requireFact(integer(artifact?.id) && typeof artifact.name === 'string' && artifact.name.length > 0 && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes >= 0 && typeof artifact.expired === 'boolean', 'history_artifact_identity_invalid');
  requireFact(artifact.workflow_run?.id === source.id && artifact.workflow_run?.head_sha === source.headSha && validTime(artifact.created_at) && validTime(artifact.updated_at), 'history_artifact_metadata_invalid');
  requireFact(artifact.digest === null || typeof artifact.digest === 'string', 'history_artifact_digest_invalid');
  return { id: artifact.id, name: artifact.name, digest: artifact.digest, sizeInBytes: artifact.size_in_bytes, expired: artifact.expired, runId: artifact.workflow_run.id, headSha: artifact.workflow_run.head_sha, createdAt: artifact.created_at, updatedAt: artifact.updated_at, expiresAt: artifact.expires_at ?? null };
}

/**
 * Full unfiltered scope, page order and boundaries participate in both reads.
 * At most 100 pages / 10,000 advertised rows can be observed. Exhausting that
 * API view is not a guarantee of index completeness or an atomic history lease.
 */
async function readPages(api, path, key, options, receipts) {
  const items = [];
  let total;
  for (let page = 1; page <= options.maxPages; page++) {
    const value = await api(`${path}?per_page=${PAGE_SIZE}&page=${page}`);
    requireFact(Array.isArray(value?.[key]) && Number.isSafeInteger(value.total_count) && value.total_count >= 0, 'history_pagination_response_invalid');
    requireFact(value[key].length <= PAGE_SIZE, 'history_pagination_response_invalid');
    requireFact(total === undefined || value.total_count === total, 'history_pagination_changed');
    total = value.total_count;
    requireFact(total <= options.maxPages * PAGE_SIZE && total <= MAX_RUNS, 'history_pagination_limit_exceeded');
    const ids = value[key].map(item => item?.id);
    requireFact(ids.every(integer), 'history_pagination_item_invalid');
    receipts.push({ path, key, page, totalCount: total, ids });
    items.push(...value[key]);
    requireFact(items.length <= total && new Set(items.map(item => item.id)).size === items.length, 'history_pagination_shift_or_duplicate');
    if (items.length === total) return items;
    requireFact(value[key].length > 0, 'history_pagination_incomplete');
  }
  throw new CandidateHistoryReadError('history_pagination_limit_exceeded');
}

function checkSource(run, pull, options) {
  requireFact(run.id === options.sourceRunId && run.runAttempt === options.sourceRunAttempt, 'history_source_attempt_changed');
  requireFact(options.eligibleEvents.includes(run.event), 'history_source_event_not_eligible');
  requireFact(run.status === 'completed' && run.conclusion === 'success', 'history_source_not_successful');
  requireFact(run.pulls.length === 1 && run.pulls[0].number === options.prNumber, 'history_source_candidate_ambiguous');
  requireFact(run.pulls[0].headSha === pull.headSha && (run.event !== 'pull_request' || run.headSha === pull.headSha), 'history_pr_head_changed');
  requireFact(pull.merged === true || (pull.state === 'open' && pull.mergeable === true), 'history_pr_conflict_or_unknown');
  if (options.expectedCandidate) {
    requireFact(pull.headSha === options.expectedCandidate.headSha && run.pulls[0].baseSha === options.expectedCandidate.baseSha && run.pulls[0].headSha === options.expectedCandidate.headSha, 'history_expected_candidate_changed');
    // A merged PR's API base follows main. Its tested base must come from Git
    // parents/actual checkout outside this component, not this moving API field.
    if (!pull.merged) requireFact(pull.baseSha === options.expectedCandidate.baseSha, 'history_pr_base_changed');
  }
  requireFact(Date.parse(run.startedAt) <= Date.parse(run.updatedAt) && Date.parse(run.updatedAt) <= options.now && options.now - Date.parse(run.updatedAt) < options.maxAgeMs, 'history_source_expired_or_clock_invalid');
}

async function snapshot(options) {
  const { api, sourceRunId, sourceRunAttempt, workflowId, prNumber } = options;
  const pageReceipts = [];
  const pullRaw = await api(`/pulls/${prNumber}`);
  const pull = pullIdentity(pullRaw, options);
  const sourceRaw = await api(`/actions/runs/${sourceRunId}`);
  const source = runIdentity(sourceRaw, options);
  checkSource(source, pull, options);

  // No head/date/status filter: an old-created run may have a newer failing
  // attempt, including a previous API head of the same PR. Keep the complete
  // advertised workflow catalog in the A/measurement/B observation fingerprint.
  const listedRaw = await readPages(api, `/actions/workflows/${workflowId}/runs`, 'workflow_runs', options, pageReceipts);
  const scope = listedRaw.map(run => runIdentity(run, options));
  const listedSource = scope.filter(run => run.id === sourceRunId);
  requireFact(listedSource.length === 1 && equal(listedSource[0], source), 'history_source_listing_changed');
  const latestAttempts = [];
  let attemptReads = 0;
  const relatedRunIds = [];
  for (const listed of scope.filter(run => options.eligibleEvents.includes(run.event))) {
    // Missing/multiple associations cannot establish that a run is unrelated.
    // Only an explicit different single PR AND different immutable API head
    // permits omitting its expensive direct latest/attempt reads.
    requireFact(listed.pulls.length === 1, 'history_candidate_identity_unknown');
    if (listed.pulls[0].number !== prNumber && listed.headSha !== source.headSha) continue;
    requireFact(++attemptReads <= options.maxAttemptReads, 'history_attempt_read_limit_exceeded');
    relatedRunIds.push(listed.id);
    // A stale listing may still report attempt 1 after a rerun has failed.
    // Reading that listed old attempt would preserve its success. Always read
    // the latest route first, then its exact attempt, and latch any difference.
    const latest = runIdentity(await api(`/actions/runs/${listed.id}`), options);
    requireFact(equal(latest, listed), 'history_latest_run_changed');
    const attempt = runIdentity(await api(`/actions/runs/${listed.id}/attempts/${latest.runAttempt}`), options);
    requireFact(equal(attempt, latest), 'history_latest_attempt_changed');
    latestAttempts.push({ apiVerified: true, repositoryId: options.repository.id, workflowId, suite: options.suite, runId: attempt.id, runAttempt: attempt.runAttempt, apiHeadSha: attempt.headSha, startedAt: attempt.startedAt, status: attempt.status, conclusion: attempt.conclusion, candidate: { prNumber: attempt.pulls[0].number, baseSha: attempt.pulls[0].baseSha, headSha: attempt.pulls[0].headSha } });
  }
  const matching = latestAttempts.filter(run => run.candidate.prNumber === prNumber).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.runId - a.runId);
  requireFact(matching.length > 0, 'history_candidate_source_missing');
  const latest = matching[0];
  requireFact(latest.runId === sourceRunId && latest.runAttempt === sourceRunAttempt, successful(latest) ? 'history_newer_evidence_required' : 'history_newer_attempt_not_successful');
  // The existing receipt reader also vetoes a newer non-success with the same
  // API head associated with another PR. Retain that union of veto domains.
  for (const related of latestAttempts) {
    if (related.runId !== sourceRunId && related.apiHeadSha === source.headSha && Date.parse(related.startedAt) >= Date.parse(source.startedAt)) {
      requireFact(successful(related), 'history_newer_related_attempt_not_successful');
    }
  }

  const jobsRaw = await readPages(api, `/actions/runs/${sourceRunId}/attempts/${sourceRunAttempt}/jobs`, 'jobs', options, pageReceipts);
  const artifactsRaw = await readPages(api, `/actions/runs/${sourceRunId}/artifacts`, 'artifacts', options, pageReceipts);
  const jobs = jobsRaw.map(job => jobIdentity(job, source));
  const artifacts = artifactsRaw.map(artifact => artifactIdentity(artifact, source));
  // Seal the individual read window too: do not mix start-of-read attempt/PR
  // facts with jobs or artifacts returned after the source has changed.
  const sourceEnd = runIdentity(await api(`/actions/runs/${sourceRunId}`), options);
  const pullEnd = pullIdentity(await api(`/pulls/${prNumber}`), options);
  requireFact(equal(source, sourceEnd), 'history_source_changed_during_snapshot');
  requireFact(equal(pull, pullEnd), 'history_pr_changed_during_snapshot');

  const statistics = {
    runCount: scope.length, relatedRunIds,
    workflowPageCount: pageReceipts.filter(receipt => receipt.key === 'workflow_runs').length,
    relatedLatestReads: attemptReads, relatedAttemptReads: attemptReads,
    readBounds: { maxPages: options.maxPages, maxRuns: options.maxPages * PAGE_SIZE, maxAttemptReads: options.maxAttemptReads },
    catalogObservationOnly: true, indexCompletenessVerified: false, atomicLease: false,
  };
  const content = { scope, sourceRun: source, sourceAttempt: scope.find(run => run.id === sourceRunId), jobs, artifacts, pull, latestAttempts, pageReceipts, statistics };
  return { fingerprint: fingerprint(content), scopeFingerprint: fingerprint({ scope, pages: pageReceipts.filter(receipt => receipt.key === 'workflow_runs') }), ...content };
}

function validateOptions(options) {
  requireFact(options && typeof options.api === 'function' && integer(options.repository?.id) && REPOSITORY.test(options.repository?.fullName ?? '') && integer(options.workflowId) && WORKFLOW.test(options.workflowPath ?? '') && integer(options.prNumber) && integer(options.sourceRunId) && integer(options.sourceRunAttempt) && typeof options.suite === 'string' && options.suite.length > 0, 'history_options_invalid');
  requireFact(Array.isArray(options.eligibleEvents) && options.eligibleEvents.length > 0 && new Set(options.eligibleEvents).size === options.eligibleEvents.length && options.eligibleEvents.every(event => ['pull_request', 'merge_group'].includes(event)), 'history_event_policy_invalid');
  requireFact(Number.isFinite(options.now) && Number.isFinite(new Date(options.now).getTime()), 'history_clock_invalid');
  requireFact(Number.isSafeInteger(options.maxPages) && options.maxPages > 0 && options.maxPages <= MAX_PAGES && Number.isSafeInteger(options.maxAttemptReads) && options.maxAttemptReads > 0 && options.maxAttemptReads <= 2_000 && [0, 1].includes(options.maxRetries), 'history_read_bounds_invalid');
  requireFact(Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0 && options.maxAgeMs <= MAX_AGE, 'history_expiry_policy_invalid');
  if (options.expectedCandidate) requireFact(SHA.test(options.expectedCandidate.baseSha ?? '') && SHA.test(options.expectedCandidate.headSha ?? ''), 'history_expected_candidate_invalid');
  requireFact(options.measure === undefined || typeof options.measure === 'function', 'history_measure_callback_invalid');
  if (options.requireMeasurement) requireFact(typeof options.measure === 'function', 'history_measure_callback_required');
}

function bindMeasurement(measurement, snapshotA, options) {
  const evidence = measurement?.manifest ?? measurement?.evidence ?? measurement;
  const producer = evidence?.producer;
  const source = snapshotA.sourceRun;
  requireFact(evidence?.repository?.id === options.repository.id && evidence.repository.fullName === options.repository.fullName && evidence.suite === options.suite, 'history_measurement_repository_or_suite_mismatch');
  requireFact(producer?.repositoryId === options.repository.id && producer.workflowId === options.workflowId && producer.path === options.workflowPath && producer.runId === source.id && producer.runAttempt === source.runAttempt && producer.headSha === source.headSha && producer.event === source.event && producer.status === source.status && producer.conclusion === source.conclusion && producer.startedAt === source.startedAt && producer.completedAt === source.updatedAt, 'history_measurement_source_mismatch');
  const candidate = evidence?.candidate;
  requireFact(candidate?.prNumber === options.prNumber && candidate.headSha === snapshotA.pull.headSha && candidate.baseSha === source.pulls[0].baseSha && candidate.headSha === source.pulls[0].headSha, 'history_measurement_candidate_mismatch');
  requireFact(Array.isArray(producer.jobs) && producer.jobs.length > 0 && new Set(producer.jobs.map(job => job.id)).size === producer.jobs.length, 'history_measurement_jobs_missing_or_ambiguous');
  for (const job of producer.jobs) {
    const actual = snapshotA.jobs.find(item => item.id === job.id);
    requireFact(actual && job.name === actual.name && job.status === actual.status && job.conclusion === actual.conclusion, 'history_measurement_job_mismatch');
    requireFact(Array.isArray(job.steps) && job.steps.length > 0 && new Set(job.steps.map(step => step.number)).size === job.steps.length, 'history_measurement_steps_missing_or_ambiguous');
    for (const step of job.steps) {
      const observed = actual.steps.find(item => item.number === step.number);
      requireFact(integer(step.number) && observed && step.name === observed.name && step.status === observed.status && step.conclusion === observed.conclusion, 'history_measurement_step_mismatch');
    }
  }
  requireFact(Array.isArray(evidence.artifacts) && evidence.artifacts.length > 0 && new Set(evidence.artifacts.map(artifact => artifact.id)).size === evidence.artifacts.length, 'history_measurement_artifacts_missing_or_ambiguous');
  for (const artifact of evidence.artifacts) {
    const actual = snapshotA.artifacts.find(item => item.id === artifact.id);
    requireFact(actual && artifact.name === actual.name && artifact.digest === actual.digest && artifact.sizeInBytes === actual.sizeInBytes && artifact.expired === actual.expired && artifact.runId === source.id && artifact.runAttempt === source.runAttempt && actual.headSha === source.headSha, 'history_measurement_artifact_mismatch');
  }
}

/**
 * Every observed error/change is latched. A bounded retry can add diagnostic
 * snapshots but can NEVER restore success or search backward for an older green.
 * stableDuringRead only means these completed independent reads matched.
 * It is a coherence observation, not proof that optional/skipped jobs executed
 * or that the caller's full suite/runtime verification policy was satisfied.
 * It does not cover an event after the last read, ABA changes, eventually
 * consistent API omissions, or any producer bypassing a future external fence.
 */
export async function readConsistentCandidateHistory(input = {}) {
  const result = { schemaVersion: 1, runFull: true, skip: false, stableDuringRead: false, measurementBound: false, measurement: null, skipAuthorization: false, readStatus: 'fallback', reasons: [], snapshots: [], statistics: [], reads: 0, retries: 0 };
  const add = reason => { if (!result.reasons.includes(reason)) result.reasons.push(reason); };
  try {
    const options = { now: Date.now(), maxPages: MAX_PAGES, maxAttemptReads: 200, maxRetries: 0, maxAgeMs: MAX_AGE, ...input };
    validateOptions(options);
    result.observedAt = new Date(options.now).toISOString();
    for (let round = 0; round <= options.maxRetries; round++) {
      if (round > 0) result.retries++;
      try {
        result.reads++;
        const first = freezeFacts(await snapshot(options));
        result.snapshots.push(first);
        result.statistics.push(first.statistics);
        let measurement;
        if (options.measure) {
          measurement = await options.measure(first);
          bindMeasurement(measurement, first, options);
          result.measurement = measurement;
        }
        result.reads++;
        const second = freezeFacts(await snapshot(options));
        result.snapshots.push(second);
        result.statistics.push(second.statistics);
        if (first.fingerprint !== second.fingerprint) {
          add(first.scopeFingerprint !== second.scopeFingerprint ? 'history_scope_changed_between_reads' : 'history_facts_changed_between_reads');
        }
        if (result.reasons.length === 0) {
          result.stableDuringRead = true;
          result.measurementBound = typeof options.measure === 'function';
          result.readStatus = 'ok';
          break;
        }
      } catch (error) {
        const reason = readError(error);
        add(reason);
        // Permission/authorization problems cannot become permission to trust on retry.
        if (/http_(401|403|404)$/.test(reason)) break;
      }
    }
  } catch (error) { add(readError(error)); }
  return result;
}

/** Required-measurement entry point: A -> fresh manifest/log/runtime measurement -> B. */
export async function withConsistentCandidateHistory(options = {}) {
  return readConsistentCandidateHistory({ ...options, requireMeasurement: true });
}
