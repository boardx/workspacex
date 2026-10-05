import assert from 'node:assert/strict';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
import { readConsistentCandidateHistory, withConsistentCandidateHistory } from './lib/ci-candidate-history.mjs';

const oid = value => value.repeat(40);
const B = oid('1'), H = oid('2'), S = oid('3');
const PATH = '.github/workflows/harness-verify.yml';
const REPO = { id: 7, full_name: 'boardx/workspacex' };
const now = Date.parse('2026-10-05T12:00:00Z');
const success = { status: 'completed', conclusion: 'success' };
const options = { repository: { id: REPO.id, fullName: REPO.full_name }, workflowId: 10, workflowPath: PATH, prNumber: 9, sourceRunId: 100, sourceRunAttempt: 1, eligibleEvents: ['pull_request', 'merge_group'], suite: 'fullstack-smoke', now, expectedCandidate: { baseSha: B, headSha: H } };

function run(id, extras = {}) {
  return { id, run_attempt: 1, workflow_id: 10, path: PATH, event: 'pull_request', head_sha: H, head_branch: 'worker/candidate', repository: REPO, head_repository: REPO, created_at: '2026-10-05T10:00:00Z', run_started_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:20:00Z', pull_requests: [{ number: 9, base: { sha: B }, head: { sha: H } }], ...success, ...extras };
}
function fixture() {
  const source = run(100);
  const old = run(90, { created_at: '2026-10-04T10:00:00Z', run_started_at: '2026-10-04T10:00:00Z', updated_at: '2026-10-04T10:20:00Z', conclusion: 'failure' });
  const main = run(99, { event: 'push', head_sha: S, head_branch: 'main', pull_requests: [] });
  const pull = { number: 9, state: 'closed', merged: true, mergeable: null, merge_commit_sha: S, updated_at: '2026-10-05T10:30:00Z', base: { sha: S, ref: 'main', repo: REPO }, head: { sha: H, repo: REPO } };
  const jobs = [{ id: 101, run_id: 100, name: 'fullstack-smoke', ...success, started_at: '2026-10-05T10:00:01Z', completed_at: '2026-10-05T10:19:00Z', runner_id: 40, runner_group_id: 0, labels: ['ubuntu-latest'], steps: [{ number: 1, name: 'Checkout', ...success, started_at: '2026-10-05T10:00:01Z', completed_at: '2026-10-05T10:00:05Z' }, { number: 2, name: 'Execute smoke', ...success, started_at: '2026-10-05T10:02:00Z', completed_at: '2026-10-05T10:19:00Z' }] }];
  const artifacts = [{ id: 201, name: 'smoke-100', digest: `sha256:${'a'.repeat(64)}`, size_in_bytes: 120, expired: false, created_at: '2026-10-05T10:19:30Z', updated_at: '2026-10-05T10:19:30Z', expires_at: '2026-10-19T10:19:30Z', workflow_run: { id: 100, head_sha: H } }];
  const state = { source, pull, jobs, artifacts, scope: [source, main, old], attempts: {}, calls: [], counts: new Map(), pageSize: 100, before: null };
  const pages = (items, page) => ({ total_count: items.length, items: items.slice((page - 1) * state.pageSize, page * state.pageSize) });
  const api = async path => {
    state.calls.push(path);
    state.counts.set(path, (state.counts.get(path) ?? 0) + 1);
    if (state.before) await state.before(path, state.counts.get(path), state);
    if (path === '/pulls/9') return structuredClone(state.pull);
    if (path === '/actions/runs/100') return structuredClone(state.source);
    const attempts = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(path);
    if (attempts) return structuredClone(state.attempts[`${attempts[1]}:${attempts[2]}`] ?? state.scope.find(item => item.id === Number(attempts[1]) && item.run_attempt === Number(attempts[2])));
    const history = /^\/actions\/workflows\/10\/runs\?per_page=100&page=(\d+)$/.exec(path);
    if (history) { const result = pages(state.scope, Number(history[1])); return { total_count: result.total_count, workflow_runs: structuredClone(result.items) }; }
    const jobsPath = /^\/actions\/runs\/100\/attempts\/1\/jobs\?per_page=100&page=(\d+)$/.exec(path);
    if (jobsPath) { const result = pages(state.jobs, Number(jobsPath[1])); return { total_count: result.total_count, jobs: structuredClone(result.items) }; }
    const artifactsPath = /^\/actions\/runs\/100\/artifacts\?per_page=100&page=(\d+)$/.exec(path);
    if (artifactsPath) { const result = pages(state.artifacts, Number(artifactsPath[1])); return { total_count: result.total_count, artifacts: structuredClone(result.items) }; }
    throw new Error(`Unexpected fixture API: ${path}`);
  };
  const read = extra => readConsistentCandidateHistory({ ...options, api, ...extra });
  return { state, api, read };
}

function measuredFacts(snapshotA) {
  const run = snapshotA.sourceRun;
  return { manifest: { repository: { id: REPO.id, fullName: REPO.full_name }, suite: options.suite, producer: { repositoryId: REPO.id, workflowId: run.workflowId, path: run.path, runId: run.id, runAttempt: run.runAttempt, headSha: run.headSha, event: run.event, status: run.status, conclusion: run.conclusion, startedAt: run.startedAt, completedAt: run.updatedAt, jobs: snapshotA.jobs.map(job => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, steps: job.steps.map(step => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion })) })) }, candidate: { prNumber: options.prNumber, baseSha: run.pulls[0].baseSha, headSha: snapshotA.pull.headSha }, artifacts: snapshotA.artifacts.map(artifact => ({ id: artifact.id, name: artifact.name, digest: artifact.digest, sizeInBytes: artifact.sizeInBytes, expired: artifact.expired, runId: run.id, runAttempt: run.runAttempt })) } };
}

