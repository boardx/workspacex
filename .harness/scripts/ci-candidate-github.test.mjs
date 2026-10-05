import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
import { createGitHubApi, githubPages, IDENTITY_PREFIX, IDENTITY_STEP, observeCandidateRun, parseCheckoutIdentity } from './lib/ci-candidate-github.mjs';
import { createObservationBudget } from './lib/ci-candidate-budget.mjs';
import { runObserver } from './ci-candidate-observer.mjs';

const oid = value => value.repeat(40);
const B = oid('1'), H = oid('2'), M = oid('3'), S = oid('4'), O = oid('5');
const TB = oid('6'), TS = oid('7'), TH = oid('8');
const PATH = '.github/workflows/harness-verify.yml';
const OBSERVER = '.github/workflows/ci-candidate-shadow.yml';
const ACTION = '.github/actions/ci-candidate-identity/action.yml';
const REPO = { id: 1, full_name: 'boardx/workspacex', default_branch: 'main' };
const now = Date.parse('2026-10-05T10:40:00Z');
const success = { status: 'completed', conclusion: 'success' };
const suite = { id: 'fullstack-smoke', owner: { workflow: PATH, job: 'fullstack-smoke' }, eligibleSourceEvents: ['pull_request', 'merge_group'], execution: { actualStepNames: ['Execute smoke'], actualStepNamePatterns: [], artifactNamePatterns: ['^smoke-[0-9]+$'] } };
const config = { identityPaths: ['pnpm-lock.yaml'], suites: [suite] };

