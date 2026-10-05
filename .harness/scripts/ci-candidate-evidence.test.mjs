import assert from 'node:assert/strict';
import { buildCandidateManifest, compareFingerprints, evaluateShadow, fingerprint, fingerprintEntries, RUNTIME_CAPTURE_STEP } from './lib/ci-candidate-evidence.mjs';

// The harness CI discovers .test.mjs with Vitest; node --test is also the
// dependency-free independent remeasurement entry point.
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');

const now = Date.parse('2026-10-05T12:00:00Z');
const sha = character => character.repeat(40);
const time = seconds => new Date(now + seconds * 1000).toISOString();
const baseSha = sha('a');
const headSha = sha('b');
const mergeSha = sha('c');
const sourceTree = sha('d');
const observerSha = sha('e');
const mainSha = sha('f');
const success = { status: 'completed', conclusion: 'success' };

function fixture() {
  const observer = { source: 'protected-workflow-run-observer', apiVerified: true, definitionTrusted: true, event: 'workflow_run', repositoryId: 42, workflowId: 7, path: '.github/workflows/ci-candidate-observer.yml', ref: 'refs/heads/main', runId: 300, runAttempt: 1, headSha: observerSha, checkoutSha: observerSha };
  const fingerprints = {
    definitions: fingerprintEntries([{ path: '.github/workflows/harness-verify.yml', oid: sha('1') }, { path: 'apps/web/e2e/core.spec.ts', oid: sha('2') }]),
    locks: fingerprintEntries([{ path: 'pnpm-lock.yaml', oid: sha('3') }]),
    toolchain: fingerprint({ node: '22.20.0', pnpm: '9.15.0', python: '3.12.3', docker: '28.4.0' }),
    environment: fingerprint({ runnerImage: 'ubuntu-24.04', runnerImageVersion: '20260928.18', os: 'Linux', arch: 'X64' }),
  };
  const facts = {
    repository: { id: 42, fullName: 'boardx/workspacex' }, suite: 'harness/fullstack-smoke', observer,
    producer: { apiVerified: true, definitionTrusted: true, runtimeAttested: { verified: true, source: 'github-job-log' }, repositoryId: 42, workflowId: 9, path: '.github/workflows/harness-verify.yml', runId: 100, runAttempt: 1, event: 'pull_request', headSha, ...success, startedAt: time(-3600), completedAt: time(-3300), jobs: [{ id: 101, name: 'fullstack-smoke', ...success, steps: [{ name: 'Execute trusted full-stack smoke', ...success }, { name: 'Upload runtime evidence', ...success }], checkout: { sha: mergeSha, tree: sourceTree, baseSha, headSha, verified: true, source: 'github-job-log' } }] },
    candidate: { prNumber: 4000, baseSha, headSha, mergeSha, sourceTree, parents: [baseSha, headSha], mergeable: true, headCurrent: true }, fingerprints,
    artifacts: [{ id: 201, name: 'runtime-100', runId: 100, runAttempt: 1, apiVerified: true, expired: false, sizeInBytes: 2048, digest: fingerprint('actual artifact archive bytes') }], observedAt: time(-3000),
  };
  const policy = { repositoryId: 42, repository: 'boardx/workspacex', suite: facts.suite, observer: { workflowId: 7, path: observer.path, ref: observer.ref }, producer: { workflowId: 9, path: facts.producer.path, events: ['pull_request', 'merge_group'] }, jobs: [{ name: 'fullstack-smoke', executeSteps: ['Execute trusted full-stack smoke', 'Upload runtime evidence'], artifactNames: ['runtime-100'] }], maxAgeMs: 86_400_000 };
  const current = { repositoryId: 42, suite: facts.suite, runtimeAttested: { verified: true, source: 'github-job-log' }, checkout: { sha: mainSha, tree: sourceTree, parents: [baseSha], verified: true, source: 'github-job-log' }, candidate: { prNumber: 4000, baseSha, headSha, headCurrent: true, mergeable: true }, fingerprints: { ...fingerprints } };
  const latestAttempts = [{ apiVerified: true, repositoryId: 42, workflowId: 9, suite: facts.suite, runId: 100, runAttempt: 1, candidate: { prNumber: 4000, baseSha, headSha }, startedAt: time(-3600), ...success }];
  // Synthetic oracle only: these complete API/log facts model a future protected
  // runtime capture. They are NOT an attestation of a real CI runtime. Today's
  // adapter deliberately reports pre-install host captures as verified=false.
  const sourceJob = facts.producer.jobs[0];
  sourceJob.steps = [{ name: RUNTIME_CAPTURE_STEP, number: 1, ...success }, ...sourceJob.steps.map((step, index) => ({ ...step, number: index + 2 }))];
  sourceJob.runtimeCaptureLogDigest = fingerprint('independently fetched source capture log');
  facts.producer.runtimeAttested = { verified: true, source: 'github-job-log', runId: 100, runAttempt: 1, jobId: sourceJob.id, checkoutSha: mergeSha, stepName: RUNTIME_CAPTURE_STEP, stepNumber: 1, logDigest: sourceJob.runtimeCaptureLogDigest, toolchainFingerprint: fingerprints.toolchain, environmentFingerprint: fingerprints.environment };
  const mainJob = { id: 501, name: sourceJob.name, ...success, steps: sourceJob.steps.map(step => ({ ...step })), runtimeCaptureLogDigest: fingerprint('independently fetched main capture log') };
  current.execution = { apiVerified: true, repositoryId: 42, workflowId: 9, path: facts.producer.path, event: 'push', ref: 'refs/heads/main', runId: 500, runAttempt: 1, headSha: mainSha, job: mainJob };
  current.runtimeAttested = { ...facts.producer.runtimeAttested, runId: 500, jobId: mainJob.id, checkoutSha: mainSha, logDigest: mainJob.runtimeCaptureLogDigest };
  return { facts, current, policy, authority: { ...observer }, latestAttempts, readStatus: 'ok', mode: 'shadow', now };
}