const assertFallback = report => {
  assert.equal(report.stableDuringRead, false);
  assert.equal(report.readStatus, 'fallback');
  assert.equal(report.runFull, true);
  assert.equal(report.skip, false);
  assert.equal(report.skipAuthorization, false);
  assert.ok(report.reasons.length > 0);
};

test('two independent complete API snapshots match and are observations only', async () => {
  const { state, read } = fixture();
  const report = await read();
  assert.equal(report.stableDuringRead, true);
  assert.equal(report.readStatus, 'ok');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.reads, 2);
  assert.equal(report.snapshots.length, 2);
  assert.equal(report.snapshots[0].fingerprint, report.snapshots[1].fingerprint);
  assert.equal(report.runFull, true); assert.equal(report.skip, false); assert.equal(report.skipAuthorization, false);
  assert.equal(state.counts.get('/actions/runs/100'), 4, 'source is freshly read at both ends of both windows');
  assert.equal(state.counts.get('/pulls/9'), 4, 'current PR is freshly read at both ends of both windows');
  assert.equal(state.counts.get('/actions/runs/100/attempts/1'), 2);
  assert.equal(report.snapshots[1].latestAttempts.filter(run => run.runId === 100).length, 1);
  assert.equal(state.calls.some(path => /created=|head_sha=|event=/.test(path)), false);
});

test('measurement is bracketed by complete fresh reads and bound to snapshot A facts', async () => {
  const { api, state } = fixture();
  let callsAtMeasure;
  const report = await withConsistentCandidateHistory({ ...options, api, measure: async snapshotA => {
    callsAtMeasure = state.calls.length;
    assert.equal(state.counts.get('/actions/runs/100'), 2, 'A sealed source before measurement');
    assert.equal(state.counts.get('/pulls/9'), 2, 'A sealed PR before measurement');
    return { ...measuredFacts(snapshotA), marker: 'fresh measurement' };
  } });
  assert.equal(report.stableDuringRead, true);
  assert.equal(report.measurementBound, true);
  assert.equal(report.measurement.marker, 'fresh measurement');
  assert.ok(state.calls.length > callsAtMeasure, 'B was independently read after measurement');
  assert.equal(state.counts.get('/actions/runs/100'), 4);
  assert.equal(report.skip, false); assert.equal(report.runFull, true); assert.equal(report.skipAuthorization, false);
});