function identity({ main = false } = {}) {
  return { schemaVersion: 1, sha: main ? S : M, tree: TS, parents: main ? [B] : [B, H], workflowRef: `boardx/workspacex/${PATH}@${main ? 'refs/heads/main' : 'refs/pull/9/merge'}`, workflowSha: main ? S : M, candidate: { prNumber: main ? null : 9, baseSha: main ? null : B, headSha: main ? null : H }, toolchain: { node: 'v22.18.0', pnpm: '10.15.0', python: 'Python 3.12.0', docker: 'Docker version 28.0.0' }, environment: { platform: 'linux', arch: 'x64', imageOS: 'ubuntu24', imageVersion: '20261005.1.0', runnerEnvironment: 'github-hosted', runnerOS: 'Linux' } };
}
const marker = (value, stamp = '2026-10-05T10:00:03.1250000Z') => `${stamp} ${IDENTITY_PREFIX}${Buffer.from(JSON.stringify(value)).toString('base64')}\n`;
function job(id, main = false) {
  const started_at = main ? '2026-10-05T10:20:00Z' : '2026-10-05T10:00:00Z';
  const completed_at = main ? '2026-10-05T10:30:00Z' : '2026-10-05T10:10:00Z';
  return { id, run_id: id - 1, name: 'fullstack-smoke', ...success, started_at, completed_at, runner_id: 123, runner_group_id: 1, labels: ['ubuntu-latest'], steps: [{ name: 'Set up job', ...success }, { name: 'Run actions/checkout@v5', ...success }, { name: IDENTITY_STEP, ...success, started_at, completed_at: main ? '2026-10-05T10:20:06Z' : '2026-10-05T10:00:06Z' }, { name: 'Execute smoke', ...success }].map((step, index) => ({ number: index + 1, started_at, completed_at, ...step })) };
}
function run(id, event, sha, extras = {}) {
  return { id, event, run_attempt: 1, workflow_id: 10, head_sha: sha, head_branch: event === 'pull_request' ? 'worker/candidate' : 'main', path: PATH, repository: REPO, head_repository: REPO, run_started_at: '2026-10-05T10:00:00Z', created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:10:00Z', pull_requests: event === 'pull_request' ? [{ number: 9, base: { sha: B }, head: { sha: H } }] : [], ...success, ...extras };
}
function fixture() {
  const source = run(100, 'pull_request', H);
  const main = run(200, 'push', S, { run_started_at: '2026-10-05T10:20:00Z', updated_at: '2026-10-05T10:30:00Z' });
  const own = run(900, 'workflow_run', O, { workflow_id: 20, path: OBSERVER, status: 'in_progress', conclusion: null });
  const pull = { number: 9, state: 'closed', merged: true, mergeable: null, merge_commit_sha: S, updated_at: '2026-10-05T10:19:00Z', base: { sha: S, ref: 'main', repo: REPO }, head: { sha: H, repo: REPO } };
  const entries = sourceCode => [{ path: PATH, type: 'blob', mode: '100644', sha: oid('a') }, { path: OBSERVER, type: 'blob', mode: '100644', sha: oid('b') }, { path: ACTION, type: 'blob', mode: '100644', sha: oid('c') }, { path: 'pnpm-lock.yaml', type: 'blob', mode: '100644', sha: oid('d') }, { path: 'apps/api/src/index.ts', type: 'blob', mode: '100644', sha: sourceCode }];
  const commits = { [B]: { sha: B, tree: { sha: TB }, parents: [{ sha: oid('0') }] }, [H]: { sha: H, tree: { sha: TH }, parents: [{ sha: B }] }, [M]: { sha: M, tree: { sha: TS }, parents: [{ sha: B }, { sha: H }] }, [S]: { sha: S, tree: { sha: TS }, parents: [{ sha: B }] }, [O]: { sha: O, tree: { sha: TS }, parents: [{ sha: S }] } };
  const trees = { [TB]: { sha: TB, truncated: false, tree: entries(oid('e')) }, [TH]: { sha: TH, truncated: false, tree: entries(oid('f')) }, [TS]: { sha: TS, truncated: false, tree: entries(oid('f')) } };
  const artifacts = [{ id: 301, name: 'smoke-100', expired: false, size_in_bytes: 200, digest: `sha256:${'a'.repeat(64)}`, workflow_run: { id: 100, head_sha: H }, created_at: '2026-10-05T10:09:00Z', updated_at: '2026-10-05T10:09:00Z' }];
  const state = { source, main, own, pull, commits, trees, artifacts, jobs: { 100: job(101), 200: job(201, true) }, logs: { 101: marker(identity()), 201: marker(identity({ main: true }), '2026-10-05T10:20:03.1250000Z') }, history: [source], latest: {}, attempts: {}, calls: [], denied: null };
  const api = async (path, options) => {
    state.calls.push({ path, options });
    state.beforeApi?.(path);
    if (state.denied?.(path)) { const { EvidenceReadError } = await import('./lib/ci-candidate-github.mjs'); throw new EvidenceReadError('github_api_http_403'); }
    if (path === '') return structuredClone(REPO);
    if (path === '/actions/runs/900') return structuredClone(state.own);
    if (path === '/actions/runs/100') return structuredClone(state.latest[100] ?? state.source);
    if (path === '/actions/runs/200') return structuredClone(state.main);
    if (path === '/actions/workflows/20') return { id: 20, path: OBSERVER };
    if (path === '/actions/workflows/10') return { id: 10, path: PATH };
    if (path.startsWith('/git/commits/')) return structuredClone(state.commits[path.slice('/git/commits/'.length)]);
    if (path.startsWith('/git/trees/')) return structuredClone(state.trees[path.slice('/git/trees/'.length).split('?')[0]]);
    if (path.startsWith('/actions/runs/100/attempts/1/jobs?')) return { total_count: 1, jobs: [structuredClone(state.jobs[100])] };
    if (path.startsWith('/actions/runs/200/attempts/1/jobs?')) return { total_count: 1, jobs: [structuredClone(state.jobs[200])] };
    if (path.startsWith('/actions/runs/100/artifacts?')) return { total_count: state.artifacts.length, artifacts: structuredClone(state.artifacts) };
    if (path === '/actions/jobs/101/logs') return state.logs[101];
    if (path === '/actions/jobs/201/logs') return state.logs[201];
    if (path === '/pulls/9') return structuredClone(state.pull);
    if (path === `/commits/${S}/pulls?per_page=100`) return [structuredClone(state.pull)];
    if (path === `/commits/${H}/pulls?per_page=100`) return state.mergeGroupPulls ?? [structuredClone(state.pull)];
    if (path.startsWith('/actions/workflows/10/runs?')) { const page = Number(new URL(path, 'https://fixture.invalid').searchParams.get('page')); return { total_count: state.history.length, workflow_runs: structuredClone(state.history.slice((page - 1) * 100, page * 100)) }; }
    const rerun = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(path);
    if (rerun) return structuredClone(state.attempts[`${rerun[1]}:${rerun[2]}`] ?? state.history.find(item => item.id === Number(rerun[1]) && item.run_attempt === Number(rerun[2])));
    const latest = /^\/actions\/runs\/(\d+)$/.exec(path);
    if (latest) return structuredClone(state.latest[latest[1]] ?? state.history.find(item => item.id === Number(latest[1])));
    throw new Error(`Unexpected fixture API: ${path}`);
  };
  const observe = (sourceRunId = 200, extra = {}) => observeCandidateRun({ api, repositoryName: REPO.full_name, sourceRunId, observerRunId: 900, actualCheckout: { sha: O, tree: TS, parents: [S] }, expectedObserverSha: O, config, now, ...extra });
  return { state, api, observe };
}

test('fixed pre-install identity interior is parsed; test-produced marker outside step is ignored', () => {
  const original = identity();
  const forged = { ...original, sha: oid('9') };
  assert.deepEqual(parseCheckoutIdentity(marker(original) + marker(forged, '2026-10-05T10:05:00Z'), job(101)), original);
});

test('GitHub-hosted default runner group zero is valid API identity, without attesting runtime', async () => {
  const actualHosted = job(101); actualHosted.runner_group_id = 0;
  assert.deepEqual(parseCheckoutIdentity(marker(identity()), actualHosted), identity());
  const { observe, state } = fixture();
  state.jobs[100].runner_group_id = 0; state.jobs[200].runner_group_id = 0;
  const observed = (await observe()).suites[0];
  assert.deepEqual(observed.reasons, ['runtime_not_attested']);
  assert.equal(observed.wouldReuse, false); assert.equal(observed.skip, false); assert.equal(observed.runFull, true);
});

test('missing, negative or malformed runner group and missing runner ID cannot prove API identity', () => {
  for (const value of [undefined, null, -1, 0.5, '0', false, NaN]) {
    const altered = job(101); altered.runner_group_id = value;
    assert.throws(() => parseCheckoutIdentity(marker(identity()), altered), /runner_identity_missing/);
  }
  const altered = job(101); altered.runner_id = 0; altered.runner_group_id = 0;
  assert.throws(() => parseCheckoutIdentity(marker(identity()), altered), /runner_identity_missing/);
});

test('a malicious nested timestamp, boundary marker, duplicates or no marker cannot prove checkout', () => {
  for (const logs of [
    `2026-10-05T10:05:00Z ${marker(identity())}`,
    marker(identity(), '2026-10-05T10:00:00.900Z'),
    marker(identity(), '2026-10-05T10:00:06.001Z'),
    marker(identity()) + marker(identity()),
    '',
  ]) assert.throws(() => parseCheckoutIdentity(logs, job(101)), /identity_marker_missing_or_ambiguous/);
});

test('later warning with a newline and backdated exact marker cannot replace the real marker', () => {
  // actions/runner may timestamp a whole warning only once. Its message can
  // contain a newline; the resulting backdated line must make evidence ambiguous.
  const injected = `2026-10-05T10:05:00Z ##[warning]untrusted warning\n${marker({ ...identity(), sha: oid('9') })}`;
  assert.throws(() => parseCheckoutIdentity(marker(identity()) + injected, job(101)), /identity_marker_missing_or_ambiguous/);
});

test('self-hosted or failed identity is refused; unavailable initial tool remains incomplete metadata', () => {
  const host = identity(); host.environment.runnerEnvironment = 'self-hosted';
  const unavailable = identity(); unavailable.toolchain.pnpm = 'unavailable';
  const failedJob = job(101); failedJob.steps[2].conclusion = 'failure';
  assert.throws(() => parseCheckoutIdentity(marker(host), job(101)), /untrusted_runner_environment/);
  assert.equal(parseCheckoutIdentity(marker(unavailable), job(101)).toolchain.pnpm, 'unavailable');
  assert.throws(() => parseCheckoutIdentity(marker(identity()), failedJob), /identity_step_missing_or_not_successful/);
});

test('identity must precede any candidate script, setup or dependency installation', () => {
  for (const name of ['Run node .harness/scripts/ci-lane-dedup.mjs', 'Setup pnpm', 'Setup Node', 'Run pnpm install --frozen-lockfile', 'Run Board scope', 'Run forged checkout']) {
    const altered = job(101);
    altered.steps.splice(2, 0, { name, ...success });
    assert.throws(() => parseCheckoutIdentity(marker(identity()), altered), /pre_identity_candidate_execution/, name);
  }
  const noCheckout = job(101); noCheckout.steps.splice(1, 1);
  assert.throws(() => parseCheckoutIdentity(marker(identity()), noCheckout), /pre_identity_candidate_execution/);
  const namedCheckout = job(101); namedCheckout.steps[1].name = 'Checkout';
  assert.equal(parseCheckoutIdentity(marker(identity()), namedCheckout).sha, M);
});

test('trusted PR producer creates manifest from APIs, without downloading any artifact JSON', async () => {
  const { observe, state } = fixture();
  const report = await observe(100);
  assert.equal(report.suites[0].candidateEvidenceGenerated, true);
  assert.equal(report.suites[0].manifest.candidate.mergeSha, M);
  assert.equal(report.suites[0].manifest.candidate.sourceTree, TS);
  assert.equal(report.suites[0].skip, false);
  assert.equal(report.suites[0].runFull, true);
  assert.deepEqual(report.suites[0].reasons, ['awaiting_main_comparison']);
  assert.equal(state.calls.some(call => /\/artifacts\/\d+\//.test(call.path)), false);
  assert.equal(report.suites[0].historyObservation.stableDuringRead, true);
  assert.equal(report.suites[0].historyObservation.measurementBound, true);
  assert.equal(report.suites[0].historyObservation.skipAuthorization, false);
  assert.equal(report.suites[0].historyObservation.snapshotFingerprints.length, 2);
});

test('job success cannot mask an unsuccessful unselected upload or cleanup step', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'neutral']) {
    const { state, observe } = fixture();
    state.jobs[100].steps.push({ number: 5, name: 'Retain artifact or cleanup', status: 'completed', conclusion, started_at: state.jobs[100].started_at, completed_at: state.jobs[100].completed_at });
    const result = (await observe(100)).suites[0];
    assert.deepEqual(result.reasons, ['source_job_step_not_successful']);
    assert.equal(result.manifest, undefined); assert.equal(result.skip, false); assert.equal(result.runFull, true);
  }
});

