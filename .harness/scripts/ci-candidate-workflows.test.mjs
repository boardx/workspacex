import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  BASELINE_SHA, IDENTITY_ACTION, SOURCE_WORKFLOWS, inspectCheckoutOwnership,
  inspectSuiteOwnership,
} from './lint-ci-suite-ownership.mjs';
import { IDENTITY_STEP, parseCheckoutIdentity } from './lib/ci-candidate-github.mjs';

// Existing harness Vitest discovery includes *.test.mjs. Register with the
// active runner so the unchanged harness check and the explicit node check both
// execute these assertions instead of producing a misleading empty suite.
const test = process.env.VITEST ? (await import('vitest')).test : (await import('node:test')).default;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 2_000_000 }).trim();
const load = path => parse(read(path));
const config = JSON.parse(read('.harness/config/ci-suite-ownership.json'));
const source = new Map(SOURCE_WORKFLOWS.map(path => [path, load(path)]));
const baseline = new Map(SOURCE_WORKFLOWS.map(path => [path, parse(git(['show', `${BASELINE_SHA}:${path}`]))]));
const ADDITIVE_CHECKS = [
  { name: 'Candidate evidence and ownership regression tests', run: 'node --test .harness/scripts/ci-candidate-*.test.mjs' },
  { name: 'Validate single suite ownership (shadow only)', run: 'node .harness/scripts/lint-ci-suite-ownership.mjs' },
];

function withoutApprovedAdditions(definition, path) {
  const copy = structuredClone(definition);
  for (const [jobId, job] of Object.entries(copy.jobs)) {
    job.steps = job.steps.filter(step => {
      if (step.uses === IDENTITY_ACTION) {
        const expected = { name: IDENTITY_STEP, uses: IDENTITY_ACTION };
        assert.deepEqual(step, expected, `${path}/${jobId}: identity addition must have no secret, credentials or conditional bypass`);
        return false;
      }
      if (ADDITIVE_CHECKS.some(added => added.name === step.name)) {
        assert.equal(path, '.github/workflows/harness-verify.yml');
        assert.equal(jobId, 'verify-control-plane');
        assert.deepEqual(step, ADDITIVE_CHECKS.find(added => added.name === step.name));
        return false;
      }
      return true;
    });
  }
  return copy;
}
function assertSourcePreserved(actual, expected, path) {
  assert.deepEqual(withoutApprovedAdditions(actual, path), expected,
    `${path}: triggers, permissions, required checks, execution conditions, needs, deployment and manual controls must remain identical`);
}

for (const path of SOURCE_WORKFLOWS) {
  test(`${path}: complete baseline semantics remain unchanged after approved additions`, () => {
    assertSourcePreserved(source.get(path), baseline.get(path), path);
  });
}

test('all 28 source installs record identity immediately after checkout before any candidate command', () => {
  let markers = 0;
  for (const path of SOURCE_WORKFLOWS.slice(0, 3)) {
    for (const [jobId, job] of Object.entries(source.get(path).jobs)) {
      const steps = job.steps ?? [];
      const installs = steps.map((step, index) => /\bpnpm install\b/.test(step.run ?? '') ? index : -1).filter(index => index >= 0);
      const identity = steps.map((step, index) => step.uses === IDENTITY_ACTION ? index : -1).filter(index => index >= 0);
      if (!installs.length) { assert.equal(identity.length, 0); continue; }
      assert.equal(identity.length, 1, `${path}/${jobId}`);
      const checkout = steps.findIndex(step => step.uses?.startsWith('actions/checkout@'));
      assert.equal(identity[0], checkout + 1, `${path}/${jobId}: marker must immediately follow checkout`);
      assert(identity[0] < installs[0]);
      const before = steps.slice(0, identity[0]);
      assert(before.some(step => step.uses?.startsWith('actions/checkout@')));
      assert(!before.some(step => step.run || step.uses?.startsWith('./')), `${path}/${jobId}: no candidate execution before identity`);
      // Existing dedup and scope helpers are preserved, but execute only after
      // identity; otherwise they could rewrite the action or runner PATH.
      const oldSteps = baseline.get(path).jobs[jobId].steps;
      assert.deepEqual(before, oldSteps.slice(0, checkout + 1));
      assert.equal(steps[identity[0]].if, undefined);
      markers++;
    }
  }
  assert.equal(markers, 28);
});

