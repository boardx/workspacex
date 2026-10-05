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
  const state = { source, pull, jobs, artifacts, scope: [source, main, old], latest: {}, attempts: {}, calls: [], counts: new Map(), pageSize: 100, before: null };
  const pages = (items, page) => ({ total_count: items.length, items: items.slice((page - 1) * state.pageSize, page * state.pageSize) });
  const api = async path => {
    state.calls.push(path);
    state.counts.set(path, (state.counts.get(path) ?? 0) + 1);
    if (state.before) await state.before(path, state.counts.get(path), state);
    if (path === '/pulls/9') return structuredClone(state.pull);
    const latest = /^\/actions\/runs\/(\d+)$/.exec(path);
    if (latest) return structuredClone(state.latest[latest[1]] ?? (Number(latest[1]) === 100 ? state.source : state.scope.find(item => item.id === Number(latest[1]))));
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
  assert.equal(state.counts.get('/actions/runs/100'), 6, 'source is freshly read at both ends and its latest endpoint in both windows');
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
    assert.equal(state.counts.get('/actions/runs/100'), 3, 'A sealed source and direct latest before measurement');
    assert.equal(state.counts.get('/pulls/9'), 2, 'A sealed PR before measurement');
    return { ...measuredFacts(snapshotA), marker: 'fresh measurement' };
  } });
  assert.equal(report.stableDuringRead, true);
  assert.equal(report.measurementBound, true);
  assert.equal(report.measurement.marker, 'fresh measurement');
  assert.ok(state.calls.length > callsAtMeasure, 'B was independently read after measurement');
  assert.equal(state.counts.get('/actions/runs/100'), 6);
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
  assert.equal(state.calls.includes('/actions/runs/110'), true, 'newer source is inspected but never selected for old evidence');
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

// These are independent API response models, not live GitHub history or an
// atomic lease. Latest endpoints and immutable-attempt endpoints deliberately
// have separate storage so an old green attempt cannot mask a current retry.
function unrelatedRun(id) {
  const head = id.toString(16).padStart(40, '0');
  return run(id, { head_sha: head, head_branch: `worker/unrelated-${id}`, pull_requests: [{ number: id, base: { sha: B }, head: { sha: head } }] });
}
function globalFixture(total = 9659) {
  const value = fixture();
  const old = value.state.scope.find(item => item.id === 90);
  value.state.scope = [value.state.source, ...Array.from({ length: total - 2 }, (_, index) => unrelatedRun(1000 + index)), old];
  return value;
}
const directReads = state => state.calls.filter(path => /^\/actions\/runs\/\d+$/.test(path));
const attemptReads = state => state.calls.filter(path => /^\/actions\/runs\/\d+\/attempts\/\d+$/.test(path));
const workflowPages = state => state.calls.filter(path => path.startsWith('/actions/workflows/10/runs?'));

test('9659-row unfiltered global catalog exhausts all 97 pages while independently checking only its two associated latest runs', async () => {
  const { state, read } = globalFixture();
  const report = await read();
  assert.equal(report.readStatus, 'ok', report.reasons.join(','));
  assert.equal(report.stableDuringRead, true); assert.equal(report.skip, false); assert.equal(report.runFull, true); assert.equal(report.skipAuthorization, false);
  assert.equal(report.snapshots.length, 2); assert.equal(report.snapshots[0].scope.length, 9659);
  for (const snapshot of report.snapshots) {
    assert.deepEqual(snapshot.statistics, { runCount: 9659, relatedRunIds: [100, 90], workflowPageCount: 97, relatedLatestReads: 2, relatedAttemptReads: 2,
      readBounds: { maxPages: 100, maxRuns: 10000, maxAttemptReads: 200 }, catalogObservationOnly: true, indexCompletenessVerified: false, atomicLease: false });
    assert.deepEqual(snapshot.latestAttempts.map(item => item.runId), [100, 90]);
    assert.equal(snapshot.pageReceipts.filter(item => item.key === 'workflow_runs').length, 97);
    assert.equal(snapshot.scope.at(-1).id, 90, 'related old run is in the final advertised page');
  }
  assert.equal(workflowPages(state).length, 194);
  assert.equal(state.counts.get('/actions/workflows/10/runs?per_page=100&page=97'), 2);
  assert.equal(state.counts.has('/actions/workflows/10/runs?per_page=100&page=98'), false);
  assert.deepEqual(new Set(directReads(state)), new Set(['/actions/runs/100', '/actions/runs/90']));
  assert.equal(state.counts.get('/actions/runs/100'), 6); assert.equal(state.counts.get('/actions/runs/90'), 2);
  assert.deepEqual(new Set(attemptReads(state)), new Set(['/actions/runs/100/attempts/1', '/actions/runs/90/attempts/1']));
  assert.equal(attemptReads(state).length, 4);
  assert.equal(state.calls.some(path => /created=|head_sha=|event=/.test(path)), false);
});