function evaluate(value) {
  return evaluateShadow({ ...value, evidence: value.evidence ?? buildCandidateManifest(value.facts) });
}

function assertFallback(result, reason) {
  assert.equal(result.skip, false);
  assert.equal(result.runFull, true);
  assert.equal(result.wouldReuse, false);
  assert.equal(result.sourceRun, null);
  if (reason) assert.ok(result.reasons.includes(reason), `Expected ${reason}; received ${result.reasons.join(', ')}`);
}

describe('immutable fingerprints', () => {
  it('canonicalizes object key order while retaining array order', () => {
    assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
    assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
  });
  it('binds definition paths, blob identities and executable modes', () => {
    const entries = [{ path: 'a.mjs', oid: sha('1') }, { path: 'b.mjs', oid: sha('2') }];
    assert.equal(fingerprintEntries(entries), fingerprintEntries([...entries].reverse()));
    assert.notEqual(fingerprintEntries(entries), fingerprintEntries([{ ...entries[0], path: 'renamed.mjs' }, entries[1]]));
    assert.notEqual(fingerprintEntries(entries), fingerprintEntries([{ ...entries[0], oid: sha('3') }, entries[1]]));
    assert.notEqual(fingerprintEntries(entries), fingerprintEntries([{ ...entries[0], mode: '100755' }, entries[1]]));
  });
  for (const path of ['', '/absolute', '../escape', 'x/../escape', 'x//a', 'x\\a', './a']) {
    it(`rejects ambiguous definition path ${JSON.stringify(path)}`, () => assert.throws(() => fingerprintEntries([{ path, oid: sha('1') }])));
  }
  it('rejects empty and duplicate entry sets', () => {
    assert.throws(() => fingerprintEntries([]));
    assert.throws(() => fingerprintEntries([{ path: 'a', oid: sha('1') }, { path: 'a', oid: sha('2') }]));
  });
  for (const value of [undefined, NaN, Infinity, new Date(), new Array(1), { field: undefined }]) {
    it(`rejects non-JSON fingerprint inputs (${String(value)})`, () => assert.throws(() => fingerprint(value)));
  }
  it('rejects circular values', () => {
    const circular = {}; circular.self = circular;
    assert.throws(() => fingerprint(circular));
  });
  it('reports every absent or changed fingerprint', () => assert.deepEqual(compareFingerprints({}, {}), ['definitions', 'locks', 'toolchain', 'environment']));
});

