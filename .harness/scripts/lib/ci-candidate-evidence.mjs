/**
 * Candidate evidence is an observation made by protected default-branch code.
 * This module does not turn PR JSON, an artifact name, or run.head_sha into trust.
 * The observer must independently obtain GitHub run/jobs/log/artifact metadata,
 * compare the executed workflow with its protected definition, and resolve Git
 * objects. Consumers must reauthenticate the observer through `authority`.
 * Phase one NEVER skips execution, including when a comparison succeeds.
 */
import { createHash } from 'node:crypto';

export const CANDIDATE_EVIDENCE_VERSION = 1;
export const FINGERPRINT_KEYS = ['definitions', 'locks', 'toolchain', 'environment'];
export const RUNTIME_CAPTURE_STEP = 'Record trusted execution runtime identity';
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REF = 'refs/heads/main';
const SOURCE = 'protected-workflow-run-observer';

function canonical(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Evidence must contain finite, acyclic JSON values');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Evidence must contain plain JSON objects');
  }
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${Array.from(value, item => canonical(item, seen)).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}

/** Stable SHA-256; object key order does not change identity, array order does. */
export function fingerprint(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

/** A definition/lock fingerprint binds paths AND immutable Git blob identities. */
export function fingerprintEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('At least one Git entry is required');
  const paths = new Set();
  const normalized = entries.map(entry => {
    if (!entry || typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new TypeError('Invalid Git entry path');
    }
    if (!SHA.test(entry.oid ?? '') || !/^(100644|100755|120000|160000)$/.test(entry.mode ?? '100644') || paths.has(entry.path)) {
      throw new TypeError('Invalid or duplicate Git entry');
    }
    paths.add(entry.path);
    return { path: entry.path, oid: entry.oid, mode: entry.mode ?? '100644' };
  });
  return fingerprint(normalized.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Build only from independent API + Git facts, NEVER a PR-authored manifest.
 * A fingerprint detects corruption; it is not a signature or a trust receipt.
 */
export function buildCandidateManifest(facts) {
  const { repository, suite, observer, producer, candidate, fingerprints, artifacts, observedAt } = facts;
  const payload = JSON.parse(canonical({ schemaVersion: CANDIDATE_EVIDENCE_VERSION, repository, suite, observer, producer, candidate, fingerprints, artifacts, observedAt }));
  return { ...payload, fingerprint: fingerprint(payload) };
}

export function compareFingerprints(expected, actual) {
  return FINGERPRINT_KEYS.filter(key => !DIGEST.test(expected?.[key] ?? '') || !DIGEST.test(actual?.[key] ?? '') || expected[key] !== actual[key]);
}

const positiveInt = value => Number.isSafeInteger(value) && value > 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const successful = value => value?.status === 'completed' && value?.conclusion === 'success';
const same = (a, b) => canonical(a) === canonical(b);
const checkoutProof = value => value?.verified === true && value?.source === 'github-job-log' && SHA.test(value?.sha ?? '') && SHA.test(value?.tree ?? '');

function runtimeProof({ attestation, run, job, checkout, fingerprints, spec }) {
  if (attestation?.verified !== true || attestation?.source !== 'github-job-log' || run?.apiVerified !== true || !positiveInt(run?.runId) || !positiveInt(run?.runAttempt) || !positiveInt(job?.id) || !successful(job)) return false;
  if (attestation.runId !== run.runId || attestation.runAttempt !== run.runAttempt || attestation.jobId !== job.id || attestation.checkoutSha !== checkout?.sha) return false;
  if (attestation.stepName !== RUNTIME_CAPTURE_STEP || !positiveInt(attestation.stepNumber) || !DIGEST.test(attestation.logDigest ?? '') || attestation.logDigest !== job.runtimeCaptureLogDigest) return false;
  if (!DIGEST.test(attestation.toolchainFingerprint ?? '') || !DIGEST.test(attestation.environmentFingerprint ?? '') || attestation.toolchainFingerprint !== fingerprints?.toolchain || attestation.environmentFingerprint !== fingerprints?.environment) return false;
  if (!Array.isArray(job.steps)) return false;
  const capture = job.steps.filter(step => step.name === RUNTIME_CAPTURE_STEP);
  if (capture.length !== 1 || !successful(capture[0]) || capture[0].number !== attestation.stepNumber) return false;
  return spec.executeSteps.every(name => {
    const steps = job.steps.filter(step => step.name === name);
    return steps.length === 1 && successful(steps[0]) && positiveInt(steps[0].number) && steps[0].number > attestation.stepNumber;
  });
}

function checkRuntime(evidence, current, policy, add) {
  const source = evidence.producer;
  const execution = current.execution;
  if (execution?.apiVerified !== true || execution?.repositoryId !== policy.repositoryId || execution?.workflowId !== policy.producer.workflowId || execution?.path !== policy.producer.path || !['push', 'workflow_dispatch'].includes(execution?.event) || execution?.ref !== REF || execution?.headSha !== current.checkout?.sha) add('runtime_not_attested');
  for (const spec of policy.jobs) {
    const sourceJob = source?.jobs?.find(job => job.name === spec.name);
    const mainJob = execution?.job;
    if (mainJob?.name !== spec.name || !runtimeProof({ attestation: source?.runtimeAttested, run: source, job: sourceJob, checkout: sourceJob?.checkout, fingerprints: evidence.fingerprints, spec }) || !runtimeProof({ attestation: current.runtimeAttested, run: execution, job: mainJob, checkout: current.checkout, fingerprints: current.fingerprints, spec })) add('runtime_not_attested');
  }
}

function checkPolicy(policy, add) {
  if (!positiveInt(policy?.repositoryId) || !/^[\w.-]+\/[\w.-]+$/.test(policy?.repository ?? '') || typeof policy?.suite !== 'string' || !policy.suite) add('invalid_policy');
  if (!positiveInt(policy?.observer?.workflowId) || !/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(policy?.observer?.path ?? '') || policy?.observer?.ref !== REF) add('invalid_observer_policy');
  if (!positiveInt(policy?.producer?.workflowId) || !/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(policy?.producer?.path ?? '') || !Array.isArray(policy?.producer?.events) || policy.producer.events.length === 0 || policy.producer.events.some(event => !['pull_request', 'merge_group'].includes(event))) add('invalid_producer_policy');
  if (!Array.isArray(policy?.jobs) || policy.jobs.length === 0 || new Set(policy.jobs.map(job => job.name)).size !== policy.jobs.length || policy.jobs.some(job => typeof job.name !== 'string' || !job.name || !Array.isArray(job.executeSteps) || job.executeSteps.length === 0 || job.executeSteps.some(step => typeof step !== 'string' || !step) || !Array.isArray(job.artifactNames) || job.artifactNames.length === 0 || job.artifactNames.some(name => typeof name !== 'string' || !name))) add('invalid_job_policy');
  if (policy?.maxAgeMs !== undefined && (!Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || policy.maxAgeMs > 86_400_000)) add('invalid_expiry_policy');
}

function checkAuthority(evidence, authority, policy, add) {
  const observer = evidence.observer;
  for (const fact of [observer, authority]) {
    if (fact?.source !== SOURCE || fact?.apiVerified !== true || fact?.definitionTrusted !== true || fact?.event !== 'workflow_run' || fact?.ref !== policy.observer.ref || fact?.workflowId !== policy.observer.workflowId || fact?.path !== policy.observer.path || fact?.repositoryId !== policy.repositoryId || !positiveInt(fact?.runId) || !positiveInt(fact?.runAttempt) || !SHA.test(fact?.headSha ?? '') || fact?.checkoutSha !== fact?.headSha) add('untrusted_observer');
  }
  // Authority comes from fresh GitHub API metadata OUTSIDE the manifest payload.
  // A PR can copy these strings but cannot create this receipt on the consumer.
  if (!authority || !observer || !same(observer, authority)) add('observer_authority_mismatch');
}

function checkCandidate(evidence, current, add) {
  const candidate = evidence.candidate;
  const latest = current.candidate;
  if (!positiveInt(candidate?.prNumber) || ![candidate?.baseSha, candidate?.headSha, candidate?.mergeSha, candidate?.sourceTree].every(value => SHA.test(value ?? '')) || candidate?.mergeable !== true || candidate?.headCurrent !== true || !same(candidate?.parents ?? [], [candidate?.baseSha, candidate?.headSha])) add('invalid_candidate');
  if (latest?.mergeable !== true) add('candidate_conflict_or_unknown');
  if (latest?.headCurrent !== true || latest?.prNumber !== candidate?.prNumber || latest?.headSha !== candidate?.headSha) add('candidate_head_changed');
  if (latest?.baseSha !== candidate?.baseSha) add('candidate_base_changed');
  if (!checkoutProof(current.checkout)) add('unverified_main_checkout');
  if (current.checkout?.tree !== candidate?.sourceTree) add('source_tree_changed');
  const parents = current.checkout?.parents;
  // Squash has one parent; merge has two. Both must start at the tested base.
  if (!Array.isArray(parents) || ![1, 2].includes(parents.length) || parents[0] !== candidate?.baseSha || (parents.length === 2 && parents[1] !== candidate?.headSha)) add('main_parent_changed');
}

function checkProducer(evidence, policy, add) {
  const producer = evidence.producer;
  if (producer?.apiVerified !== true || producer?.definitionTrusted !== true || producer?.repositoryId !== policy.repositoryId || producer?.workflowId !== policy.producer.workflowId || producer?.path !== policy.producer.path || !policy.producer.events.includes(producer?.event) || !positiveInt(producer?.runId) || !positiveInt(producer?.runAttempt)) add('untrusted_executor');
  if (!successful(producer)) add('producer_not_successful');
  if (!SHA.test(producer?.headSha ?? '') || (producer?.event === 'pull_request' && producer?.headSha !== evidence.candidate?.headSha) || (producer?.event === 'merge_group' && producer?.headSha !== evidence.candidate?.mergeSha)) add('producer_head_mismatch');
  const jobs = producer?.jobs;
  if (!Array.isArray(jobs) || new Set(jobs.map(job => job.name)).size !== jobs.length) { add('invalid_jobs'); return; }
  for (const spec of policy.jobs) {
    const job = jobs.find(item => item.name === spec.name);
    if (!positiveInt(job?.id) || !successful(job)) add(`job_not_successful:${spec.name}`);
    if (!Array.isArray(job?.steps) || new Set(job.steps.map(step => step.name)).size !== job.steps.length || !spec.executeSteps.every(name => successful(job.steps.find(step => step.name === name)))) add(`execution_not_proven:${spec.name}`);
    const checkout = job?.checkout;
    if (!checkoutProof(checkout) || checkout.sha !== evidence.candidate?.mergeSha || checkout.tree !== evidence.candidate?.sourceTree || checkout.baseSha !== evidence.candidate?.baseSha || checkout.headSha !== evidence.candidate?.headSha) add(`checkout_not_proven:${spec.name}`);
  }
}

function checkArtifacts(evidence, policy, add) {
  const artifacts = evidence.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0 || new Set(artifacts.map(item => item.id)).size !== artifacts.length || new Set(artifacts.map(item => item.name)).size !== artifacts.length) { add('invalid_artifacts'); return; }
  for (const artifact of artifacts) {
    if (!positiveInt(artifact?.id) || typeof artifact?.name !== 'string' || !artifact.name || artifact?.apiVerified !== true || artifact?.expired !== false || !positiveInt(artifact?.sizeInBytes) || !DIGEST.test(artifact?.digest ?? '') || artifact?.runId !== evidence.producer?.runId || artifact?.runAttempt !== evidence.producer?.runAttempt) add('artifact_unverified_or_expired');
  }
  if (!policy.jobs.flatMap(job => job.artifactNames).every(name => artifacts.some(artifact => artifact.name === name))) add('required_artifact_missing');
}

function checkHistory(evidence, history, policy, add) {
  if (!Array.isArray(history) || history.length === 0) { add('history_missing'); return; }
  const producer = evidence.producer;
  const started = Date.parse(producer.startedAt);
  let sourceFound = false;
  for (const attempt of history) {
    if (attempt?.apiVerified !== true || attempt?.repositoryId !== policy.repositoryId || attempt?.workflowId !== policy.producer.workflowId || attempt?.suite !== policy.suite || !positiveInt(attempt?.runId) || !positiveInt(attempt?.runAttempt) || !validTime(attempt?.startedAt)) { add('history_unverified'); continue; }
    const source = attempt.runId === producer.runId && attempt.runAttempt === producer.runAttempt;
    const newer = Date.parse(attempt.startedAt) >= started || (attempt.runId === producer.runId && attempt.runAttempt > producer.runAttempt);
    const candidate = attempt.candidate;
    if (!positiveInt(candidate?.prNumber) || !SHA.test(candidate?.baseSha ?? '') || !SHA.test(candidate?.headSha ?? '')) { if (newer || source) add('newer_attempt_identity_unknown'); continue; }
    if (source) {
      sourceFound = true;
      if (!successful(attempt) || candidate.prNumber !== evidence.candidate.prNumber || candidate.baseSha !== evidence.candidate.baseSha || candidate.headSha !== evidence.candidate.headSha) add('source_attempt_changed');
    } else if (newer && candidate.prNumber === evidence.candidate.prNumber) {
      if (candidate.baseSha !== evidence.candidate.baseSha || candidate.headSha !== evidence.candidate.headSha) add('newer_candidate_changed');
      // A newer success has its own manifest. Do not fall back to an older one.
      add(successful(attempt) ? 'newer_evidence_required' : 'newer_attempt_not_successful');
    }
  }
  if (!sourceFound) add('source_attempt_missing');
}

/**
 * Compare an authenticated observer manifest with the ACTUAL main checkout.
 * `readStatus=ok` means all GitHub history pages, jobs, artifacts and Git objects
 * were obtained. Permission errors, partial history and exceptions are fallbacks.
 * `authority` MUST be independently derived by the consumer, not copied from JSON.
 * A runtime attestation binds runId/runAttempt/jobId/checkoutSha, the fixed
 * RUNTIME_CAPTURE_STEP and stepNumber, a logDigest equal to the protected
 * adapter's job.runtimeCaptureLogDigest, and both runtime fingerprints.
 * Main supplies current.execution with independently verified repository and
 * workflow identity, run/attempt, main head/ref/event, and complete API job facts.
 * These digests detect mismatches; none substitutes for authenticating the logs
 * or proving that runtime capture occurred before any untrusted candidate code.
 * Inputs and output are JSON. No code, download or token operations occur here.
 */
export function evaluateShadow(options = {}) {
  const result = { schemaVersion: CANDIDATE_EVIDENCE_VERSION, mode: 'shadow', skip: false, runFull: true, wouldReuse: false, reasons: [], sourceRun: null, evidenceFingerprint: null };
  const add = reason => { if (!result.reasons.includes(reason)) result.reasons.push(reason); };
  try {
    options = options ?? {};
    result.mode = options.mode ?? 'shadow';
    const { evidence, current, policy, authority, latestAttempts, readStatus, freshRun = false, now = Date.now() } = options;
    if (result.mode !== 'shadow') add(result.mode === 'disabled' ? 'reuse_disabled' : 'reuse_not_approved');
    if (freshRun) add('fresh_run_requested');
    if (readStatus !== 'ok') add('evidence_lookup_failed');
    if (!Number.isFinite(now)) add('invalid_clock');
    checkPolicy(policy, add);
    if (result.reasons.length) return result;
    if (!evidence || evidence.schemaVersion !== CANDIDATE_EVIDENCE_VERSION) { add('evidence_missing_or_version_unknown'); return result; }
    const { fingerprint: recorded, ...payload } = evidence;
    if (!DIGEST.test(recorded ?? '') || recorded !== fingerprint(payload)) add('manifest_fingerprint_mismatch');
    result.evidenceFingerprint = recorded ?? null;
    if (evidence.repository?.id !== policy.repositoryId || evidence.repository?.fullName !== policy.repository || evidence.suite !== policy.suite || current?.repositoryId !== policy.repositoryId || current?.suite !== policy.suite) add('repository_or_suite_mismatch');
    if (!current) { add('current_checkout_missing'); return result; }
    checkAuthority(evidence, authority, policy, add);
    checkCandidate(evidence, current, add);
    checkProducer(evidence, policy, add);
    checkArtifacts(evidence, policy, add);
    // An early host fingerprint cannot attest later installed tools or images.
    // Protected adapter facts must bind the execution capture to GitHub jobs,
    // attempts, ordered steps and fingerprints. A log digest is NOT a signature.
    // Host-only or unavailable/dynamic runtime information stays verified=false.
    checkRuntime(evidence, current, policy, add);
    for (const key of compareFingerprints(evidence.fingerprints, current.fingerprints)) add(`fingerprint_changed:${key}`);
    const started = Date.parse(evidence.producer?.startedAt);
    const completed = Date.parse(evidence.producer?.completedAt);
    const observed = Date.parse(evidence.observedAt);
    if (![started, completed, observed].every(Number.isFinite) || started > completed || completed > observed || observed > now) add('invalid_evidence_time');
    if (now - completed >= (policy.maxAgeMs ?? 86_400_000)) add('evidence_expired');
    checkHistory(evidence, latestAttempts, policy, add);
    result.wouldReuse = result.reasons.length === 0;
    if (result.wouldReuse) result.sourceRun = `https://github.com/${policy.repository}/actions/runs/${evidence.producer.runId}/attempts/${evidence.producer.runAttempt}`;
  } catch {
    result.wouldReuse = false;
    add('validation_exception');
  }
  return result;
}