test('individual branch push duplication is not invented: push remains main/tag only', () => {
  for (const path of SOURCE_WORKFLOWS) {
    assert.deepEqual(source.get(path).on.push.branches, ['main']);
    assert.deepEqual(source.get(path).on.push, baseline.get(path).on.push);
  }
  for (const path of SOURCE_WORKFLOWS.slice(0, 3)) assert(Object.hasOwn(source.get(path).on, 'pull_request'));
});

test('main-only/full candidate regression, Board native/meeting and deployment coverage are retained', () => {
  for (const job of ['full-regression-core', 'chat-read', 'self-service-profile', 'e2e-full']) {
    assert.deepEqual(withoutApprovedAdditions(source.get(SOURCE_WORKFLOWS[0]), SOURCE_WORKFLOWS[0]).jobs[job], baseline.get(SOURCE_WORKFLOWS[0]).jobs[job]);
  }
  assert.deepEqual(source.get(SOURCE_WORKFLOWS[3]), baseline.get(SOURCE_WORKFLOWS[3]));
  assert.deepEqual(source.get(SOURCE_WORKFLOWS[1]).jobs.deploy, baseline.get(SOURCE_WORKFLOWS[1]).jobs.deploy);
  const deploy = source.get(SOURCE_WORKFLOWS[1]).jobs.deploy;
  assert(deploy.needs.length > 0);
  assert(deploy.steps.some(step => step.name === '部署并冒烟' && /deploy-gate\.sh/.test(step.run)));
  // The actual-version, health, login/core smoke and migration implementation
  // remains the existing deployment closure; phase one must not rewrite it.
  for (const name of ['deploy-gate.sh', 'deploy-readiness.sh', 'deploy.sh', 'devapp-runtime-identity.mjs', 'deep-agent-lib.sh']) {
    const path = `.harness/scripts/vm/${name}`;
    assert.equal(read(path).trim(), git(['show', `${BASELINE_SHA}:${path}`]), `${path}: deployment/runtime checks must be retained`);
  }
});

test('manual independent fresh reruns and existing dispatch entries remain available', () => {
  for (const path of SOURCE_WORKFLOWS) assert.deepEqual(source.get(path).on.workflow_dispatch, baseline.get(path).on.workflow_dispatch);
  assert.equal(source.get(SOURCE_WORKFLOWS[0]).on.workflow_dispatch.inputs.fresh_run.type, 'boolean');
  assert.equal(source.get(SOURCE_WORKFLOWS[3]).on.workflow_dispatch.inputs.fresh_run.type, 'boolean');
});

const driftCases = [
  ['deleted required execution step', value => { value.jobs['verify-full-compile'].steps.pop(); }],
  ['lowered required-check needs', value => { value.jobs['e2e-full'].needs = []; }],
  ['expanded token permission', value => { value.permissions.contents = 'write'; }],
  ['removed PR synchronization trigger', value => { delete value.on.pull_request; }],
  ['skipped main-only coverage', value => { value.jobs['full-regression-core'].if = 'false'; }],
  ['swallowed execution failure', value => { value.jobs['verify-full-compile']['continue-on-error'] = true; }],
  ['changed manual fresh-run control', value => { value.on.workflow_dispatch.inputs.fresh_run.default = true; }],
  ['altered additive lint to a fake green', value => { value.jobs['verify-control-plane'].steps.find(step => step.name === ADDITIVE_CHECKS[1].name).run = 'true'; }],
  ['identity gaining a secret', value => { value.jobs['verify-affected'].steps.find(step => step.uses === IDENTITY_ACTION).env = { TOKEN: '${{ secrets.TEST }}' }; }],
];
for (const [name, mutate] of driftCases) {
  test(`negative drift: ${name} is rejected`, () => {
    const path = SOURCE_WORKFLOWS[0];
    const changed = structuredClone(source.get(path));
    mutate(changed);
    assert.throws(() => assertSourcePreserved(changed, baseline.get(path), path), assert.AssertionError);
  });
}

