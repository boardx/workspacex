import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
import { PILOT_SUPERVISOR_STEP, PILOT_WORKFLOW_PATH, verifyPilotBootstrap } from './lib/ci-candidate-pilot-authority.mjs';
import { runPilotSupervisor } from './ci-candidate-pilot-supervisor.mjs';

const oid = value => value.repeat(40);
const B = oid('1'), H = oid('2'), M = oid('3'), T = oid('4'), O = oid('5'), OT = oid('6');
const now = Date.parse('2026-10-05T12:00:00Z');
const repo = { id: 7, full_name: 'boardx/workspacex', default_branch: 'main', private: false };
const actualCheckout = { sha: O, tree: OT, parents: [B] };
const bootstrapOptions = { repositoryName: repo.full_name, runId: 900, runAttempt: 1, sourceRunId: 100, actualCheckout, expectedSha: O, ref: 'refs/heads/main', event: 'workflow_dispatch', runnerName: 'GitHub Actions 42', runnerEnvironment: 'github-hosted', now };

function fixture() {
  const own = { id: 900, run_attempt: 1, workflow_id: 20, path: PILOT_WORKFLOW_PATH, event: 'workflow_dispatch', head_branch: 'main', head_sha: O, status: 'in_progress', conclusion: null, repository: repo, head_repository: repo, run_started_at: '2026-10-05T10:00:00Z' };
  const job = { id: 901, run_id: 900, name: 'protected-pilot', status: 'in_progress', conclusion: null, started_at: '2026-10-05T10:00:10Z', runner_id: 40, runner_group_id: 0, runner_name: 'GitHub Actions 42', labels: ['ubuntu-latest', 'Linux', 'X64'], steps: [{ name: 'Checkout protected supervisor', number: 1, status: 'completed', conclusion: 'success' }, { name: 'Set up controller Node', number: 2, status: 'completed', conclusion: 'success' }, { name: PILOT_SUPERVISOR_STEP, number: 3, status: 'in_progress', conclusion: null, started_at: '2026-10-05T10:00:20Z' }] };
  const state = { repo: structuredClone(repo), own, attempt: null, job, extraJobs: [], workflow: { id: 20, path: PILOT_WORKFLOW_PATH, state: 'active' }, commit: { sha: O, tree: { sha: OT }, parents: [{ sha: B }] }, definition: { type: 'file', path: PILOT_WORKFLOW_PATH, sha: oid('a'), size: 1200 }, calls: [], before: null };
  const api = async path => {
    state.calls.push(path);
    if (state.before) await state.before(path);
    if (path === '') return structuredClone(state.repo);
    if (path === '/actions/runs/900') return structuredClone(state.own);
    if (path === '/actions/runs/900/attempts/1') return structuredClone(state.attempt ?? state.own);
    if (path === '/actions/workflows/20') return structuredClone(state.workflow);
    if (path === `/git/commits/${O}`) return structuredClone(state.commit);
    if (path === `/contents/${PILOT_WORKFLOW_PATH}?ref=${O}`) return structuredClone(state.definition);
    if (path.startsWith('/actions/runs/900/attempts/1/jobs?')) return { total_count: 1 + state.extraJobs.length, jobs: structuredClone([state.job, ...state.extraJobs]) };
    throw new Error(`Unexpected fixture API: ${path}`);
  };
  return { state, api, verify: extra => verifyPilotBootstrap({ ...bootstrapOptions, api, ...extra }) };
}

function assertRejected(result) {
  assert.equal(result.bootstrapVerified, false);
  assert.equal(result.protectedVerified, false);
  assert.equal(result.apiVerified, false);
  assert.equal(result.runFull, true);
  assert.equal(result.skip, false);
  assert.equal(result.authority, null);
  assert.ok(result.reasons.length > 0);
}