test('required measurement API rejects missing callbacks instead of accepting unmeasured snapshots', async () => {
  const { api, state } = fixture();
  const result = await withConsistentCandidateHistory({ ...options, api });
  assertFallback(result);
  assert.deepEqual(result.reasons, ['history_measure_callback_required']);
  assert.equal(state.calls.length, 0);
  const pureRead = await readConsistentCandidateHistory({ ...options, api });
  assert.equal(pureRead.stableDuringRead, true);
  assert.equal(pureRead.measurementBound, false);
});

test('facts measured before A cannot masquerade as fresh once jobs or artifact state has changed', async () => {
  for (const mutate of [
    state => { state.jobs[0].steps[1].conclusion = 'skipped'; },
    state => { state.jobs[0].id = 999; },
    state => { state.artifacts[0].digest = `sha256:${'b'.repeat(64)}`; },
  ]) {
    const { api, state, read } = fixture();
    const prior = await read();
    const stale = measuredFacts(prior.snapshots[0]);
    mutate(state);
    const report = await withConsistentCandidateHistory({ ...options, api, measure: async () => stale });
    assertFallback(report);
    assert.equal(report.measurementBound, false);
    assert.ok(report.reasons[0].startsWith('history_measurement_'));
  }
});

test('every measured source/PR/job/step/artifact identity must bind A', async () => {
  for (const mutate of [
    evidence => { evidence.repository.id++; },
    evidence => { evidence.suite = 'other-suite'; },
    evidence => { evidence.producer.runId++; },
    evidence => { evidence.producer.runAttempt++; },
    evidence => { evidence.producer.headSha = oid('4'); },
    evidence => { evidence.candidate.prNumber++; },
    evidence => { evidence.candidate.baseSha = oid('4'); },
    evidence => { evidence.candidate.headSha = oid('4'); },
    evidence => { evidence.producer.jobs[0].name = 'different-job'; },
    evidence => { evidence.producer.jobs[0].steps[1].number++; },
    evidence => { evidence.producer.jobs[0].steps[1].conclusion = 'failure'; },
    evidence => { evidence.artifacts[0].runAttempt++; },
    evidence => { evidence.artifacts[0].sizeInBytes++; },
    evidence => { evidence.artifacts[0].name = 'different-artifact'; },
  ]) {
    const { api } = fixture();
    const report = await withConsistentCandidateHistory({ ...options, api, measure: async snapshotA => { const value = measuredFacts(snapshotA); mutate(value.manifest); return value; } });
    assertFallback(report);
    assert.equal(report.measurementBound, false);
  }
});