test('ordinary skipped optional steps do not fabricate or discard the actual successful execution', async () => {
  const { state, observe } = fixture();
  state.jobs[100].steps.push({ number: 5, name: 'Optional conditional cleanup', status: 'completed', conclusion: 'skipped', started_at: state.jobs[100].started_at, completed_at: state.jobs[100].completed_at });
  const result = (await observe(100)).suites[0];
  assert.equal(result.candidateEvidenceGenerated, true); assert.equal(result.skip, false); assert.equal(result.runFull, true);
});

test('adapter rejects a new failed candidate appearing in the second full-history read', async () => {
  const { state, observe } = fixture();
  let histories = 0;
  state.beforeApi = path => {
    if (path.startsWith('/actions/workflows/10/runs?') && ++histories === 2) {
      state.history.unshift(run(110, 'pull_request', H, { conclusion: 'failure', run_started_at: '2026-10-05T10:11:00Z', updated_at: '2026-10-05T10:12:00Z' }));
    }
  };
  const result = (await observe(100)).suites[0];
  assert.deepEqual(result.reasons, ['history_newer_attempt_not_successful']);
  assert.equal(result.manifest, undefined); assert.equal(result.skip, false); assert.equal(result.runFull, true);
});

test('adapter cannot bind a replacement artifact measured after snapshot A', async () => {
  const { state, observe } = fixture();
  let artifacts = 0;
  state.beforeApi = path => {
    if (path.startsWith('/actions/runs/100/artifacts?') && ++artifacts === 3) state.artifacts[0].digest = `sha256:${'b'.repeat(64)}`;
  };
  const result = (await observe(100)).suites[0];
  assert.deepEqual(result.reasons, ['history_measurement_artifact_mismatch']);
  assert.equal(result.manifest, undefined); assert.equal(result.skip, false);
});

test('adapter cannot bind a changed step identity measured after snapshot A', async () => {
  const { state, observe } = fixture();
  let jobs = 0;
  state.beforeApi = path => {
    if (path.startsWith('/actions/runs/100/attempts/1/jobs?') && ++jobs === 3) state.jobs[100].steps[3].number = 8;
  };
  const result = (await observe(100)).suites[0];
  assert.deepEqual(result.reasons, ['history_measurement_step_mismatch']);
  assert.equal(result.manifest, undefined); assert.equal(result.runFull, true);
});

test('adapter rejects permission loss during the second read without retaining an old manifest', async () => {
  const { state, observe } = fixture();
  let histories = 0;
  state.denied = path => path.startsWith('/actions/workflows/10/runs?') && ++histories === 2;
  const result = (await observe(100)).suites[0];
  assert.deepEqual(result.reasons, ['github_api_http_403']);
  assert.equal(result.manifest, undefined); assert.equal(result.skip, false);
});