test('main dispatch bootstrap independently binds run/attempt/actual Git/job/runner but has no final authority', async () => {
  const { state, verify } = fixture();
  const result = await verify();
  assert.equal(result.bootstrapVerified, true);
  assert.equal(result.authority.apiBootstrapVerified, true);
  assert.equal(result.authority.definitionTrusted, true);
  assert.equal(result.authority.runId, 900); assert.equal(result.authority.runAttempt, 1); assert.equal(result.authority.jobId, 901);
  assert.equal(result.authority.controllerTree, OT);
  assert.equal(result.authority.sourceRunId, 100);
  assert.equal(result.authority.runnerGroupId, 0);
  assert.equal(result.protectedVerified, false); assert.equal(result.apiVerified, false);
  assert.equal(result.authority.protectedVerified, false); assert.equal(result.authority.apiVerified, false);
  assert.equal(result.skip, false); assert.equal(result.runFull, true);
  assert.ok(state.calls.includes('/actions/runs/900/attempts/1'));
  assert.ok(state.calls.includes(`/git/commits/${O}`));
});

test('wrong main branch/head/default branch/ref/event cannot pass bootstrap', async () => {
  for (const mutate of [
    state => { state.own.head_branch = 'worker/evil'; },
    state => { state.own.head_sha = H; },
    state => { state.repo.default_branch = 'worker/evil'; },
    state => { state.own.event = 'pull_request'; },
  ]) {
    const { state, verify } = fixture(); mutate(state);
    assertRejected(await verify());
  }
  for (const extra of [{ ref: 'refs/pull/9/merge' }, { event: 'pull_request' }, { expectedSha: H }, { actualCheckout: { ...actualCheckout, sha: H } }]) assertRejected(await fixture().verify(extra));
});

test('workflow definition/path/attempt/foreign repository mismatch is refused', async () => {
  for (const mutate of [
    state => { state.own.path = '.github/workflows/attacker.yml'; },
    state => { state.workflow.path = '.github/workflows/attacker.yml'; },
    state => { state.workflow.id = 21; },
    state => { state.own.run_attempt = 2; },
    state => { state.attempt = { ...state.own, run_attempt: 2 }; },
    state => { state.own.head_repository = { ...repo, id: 8 }; },
    state => { state.repo.full_name = 'attacker/workspacex'; },
    state => { state.definition.path = '.github/workflows/attacker.yml'; },
  ]) {
    const { state, verify } = fixture(); mutate(state);
    assertRejected(await verify());
  }
});

test('actual controller Git tree and parents must match independent immutable objects', async () => {
  for (const mutate of [state => { state.commit.tree.sha = T; }, state => { state.commit.parents[0].sha = H; }, state => { state.commit.sha = H; }]) {
    const { state, verify } = fixture(); mutate(state);
    assertRejected(await verify());
  }
});

test('missing/mismatched runner, wrong job, ambiguous job or non-current supervisor refuses launch identity', async () => {
  for (const mutate of [
    state => { state.job.runner_id = 0; },
    state => { state.job.runner_name = 'other runner'; },
    state => { state.job.runner_group_id = -1; },
    state => { state.job.labels = ['self-hosted']; },
    state => { state.job.run_id = 999; },
    state => { state.job.name = 'attacker'; },
    state => { state.extraJobs = [{ ...state.job, id: 902 }]; },
    state => { state.job.steps[2].status = 'completed'; state.job.steps[2].conclusion = 'success'; },
    state => { state.job.steps[2].name = 'Candidate fake supervisor'; },
  ]) {
    const { state, verify } = fixture(); mutate(state);
    assertRejected(await verify());
  }
});

test('completed run is not current bootstrap authority, and unknown/API exception fails closed', async () => {
  const completed = fixture(); completed.state.own.status = 'completed'; completed.state.own.conclusion = 'success';
  assertRejected(await completed.verify());
  const failure = fixture(); failure.state.before = () => { throw new Error('secret=not-output'); };
  const result = await failure.verify();
  assertRejected(result);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  const denied = fixture(); denied.state.before = () => { const error = new Error('HTTP'); error.reason = 'github_api_http_403'; throw error; };
  assert.deepEqual((await denied.verify()).reasons, ['github_api_http_403']);
});

