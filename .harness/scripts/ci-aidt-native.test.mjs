import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AIDT_NATIVE_FLAGS, assertAidtNativeEnvironment, assertAidtNativeSource, assertRuntimeCommand, runtimeArgs, runtimeCommand, verifyAidtNativeCheckout } from './ci-fullstack-runtime.mjs';
import { completeNative, declaredNativeSpecs, nativeVerdict, prepareNative } from './ci-aidt-native.mjs';

const source = 'a'.repeat(40), control = 'b'.repeat(40);
function environment(overrides = {}) {
  return { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'boardx/workspacex',
    GITHUB_REF: 'refs/heads/develop', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: control,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', AIDT_NATIVE_EXPECTED_SOURCE_SHA: source,
    ...Object.fromEntries(AIDT_NATIVE_FLAGS.map(key => [key, '1'])), ...overrides };
}
const inputs = { root: '/runner/work/candidate', home: '/runner/temp/home', tools: '/runner/temp/tools', uid: 1001, gid: 127,
  socketGid: 999, image: `mcr.microsoft.com/playwright@sha256:${'a'.repeat(64)}`, node: '/opt/node/bin/node', pnpm: '/opt/pnpm',
  docker: '/usr/bin/docker', compose: '/opt/docker-compose', unzip: '/usr/bin/unzip' };

test('native command is explicit, retains isolation and heavy-browser tokens, and refuses partial argv', () => {
  const command = runtimeCommand(false, false, false, false, undefined, true);
  assert.deepEqual(command, ['pnpm', 'exec', 'tsx', '.harness/scripts/with-test-isolation.ts', '--', 'pnpm', '--filter', 'web', 'exec', 'playwright', 'test', '--config', 'playwright.aidt-native.config.ts']);
  assertRuntimeCommand('aidt-native', ['--', ...command]);
  for (const extra of [['--grep', 'one'], ['--shard', '1/2'], ['--list'], ['--retries=0'], ['--config', 'other.ts']]) {
    assert.throws(() => assertRuntimeCommand('aidt-native', ['--', ...command, ...extra]), /CONTRACT_MISMATCH/);
  }
  assert.throws(() => assertRuntimeCommand('aidt-native', ['--', 'pnpm', 'run', 'verify:fullstack-product']), /CONTRACT_MISMATCH/);
  assert.throws(() => assertRuntimeCommand('unknown', ['--', 'pnpm', 'run', 'verify:fullstack-smoke']), /UNKNOWN_RUNTIME_MODE/);
  assert.throws(() => runtimeCommand(false, false, false, false, 'product', true), /MODE_COMBINATION/);
  assert.deepEqual(runtimeCommand(false), ['pnpm', 'run', 'verify:fullstack-smoke']);
  assert.deepEqual(runtimeCommand(false, false, false, false, 'product'), ['pnpm', 'run', 'verify:fullstack-product']);
});

test('only the opt-in mode forwards the four exact nonsecret flags and source selector', () => {
  const env = environment({ GH_TOKEN: 'secret-must-not-enter', GITHUB_TOKEN: 'secret-must-not-enter', MODEL_API_KEY: 'secret-must-not-enter',
    WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: 'secret-must-not-enter', NEXT_PUBLIC_ENABLE_AIDT_ENTITY_CHAT: '1' });
  const native = runtimeArgs({ ...inputs, env, aidtNative: true });
  for (const key of AIDT_NATIVE_FLAGS) assert(native.includes(`${key}=1`));
  assert(native.includes(`AIDT_NATIVE_EXPECTED_SOURCE_SHA=${source}`));
  assert(!native.join(' ').includes('secret-must-not-enter'));
  assert(!native.includes('WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN'));
  assert(!native.join(' ').includes('AIDT_ENTITY_CHAT'));
  for (const mode of [{}, { geometry: true }, { sticky: true }, { directory: true }, { coreLoop: true }, { partition: 'product' }, { partition: 'board' }]) {
    const ordinary = runtimeArgs({ ...inputs, env, ...mode });
    for (const key of [...AIDT_NATIVE_FLAGS, 'AIDT_NATIVE_EXPECTED_SOURCE_SHA']) assert(!ordinary.some(arg => arg === key || arg.startsWith(key + '=')));
  }
});