test('a failed rerun can start after the last read; a stable observation never authorizes reuse', async () => {
  const { state, observe } = fixture();
  const result = (await observe(100)).suites[0];
  state.source.run_attempt = 2; state.source.status = 'in_progress'; state.source.conclusion = null;
  assert.equal(result.historyObservation.stableDuringRead, true);
  assert.equal(result.historyObservation.skipAuthorization, false);
  assert.equal(result.manifest.producer.runtimeAttested.verified, false);
  assert.equal(result.skip, false); assert.equal(result.runFull, true); assert.equal(result.wouldReuse, false);
});

test('single-PR merge group binds actual Git parents; an ambiguous merge group retains full execution', async () => {
  for (const ambiguous of [false, true]) {
    const { observe, state } = fixture();
    state.source.event = 'merge_group'; state.source.head_sha = M;
    state.logs[101] = marker({ ...identity(), workflowRef: `boardx/workspacex/${PATH}@refs/heads/gh-readonly-queue/main/pr-9-${H}`, candidate: { prNumber: null, baseSha: B, headSha: M } });
    state.artifacts[0].workflow_run.head_sha = M;
    state.pull = { ...state.pull, state: 'open', merged: false, mergeable: true, merge_commit_sha: oid('9'), base: { ...state.pull.base, sha: B } };
    if (ambiguous) state.mergeGroupPulls = [state.pull, { ...state.pull, number: 10 }];
    const observed = (await observe(100)).suites[0];
    if (ambiguous) assert.deepEqual(observed.reasons, ['merge_group_multiple_or_unknown_candidates']);
    else {
      assert.equal(observed.candidateEvidenceGenerated, true);
      assert.equal(observed.manifest.candidate.prNumber, 9);
      assert.deepEqual(observed.manifest.candidate.parents, [B, H]);
    }
    assert.equal(observed.runFull, true); assert.equal(observed.skip, false);
  }
});

test('squash SHA differs but independent full-tree comparison works and host-only runtime retains full execution', async () => {
  const { observe, state } = fixture();
  const report = await observe();
  assert.equal(report.suites[0].manifest.candidate.mergeSha, M);
  assert.deepEqual(report.suites[0].reasons, ['runtime_not_attested']);
  assert.equal(report.suites[0].wouldReuse, false);
  assert.equal(report.suites[0].runFull, true);
  assert.equal(report.suites[0].skip, false);
  assert.equal(state.calls.filter(call => call.path === '/actions/runs/900').length, 2, 'authority is independently re-read');
});

function otherPrRun(id) {
  const head = id.toString(16).padStart(40, '0');
  return run(id, 'pull_request', head, { head_branch: `worker/unrelated-${id}`, pull_requests: [{ number: id, base: { sha: B }, head: { sha: head } }] });
}
function mainCatalogFixture(total = 2501) {
  const value = fixture(); value.state.history = [...Array.from({ length: total - 1 }, (_, index) => otherPrRun(1000 + index)), value.state.source];
  return value;
}
function assertCompleteValidation(report) {
  assert.equal(report.runFull, true); assert.equal(report.skip, false);
  for (const result of report.suites) { assert.equal(result.runFull, true); assert.equal(result.skip, false); assert.equal(result.wouldReuse, false); }
}

for (const limit of [undefined, 80]) test(`main-push discovery beyond 2000 rows uses shared reader with ${limit ?? 'default'} request budget`, async () => {
  const { state, observe } = mainCatalogFixture(); const report = await observe(200, limit === undefined ? {} : { budget: createObservationBudget({ maxRequests: limit }) }); const result = report.suites[0];
  if (process.env.CI_CANDIDATE_ROUTE_REPRO_RECEIPT) writeFileSync(process.env.CI_CANDIDATE_ROUTE_REPRO_RECEIPT, `${JSON.stringify({ modelOnly: true, catalogRows: state.history.length, report, paths: state.calls.map(call => call.path) }, null, 2)}\n`);
  assertCompleteValidation(report);
  assert.ok(state.calls.some(call => call.path.endsWith('page=26')), 'source is intentionally after the old 20-page limit');
  if (limit === 80) {
    assert.deepEqual(result.reasons, ['observer_request_budget_exhausted']);
    assert.equal(result.manifest, undefined);
    assert.equal(report.observationBudget.requests, 80); assert.equal(report.observationBudget.exhausted, true);
    assert.equal(report.observationBudget.reason, 'observer_request_budget_exhausted');
    assert.equal(result.discoveryObservation.strategy, 'unfiltered-workflow-api-view-v1');
    assert.equal(result.discoveryObservation.statistics.runCount, 2501);
    assert.equal(result.discoveryObservation.indexCompletenessVerified, false); assert.equal(result.discoveryObservation.atomicLease, false);
  } else {
    assert.deepEqual(result.reasons, ['runtime_not_attested']);
    assert.equal(report.observationBudget.requests, 130);
    assert.equal(report.observationBudget.exhausted, false);
    assert.equal(result.historyObservation.stableDuringRead, true); assert.equal(result.historyObservation.measurementBound, true);
    assert.equal(result.manifest.producer.runId, 100); assert.equal(result.manifest.producer.runtimeAttested.verified, false);
  }
});

for (const [name, status, conclusion] of [['failure', 'completed', 'failure'], ['queued', 'queued', null], ['cancelled', 'completed', 'cancelled']]) test(`main discovery cannot select old attempt-1 green over direct latest attempt-2 ${name}`, async () => {
  const { state, observe } = mainCatalogFixture();
  const listed = run(90, 'pull_request', H, { created_at: '2026-01-01T00:00:00Z', run_started_at: '2026-10-04T10:00:00Z', updated_at: '2026-10-04T10:10:00Z' });
  state.history.splice(1100, 0, listed); state.attempts['90:1'] = structuredClone(listed);
  state.latest[90] = { ...structuredClone(listed), run_attempt: 2, status, conclusion, run_started_at: '2026-10-05T10:15:00Z', updated_at: '2026-10-05T10:16:00Z' };
  state.attempts['90:2'] = structuredClone(state.latest[90]);
  const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['history_latest_run_changed']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/90'), true);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/90/attempts/1'), false, 'the old exact green does not replace a fresh latest read');
});