test('large-catalog measurement is performed after the full A catalog and related latest reads, before independent B', async () => {
  const { state, api } = globalFixture(); let measured = 0;
  const report = await withConsistentCandidateHistory({ ...options, api, measure: async snapshot => {
    measured++; assert.equal(snapshot.scope.length, 9659); assert.equal(workflowPages(state).length, 97);
    assert.equal(state.counts.get('/actions/runs/100'), 3); assert.equal(state.counts.get('/actions/runs/90'), 1);
    assert.equal(state.counts.get('/actions/runs/90/attempts/1'), 1); return measuredFacts(snapshot);
  } });
  assert.equal(report.stableDuringRead, true, report.reasons.join(',')); assert.equal(report.measurementBound, true);
  assert.equal(measured, 1); assert.equal(workflowPages(state).length, 194); assert.equal(report.skipAuthorization, false);
});

test('unrelated eligible failures participate in catalog fingerprints without consuming associated-attempt reads', async () => {
  const { state, read } = fixture();
  const irrelevant = unrelatedRun(2000); Object.assign(irrelevant, { conclusion: 'failure', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' });
  state.scope.push(irrelevant);
  const report = await read({ maxAttemptReads: 2 });
  assert.equal(report.stableDuringRead, true, report.reasons.join(','));
  assert.equal(report.snapshots[0].scope.find(item => item.id === 2000).conclusion, 'failure');
  assert.equal(state.calls.includes('/actions/runs/2000'), false); assert.equal(state.calls.some(path => path.includes('/2000/attempts/')), false);
  assert.deepEqual(report.snapshots[0].statistics.relatedRunIds, [100, 90]);
});

for (const [name, mutate] of [
  ['result', item => { item.conclusion = 'failure'; }],
  ['attempt', item => { item.run_attempt = 2; }],
  ['actor', item => { item.actor = { id: 987 }; }],
  ['PR association', item => { item.pull_requests[0].head.sha = oid('a'); }],
]) test(`global unrelated ${name} changes remain in A/B fingerprints`, async () => {
  const { state, read } = globalFixture();
  state.before = (path, count) => { if (path === '/pulls/9' && count === 3) mutate(state.scope[5000]); };
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_scope_changed_between_reads']);
  assert.equal(state.calls.includes(`/actions/runs/${state.scope[5000].id}`), false);
});

for (const [name, status, conclusion] of [['failure', 'completed', 'failure'], ['queued', 'queued', null], ['cancellation', 'completed', 'cancelled']]) {
  test(`listed attempt 1 green cannot hide direct latest attempt 2 ${name}`, async () => {
    const { state, read } = fixture(); const listed = state.scope.find(item => item.id === 90);
    listed.conclusion = 'success'; listed.created_at = '2026-01-01T00:00:00Z';
    state.attempts['90:1'] = structuredClone(listed);
    state.latest[90] = { ...structuredClone(listed), run_attempt: 2, status, conclusion, run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' };
    state.attempts['90:2'] = structuredClone(state.latest[90]);
    const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_latest_run_changed']);
    assert.equal(state.calls.includes('/actions/runs/90'), true, 'the direct current run endpoint is mandatory even for listed attempt 1');
    assert.equal(state.calls.includes('/actions/runs/90/attempts/1'), false, 'old exact green is not used to overrule a newer direct latest');
  });
}

test('consistent listed/direct attempt 2 still requires the independent exact current attempt and rejects its changed result', async () => {
  const { state, read } = fixture(); const listed = state.scope.find(item => item.id === 90);
  listed.run_attempt = 2; listed.conclusion = 'success'; state.latest[90] = structuredClone(listed);
  state.attempts['90:2'] = { ...structuredClone(listed), conclusion: 'failure' };
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_latest_attempt_changed']);
  assert.equal(state.calls.includes('/actions/runs/90'), true); assert.equal(state.calls.includes('/actions/runs/90/attempts/2'), true);
  assert.equal(state.calls.includes('/actions/runs/90/attempts/1'), false);
});

test('even an attempt-1 unrelated-head run on the same PR is freshly checked for a hidden newer retry', async () => {
  const { state, read } = fixture(); const prior = run(50, { head_sha: oid('4'), created_at: '2026-01-01T00:00:00Z', run_started_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:20:00Z', pull_requests: [{ number: 9, base: { sha: B }, head: { sha: oid('4') } }] });
  state.scope.push(prior); state.attempts['50:1'] = structuredClone(prior);
  state.latest[50] = { ...structuredClone(prior), run_attempt: 2, conclusion: 'failure', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' };
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_latest_run_changed']);
  assert.equal(state.calls.includes('/actions/runs/50'), true); assert.equal(state.calls.includes('/actions/runs/50/attempts/1'), false);
});

test('old-created old-head same-PR run with a consistently observed newer failed retry invalidates source evidence', async () => {
  const { state, read } = fixture(); state.scope.push(run(50, { run_attempt: 3, head_sha: oid('4'), created_at: '2026-01-01T00:00:00Z', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z', conclusion: 'failure', pull_requests: [{ number: 9, base: { sha: B }, head: { sha: oid('4') } }] }));
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_newer_attempt_not_successful']);
  assert.equal(state.calls.includes('/actions/runs/50'), true); assert.equal(state.calls.includes('/actions/runs/50/attempts/3'), true);
});

for (const [status, conclusion] of [['completed', 'failure'], ['queued', null], ['completed', 'cancelled']]) test(`same immutable API head on another PR still invalidates a newer ${status}/${conclusion} execution`, async () => {
  const { state, read } = fixture(); state.scope.push(run(110, { status, conclusion, pull_requests: [{ number: 88, base: { sha: B }, head: { sha: H } }], run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' }));
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_newer_related_attempt_not_successful']);
  assert.equal(state.calls.includes('/actions/runs/110'), true); assert.equal(state.calls.includes('/actions/runs/110/attempts/1'), true);
});

test('same API head on another PR is related even when its PR-head association differs', async () => {
  const { state, read } = fixture(); state.scope.push(run(110, { conclusion: 'failure', pull_requests: [{ number: 88, base: { sha: B }, head: { sha: oid('4') } }], run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' }));
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_newer_related_attempt_not_successful']); assert.equal(state.calls.includes('/actions/runs/110'), true);
});

for (const [name, pulls, expected] of [
  ['empty', [], 'history_candidate_identity_unknown'],
  ['unknown', [{ number: 88, base: { sha: B }, head: {} }], 'history_candidate_identity_unknown'],
  ['multiple distinct PRs', [{ number: 88, base: { sha: B }, head: { sha: S } }, { number: 89, base: { sha: B }, head: { sha: S } }], 'history_candidate_identity_unknown'],
  ['duplicate ambiguous PR', [{ number: 88, base: { sha: B }, head: { sha: S } }, { number: 88, base: { sha: B }, head: { sha: S } }], 'history_candidate_identity_ambiguous'],
]) test(`an eligible row with ${name} association cannot be excluded as unrelated`, async () => {
  const { state, read } = fixture(); state.scope.push(unrelatedRun(2000)); state.scope.at(-1).pull_requests = pulls;
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, [expected]);
});

test('missing source from a complete global list invalidates direct source success', async () => {
  const { state, read } = fixture(); state.scope = state.scope.filter(item => item.id !== 100);
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_source_listing_changed']);
});

test('the 10000-row catalog boundary reads exactly 100 pages per observation', async () => {
  const { state, read } = globalFixture(10000); const report = await read();
  assert.equal(report.stableDuringRead, true, report.reasons.join(',')); assert.equal(report.snapshots[1].scope.length, 10000);
  assert.equal(report.snapshots[1].statistics.workflowPageCount, 100); assert.equal(workflowPages(state).length, 200);
  assert.equal(state.calls.some(path => path.endsWith('page=101')), false); assert.equal(report.skipAuthorization, false);
});

test('advertised 10001 rows cannot truncate into a green 10000-row receipt', async () => {
  const { state, read } = globalFixture(10001); const report = await read();
  assertFallback(report); assert.deepEqual(report.reasons, ['history_pagination_limit_exceeded']);
  assert.equal(state.calls.some(path => path.includes('/attempts/')), false, 'an incomplete catalog cannot start attempt evidence reads');
});

for (const [name, response, expected] of [
  ['empty page hole', state => ({ total_count: 9659, workflow_runs: [] }), 'history_pagination_incomplete'],
  ['duplicate earlier page', state => ({ total_count: 9659, workflow_runs: state.scope.slice(0, 100) }), 'history_pagination_shift_or_duplicate'],
  ['changed advertised count', state => ({ total_count: 9660, workflow_runs: state.scope.slice(4900, 5000) }), 'history_pagination_changed'],
]) test(`global catalog ${name} at page 50 is latched fallback`, async () => {
  const { state, read, api } = globalFixture();
  const report = await read({ api: async path => path === '/actions/workflows/10/runs?per_page=100&page=50' ? response(state) : api(path) });
  assertFallback(report); assert.deepEqual(report.reasons, [expected]); assert.equal(state.calls.some(path => path.includes('/attempts/')), false);
});

test('a page exceeding the advertised 100-row API page size fails closed', async () => {
  const { api, read } = globalFixture();
  const report = await read({ api: async path => { const value = await api(path); if (path === '/actions/workflows/10/runs?per_page=100&page=1') value.workflow_runs.push(unrelatedRun(50000)); return value; } });
  assertFallback(report); assert.deepEqual(report.reasons, ['history_pagination_response_invalid']);
});

test('200 related IDs exhaust the default direct/latest-attempt budget without charging unrelated catalog rows', async () => {
  const { state, read } = fixture(); state.scope = [state.source, ...Array.from({ length: 199 }, (_, index) => run(2000 + index, { run_started_at: '2026-10-04T10:00:00Z', updated_at: '2026-10-04T10:20:00Z' })), ...Array.from({ length: 500 }, (_, index) => unrelatedRun(10000 + index))];
  const report = await read(); assert.equal(report.stableDuringRead, true, report.reasons.join(','));
  assert.equal(report.snapshots[0].statistics.relatedLatestReads, 200); assert.equal(report.snapshots[0].statistics.relatedAttemptReads, 200);
  assert.equal(attemptReads(state).length, 400); assert.equal(state.calls.includes('/actions/runs/10000'), false); assert.equal(report.snapshots[0].scope.length, 700);
});

test('201 related IDs fail the default budget instead of silently excluding one', async () => {
  const { state, read } = fixture(); state.scope = [state.source, ...Array.from({ length: 200 }, (_, index) => run(2000 + index, { run_started_at: '2026-10-04T10:00:00Z', updated_at: '2026-10-04T10:20:00Z' }))];
  const report = await read(); assertFallback(report); assert.deepEqual(report.reasons, ['history_attempt_read_limit_exceeded']);
  assert.equal(attemptReads(state).length, 200); assert.equal(state.calls.includes('/actions/runs/2199'), false);
});

test('a direct latest change during measurement stays latched even after retry observations recover', async () => {
  const { state, api } = fixture(); let measured = 0;
  state.before = (path, count) => { if (path === '/pulls/9' && count === 4) delete state.latest[90]; };
  const report = await withConsistentCandidateHistory({ ...options, api, maxRetries: 1, measure: async snapshot => {
    measured++; if (measured === 1) state.latest[90] = { ...structuredClone(state.scope.find(item => item.id === 90)), run_attempt: 2, conclusion: 'failure', run_started_at: '2026-10-05T11:00:00Z', updated_at: '2026-10-05T11:20:00Z' };
    return measuredFacts(snapshot);
  } });
  assertFallback(report); assert.deepEqual(report.reasons, ['history_latest_run_changed']); assert.equal(report.measurementBound, false);
  assert.equal(report.retries, 1); assert.equal(measured, 2);
  assert.equal(report.snapshots.at(-2).fingerprint, report.snapshots.at(-1).fingerprint);
});

for (const code of [403, 429]) test(`direct latest HTTP ${code} cannot substitute a cached exact-attempt green`, async () => {
  const { state, read } = fixture();
  state.before = (path, count) => { if (path === '/actions/runs/90' && count === 1) { const error = new Error('private HTTP diagnostic'); error.reason = `github_api_http_${code}`; throw error; } };
  const report = await read({ maxRetries: 1 }); assertFallback(report); assert.deepEqual(report.reasons, [`github_api_http_${code}`]);
  assert.equal(report.skipAuthorization, false); if (code === 403) assert.equal(report.retries, 0); else { assert.equal(report.retries, 1); assert.equal(report.snapshots.at(-2).fingerprint, report.snapshots.at(-1).fingerprint); }
});