test('native admission rejects local, non-develop, malformed source and disabled flags', () => {
  assertAidtNativeEnvironment(environment());
  assertAidtNativeSource(environment(), source, true);
  for (const overrides of [{ CI: '' }, { GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_REPOSITORY: 'other/workspacex' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_EVENT_NAME: 'push' },
    { AIDT_NATIVE_EXPECTED_SOURCE_SHA: 'develop' }, { GITHUB_SHA: 'x' }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: '1;true' }]) {
    assert.throws(() => assertAidtNativeEnvironment(environment(overrides)), /AIDT_NATIVE_/);
  }
  for (const key of AIDT_NATIVE_FLAGS) for (const value of ['', '0', 'true', '1;true']) {
    assert.throws(() => runtimeArgs({ ...inputs, env: environment({ [key]: value }), aidtNative: true }), /FLAGS_REQUIRED/);
  }
  assert.throws(() => assertAidtNativeSource(environment(), control, true), /SOURCE_MISMATCH/);
  assert.throws(() => assertAidtNativeSource(environment(), source, false), /SOURCE_NOT_MERGED/);
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'aidt-native-guard-'));
  const git = args => execFileSync('git', ['-C', root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.test', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['checkout', '-q', '-b', 'develop']);
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  writeFileSync(join(root, 'apps/web/playwright.aidt-native.config.ts'), 'export default {\n  testMatch: ["alpha.spec.ts", "beta.spec.ts"],\n};\n');
  git(['add', '.']); git(['commit', '-qm', 'base']); const base = git(['rev-parse', 'HEAD']);
  git(['checkout', '-qb', 'feature']); writeFileSync(join(root, 'tracked.txt'), 'candidate');
  git(['add', '.']); git(['commit', '-qm', 'candidate']); const candidate = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'develop']); git(['merge', '--no-ff', '-m', 'merged candidate', 'feature']); const merged = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '--detach', candidate]);
  return { root, git, base, candidate, merged, env: environment({ AIDT_NATIVE_EXPECTED_SOURCE_SHA: candidate, GITHUB_SHA: merged }) };
}