test('main discovery and A/B revalidation retain every unrelated row in the scope fingerprint', async () => {
  const { state, observe } = mainCatalogFixture(201); let firstPages = 0;
  state.beforeApi = path => { if (path === '/actions/workflows/10/runs?per_page=100&page=1' && ++firstPages === 3) state.history[100].conclusion = 'failure'; };
  const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['history_scope_changed_between_reads']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(firstPages, 3, 'discovery, A, and independent B all exhaust their own global catalog');
  assert.equal(state.calls.some(call => call.path === `/actions/runs/${state.history[100].id}`), false, 'explicitly unrelated rows contribute fingerprints without direct attempt reads');
});

test('main cannot compare a fresh stable A/B measurement against an older discovery catalog', async () => {
  const { state, observe } = mainCatalogFixture(201); let firstPages = 0;
  state.beforeApi = path => { if (path === '/actions/workflows/10/runs?per_page=100&page=1' && ++firstPages === 2) state.history[100].conclusion = 'cancelled'; };
  const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['history_discovery_catalog_changed']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(firstPages, 3, 'the changed catalog is stable in A/B but still differs from source discovery');
});

test('main discovery cross-checks the independently read exact latest attempt rather than trusting the latest endpoint alone', async () => {
  const { state, observe } = mainCatalogFixture();
  state.attempts['100:1'] = { ...structuredClone(state.source), conclusion: 'failure' };
  const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['history_latest_attempt_changed']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/100'), true);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/100/attempts/1'), true);
});

test('main discovery refuses a newer failed run associated with another PR at the same source API head', async () => {
  const { state, observe } = mainCatalogFixture();
  const differentPr = run(50, 'pull_request', H, { run_started_at: '2026-10-05T10:15:00Z', conclusion: 'failure',
    pull_requests: [{ number: 999, base: { sha: B }, head: { sha: H } }] });
  state.history.splice(1100, 0, differentPr);
  const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['history_newer_related_attempt_not_successful']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/50'), true);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/50/attempts/1'), true);
});

for (const event of ['pull_request', 'push']) test(`main discovery rejects a foreign-repository catalog row even for ${event}`, async () => {
  const { state, observe } = mainCatalogFixture();
  const foreign = otherPrRun(50000); foreign.event = event; foreign.head_repository = { ...REPO, id: 2, full_name: 'other/foreign' }; if (event === 'push') foreign.pull_requests = [];
  state.history.splice(1100, 0, foreign);
  const report = await observe(); assertCompleteValidation(report); assert.deepEqual(report.suites[0].reasons, ['history_foreign_repository']); assert.equal(report.suites[0].manifest, undefined);
});

for (const [name, pulls, reason] of [
  ['no PR association', [], 'history_candidate_identity_unknown'],
  ['unknown PR association', [{ number: 50000, base: { sha: B }, head: {} }], 'history_candidate_identity_unknown'],
  ['multiple PR associations', [{ number: 50000, base: { sha: B }, head: { sha: S } }, { number: 50001, base: { sha: B }, head: { sha: S } }], 'history_candidate_identity_unknown'],
  ['duplicate ambiguous PR associations', [{ number: 50000, base: { sha: B }, head: { sha: S } }, { number: 50000, base: { sha: B }, head: { sha: S } }], 'history_candidate_identity_ambiguous'],
]) test(`main discovery cannot exclude an eligible catalog row with ${name}`, async () => {
  const { state, observe } = mainCatalogFixture(); const row = otherPrRun(50000); row.pull_requests = pulls; state.history.splice(1100, 0, row);
  const report = await observe(); assertCompleteValidation(report); assert.deepEqual(report.suites[0].reasons, [reason]); assert.equal(report.suites[0].manifest, undefined);
});

test('main discovery rejects advertised catalogs over 10000 at the first page without requesting history evidence', async () => {
  const { state, observe } = mainCatalogFixture(10001); const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['history_pagination_limit_exceeded']); assert.equal(report.suites[0].manifest, undefined);
  const pages = state.calls.filter(call => call.path.startsWith('/actions/workflows/10/runs?'));
  assert.equal(pages.length, 1); assert.ok(pages[0].path.endsWith('page=1'));
  assert.equal(state.calls.some(call => call.path === '/actions/runs/100/attempts/1'), false);
});

for (const sourceRunId of [100, 200]) test(`source ${sourceRunId} retains complete execution when its whole observation request budget is exhausted`, async () => {
  const { state, observe } = fixture(); const budget = createObservationBudget({ maxRequests: 20 });
  const report = await observe(sourceRunId, { budget }); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['observer_request_budget_exhausted']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(state.calls.length, 20); assert.equal(report.observationBudget.requests, 20); assert.equal(report.observationBudget.limits.maxRequests, 20);
  assert.equal(report.observationBudget.reason, 'observer_request_budget_exhausted'); assert.equal(report.observationBudget.exhausted, true);
  assert.equal(report.observationBudget.executionAuthorityVerified, false); assert.equal(report.observationBudget.runFull, true); assert.equal(report.observationBudget.skip, false);
  assert.equal(state.calls.some(call => call.path.startsWith('/actions/workflows/10/runs?')), true, 'the limit covers evidence lookup as well as bootstrap');
});

test('multiple suites share one latched request budget instead of receiving a fresh allowance each', async () => {
  const { state, observe } = fixture(); const budget = createObservationBudget({ maxRequests: 20 });
  const multipleSuites = { ...config, suites: [suite, { ...suite, id: 'second-observed-suite' }] };
  const report = await observe(100, { budget, config: multipleSuites }); assertCompleteValidation(report);
  assert.equal(report.suites.length, 2); assert.equal(state.calls.length, 20); assert.equal(report.observationBudget.requests, 20);
  for (const result of report.suites) { assert.deepEqual(result.reasons, ['observer_request_budget_exhausted']); assert.equal(result.manifest, undefined); }
  assert.equal(report.observationBudget.reason, 'observer_request_budget_exhausted');
});