describe('synthetic successful shadow oracle still executes all validation', () => {
  it('accepts a squash with different SHA, identical complete tree and tested parent', () => {
    const value = fixture();
    assert.notEqual(value.current.checkout.sha, value.facts.candidate.mergeSha);
    const result = evaluate(value);
    assert.equal(result.wouldReuse, true);
    assert.equal(result.skip, false);
    assert.equal(result.runFull, true);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.sourceRun, 'https://github.com/boardx/workspacex/actions/runs/100/attempts/1');
  });
  it('accepts a merge with exactly the tested base and head parents', () => {
    const value = fixture(); value.current.checkout.parents.push(headSha);
    assert.equal(evaluate(value).wouldReuse, true);
  });
  it('supports authenticated merge-group execution', () => {
    const value = fixture(); value.facts.producer.event = 'merge_group'; value.facts.producer.headSha = mergeSha;
    assert.equal(evaluate(value).wouldReuse, true);
  });
  it('ignores a fully identified older failure and unrelated PR measurement', () => {
    const value = fixture();
    value.latestAttempts.push({ ...value.latestAttempts[0], runId: 80, conclusion: 'failure', startedAt: time(-7200) });
    value.latestAttempts.push({ ...value.latestAttempts[0], runId: 200, conclusion: 'failure', startedAt: time(-1200), candidate: { ...value.latestAttempts[0].candidate, prNumber: 4001 } });
    assert.equal(evaluate(value).wouldReuse, true);
  });
  it('does not mutate inputs', () => {
    const value = fixture(); const before = JSON.stringify(value); evaluate(value);
    assert.equal(JSON.stringify(value), before);
  });
});

