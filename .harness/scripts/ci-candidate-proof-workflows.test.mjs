import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { OBSERVATION_LIMITS } from './lib/ci-candidate-budget.mjs';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PARENT = '9225b28b17f634185e795469898b2385546f0284';
const PATH = '.github/workflows/ci-candidate-runtime-pilot.yml';
const read = path => readFileSync(resolve(ROOT, path), 'utf8');
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 4_000_000 });
const definition = parse(read(PATH));
const policy = JSON.parse(read('.harness/config/ci-candidate-pilot.json'));

function inspect(value) {
  assert.deepEqual(value.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
  assert.deepEqual(Object.keys(value.on).sort(), ['merge_group', 'pull_request', 'workflow_dispatch']);
  assert.deepEqual(Object.keys(value.on.workflow_dispatch.inputs), ['source_run_id']);
  assert.equal(value.on.workflow_dispatch.inputs.source_run_id.type, 'string');
  assert.equal(value.concurrency['cancel-in-progress'], false);
  for (const job of Object.values(value.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(job.permissions, undefined); assert.equal(job.environment, undefined);
  }
  const pilot = value.jobs['protected-pilot'];
  assert.equal(pilot.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  assert.equal(pilot.steps[0].name, 'Checkout protected supervisor');
  assert.equal(pilot.steps[0].uses, 'actions/checkout@v5');
  assert.deepEqual(pilot.steps[0].with, { ref: '${{ github.sha }}', 'fetch-depth': 0, 'persist-credentials': false });
  assert.equal(pilot.steps[1].uses, 'actions/setup-node@v5');
  assert.deepEqual(pilot.steps[1].with, { 'node-version': '22', 'package-manager-cache': false });
  assert.equal(pilot.steps[2].run, `docker pull ${policy.image.reference}`);
  assert.equal(pilot.steps[3].name, 'Start trusted runtime supervisor');
  assert.equal(pilot.steps[3].run, 'node .harness/scripts/ci-candidate-pilot-supervisor.mjs');
  assert.deepEqual(pilot.steps[3].env, {
    GH_TOKEN: '${{ github.token }}', CI_CANDIDATE_SOURCE_RUN_ID: '${{ inputs.source_run_id }}',
    CI_CANDIDATE_OUTPUT_DIR: '${{ runner.temp }}/ci-candidate-runtime-pilot',
  });
  assert.equal(pilot.steps[4].uses, 'actions/upload-artifact@v6');
  assert.equal(pilot.steps[4].if, 'always()'); assert.equal(pilot.steps.length, 5);
  assert.deepEqual(pilot.steps[4].with.path.trim().split('\n'), [
    '${{ runner.temp }}/ci-candidate-runtime-pilot/**/*.json',
    '${{ runner.temp }}/ci-candidate-runtime-pilot/**/candidate.stdout',
    '${{ runner.temp }}/ci-candidate-runtime-pilot/**/candidate.stderr',
  ]);
  assert.equal(value.jobs['reject-branch-dispatch'].if, "github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'");
  assert.match(value.jobs['reject-branch-dispatch'].steps[0].run, /exit 1/);
  const regression = value.jobs['isolation-regression'];
  assert.equal(regression.if, "github.event_name != 'workflow_dispatch'");
  assert.equal(regression.steps[0].with['persist-credentials'], false);
  assert.deepEqual(regression.steps[1].with, { 'node-version': '22', 'package-manager-cache': false });
  assert.equal(regression.steps[2].run, `docker pull ${policy.image.reference}`);
  assert.deepEqual(regression.steps[3].env, { CI_CANDIDATE_PILOT_REAL: '1', CI_CANDIDATE_PILOT_REAL_OUTPUT: '${{ runner.temp }}/ci-candidate-isolation-regression' });
  assert.equal(regression.steps[3].run, 'node --test .harness/scripts/ci-candidate-pilot.test.mjs');
  assert.equal(regression.steps.length, 5);
  assert.equal(regression.steps[4].uses, 'actions/upload-artifact@v6');
  assert.equal(regression.steps[4].if, 'always()');
  assert.equal(regression.steps[4].with['if-no-files-found'], 'error');
  assert.match(read('.harness/scripts/ci-candidate-pilot.test.mjs'), /process\.env\.CI_CANDIDATE_PILOT_REAL/);
  assert(!JSON.stringify(value).includes('secrets.'));
  assert(!JSON.stringify(value).includes('pull_request_target'));
  assert(!JSON.stringify(value).includes('id-token'));
}

test('pilot workflow has a separate fresh main-only controller and actual PR isolation tests', () => inspect(definition));
for (const [name, mutate] of [
  ['write permissions', value => { value.permissions.contents = 'write'; }],
  ['candidate-selected controller checkout', value => { value.jobs['protected-pilot'].steps[0].with.ref = '${{ inputs.source_run_id }}'; }],
  ['host candidate install before supervisor', value => { value.jobs['protected-pilot'].steps.splice(2, 0, { run: 'pnpm install' }); }],
  ['secret passed to regression', value => { value.jobs['isolation-regression'].steps[3].env.GH_TOKEN = '${{ secrets.GITHUB_TOKEN }}'; }],
  ['mutable image pull', value => { value.jobs['protected-pilot'].steps[2].run = 'docker pull node:22'; }],
  ['branch controller execution', value => { value.jobs['protected-pilot'].if = "github.event_name == 'workflow_dispatch'"; }],
  ['candidate-controlled shell', value => { value.jobs['protected-pilot'].steps[3].run = '${{ inputs.source_run_id }}'; }],
  ['credentials retained in input repository', value => { value.jobs['protected-pilot'].steps[0].with['persist-credentials'] = true; }],
  ['dispatch branch silently accepted', value => { value.jobs['reject-branch-dispatch'].steps[0].run = 'exit 0'; }],
  ['automatic candidate package-manager cache', value => { delete value.jobs['isolation-regression'].steps[1].with['package-manager-cache']; }],
]) test(`workflow regression rejects ${name}`, () => {
  const changed = structuredClone(definition); mutate(changed); assert.throws(() => inspect(changed));
});

test('completed pilot observer uses only protected main code and bounded data artifacts', () => {
  const value = parse(read('.github/workflows/ci-candidate-pilot-observer.yml'));
  assert.deepEqual(value.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
  assert.deepEqual(value.on.workflow_run, { workflows: ['ci-candidate-runtime-pilot'], types: ['completed'] });
  assert.deepEqual(Object.keys(value.on).sort(), ['workflow_dispatch', 'workflow_run']);
  assert.equal(value.jobs.observe.if, "github.ref == 'refs/heads/main'");
  assert.equal(value.jobs.observe['runs-on'], 'ubuntu-latest');
  assert.deepEqual(value.jobs.observe.steps[0].with, { ref: '${{ github.sha }}', 'fetch-depth': 0, 'persist-credentials': false });
  assert.equal(value.jobs.observe.steps[1].uses, 'actions/setup-node@v5');
  assert.deepEqual(value.jobs.observe.steps[1].with, { 'node-version': '22', 'package-manager-cache': false });
  assert.equal(value.jobs.observe.steps[2].run, 'node .harness/scripts/ci-candidate-pilot-observer.mjs');
  assert.deepEqual(value.jobs.observe.steps[2].env, {
    GH_TOKEN: '${{ github.token }}', CI_CANDIDATE_SOURCE_RUN_ID: '${{ inputs.source_run_id || github.event.workflow_run.id }}',
    CI_CANDIDATE_OUTPUT_DIR: '${{ runner.temp }}/ci-candidate-pilot-observer',
  });
  assert.equal(value.jobs.observe.steps[3].with.path, '${{ runner.temp }}/ci-candidate-pilot-observer/*.json');
  assert.equal(value.jobs.observe.steps.length, 4);
  assert.match(value.jobs['reject-branch-dispatch'].steps[0].run, /exit 1/);
  assert(!JSON.stringify(value).includes('secrets.'));
  assert(!JSON.stringify(value).includes('docker '));
  assert(!JSON.stringify(value).includes('pnpm install'));
  assert.equal(value.jobs.observe.environment, undefined);
});

test('parent source validation workflows and deployment scripts remain byte-identical', () => {
  for (const path of ['harness-verify.yml', 'backend-gates.yml', 'board-acceptance.yml', 'board-native-acceptance.yml']) {
    const file = `.github/workflows/${path}`;
    assert.equal(read(file), git(['show', `${PARENT}:${file}`]), file);
  }
  for (const path of ['deploy-gate.sh', 'deploy-readiness.sh', 'deploy.sh', 'devapp-runtime-identity.mjs']) {
    const file = `.harness/scripts/vm/${path}`;
    assert.equal(read(file), git(['show', `${PARENT}:${file}`]), file);
  }
});

test('the fixed dependency-free command and test definitions are actual parent Git objects', () => {
  assert.equal(policy.mode, 'shadow'); assert.equal(policy.command.expectedTests, 175);
  assert.deepEqual(policy.command.argv, ['/usr/local/bin/node', '--test', '/input/.harness/scripts/ci-candidate-evidence.test.mjs']);
  for (const pin of policy.command.definitionBlobs) {
    assert.equal(git(['rev-parse', `${PARENT}:${pin.path}`]).trim(), pin.oid);
    assert.equal(git(['hash-object', pin.path]).trim(), pin.oid);
  }
  assert.match(policy.image.reference, /^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/);
  assert.equal(policy.image.platform, 'linux/amd64');
  assert.match(policy.image.configDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(policy.image.rootfsLayers.length, 5);
});

// Only the two trusted observer read steps acquire a timeout; every other byte
// remains bound to the frozen checkpoint, including permissions and triggers.
test('observer workflow delta is exactly the bounded read timeout with receipt headroom', () => {
  const base = '77700fe5f15eabb4ceeff2bd10a2eed59e2d7178';
  const addition = '        # Internal read budget is 90s; leave time for bootstrap and receipt output.\n        timeout-minutes: 3\n';
  for (const [file, stepName] of [
    ['ci-candidate-shadow.yml', 'Observe candidate evidence (always execute validation)'],
    ['ci-candidate-pilot-observer.yml', 'Verify completed protected pilot receipt'],
  ]) {
    const path = `.github/workflows/${file}`, text = read(path), old = git(['show', `${base}:${path}`]);
    assert.equal(text.split(addition).length, 2, 'one exact timeout insertion only');
    assert.equal(text.replace(addition, ''), old, 'no other workflow delta allowed');
    const definition = parse(text), step = definition.jobs.observe.steps.find(value => value.name === stepName);
    assert.equal(step['timeout-minutes'], 3);
    assert.ok(OBSERVATION_LIMITS.maxElapsedMs + 60_000 < step['timeout-minutes'] * 60_000);
    assert.ok(step['timeout-minutes'] < definition.jobs.observe['timeout-minutes']);
    assert.deepEqual(definition.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
    assert.equal(definition.jobs.observe.steps.at(-1).if, 'always()');
  }
});