test('the whole observation deadline rejects an API result that returns after its time budget', async () => {
  const { state, observe } = fixture(); let elapsed = 0;
  const budget = createObservationBudget({ maxElapsedMs: 10, clock: () => elapsed });
  state.beforeApi = path => { if (path.includes('/jobs?')) elapsed = 11; };
  const report = await observe(100, { budget }); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['observer_time_budget_exhausted']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(report.observationBudget.elapsedMs, 11); assert.equal(report.observationBudget.limits.maxElapsedMs, 10);
  assert.equal(report.observationBudget.reason, 'observer_time_budget_exhausted'); assert.equal(report.observationBudget.requests, state.calls.length);
  assert.equal(state.calls.some(call => call.path.includes('/logs')), false, 'a late jobs response cannot advance into trusted log measurement');
});

test('a hanging observation API is aborted, and a late green cannot clear its timeout fallback', async () => {
  const value = fixture(); const budget = createObservationBudget({ maxElapsedMs: 1000, requestTimeoutMs: 10 });
  let calls = 0, signal, resolveLate;
  const hangingApi = async (_path, options) => { calls++; signal = options.signal; return new Promise(resolve => { resolveLate = resolve; }); };
  const report = await value.observe(100, { budget, api: hangingApi }); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['observer_request_timeout']); assert.equal(report.suites[0].manifest, undefined);
  assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.equal(report.observationBudget.reason, 'observer_request_timeout');
  resolveLate(REPO); await Promise.resolve();
  const repeat = await value.observe(100, { budget, api: hangingApi }); assertCompleteValidation(repeat);
  assert.deepEqual(repeat.suites[0].reasons, ['observer_request_timeout']); assert.equal(repeat.suites[0].manifest, undefined);
  assert.equal(calls, 1); assert.equal(repeat.observationBudget.requests, 1);
});

test('a normal-sized successful model reports the default global bounds without granting reuse', async () => {
  const { state, observe } = fixture(); const report = await observe(); assertCompleteValidation(report);
  assert.deepEqual(report.suites[0].reasons, ['runtime_not_attested']);
  assert.deepEqual(report.observationBudget.limits, { maxRequests: 200, maxElapsedMs: 90000, requestTimeoutMs: 10000 });
  assert.equal(report.observationBudget.requests, state.calls.length); assert.ok(report.observationBudget.requests <= 200);
  assert.equal(report.observationBudget.exhausted, false); assert.equal(report.observationBudget.reason, null);
  assert.equal(report.observationBudget.executionAuthorityVerified, false); assert.equal(report.observationBudget.diagnosticsOnly, true);
});

test('source workflow or identity action modification against trusted base is rejected', async () => {
  for (const path of [PATH, ACTION]) {
    const { observe, state } = fixture();
    state.trees[TB].tree.find(entry => entry.path === path).sha = oid('9');
    assert.deepEqual((await observe(100)).suites[0].reasons, [`untrusted_definition:${path}`]);
  }
});

test('changed pre-identity scope/dedup script or setup input cannot produce trusted manifest', async () => {
  for (const path of ['.harness/scripts/ci-lane-dedup.mjs', '.harness/scripts/board-ci-scope.mjs', 'package.json', '.npmrc', 'pnpm-workspace.yaml', '.nvmrc', 'pnpm-lock.yaml']) {
    const { observe, state } = fixture();
    for (const tree of Object.values(state.trees)) {
      const existing = tree.tree.find(entry => entry.path === path);
      if (!existing) tree.tree.push({ path, type: 'blob', mode: '100644', sha: oid('a') });
    }
    state.trees[TB].tree.find(entry => entry.path === path).sha = oid('9');
    assert.deepEqual((await observe(100)).suites[0].reasons, ['pre_identity_definition_closure_changed'], path);
  }
});

test('untrusted API checkout, unexpected parents and changed main tree retain complete execution', async () => {
  const wrongObserver = fixture();
  wrongObserver.state.own.head_sha = B;
  assert.deepEqual((await wrongObserver.observe()).suites[0].reasons, ['untrusted_observer_checkout']);
  const parents = fixture(); parents.state.commits[S].parents = [{ sha: H }];
  assert.deepEqual((await parents.observe()).suites[0].reasons, ['checkout_git_object_mismatch']);
  const tree = fixture(); tree.state.logs[201] = marker({ ...identity({ main: true }), tree: TB }, '2026-10-05T10:20:03.1250000Z');
  assert.deepEqual((await tree.observe()).suites[0].reasons, ['checkout_git_object_mismatch']);
});

test('PR head change, cross-repository source and ambiguous PR identities are refused', async () => {
  const head = fixture(); head.state.pull.head.sha = oid('9');
  assert.deepEqual((await head.observe(100)).suites[0].reasons, ['candidate_head_changed']);
  const foreign = fixture(); foreign.state.source.head_repository = { ...REPO, id: 2 };
  assert.deepEqual((await foreign.observe(100)).suites[0].reasons, ['foreign_run_repository']);
  const ambiguous = fixture(); ambiguous.state.source.pull_requests.push({ number: 10 });
  assert.deepEqual((await ambiguous.observe(100)).suites[0].reasons, ['run_candidate_missing_or_ambiguous']);
});

test('a newer failure, cancellation or incomplete status invalidates older successful measurement', async () => {
  for (const status of ['failure', 'cancelled', 'unknown']) {
    const { observe, state } = fixture();
    state.history.push(run(102, 'pull_request', H, { conclusion: status, run_started_at: '2026-10-05T10:15:00Z' }));
    assert.deepEqual((await observe()).suites[0].reasons, ['newer_attempt_not_successful_or_head_changed']);
  }
});