const negatives = [
  ['missing evidence', value => { value.evidence = {}; }, 'evidence_missing_or_version_unknown'],
  ['unknown evidence version', value => { value.evidence = { ...buildCandidateManifest(value.facts), schemaVersion: 2 }; }, 'evidence_missing_or_version_unknown'],
  ['corrupted manifest', value => { value.evidence = buildCandidateManifest(value.facts); value.evidence.suite = 'other'; }, 'manifest_fingerprint_mismatch'],
  ['source repository rename', value => { value.facts.repository.fullName = 'evil/workspacex'; }, 'repository_or_suite_mismatch'],
  ['source repository numeric identity', value => { value.facts.repository.id = 43; }, 'repository_or_suite_mismatch'],
  ['consumer repository identity', value => { value.current.repositoryId = 43; }, 'repository_or_suite_mismatch'],
  ['wrong consumer suite', value => { value.current.suite = 'harness/full-regression-core'; }, 'repository_or_suite_mismatch'],
  ['PR self-reported authority', value => { value.authority.source = 'pull-request-artifact'; }, 'untrusted_observer'],
  ['PR JSON masquerading as observer', value => { value.facts.observer.source = 'pull-request-artifact'; value.authority = { ...value.facts.observer }; }, 'untrusted_observer'],
  ['missing independently authenticated authority', value => { value.authority = null; }, 'untrusted_observer'],
  ['observer API not verified', value => { value.authority.apiVerified = false; }, 'untrusted_observer'],
  ['observer definition not trusted', value => { value.authority.definitionTrusted = false; }, 'untrusted_observer'],
  ['observer ran on PR branch', value => { value.authority.ref = 'refs/pull/4000/merge'; }, 'untrusted_observer'],
  ['observer has wrong event', value => { value.authority.event = 'pull_request'; }, 'untrusted_observer'],
  ['observer workflow identity changed', value => { value.authority.workflowId++; }, 'untrusted_observer'],
  ['observer path changed', value => { value.authority.path = '.github/workflows/untrusted.yml'; }, 'untrusted_observer'],
  ['observer checked out another revision', value => { value.authority.checkoutSha = baseSha; }, 'untrusted_observer'],
  ['observer receipt attempt mismatch', value => { value.authority.runAttempt++; }, 'observer_authority_mismatch'],
  ['producer executed in fork', value => { value.facts.producer.repositoryId = 43; }, 'untrusted_executor'],
  ['producer API not verified', value => { value.facts.producer.apiVerified = false; }, 'untrusted_executor'],
  ['producer definition changed from protected base', value => { value.facts.producer.definitionTrusted = false; }, 'untrusted_executor'],
  ['source runtime attestation absent', value => { delete value.facts.producer.runtimeAttested; }, 'runtime_not_attested'],
  ['main runtime attestation absent', value => { delete value.current.runtimeAttested; }, 'runtime_not_attested'],
  ['source runtime unavailable', value => { value.facts.producer.runtimeAttested.verified = false; }, 'runtime_not_attested'],
  ['main runtime unavailable', value => { value.current.runtimeAttested.verified = false; }, 'runtime_not_attested'],
  ['pre-install host cannot attest later container tools', value => { value.facts.producer.runtimeAttested.source = 'pre-install-host-only'; }, 'runtime_not_attested'],
  ['main pre-install host cannot attest dynamic tools', value => { value.current.runtimeAttested.source = 'pre-install-host-only'; }, 'runtime_not_attested'],
  ['PR self-reported runtime attestation', value => { value.facts.producer.runtimeAttested.source = 'pr-json'; }, 'runtime_not_attested'],
  ['empty source runtime claim', value => { value.facts.producer.runtimeAttested = { verified: true, source: 'github-job-log' }; }, 'runtime_not_attested'],
  ['empty main runtime claim', value => { value.current.runtimeAttested = { verified: true, source: 'github-job-log' }; }, 'runtime_not_attested'],
  ['source runtime swapped run', value => { value.facts.producer.runtimeAttested.runId++; }, 'runtime_not_attested'],
  ['source runtime swapped attempt', value => { value.facts.producer.runtimeAttested.runAttempt++; }, 'runtime_not_attested'],
  ['source runtime swapped job', value => { value.facts.producer.runtimeAttested.jobId++; }, 'runtime_not_attested'],
  ['source runtime swapped checkout', value => { value.facts.producer.runtimeAttested.checkoutSha = headSha; }, 'runtime_not_attested'],
  ['source runtime wrong step', value => { value.facts.producer.runtimeAttested.stepName = 'Print arbitrary JSON'; }, 'runtime_not_attested'],
  ['source runtime wrong step number', value => { value.facts.producer.runtimeAttested.stepNumber++; }, 'runtime_not_attested'],
  ['source runtime unknown log digest', value => { delete value.facts.producer.runtimeAttested.logDigest; }, 'runtime_not_attested'],
  ['source runtime altered log digest', value => { value.facts.producer.runtimeAttested.logDigest = fingerprint('forged'); }, 'runtime_not_attested'],
  ['source runtime log facts missing', value => { delete value.facts.producer.jobs[0].runtimeCaptureLogDigest; }, 'runtime_not_attested'],
  ['source runtime swapped toolchain fingerprint', value => { value.facts.producer.runtimeAttested.toolchainFingerprint = fingerprint('other tools'); }, 'runtime_not_attested'],
  ['source runtime swapped environment fingerprint', value => { value.facts.producer.runtimeAttested.environmentFingerprint = fingerprint('other container'); }, 'runtime_not_attested'],
  ['source runtime fixed capture did not execute', value => { value.facts.producer.jobs[0].steps[0].conclusion = 'skipped'; }, 'runtime_not_attested'],
  ['source runtime recorded after executed test', value => { value.facts.producer.jobs[0].steps[1].number = 1; }, 'runtime_not_attested'],
  ['source test order unknown', value => { delete value.facts.producer.jobs[0].steps[1].number; }, 'runtime_not_attested'],
  ['main runtime execution API fact missing', value => { delete value.current.execution; }, 'runtime_not_attested'],
  ['main runtime execution not API verified', value => { value.current.execution.apiVerified = false; }, 'runtime_not_attested'],
  ['main runtime execution wrong repository', value => { value.current.execution.repositoryId++; }, 'runtime_not_attested'],
  ['main runtime execution wrong workflow', value => { value.current.execution.workflowId++; }, 'runtime_not_attested'],
  ['main runtime execution wrong path', value => { value.current.execution.path = '.github/workflows/untrusted.yml'; }, 'runtime_not_attested'],
  ['main runtime execution wrong event', value => { value.current.execution.event = 'pull_request'; }, 'runtime_not_attested'],
  ['main runtime execution wrong ref', value => { value.current.execution.ref = 'refs/pull/4000/merge'; }, 'runtime_not_attested'],
  ['main runtime execution wrong checkout', value => { value.current.execution.headSha = mergeSha; }, 'runtime_not_attested'],
  ['main runtime swapped attempt', value => { value.current.runtimeAttested.runAttempt++; }, 'runtime_not_attested'],
  ['main runtime swapped job', value => { value.current.runtimeAttested.jobId++; }, 'runtime_not_attested'],
  ['main runtime altered log digest', value => { value.current.runtimeAttested.logDigest = fingerprint('forged'); }, 'runtime_not_attested'],
  ['main runtime capture cannot follow execution', value => { value.current.execution.job.steps[1].number = 1; }, 'runtime_not_attested'],
  ['producer workflow identity changed', value => { value.facts.producer.workflowId++; }, 'untrusted_executor'],
  ['producer workflow path changed', value => { value.facts.producer.path = '.github/workflows/untrusted.yml'; }, 'untrusted_executor'],
  ['producer push self report', value => { value.facts.producer.event = 'push'; }, 'untrusted_executor'],
  ['producer source head mismatch', value => { value.facts.producer.headSha = baseSha; }, 'producer_head_mismatch'],
  ['merge-group source head mismatch', value => { value.facts.producer.event = 'merge_group'; }, 'producer_head_mismatch'],
  ['candidate head changed', value => { value.current.candidate.headSha = sha('1'); }, 'candidate_head_changed'],
  ['candidate branch has new commits', value => { value.current.candidate.headCurrent = false; }, 'candidate_head_changed'],
  ['candidate base changed', value => { value.current.candidate.baseSha = sha('1'); }, 'candidate_base_changed'],
  ['candidate identity changed', value => { value.current.candidate.prNumber++; }, 'candidate_head_changed'],
  ['candidate merge conflict', value => { value.current.candidate.mergeable = false; }, 'candidate_conflict_or_unknown'],
  ['candidate merge state unknown', value => { delete value.current.candidate.mergeable; }, 'candidate_conflict_or_unknown'],
  ['candidate merge parents unknown', value => { value.facts.candidate.parents = []; }, 'invalid_candidate'],
  ['unverified candidate merge', value => { value.facts.candidate.mergeable = false; }, 'invalid_candidate'],
  ['main parent changed while source tree identical', value => { value.current.checkout.parents = [sha('1')]; }, 'main_parent_changed'],
  ['merge has different second parent', value => { value.current.checkout.parents = [baseSha, sha('1')]; }, 'main_parent_changed'],
  ['octopus merge', value => { value.current.checkout.parents = [baseSha, headSha, sha('1')]; }, 'main_parent_changed'],
  ['main source changed even when SHA claim matches', value => { value.current.checkout.sha = mergeSha; value.current.checkout.tree = sha('1'); }, 'source_tree_changed'],
  ['main checkout was self reported', value => { value.current.checkout.source = 'pr-json'; }, 'unverified_main_checkout'],
  ['main checkout not observed', value => { value.current.checkout.verified = false; }, 'unverified_main_checkout'],
  ['job checked out head instead of candidate merge', value => { value.facts.producer.jobs[0].checkout.sha = headSha; }, 'checkout_not_proven:fullstack-smoke'],
  ['job checked out a different tree', value => { value.facts.producer.jobs[0].checkout.tree = sha('1'); }, 'checkout_not_proven:fullstack-smoke'],
  ['job checkout report supplied by PR', value => { value.facts.producer.jobs[0].checkout.source = 'pr-json'; }, 'checkout_not_proven:fullstack-smoke'],
  ['job checkout marker not verified', value => { value.facts.producer.jobs[0].checkout.verified = false; }, 'checkout_not_proven:fullstack-smoke'],
  ['missing actual job', value => { value.facts.producer.jobs = []; }, 'job_not_successful:fullstack-smoke'],
  ['duplicate job names', value => { value.facts.producer.jobs.push({ ...value.facts.producer.jobs[0], id: 102 }); }, 'invalid_jobs'],
  ['duplicate execution markers', value => { value.facts.producer.jobs[0].steps.push({ ...value.facts.producer.jobs[0].steps[1] }); }, 'execution_not_proven:fullstack-smoke'],
  ['no actual executed step', value => { value.facts.producer.jobs[0].steps = []; }, 'execution_not_proven:fullstack-smoke'],
  ['continue-on-error cannot hide failure', value => { value.facts.producer.jobs[0].steps[1].conclusion = 'failure'; }, 'execution_not_proven:fullstack-smoke'],
  ['no retained artifacts', value => { value.facts.artifacts = []; }, 'invalid_artifacts'],
  ['artifact digest absent', value => { delete value.facts.artifacts[0].digest; }, 'artifact_unverified_or_expired'],
  ['artifact digest self reported', value => { value.facts.artifacts[0].apiVerified = false; }, 'artifact_unverified_or_expired'],
  ['expired artifact', value => { value.facts.artifacts[0].expired = true; }, 'artifact_unverified_or_expired'],
  ['empty artifact', value => { value.facts.artifacts[0].sizeInBytes = 0; }, 'artifact_unverified_or_expired'],
  ['artifact from another run', value => { value.facts.artifacts[0].runId++; }, 'artifact_unverified_or_expired'],
  ['artifact from old run attempt', value => { value.facts.artifacts[0].runAttempt++; }, 'artifact_unverified_or_expired'],
  ['missing required suite artifact', value => { value.facts.artifacts[0].name = 'irrelevant'; }, 'required_artifact_missing'],
  ['duplicate artifact identity', value => { value.facts.artifacts.push({ ...value.facts.artifacts[0] }); }, 'invalid_artifacts'],
  ['future observation', value => { value.facts.observedAt = time(1); }, 'invalid_evidence_time'],
  ['unknown completion time', value => { value.facts.producer.completedAt = 'unknown'; }, 'invalid_evidence_time'],
  ['completion before start', value => { value.facts.producer.completedAt = time(-3700); }, 'invalid_evidence_time'],
  ['evidence at expiry boundary', value => { value.now = Date.parse(value.facts.producer.completedAt) + 86_400_000; }, 'evidence_expired'],
  ['no history', value => { value.latestAttempts = []; }, 'history_missing'],
  ['partial history omits source', value => { value.latestAttempts[0].runId++; value.latestAttempts[0].startedAt = time(-7200); }, 'source_attempt_missing'],
  ['permission denied', value => { value.readStatus = 'permission-denied'; }, 'evidence_lookup_failed'],
  ['history pagination incomplete', value => { value.readStatus = 'incomplete'; }, 'evidence_lookup_failed'],
  ['API exception', value => { value.readStatus = 'exception'; }, 'evidence_lookup_failed'],
  ['unverified source history', value => { value.latestAttempts[0].apiVerified = false; }, 'history_unverified'],
  ['source attempt changed to failed', value => { value.latestAttempts[0].conclusion = 'failure'; }, 'source_attempt_changed'],
  ['source history identity altered', value => { value.latestAttempts[0].candidate.headSha = sha('1'); }, 'source_attempt_changed'],
  ['unknown newer candidate identity', value => { value.latestAttempts.push({ ...value.latestAttempts[0], runId: 200, startedAt: time(-1200), candidate: null }); }, 'newer_attempt_identity_unknown'],
  ['newer same PR has new head', value => { value.latestAttempts.push({ ...value.latestAttempts[0], runId: 200, startedAt: time(-1200), candidate: { ...value.latestAttempts[0].candidate, headSha: sha('1') } }); }, 'newer_candidate_changed'],
  ['newer success requires its own authenticated manifest', value => { value.latestAttempts.push({ ...value.latestAttempts[0], runId: 200, startedAt: time(-1200) }); }, 'newer_evidence_required'],
  ['explicit independent rerun', value => { value.freshRun = true; }, 'fresh_run_requested'],
  ['unapproved production reuse mode', value => { value.mode = 'reuse'; }, 'reuse_not_approved'],
  ['disabled comparison', value => { value.mode = 'disabled'; }, 'reuse_disabled'],
  ['unknown clock', value => { value.now = NaN; }, 'invalid_clock'],
  ['overly long reuse validity policy', value => { value.policy.maxAgeMs = 86_400_001; }, 'invalid_expiry_policy'],
  ['empty required execution policy', value => { value.policy.jobs[0].executeSteps = []; }, 'invalid_job_policy'],
  ['unprotected observer policy', value => { value.policy.observer.ref = 'refs/heads/feature'; }, 'invalid_observer_policy'],
];