function assertProtectedObserver(value) {
  assert.deepEqual(Object.keys(value.on).sort(), ['workflow_dispatch', 'workflow_run']);
  assert.deepEqual(value.on.workflow_run, { workflows: SOURCE_WORKFLOWS.slice(0, 3).map(path => source.get(path).name), types: ['completed'] });
  assert.deepEqual(value.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
  assert.deepEqual(Object.keys(value.jobs), ['observe']);
  const job = value.jobs.observe;
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.deepEqual(job.steps.map(step => step.uses ?? step.run), [
    'actions/checkout@v5', 'actions/setup-node@v5', 'node .harness/scripts/ci-candidate-observer.mjs', 'actions/upload-artifact@v6',
  ]);
  assert.deepEqual(job.steps[0].with, { ref: '${{ github.sha }}', 'persist-credentials': false });
  assert.deepEqual(job.steps[2].env, {
    GH_TOKEN: '${{ github.token }}', CI_CANDIDATE_MODE: "${{ vars.CI_CANDIDATE_MODE || 'shadow' }}",
    CI_CANDIDATE_SOURCE_RUN_ID: '${{ inputs.source_run_id || github.event.workflow_run.id }}',
    CI_CANDIDATE_OUTPUT_DIR: '${{ runner.temp }}/ci-candidate-shadow',
  });
  assert.equal(job.steps[3].if, 'always()');
  assert.equal(job.steps[3].with['if-no-files-found'], 'error');
  assert(!/secrets\.|pull_request_target|id-token|head_sha/.test(JSON.stringify(value)));
  assert.equal(value.on.workflow_dispatch.inputs.source_run_id.required, true);
  assert.equal(value.on.workflow_dispatch.inputs.source_run_id.type, 'string');
}
test('shadow observer executes the protected main snapshot with only read permissions', () => {
  assertProtectedObserver(load('.github/workflows/ci-candidate-shadow.yml'));
});
for (const [name, mutate] of [
  ['candidate checkout', value => { value.jobs.observe.steps[0].with.ref = '${{ github.event.workflow_run.head_sha }}'; }],
  ['persisted checkout credential', value => { value.jobs.observe.steps[0].with['persist-credentials'] = true; }],
  ['PR-target trigger', value => { value.on.pull_request_target = null; }],
  ['OIDC permission', value => { value.permissions['id-token'] = 'write'; }],
  ['candidate execution', value => { value.jobs.observe.steps.push({ run: 'pnpm install && pnpm test' }); }],
  ['unprotected dispatch', value => { delete value.jobs.observe.if; }],
  ['observer secret', value => { value.jobs.observe.steps[2].env.PR_TOKEN = '${{ secrets.CANDIDATE }}'; }],
]) {
  test(`negative observer drift: ${name} is rejected`, () => {
    const changed = load('.github/workflows/ci-candidate-shadow.yml');
    mutate(changed);
    assert.throws(() => assertProtectedObserver(changed), assert.AssertionError);
  });
}

test('identity action records actual checkout before installing code and consumes no secret/token', () => {
  const action = load('.github/actions/ci-candidate-identity/action.yml');
  assert.equal(action.runs.using, 'composite');
  assert.equal(action.runs.steps.length, 1);
  const step = action.runs.steps[0];
  assert.deepEqual(Object.keys(step).sort(), ['name', 'run', 'shell']);
  assert.equal(step.name, IDENTITY_STEP);
  assert.equal(step.shell, 'bash');
  assert(!/secrets\.|TOKEN|GITHUB_TOKEN|npm install|pnpm install|npm run|pnpm run|curl |fetch\(|require\(['"]\.\//.test(step.run));
  assert.equal((step.run.match(/sleep 2/g) ?? []).length, 2);
  const temp = mkdtempSync(join(tmpdir(), 'ci-candidate-workflow-'));
  try {
    const eventPath = join(temp, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } }));
    const output = execFileSync('bash', ['--noprofile', '--norc', '-c', step.run], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000, env: { ...process.env, GITHUB_EVENT_PATH: eventPath,
        GITHUB_WORKFLOW_REF: 'boardx/workspacex/.github/workflows/harness-verify.yml@refs/pull/7/merge', GITHUB_WORKFLOW_SHA: git(['rev-parse', 'HEAD']) },
    });
    const lines = output.trim().split('\n');
    assert.equal(lines.length, 1);
    assert(lines[0].startsWith('CI_CANDIDATE_IDENTITY_V1:'));
    const marker = JSON.parse(Buffer.from(lines[0].split(':')[1], 'base64').toString('utf8'));
    assert.equal(marker.sha, git(['rev-parse', 'HEAD']));
    assert.equal(marker.tree, git(['rev-parse', 'HEAD^{tree}']));
    assert.deepEqual(marker.parents, git(['show', '-s', '--format=%P', 'HEAD']).split(' ').filter(Boolean));
    assert.deepEqual(marker.candidate, { prNumber: 7, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) });
    assert.equal(marker.toolchain.node, process.version);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('GitHub step time boundaries reject marker spoofing by later candidate test output', () => {
  const identity = { schemaVersion: 1, sha: 'a'.repeat(40), tree: 'b'.repeat(40), parents: ['c'.repeat(40), 'd'.repeat(40)],
    workflowSha: 'e'.repeat(40), workflowRef: 'boardx/workspacex/.github/workflows/harness-verify.yml@refs/pull/7/merge',
    candidate: { prNumber: 7, baseSha: 'c'.repeat(40), headSha: 'd'.repeat(40) },
    toolchain: { node: 'v22.1.0', pnpm: '9.15.0', python: 'Python 3.12', docker: 'Docker 27' },
    environment: { platform: 'linux', arch: 'x64', imageOS: 'ubuntu24', imageVersion: '20261005.1', runnerEnvironment: 'github-hosted', runnerOS: 'Linux' },
  };
  const successful = { status: 'completed', conclusion: 'success' };
  const job = { runner_id: 1, runner_group_id: 1, labels: ['ubuntu-latest'], steps: [
    { name: 'Set up job', ...successful }, { name: 'Run actions/checkout@v5', ...successful },
    { name: IDENTITY_STEP, ...successful, started_at: '2026-10-05T12:00:00Z', completed_at: '2026-10-05T12:00:05Z' },
  ] };
  const encoded = Buffer.from(JSON.stringify(identity)).toString('base64');
  const line = time => `2026-10-05T12:00:${time}Z CI_CANDIDATE_IDENTITY_V1:${encoded}`;
  assert.deepEqual(parseCheckoutIdentity(line('02.123'), job), identity);
  for (const time of ['00.999', '05.000', '10.000']) assert.throws(() => parseCheckoutIdentity(line(time), job));
  assert.throws(() => parseCheckoutIdentity(`${line('02.123')}\n${line('03.123')}`, job));
  assert.throws(() => parseCheckoutIdentity(line('02.123'), { ...job, steps: job.steps.map(step => step.name === IDENTITY_STEP ? { ...step, conclusion: 'failure' } : step) }));
});

function inspectMutation(mutate, overrides = {}) {
  const changed = structuredClone(config);
  mutate(changed);
  return inspectSuiteOwnership({ config: changed, loadWorkflow: load,
    pathExists: path => existsSync(resolve(ROOT, path)), baselinePathExists: path => !!git(['ls-tree', BASELINE_SHA, '--', path]), ...overrides });
}
test('ownership inventory covers all 36 jobs and reports retained baseline native gaps explicitly', () => {
  const result = inspectCheckoutOwnership(ROOT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.suiteCount, 36);
  assert.equal(result.jobCount, 36);
  const native = config.suites.find(suite => suite.id === 'board-native');
  assert.deepEqual(result.retainedCoverageGaps.map(gap => gap.path).sort(), [...native.requiredCoveragePaths].sort());
  for (const gap of result.retainedCoverageGaps) {
    assert.equal(gap.decision, 'retain-full');
    assert.equal(gap.baselinePresent, false);
    assert.equal(gap.checkoutPresent, false);
  }
  assert.equal(native.phase1, 'retain');
  assert.deepEqual(native.eligibleSourceEvents, []);
});
for (const [name, mutate, expected] of [
  ['deleted owner', value => { value.suites.pop(); }, 'unowned-job'],
  ['duplicate logical owner', value => { value.suites[1].owner = value.suites[0].owner; }, 'duplicate-owner'],
  ['duplicate suite ID', value => { value.suites[1].id = value.suites[0].id; }, 'suite-id'],
  ['nonexistent actual step', value => { value.suites[0].execution.actualStepNames.push('fake green test'); }, 'execution-step-missing'],
  ['nonexistent actual runtime step pattern', value => { value.suites[0].execution.actualStepNamePatterns.push('^no-such-step-[0-9]+$'); }, 'execution-pattern-missing'],
  ['nonexistent artifact', value => { value.suites.find(suite => suite.id === 'fullstack-smoke').execution.artifactNamePatterns = ['^invented-evidence-[0-9]+$']; }, 'artifact-pattern-missing'],
  ['ambiguous artifact', value => { value.suites.find(suite => suite.id === 'fullstack-smoke').execution.artifactNamePatterns = ['^.*$']; }, 'artifact-pattern-ambiguous'],
  ['self-reported PR JSON trust', value => { value.sourcePolicy.acceptPrSelfReportedJson = true; }, 'unsafe-source-policy'],
  ['squash SHA mistaken for evidence', value => { value.sourcePolicy.squashShaEqualityIsEvidence = true; }, 'unsafe-source-policy'],
  ['enabled skip mode', value => { value.mode = 'reuse'; }, 'phase-one-policy'],
  ['matrix children incompletely covered', value => { value.suites.find(suite => suite.id === 'gates-test').execution.allMatrixChildrenMustExecute = false; }, 'matrix-coverage'],
  ['scope/reused verdict mistaken for execution', value => { value.suites[0].execution.scopeOrReusedVerdictIsExecution = true; }, 'reused-is-not-execution'],
  ['missing native source claimed reusable', value => { const suite = value.suites.find(item => item.id === 'board-native'); suite.phase1 = 'observe-and-run'; suite.eligibleSourceEvents = ['pull_request']; }, 'coverage-gap-reuse'],
  ['deployment claimed reusable', value => { const suite = value.suites.find(item => item.role === 'deployment'); suite.phase1 = 'observe-and-run'; suite.eligibleSourceEvents = ['pull_request']; }, 'eligible-suite-kind'],
  ['dependency lock identity deleted', value => { value.identityPaths = value.identityPaths.filter(path => path !== 'pnpm-lock.yaml'); }, 'identity-input-unbound'],
  ['workflow definition identity deleted', value => { value.suites[0].definitionPaths = value.suites[0].definitionPaths.filter(path => path !== value.suites[0].owner.workflow); }, 'workflow-definition-unbound'],
]) {
  test(`negative ownership drift: ${name} is rejected`, () => {
    assert(inspectMutation(mutate).errors.some(error => error.code === expected), `must report ${expected}`);
  });
}
test('unreadable baseline cannot silently become a successful coverage assertion', () => {
  const result = inspectMutation(() => {}, { baselinePathExists: () => { throw new Error('no permission to read baseline'); } });
  assert(result.errors.some(error => error.code === 'baseline-unreadable'));
});
test('legacy dedup-before-identity layout cannot provide trusted candidate evidence', () => {
  const result = inspectMutation(() => {}, { loadWorkflow: path => {
    const value = load(path);
    if (path === SOURCE_WORKFLOWS[0]) {
      const steps = value.jobs['fullstack-smoke'].steps;
      const marker = steps.splice(steps.findIndex(step => step.uses === IDENTITY_ACTION), 1)[0];
      steps.splice(steps.findIndex(step => /\bpnpm install\b/.test(step.run ?? '')), 0, marker);
    }
    return value;
  } });
  assert(result.errors.some(error => error.code === 'identity-preceded-by-candidate-execution'));
});