test('old-created run rerun to failure today is included via latest attempt API; no created filter', async () => {
  const { observe, state } = fixture();
  state.history.push(run(50, 'pull_request', H, { run_attempt: 2, conclusion: 'failure', created_at: '2026-09-01T10:00:00Z', run_started_at: '2026-10-05T10:15:00Z' }));
  assert.deepEqual((await observe()).suites[0].reasons, ['newer_attempt_not_successful_or_head_changed']);
  assert.equal(state.calls.some(call => call.path === '/actions/runs/50/attempts/2'), true);
  assert.equal(state.calls.some(call => call.path.includes('created=')), false);
});

test('missing/expired artifact, missing digest and old-attempt artifact cannot count as evidence', async () => {
  for (const mutate of [state => { state.artifacts = []; }, state => { state.artifacts[0].expired = true; }, state => { delete state.artifacts[0].digest; }, state => { state.artifacts[0].created_at = '2026-10-04T10:09:00Z'; }]) {
    const { observe, state } = fixture(); mutate(state);
    const result = (await observe(100)).suites[0];
    assert.equal(result.candidateEvidenceGenerated, undefined);
    assert.equal(result.runFull, true);
    assert.equal(result.wouldReuse, false);
  }
});

test('API denied at jobs/log/history always yields a fallback receipt and never a green', async () => {
  for (const denied of [path => path.includes('/jobs'), path => path.includes('/logs'), path => path.includes('/runs?')]) {
    const { observe, state } = fixture(); state.denied = denied;
    const report = await observe();
    assert.deepEqual(report.suites[0].reasons, ['github_api_http_403']);
    assert.equal(report.suites[0].runFull, true);
    assert.equal(report.suites[0].skip, false);
  }
});

test('truncated tree, missing required executed step and malformed artifact metadata retain full execution', async () => {
  const truncated = fixture(); truncated.state.trees[TS].truncated = true;
  assert.deepEqual((await truncated.observe()).suites[0].reasons, ['truncated_or_invalid_git_tree']);
  const skipped = fixture(); skipped.state.jobs[100].steps[3].conclusion = 'skipped';
  assert.deepEqual((await skipped.observe(100)).suites[0].reasons, ['actual_execution_not_successful:fullstack-smoke']);
});

test('off, unknown reuse mode and fresh-run prevent all lookups', async () => {
  for (const options of [{ mode: 'off' }, { mode: 'reuse' }, { freshRun: true }]) {
    const { observe, state } = fixture();
    const report = await observe(200, options);
    assert.equal(state.calls.length, 0);
    assert.equal(report.skip, false);
    assert.equal(report.runFull, true);
    assert.equal(report.suites[0].wouldReuse, false);
  }
});

test('manual observer observation cannot authorize reuse', async () => {
  const { observe, state } = fixture(); state.own.event = 'workflow_dispatch';
  assert.ok((await observe()).suites[0].reasons.includes('untrusted_observer'));
});

test('pagination must be complete, consistent and unique or throw', async () => {
  const one = await githubPages(async () => ({ total_count: 1, jobs: [{ id: 1 }] }), '/x', 'jobs');
  assert.deepEqual(one, [{ id: 1 }]);
  await assert.rejects(githubPages(async path => ({ total_count: 2, jobs: path.endsWith('page=1') ? [{ id: 1 }] : [] }), '/x', 'jobs'), /incomplete_pagination/);
  await assert.rejects(githubPages(async () => ({ total_count: 2, jobs: [{ id: 1 }] }), '/x', 'jobs'), /pagination_duplicate_or_invalid_id/);
  await assert.rejects(githubPages(async () => ({ total_count: 3, jobs: [{ id: 1 }] }), '/x', 'jobs', 1), /pagination_limit_exceeded/);
});

test('real API wrapper accepts exact repository root and omits token on log redirect', async () => {
  const calls = [];
  const api = createGitHubApi({ repository: REPO.full_name, token: 'private-test-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/logs')) return new Response(null, { status: 302, headers: { location: 'https://logs.example.test/signed-logs' } });
    if (url === 'https://logs.example.test/signed-logs') return new Response('safe log');
    return new Response(JSON.stringify(REPO), { headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(await api(''), REPO);
  assert.equal(await api('/actions/jobs/1/logs', { raw: true }), 'safe log');
  assert.equal(calls[0].url, 'https://api.github.com/repos/boardx/workspacex');
  assert.equal(calls[2].options.headers, undefined);
  await assert.rejects(api('//attacker.example'), /invalid_api_path/);
});

test('binary artifact transport preserves ZIP bytes and strips authorization on signed redirect', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
  const calls = [];
  const api = createGitHubApi({ repository: REPO.full_name, token: 'private-test-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://artifacts.example.test/signed-archive' } })
      : new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  } });
  assert.deepEqual(await api('/actions/artifacts/301/zip', { binary: true }), bytes);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-test-token');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, 'error');
});

test('binary artifact transport rejects declared and streamed size overflow', async () => {
  for (const declared of [true, false]) {
    const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20_000_001)); controller.close(); } });
    const api = createGitHubApi({ repository: REPO.full_name, token: 'test-token', fetchImpl: async () => new Response(oversized, { headers: declared ? { 'content-length': '20000001' } : {} }) });
    await assert.rejects(api('/actions/artifacts/301/zip', { binary: true }), /artifact_archive_too_large/);
  }
});

test('binary artifact transport refuses missing bodies, insecure redirects and ambiguous modes', async () => {
  const api = createGitHubApi({ repository: REPO.full_name, token: 'test-token', fetchImpl: async () => new Response(null) });
  await assert.rejects(api('/actions/artifacts/301/zip', { binary: true }), /artifact_archive_body_missing/);
  await assert.rejects(api('/actions/artifacts/301/zip', { binary: true, raw: true }), /ambiguous_api_response_mode/);
  for (const location of ['http://artifacts.example.test/archive', 'https://user:password@artifacts.example.test/archive']) {
    const unsafe = createGitHubApi({ repository: REPO.full_name, token: 'test-token', fetchImpl: async () => new Response(null, { status: 302, headers: { location } }) });
    await assert.rejects(unsafe('/actions/artifacts/301/zip', { binary: true }), /unsafe_log_redirect/);
  }
});