test('actual Git checkout must equal the selector and be an ancestor of merged control source', () => {
  const fixture = repository();
  try {
    assert.equal(verifyAidtNativeCheckout(fixture.root, fixture.env), fixture.candidate);
    assert.throws(() => verifyAidtNativeCheckout(fixture.root, { ...fixture.env, GITHUB_SHA: fixture.base }), /NOT_MERGED/);
    assert.throws(() => verifyAidtNativeCheckout(fixture.root, { ...fixture.env, AIDT_NATIVE_EXPECTED_SOURCE_SHA: fixture.base }), /SOURCE_MISMATCH/);
    writeFileSync(join(fixture.root, 'tracked.txt'), 'modified');
    assert.throws(() => verifyAidtNativeCheckout(fixture.root, fixture.env), /SOURCE_DIRTY/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

function evidence({ statuses = [['passed'], ['passed']], includeBeta = true } = {}) {
  const root = '/runner/work/candidate';
  const request = { schemaVersion: 1, sourceSha: source, controlSha: control, runId: '123', runAttempt: '1',
    startedAt: '2026-11-21T00:00:00.000Z', declaredSpecs: ['alpha.spec.ts', 'beta.spec.ts'] };
  const specs = ['alpha.spec.ts', ...(includeBeta ? ['beta.spec.ts'] : [])].map((file, index) => ({
    file, id: `case-${index}`, title: `case ${index}`, tests: [{ projectId: 'seeded', projectName: 'seeded', expectedStatus: 'passed',
      results: statuses[index].map((status, retry) => ({ status, retry, duration: 10 })) }],
  }));
  const report = { config: { rootDir: `${root}/apps/web/e2e` }, suites: [{ title: 'nested', suites: [{ specs }] }], errors: [],
    stats: { startTime: '2026-11-21T00:00:01.000Z', expected: specs.length, unexpected: 0, skipped: 0, flaky: 0 } };
  const context = { root, sourceSha: source, controlSha: control, runId: '123', runAttempt: '1', stepOutcome: 'success' };
  return { root, request, report, context };
}

test('spec inventory comes from one literal config and rejects malformed or partial declarations', () => {
  assert.deepEqual(declaredNativeSpecs('x\n  testMatch: ["alpha.spec.ts", "beta.spec.ts"],'), ['alpha.spec.ts', 'beta.spec.ts']);
  for (const source of ['testMatch: []', 'testMatch: ["*.spec.ts"]', 'testMatch: ["alpha.spec.ts", "alpha.spec.ts"]', 'testMatch: [foo]', 'testMatch: ["alpha.spec.ts"]\ntestMatch: ["beta.spec.ts"]']) {
    assert.throws(() => declaredNativeSpecs(source), /INVENTORY_INVALID/);
  }
});

test('verdict counts actual cases and preserves nested required-file coverage', () => {
  const fixture = evidence();
  const result = nativeVerdict(fixture.report, fixture.request, fixture.context);
  assert.equal(result.status, 'passed'); assert.equal(result.actualCases, 2); assert.equal(result.finalPassed, 2);
  assert.equal(result.specs.length, 2); assert.match(result.scope, /loopback/); assert.match(result.scope, /not live Dev/);
  const partial = evidence({ includeBeta: false });
  const failed = nativeVerdict(partial.report, partial.request, partial.context);
  assert.equal(failed.status, 'failed'); assert.deepEqual(failed.missingSpecs, ['beta.spec.ts']);
});

test('configured retries remain visible and do not add a zero-retry release requirement', () => {
  const fixture = evidence({ statuses: [['failed', 'passed'], ['passed']] });
  fixture.report.stats.expected = 1; fixture.report.stats.flaky = 1;
  const result = nativeVerdict(fixture.report, fixture.request, fixture.context);
  assert.equal(result.status, 'passed'); assert.equal(result.retriedCases, 1); assert.equal(result.flaky, 1);
  assert.deepEqual(result.cases[0].attempts.map(attempt => attempt.status), ['failed', 'passed']);
});

test('final failure, skip, interruption and runtime-step failure retain an actual failed verdict', () => {
  for (const status of ['failed', 'skipped', 'interrupted', 'timedOut']) {
    const fixture = evidence({ statuses: [[status], ['passed']] });
    fixture.report.stats.expected = 1; fixture.report.stats[status === 'skipped' ? 'skipped' : 'unexpected'] = 1;
    const result = nativeVerdict(fixture.report, fixture.request, fixture.context);
    assert.equal(result.status, 'failed'); assert.equal(result.actualCases, 2); assert.equal(result.finalFailedOrSkipped, 1);
  }
  const fixture = evidence();
  const result = nativeVerdict(fixture.report, fixture.request, { ...fixture.context, stepOutcome: 'failure' });
  assert.equal(result.status, 'failed'); assert.equal(result.actualCases, 2);
});

test('stale, cross-source, globally broken and duplicate reports cannot pass', () => {
  for (const mutate of [
    x => { x.report.stats.startTime = '2000-01-01T00:00:00Z'; },
    x => { x.request.sourceSha = control; },
    x => { x.report.config.rootDir = '/other/tests'; },
    x => { x.report.errors.push({ message: 'global teardown failed' }); },
    x => { x.report.stats.expected = 99; },
    x => { x.report.suites[0].suites[0].specs.push(x.report.suites[0].suites[0].specs[0]); },
  ]) {
    const fixture = evidence(); mutate(fixture);
    assert.throws(() => nativeVerdict(fixture.report, fixture.request, fixture.context), /AIDT_NATIVE_/);
  }
});

test('prepare and completion write source-bound JSON, preserve failure evidence and fail closed when missing', () => {
  const fixture = repository();
  try {
    const output = join(fixture.root, 'apps/web/test-results/aidt-native'); mkdirSync(output, { recursive: true });
    const controlOutput = join(fixture.root, 'apps/web/test-results/aidt-native-control');
    writeFileSync(join(output, 'results.json'), 'stale'); writeFileSync(join(output, 'trace.zip'), 'retained');
    const request = prepareNative(fixture.root, fixture.env);
    assert(!existsSync(join(output, 'results.json'))); assert.equal(request.sourceSha, fixture.candidate);
    assert(existsSync(join(controlOutput, 'request.json')));
    // Match Playwright's output cleanup: source admission survives elsewhere.
    rmSync(output, { recursive: true }); mkdirSync(output);
    writeFileSync(join(output, 'trace.zip'), 'new-failure-evidence');
    const data = evidence(); data.report.config.rootDir = resolve(fixture.root, 'apps/web/e2e');
    data.report.stats.startTime = new Date(Date.parse(request.startedAt) + 10).toISOString();
    writeFileSync(join(output, 'results.json'), JSON.stringify(data.report));
    const result = completeNative(fixture.root, { ...fixture.env, AIDT_NATIVE_TEST_OUTCOME: 'success' });
    assert.equal(result.status, 'passed'); assert.equal(result.actualCases, 2);
    assert.equal(readFileSync(join(output, 'trace.zip'), 'utf8'), 'new-failure-evidence');
    unlinkSync(join(output, 'results.json'));
    const missing = completeNative(fixture.root, { ...fixture.env, AIDT_NATIVE_TEST_OUTCOME: 'failure' });
    assert.equal(missing.status, 'failed'); assert.equal(missing.code, 'AIDT_NATIVE_EVIDENCE_MISSING');
    assert.equal(JSON.parse(readFileSync(join(controlOutput, 'verdict.json'), 'utf8')).status, 'failed');
    unlinkSync(join(controlOutput, 'verdict.json'));
    const outside = join(fixture.root, 'outside.json'); symlinkSync(outside, join(controlOutput, 'verdict.json'));
    assert.throws(() => completeNative(fixture.root, { ...fixture.env, AIDT_NATIVE_TEST_OUTCOME: 'failure' }), /OUTPUT_UNSAFE/);
    assert(!existsSync(outside));
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