test('zero/invalid source/run/attempt, missing runner or invalid clock invokes no API', async () => {
  for (const extra of [{ sourceRunId: 0 }, { sourceRunId: NaN }, { runId: 0 }, { runAttempt: 0 }, { runnerName: '' }, { runnerEnvironment: 'self-hosted' }, { now: Infinity }]) {
    const { state, verify } = fixture(); assertRejected(await verify(extra));
    assert.equal(state.calls.length, 0);
  }
});

function cliFixture() {
  const { api, state } = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'pilot-bootstrap-test-'));
  const repositoryRoot = join(directory, 'controller');
  const outputDirectory = join(directory, 'receipt');
  mkdirSync(join(repositoryRoot, '.harness/config'), { recursive: true });
  const policy = { schemaVersion: 1, suite: 'fixed-suite', command: { argv: ['/usr/local/bin/node', '--test', '/input/fixed.test.mjs'] }, image: { reference: 'node@sha256:' + 'a'.repeat(64) } };
  const policyText = JSON.stringify(policy, null, 2) + '\n';
  writeFileSync(join(repositoryRoot, '.harness/config/ci-candidate-pilot.json'), policyText);
  writeFileSync(join(repositoryRoot, '.harness/config/ci-suite-ownership.json'), JSON.stringify({ suites: [] }));
  const gitCalls = [], launches = [], resolverCalls = [];
  const git = args => {
    gitCalls.push(args);
    if (args[0] === 'rev-parse') return args[2] === 'HEAD^{commit}' ? `${O}\n` : args[2] === 'HEAD^{tree}' ? `${OT}\n` : `${T}\n`;
    if (args[0] === 'show' && args[1] === `${O}:.harness/config/ci-candidate-pilot.json`) return policyText;
    if (args[0] === 'show') return args.at(-1) === 'HEAD' ? `${B}\n` : `${B} ${H}\n`;
    if (['diff', 'fetch', 'config'].includes(args[0])) return '';
    throw new Error('Unexpected Git fixture command');
  };
  const candidate = { prNumber: 9, baseSha: B, headSha: H, mergeSha: M, sourceTree: T, parents: [B, H], mergeable: true, headCurrent: true };
  const resolved = { candidate, producer: { runId: 100, runAttempt: 1, workflowId: 10, path: '.github/workflows/harness-verify.yml', event: 'pull_request', headSha: H }, historyObservation: { stableDuringRead: true, measurementBound: true, skipAuthorization: false }, skip: false, runFull: true, protectedVerified: false };
  const env = { GITHUB_REPOSITORY: repo.full_name, GITHUB_RUN_ID: '900', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: O, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', CI_CANDIDATE_SOURCE_RUN_ID: '100', CI_CANDIDATE_OUTPUT_DIR: outputDirectory, RUNNER_NAME: 'GitHub Actions 42', RUNNER_ENVIRONMENT: 'github-hosted', GH_TOKEN: 'never-pass-private-token' };
  const dependencies = { repositoryRoot, api, git, resolveCandidate: async options => { resolverCalls.push(options); return structuredClone(resolved); }, runPilot: async options => { launches.push(options); assert.equal(existsSync(options.outputDirectory), false, 'execution receipt directory was not created by bootstrap'); return { executionSuccessful: true, proofComplete: true, protectedVerified: false, verified: false, apiVerified: false, reuseAuthorized: false, runFull: true, skip: false }; } };
  return { directory, repositoryRoot, outputDirectory, policy, env, dependencies, state, gitCalls, launches, resolverCalls, resolved, run: extra => runPilotSupervisor({ ...env, ...extra }, dependencies), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('CLI independently bootstraps, resolves source and fetches exact anonymous SHA before fixed-policy pilot', async () => {
  const fixture = cliFixture();
  try {
    const report = await fixture.run();
    assert.deepEqual(report.reasons, []);
    assert.equal(report.pilotStarted, true); assert.equal(report.pilotCompleted, true);
    assert.equal(report.protectedVerified, false); assert.equal(report.apiVerified, false);
    assert.equal(report.skip, false); assert.equal(report.runFull, true);
    assert.equal(fixture.launches.length, 1);
    assert.equal(fixture.launches[0].candidateSha, M);
    assert.deepEqual(fixture.launches[0].policy, fixture.policy);
    assert.equal(fixture.launches[0].outputDirectory, join(fixture.outputDirectory, 'execution'));
    const fetch = fixture.gitCalls.find(args => args[0] === 'fetch');
    assert.deepEqual(fetch, ['fetch', '--no-tags', '--no-write-fetch-head', 'https://github.com/boardx/workspacex.git', M]);
    assert.equal(fixture.gitCalls.some(args => args.includes('checkout') || args.includes('switch') || args.includes('submodule')), false);
    assert.equal(fixture.resolverCalls[0].authority.apiBootstrapVerified, true);
    assert.equal(fixture.resolverCalls[0].authority.apiVerified, false);
    const receipt = JSON.parse(readFileSync(join(fixture.outputDirectory, 'protected-bootstrap.json')));
    assert.equal(receipt.candidate.fullTree, T); assert.equal(receipt.controller.sha, O);
    assert.equal(receipt.candidate.sourceRunAttempt, 1);
    assert.equal(receipt.protectedVerified, false);
    assert.equal(JSON.stringify(report).includes(fixture.env.GH_TOKEN), false);
    assert.equal(JSON.stringify(fixture.launches).includes(fixture.env.GH_TOKEN), false);
  } finally { fixture.cleanup(); }
});

test('CLI invalid/zero source ID and branch dispatch do not bootstrap, fetch or launch pilot', async () => {
  for (const extra of [{ CI_CANDIDATE_SOURCE_RUN_ID: '0' }, { CI_CANDIDATE_SOURCE_RUN_ID: '' }, { CI_CANDIDATE_SOURCE_RUN_ID: '100;command' }, { GITHUB_REF: 'refs/pull/9/merge' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_RUN_ATTEMPT: '0' }]) {
    const fixture = cliFixture();
    try {
      const report = await fixture.run(extra);
      assert.equal(report.pilotStarted, false);
      assert.equal(fixture.launches.length, 0); assert.equal(fixture.gitCalls.length, 0); assert.equal(fixture.state.calls.length, 0);
      assert.equal(existsSync(join(fixture.outputDirectory, 'pilot-supervisor-report.json')), true);
    } finally { fixture.cleanup(); }
  }
});

test('CLI every bootstrap rejection refuses candidate resolver, Git fetch and pilot start', async () => {
  for (const mutate of [state => { state.own.head_branch = 'evil'; }, state => { state.own.head_sha = H; }, state => { state.own.run_attempt = 2; }, state => { state.workflow.path = '.github/workflows/evil.yml'; }, state => { state.own.head_repository = { ...repo, id: 8 }; }, state => { state.job.runner_id = 0; }, state => { state.before = () => { throw new Error('API inaccessible'); }; }]) {
    const fixture = cliFixture(); mutate(fixture.state);
    try {
      const report = await fixture.run();
      assert.equal(report.pilotStarted, false);
      assert.equal(fixture.launches.length, 0); assert.equal(fixture.resolverCalls.length, 0);
      assert.equal(fixture.gitCalls.some(args => args[0] === 'fetch'), false);
      assert.equal(report.protectedVerified, false); assert.equal(report.skip, false);
    } finally { fixture.cleanup(); }
  }
});

test('CLI changed controller/policy bytes, unstable history, wrong producer or checkout never launches', async () => {
  for (const mutate of [
    fixture => { fixture.dependencies.git = args => { if (args[0] === 'diff') throw new Error('dirty control closure'); return args[0] === 'rev-parse' ? args[2] === 'HEAD^{commit}' ? O : OT : B; }; },
    fixture => { writeFileSync(join(fixture.repositoryRoot, '.harness/config/ci-candidate-pilot.json'), JSON.stringify({ ...fixture.policy, command: { argv: ['attacker'] } })); },
    fixture => { fixture.resolved.historyObservation.stableDuringRead = false; },
    fixture => { fixture.resolved.historyObservation.measurementBound = false; },
    fixture => { fixture.resolved.producer.runId = 101; },
    fixture => { fixture.resolved.producer.headSha = B; },
    fixture => { fixture.resolved.candidate.parents = [H, B]; },
    fixture => { fixture.resolved.candidate.headCurrent = false; },
    fixture => { fixture.state.repo.private = true; },
  ]) {
    const fixture = cliFixture(); mutate(fixture);
    try {
      const report = await fixture.run();
      assert.equal(report.pilotStarted, false); assert.equal(fixture.launches.length, 0);
      assert.equal(fixture.gitCalls.some(args => args[0] === 'fetch'), false);
      assert.ok(report.reasons.length > 0);
    } finally { fixture.cleanup(); }
  }
});

test('CLI resolver/Git errors retain a fallback receipt without pilot start', async () => {
  for (const point of ['resolver', 'fetch', 'tree']) {
    const fixture = cliFixture();
    try {
      if (point === 'resolver') fixture.dependencies.resolveCandidate = async () => { throw new Error('read failure'); };
      else {
        const original = fixture.dependencies.git;
        fixture.dependencies.git = args => { if (point === 'fetch' && args[0] === 'fetch') throw new Error('anonymous unavailable'); if (point === 'tree' && args[2] === `${M}^{tree}`) return OT; return original(args); };
      }
      const report = await fixture.run();
      assert.equal(report.pilotStarted, false); assert.equal(fixture.launches.length, 0);
      assert.equal(JSON.parse(readFileSync(join(fixture.outputDirectory, 'pilot-supervisor-report.json'))).runFull, true);
    } finally { fixture.cleanup(); }
  }
});

test('local URL rewriting or credential configuration cannot bypass anonymous fixed repository fetch', async () => {
  for (const config of ['url.https://attacker.example/.insteadof\nhttps://github.com/\0', 'http.https://github.com/.extraheader\nAUTHORIZATION: private-token\0', 'http.cookiefile\n/private-cookie\0', 'credential.helper\nattacker-command\0']) {
    const fixture = cliFixture();
    const original = fixture.dependencies.git;
    fixture.dependencies.git = args => args[0] === 'config' ? config : original(args);
    try {
      const report = await fixture.run();
      assert.equal(report.pilotStarted, false);
      assert.deepEqual(report.reasons, ['pilot_git_local_credentials_or_url_rewrite']);
      assert.equal(fixture.gitCalls.some(args => args[0] === 'fetch'), false);
      assert.equal(JSON.stringify(report).includes('private-token'), false);
    } finally { fixture.cleanup(); }
  }
});

test('CLI refuses executor self-reported final authority, incomplete proof or unsuccessful execution', async () => {
  for (const change of [{ protectedVerified: true }, { apiVerified: true }, { verified: true }, { reuseAuthorized: true }, { executionSuccessful: false }, { proofComplete: false }]) {
    const fixture = cliFixture();
    fixture.dependencies.runPilot = async () => ({ protectedVerified: false, apiVerified: false, verified: false, reuseAuthorized: false, skip: false, runFull: true, executionSuccessful: true, proofComplete: true, ...change });
    try {
      const report = await fixture.run();
      assert.equal(report.protectedVerified, false); assert.equal(report.apiVerified, false); assert.equal(report.skip, false); assert.equal(report.runFull, true);
      assert.ok(report.reasons.length > 0);
    } finally { fixture.cleanup(); }
  }
});