describe('all negative paths fail closed', () => {
  for (const [name, mutate, reason] of negatives) it(name, () => { const value = fixture(); mutate(value); assertFallback(evaluate(value), reason); });
  for (const key of ['definitions', 'locks', 'toolchain', 'environment']) {
    it(`${key} change invalidates evidence`, () => { const value = fixture(); value.current.fingerprints[key] = fingerprint('changed'); assertFallback(evaluate(value), `fingerprint_changed:${key}`); });
    it(`${key} fingerprint absent invalidates evidence`, () => { const value = fixture(); delete value.current.fingerprints[key]; assertFallback(evaluate(value), `fingerprint_changed:${key}`); });
  }
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', null, 'unknown']) {
    it(`producer ${conclusion} is never reusable`, () => { const value = fixture(); value.facts.producer.conclusion = conclusion; assertFallback(evaluate(value), 'producer_not_successful'); });
    it(`executed step ${conclusion} is never reusable`, () => { const value = fixture(); value.facts.producer.jobs[0].steps[1].conclusion = conclusion; assertFallback(evaluate(value), 'execution_not_proven:fullstack-smoke'); });
    it(`newer attempt ${conclusion} invalidates old success`, () => { const value = fixture(); value.latestAttempts.push({ ...value.latestAttempts[0], runId: 200, conclusion, startedAt: time(-1200) }); assertFallback(evaluate(value), 'newer_attempt_not_successful'); });
  }
  it('in-progress newer attempt invalidates old success', () => {
    const value = fixture(); value.latestAttempts.push({ ...value.latestAttempts[0], runId: 200, status: 'in_progress', conclusion: null, startedAt: time(-1200) });
    assertFallback(evaluate(value), 'newer_attempt_not_successful');
  });
  it('rerun of older run invalidates newer-created successful run', () => {
    const value = fixture(); value.latestAttempts.push({ ...value.latestAttempts[0], runId: 80, runAttempt: 2, conclusion: 'failure', startedAt: time(-1200) });
    assertFallback(evaluate(value), 'newer_attempt_not_successful');
  });
  it('newer attempt of source invalidates it despite malformed backdated timestamp', () => {
    const value = fixture(); value.latestAttempts.push({ ...value.latestAttempts[0], runAttempt: 2, conclusion: 'cancelled', startedAt: time(-7200) });
    assertFallback(evaluate(value), 'newer_attempt_not_successful');
  });
  it('unknown inputs do not throw', () => {
    for (const value of [undefined, null, {}, { evidence: null }, { policy: {} }]) assertFallback(evaluateShadow(value));
  });
  it('validation exceptions never yield success', () => {
    const value = fixture(); value.evidence = buildCandidateManifest(value.facts); value.evidence.circular = value.evidence;
    assertFallback(evaluateShadow(value), 'validation_exception');
    assertFallback(evaluateShadow({ get mode() { throw new Error('malformed'); } }), 'validation_exception');
  });
});