test('new failed run or new attempt while measurement occurs invalidates its callback facts', async () => {
  for (const mutate of [
    state => { state.scope.unshift(run(110, { conclusion: 'failure', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' })); },
    state => { state.source.run_attempt = 2; state.source.conclusion = 'failure'; },
  ]) {
    const { api, state } = fixture();
    const report = await withConsistentCandidateHistory({ ...options, api, measure: async snapshotA => { const facts = measuredFacts(snapshotA); mutate(state); return facts; } });
    assertFallback(report);
    assert.equal(report.measurementBound, false);
  }
});

test('measurement cannot mutate or forge snapshot A to make stale facts match', async () => {
  const { api } = fixture();
  const report = await withConsistentCandidateHistory({ ...options, api, measure: async snapshotA => { snapshotA.artifacts[0].digest = `sha256:${'f'.repeat(64)}`; return measuredFacts(snapshotA); } });
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_lookup_or_validation_exception']);
});

test('measurement exception or invalid/missing source facts is always fallback', async () => {
  for (const measure of [async () => { throw new Error('private measurement diagnostic'); }, async () => ({}), async snapshotA => { const facts = measuredFacts(snapshotA); facts.manifest.producer.jobs = []; return facts; }, async snapshotA => { const facts = measuredFacts(snapshotA); facts.manifest.artifacts = []; return facts; }]) {
    const { api } = fixture();
    const report = await withConsistentCandidateHistory({ ...options, api, measure });
    assertFallback(report);
    assert.equal(report.measurementBound, false);
  }
});

test('the full history, jobs and artifacts exhaust advertised pagination on both reads', async () => {
  const { state, read } = fixture();
  state.pageSize = 1;
  state.jobs.push({ ...state.jobs[0], id: 102, name: 'second-job' });
  state.artifacts.push({ ...state.artifacts[0], id: 202, name: 'extra-100' });
  const report = await read();
  assert.equal(report.stableDuringRead, true);
  assert.equal(report.snapshots[1].scope.length, 3);
  assert.equal(report.snapshots[1].jobs.length, 2);
  assert.equal(report.snapshots[1].artifacts.length, 2);
  assert.equal(report.snapshots[1].pageReceipts.length, 7);
  assert.equal(state.counts.get('/actions/workflows/10/runs?per_page=100&page=3'), 2);
});

test('stable optional skipped job is recorded, without treating it as executed validation', async () => {
  const { state, read } = fixture();
  state.jobs.push({ ...state.jobs[0], id: 102, name: 'optional-skipped', conclusion: 'skipped', started_at: null, completed_at: null, steps: [], runner_id: null, labels: [] });
  const report = await read();
  assert.equal(report.stableDuringRead, true);
  assert.equal(report.snapshots[1].jobs.find(job => job.id === 102).conclusion, 'skipped');
  assert.equal(report.measurementBound, false);
  assert.equal(report.skip, false);
});

test('new failure/cancellation/unknown run between reads invalidates the fixed older source', async () => {
  for (const conclusion of ['failure', 'cancelled', 'unknown']) {
    const { state, read } = fixture();
    state.before = (path, count) => { if (path === '/pulls/9' && count === 3) state.scope.unshift(run(110, { conclusion, run_started_at: '2026-10-05T10:40:00Z', updated_at: '2026-10-05T10:50:00Z' })); };
    const report = await read();
    assertFallback(report);
    assert.ok(report.reasons.includes('history_newer_attempt_not_successful'));
    assert.equal(report.snapshots[0].sourceRun.id, 100);
  }
});

test('newer successful run needs its own evidence; the component never switches to it', async () => {
  const { state, read } = fixture();
  state.scope.unshift(run(110, { run_started_at: '2026-10-05T10:40:00Z', updated_at: '2026-10-05T10:50:00Z' }));
  const report = await read();
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_newer_evidence_required']);
  assert.equal(state.calls.includes('/actions/runs/110'), false);
  assert.equal(state.calls.some(path => path.includes('/110/') && path.includes('/jobs')), false);
});

test('a new source attempt at the second read is rejected even if successful', async () => {
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    const { state, read } = fixture();
    state.before = (path, count) => { if (path === '/pulls/9' && count === 3) { state.source.run_attempt = 2; state.source.conclusion = conclusion; } };
    const report = await read();
    assertFallback(report);
    assert.deepEqual(report.reasons, ['history_source_attempt_changed']);
    assert.equal(state.calls.some(path => path.includes('/attempts/2/jobs')), false);
  }
});

test('old-created run rerun today is independently read and cannot hide its newer failure', async () => {
  const { state, read } = fixture();
  state.scope.push(run(50, { run_attempt: 3, conclusion: 'failure', created_at: '2026-01-01T00:00:00Z', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' }));
  const report = await read();
  assertFallback(report);
  assert.ok(report.reasons.includes('history_newer_attempt_not_successful'));
  assert.equal(state.calls.includes('/actions/runs/50/attempts/3'), true);
});

test('listed latest attempt and independent attempt API must agree', async () => {
  const { state, read } = fixture();
  state.attempts['100:1'] = { ...state.source, conclusion: 'failure' };
  const report = await read();
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_latest_attempt_changed']);
});

test('source status changing while jobs/artifacts are read invalidates a single snapshot', async () => {
  const { state, read } = fixture();
  state.before = path => { if (path.includes('/artifacts?')) state.source.conclusion = 'failure'; };
  const report = await read();
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_source_changed_during_snapshot']);
});

test('PR new head/base/mergeability/merge SHA during or between reads is rejected', async () => {
  for (const mutate of [
    state => { state.pull.head.sha = oid('4'); },
    state => { state.pull.base.sha = oid('4'); },
    state => { state.pull.mergeable = false; },
    state => { state.pull.merge_commit_sha = oid('4'); },
  ]) {
    const { state, read } = fixture();
    state.before = (path, count) => { if (path === '/pulls/9' && count === 2) mutate(state); };
    const report = await read();
    assertFallback(report);
    assert.deepEqual(report.reasons, ['history_pr_changed_during_snapshot']);
  }
});

test('a merged PR moving API base does not substitute for the tested candidate base', async () => {
  const { read } = fixture();
  assert.equal((await read()).stableDuringRead, true, 'merged API base=S, tested base=B');
  const { state, read: otherRead } = fixture();
  state.pull.merged = false; state.pull.state = 'open'; state.pull.mergeable = true;
  const report = await otherRead();
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_pr_base_changed']);
});

test('same scope cardinality with run replacement or reordered page boundaries is detected', async () => {
  for (const mutate of [
    state => { state.scope[2] = run(91, { run_started_at: '2026-10-04T10:00:00Z', updated_at: '2026-10-04T10:20:00Z' }); },
    state => { [state.scope[1], state.scope[2]] = [state.scope[2], state.scope[1]]; },
  ]) {
    const { state, read } = fixture(); state.pageSize = 1;
    state.before = (path, count) => { if (path === '/pulls/9' && count === 3) mutate(state); };
    const report = await read();
    assertFallback(report);
    assert.deepEqual(report.reasons, ['history_scope_changed_between_reads']);
  }
});

test('job result/step outcome/runner or artifact digest/expiry/removal changes are detected', async () => {
  for (const mutate of [
    state => { state.jobs[0].conclusion = 'failure'; },
    state => { state.jobs[0].steps[1].conclusion = 'skipped'; },
    state => { state.jobs[0].runner_id++; },
    state => { state.artifacts[0].digest = `sha256:${'b'.repeat(64)}`; },
    state => { state.artifacts[0].expired = true; },
    state => { state.artifacts = []; },
  ]) {
    const { state, read } = fixture();
    state.before = (path, count) => { if (path === '/pulls/9' && count === 3) mutate(state); };
    const report = await read();
    assertFallback(report);
    assert.deepEqual(report.reasons, ['history_facts_changed_between_reads']);
  }
});

test('changing pagination total within a read is rejected', async () => {
  const { state, read } = fixture(); state.pageSize = 1;
  state.before = path => { if (path === '/actions/workflows/10/runs?per_page=100&page=2') state.scope.push(run(80, { run_started_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:20:00Z' })); };
  const report = await read();
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_pagination_changed']);
});

test('pagination shift producing duplicates, advertised truncation and bounded exhaustion all fail closed', async () => {
  const duplicate = fixture(); duplicate.state.pageSize = 1;
  duplicate.state.before = path => { if (path === '/actions/workflows/10/runs?per_page=100&page=2') duplicate.state.scope[1] = duplicate.state.scope[0]; };
  assert.deepEqual((await duplicate.read()).reasons, ['history_pagination_shift_or_duplicate']);
  const missing = fixture();
  const incompleteApi = async path => path === '/actions/workflows/10/runs?per_page=100&page=1' ? { total_count: 1, workflow_runs: [] } : missing.api(path);
  const incomplete = await missing.read({ api: incompleteApi });
  assertFallback(incomplete); assert.deepEqual(incomplete.reasons, ['history_pagination_incomplete']);
  const bounded = fixture(); bounded.state.pageSize = 1;
  const exhausted = await bounded.read({ maxPages: 1 });
  assertFallback(exhausted); assert.deepEqual(exhausted.reasons, ['history_pagination_limit_exceeded']);
});

test('permission errors anywhere preserve fallback and do not retry', async () => {
  for (const target of ['/pulls/9', '/actions/runs/100', '/attempts/1', '/jobs?', '/artifacts?', '/actions/workflows/10/runs?']) {
    const { state, read } = fixture();
    state.before = path => { if (path.includes(target)) { const error = new Error('private diagnostic never output'); error.reason = 'github_api_http_403'; throw error; } };
    const report = await read({ maxRetries: 1 });
    assertFallback(report);
    assert.deepEqual(report.reasons, ['github_api_http_403']);
    assert.equal(report.retries, 0);
    assert.equal(report.reads, 1);
  }
});

test('a failure/change observed before a bounded diagnostic retry cannot restore green', async () => {
  const { state, read } = fixture();
  state.before = (path, count) => {
    if (path === '/pulls/9' && count === 3) state.scope.push(run(110, { conclusion: 'failure', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' }));
    if (path === '/pulls/9' && count === 4) state.scope = state.scope.filter(run => run.id !== 110);
  };
  const report = await read({ maxRetries: 1 });
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_newer_attempt_not_successful']);
  assert.equal(report.retries, 1);
  assert.equal(report.reads, 4);
  assert.equal(report.snapshots.at(-2).fingerprint, report.snapshots.at(-1).fingerprint, 'even recovered equal diagnostics do not erase the observed failure');
});

test('a transient API exception may produce diagnostics on one retry but is latched fallback', async () => {
  const { state, read } = fixture();
  state.before = (path, count) => { if (path.includes('/jobs?') && count === 1) throw new Error('sensitive token=never-output'); };
  const report = await read({ maxRetries: 1 });
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_lookup_or_validation_exception']);
  assert.equal(report.retries, 1);
  assert.equal(JSON.stringify(report).includes('sensitive'), false);
});

test('unknown candidates, foreign repository, corrupt metadata or reordered steps are refused', async () => {
  for (const mutate of [
    state => { state.source.pull_requests = []; },
    state => { state.source.head_repository = { ...REPO, id: 8 }; },
    state => { state.source.run_started_at = 'unknown'; },
    state => { state.jobs[0].steps.reverse(); },
    state => { state.jobs[0].run_id = 999; },
    state => { state.artifacts[0].workflow_run.id = 999; },
  ]) {
    const { state, read } = fixture(); mutate(state);
    assertFallback(await read());
  }
});

test('invalid clocks/options/bounds and expired source produce fallback without throwing or querying', async () => {
  for (const extra of [{ now: NaN }, { now: Infinity }, { now: 1e99 }, { maxRetries: 2 }, { maxPages: 0 }, { maxPages: 101 }, { maxAttemptReads: 0 }, { eligibleEvents: [] }, { sourceRunAttempt: 0 }]) {
    const { state, read } = fixture();
    assertFallback(await read(extra));
    assert.equal(state.calls.length, 0);
  }
  const { read } = fixture();
  const report = await read({ now: now + 86_400_000 });
  assertFallback(report);
  assert.deepEqual(report.reasons, ['history_source_expired_or_clock_invalid']);
});

test('an event after the final read is outside the receipt and never authorized to skip', async () => {
  const { state, read } = fixture();
  const report = await read();
  state.scope.push(run(110, { conclusion: 'failure', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' }));
  assert.equal(report.stableDuringRead, true, 'this is only a historical observation');
  assert.equal(report.skipAuthorization, false);
  assert.equal(report.skip, false);
  assert.equal(report.runFull, true);
  assertFallback(await read());
});