test('CLI bootstrap failure and disabled modes still write receipt files and skip=false', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'candidate-observer-test-'));
  try {
    const summary = join(directory, 'github-summary.md');
    const output = join(directory, 'github-output.txt');
    const report = await runObserver({ CI_CANDIDATE_OUTPUT_DIR: directory, GITHUB_EVENT_PATH: '/absent-fixture', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output });
    assert.deepEqual(report.suites[0].reasons, ['observer_bootstrap_or_lookup_failed']);
    assert.equal(JSON.parse(readFileSync(join(directory, 'shadow-report.json'))).runFull, true);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'candidate-manifests.json'))), []);
    assert.match(readFileSync(output, 'utf8'), /skip=false/);
    assert.match(readFileSync(summary, 'utf8'), /Complete validation continues/);
    const disabled = await runObserver({ CI_CANDIDATE_MODE: 'off', CI_CANDIDATE_OUTPUT_DIR: directory });
    assert.deepEqual(disabled.suites[0].reasons, ['reuse_disabled']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI persists exact global-budget fallback receipts and no stale candidate manifests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'candidate-budget-cli-test-'));
  try {
    const { api, state } = fixture(); const budget = createObservationBudget({ maxRequests: 20 });
    const event = join(directory, 'event.json'); writeFileSync(event, JSON.stringify({ workflow_run: { id: 100 } }));
    const env = { CI_CANDIDATE_OUTPUT_DIR: directory, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: REPO.full_name,
      GITHUB_RUN_ID: '900', GITHUB_SHA: O, GITHUB_STEP_SUMMARY: join(directory, 'github-summary.md'), GITHUB_OUTPUT: join(directory, 'github-output.txt'),
      CI_CANDIDATE_MAX_REQUESTS: '1000000', CI_CANDIDATE_MAX_ELAPSED_MS: '1000000' };
    const git = args => { if (args.join(' ') === 'rev-parse HEAD') return O; if (args.join(' ') === 'rev-parse HEAD^{tree}') return TS; assert.deepEqual(args, ['show', '-s', '--format=%P', 'HEAD']); return S; };
    writeFileSync(join(directory, 'candidate-manifests.json'), JSON.stringify([{ verified: true, stale: true }]));
    const report = await runObserver(env, { api, budget, git, config, now }); assertCompleteValidation(report);
    assert.deepEqual(report.suites[0].reasons, ['observer_request_budget_exhausted']); assert.equal(state.calls.length, 20);
    const saved = JSON.parse(readFileSync(join(directory, 'shadow-report.json'), 'utf8'));
    assert.deepEqual(saved.observationBudget, report.observationBudget); assert.equal(saved.observationBudget.limits.maxRequests, 20);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'candidate-manifests.json'), 'utf8')), []);
    assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), /observer_request_budget_exhausted/);
    assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /observer_request_budget_exhausted/);
    assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /run_full=true\nskip=false/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const kind of ['bootstrap-time', 'api-timeout']) test(`CLI persists ${kind} fallback and safe GitHub outputs`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'candidate-deadline-cli-test-'));
  let resolveLate;
  try {
    const value = fixture(); let elapsed = 0, signal, apiCalls = 0;
    const budget = kind === 'bootstrap-time' ? createObservationBudget({ maxElapsedMs: 10, clock: () => elapsed }) :
      createObservationBudget({ maxElapsedMs: 1000, requestTimeoutMs: 10 });
    const event = join(directory, 'event.json'); writeFileSync(event, JSON.stringify({ workflow_run: { id: 100 } }));
    const env = { CI_CANDIDATE_OUTPUT_DIR: directory, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: REPO.full_name,
      GITHUB_RUN_ID: '900', GITHUB_SHA: O, GITHUB_STEP_SUMMARY: join(directory, 'github-summary.md'), GITHUB_OUTPUT: join(directory, 'github-output.txt') };
    const git = args => { if (kind === 'bootstrap-time') elapsed = 11; if (args.join(' ') === 'rev-parse HEAD') return O;
      if (args.join(' ') === 'rev-parse HEAD^{tree}') return TS; assert.deepEqual(args, ['show', '-s', '--format=%P', 'HEAD']); return S; };
    const api = kind === 'bootstrap-time' ? value.api : async (_path, options) => { apiCalls++; signal = options.signal;
      return new Promise(resolve => { resolveLate = resolve; }); };
    writeFileSync(join(directory, 'candidate-manifests.json'), JSON.stringify([{ verified: true, stale: true }]));
    const report = await runObserver(env, { api, budget, git, config, now }); assertCompleteValidation(report);
    const reason = kind === 'bootstrap-time' ? 'observer_time_budget_exhausted' : 'observer_request_timeout';
    assert.deepEqual(report.suites[0].reasons, [reason]); assert.equal(report.observationBudget.reason, reason); assert.equal(report.observationBudget.exhausted, true);
    const saved = JSON.parse(readFileSync(join(directory, 'shadow-report.json'), 'utf8')); assert.deepEqual(saved.observationBudget, report.observationBudget);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'candidate-manifests.json'), 'utf8')), []);
    assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), new RegExp(reason)); assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), new RegExp(reason));
    assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /run_full=true\nskip=false/);
    if (kind === 'bootstrap-time') { assert.equal(value.state.calls.length, 0); assert.equal(report.observationBudget.requests, 0);
      assert.equal(report.observationBudget.elapsedMs, 11); assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), /11\/10 ms/); }
    else { assert.equal(apiCalls, 1); assert.equal(signal.aborted, true); assert.equal(report.observationBudget.requests, 1);
      resolveLate(REPO); await Promise.resolve(); assert.deepEqual(JSON.parse(readFileSync(join(directory, 'candidate-manifests.json'), 'utf8')), []); }
  } finally { resolveLate?.(REPO); rmSync(directory, { recursive: true, force: true }); }
});
