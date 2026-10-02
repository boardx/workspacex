import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PIXEL_TEST, runAffectedTests, selectsWebTest } from './run-affected-tests.mjs';
const web = { taskId: 'web#test', command: 'vitest run' };
function recording(tasks = [web], overrides = {}) {
  const calls = [];
  const env = { IS_FORK_PR: 'false', TURBO_SCM_BASE: 'origin/review-base', PLAYWRIGHT_BROWSERS_PATH: '/runner/temp/web-browsers' };
  const options = { cwd: '/checkout', env, exists: path => path === `/checkout/${PIXEL_TEST}`,
    coreCli: () => '/checkout/apps/web/node_modules/playwright-core/cli.js',
    execute: (command, args, options) => { calls.push({ command, args, options }); return args.includes('--dry=json') ? JSON.stringify({ tasks }) : ''; }, ...overrides };
  return { calls, env, run: () => runAffectedTests(options) };
}
test('selected executable web test installs its core Chromium shell before test, using identical environment/base/filter', () => {
  const r = recording(); r.run(); assert.equal(r.calls.length, 3);
  assert.deepEqual(r.calls[0].args, ['turbo', 'run', 'test', '--affected', '--filter=!@repo/api', '--dry=json']);
  assert.equal(r.calls[1].command, process.execPath);
  assert.deepEqual(r.calls[1].args, ['/checkout/apps/web/node_modules/playwright-core/cli.js', 'install', '--with-deps', '--only-shell', 'chromium']);
  assert.deepEqual(r.calls[2].args, r.calls[0].args.slice(0, -1));
  for (const c of r.calls) { assert.equal(c.options.env, r.env); assert.equal(c.options.cwd, '/checkout'); }
});
for (const [name, tasks, exists] of [
  ['web not selected', [{ taskId: '@repo/api#test', command: 'vitest run' }], () => true],
  ['docs-only plan', [], () => true],
  ['web lint and typecheck only', [{ taskId: 'web#lint', command: 'eslint .' }, { taskId: 'web#typecheck', command: 'tsc --noEmit' }], () => true],
  ['only web build selected', [{ taskId: 'web#build', command: 'next build' }], () => true],
  ['nonexistent web test', [{ ...web, command: '<NONEXISTENT>' }], () => true],
  ['pixel test absent', [web], () => false],
]) test(`no browser installation when ${name}`, () => {
  const r = recording(tasks, { exists, coreCli: () => { throw Error('must not resolve browser dependency'); } });
  r.run(); assert.equal(r.calls.length, 2); assert.equal(r.calls[1].command, 'pnpm');
});
test('fork plan and actual test both retain API coverage', () => {
  const r = recording([], { env: { IS_FORK_PR: 'true' } }); r.run();
  assert.deepEqual(r.calls[0].args, ['turbo', 'run', 'test', '--affected', '--dry=json']);
  assert.deepEqual(r.calls[1].args, ['turbo', 'run', 'test', '--affected']);
});
test('fork and same-repository executable web plans install before their identical actual test', () => {
  for (const fork of ['true', 'false']) {
    const r = recording([{ taskId: '@repo/api#test', command: 'vitest run' }, web], { env: { IS_FORK_PR: fork, TURBO_SCM_BASE: 'origin/base', PLAYWRIGHT_BROWSERS_PATH: '/runner/temp/browser' } });
    r.run(); assert.equal(r.calls.length, 3);
    assert.deepEqual(r.calls[2].args, r.calls[0].args.slice(0, -1));
    assert.equal(r.calls[0].args.includes('--filter=!@repo/api'), fork === 'false');
    assert.ok(r.calls[1].args.includes('install'));
  }
});
test('invalid plan and missing explicit browser path fail closed before testing', () => {
  assert.throws(() => selectsWebTest({ packages: ['web'] }), /Invalid Turbo/);
  const r = recording([web], { env: {} }); assert.throws(r.run, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.equal(r.calls.length, 1);
});
test('installation failure stops test rather than skipping browser pixel assertions', () => {
  const r = recording([web], { execute: (_command, args) => {
    if (args.includes('--dry=json')) return JSON.stringify({ tasks: [web] });
    if (args.includes('install')) throw Error('installation unavailable');
    throw Error('test must not run');
  } }); assert.throws(r.run, /installation unavailable/);
});
test('workflow wires the exact affected runner and private cache only inside affected test step', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../workflows/harness-verify.yml', import.meta.url)), 'utf8');
  const affected = workflow.split('  verify-affected:')[1].split('\n  # 全仓编译门')[0];
  assert.match(affected, /PLAYWRIGHT_BROWSERS_PATH: \$\{\{ runner.temp \}\}\/workspacex-web-pixel-browsers/);
  assert.match(affected, /node \.github\/scripts\/run-affected-tests.mjs/);
  assert.match(affected, /TURBO_SCM_BASE:/); assert.match(affected, /IS_FORK_PR:/);
  assert.doesNotMatch(affected, /browserplan|ci-affected-browser|playwright install/);
});

test('actual Turbo web test preserves strict mode and only scoped browser cache passthrough', () => {
  const result = spawnSync('pnpm', ['turbo', 'run', 'test', '--filter=web', '--dry=json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(result.stdout).tasks.find(task => task.taskId === 'web#test');
  assert.equal(task.envMode, 'strict');
  assert.deepEqual(task.resolvedTaskDefinition.passThroughEnv, ['PLAYWRIGHT_BROWSERS_PATH']);
  assert.ok(task.resolvedTaskDefinition.env.includes('WORKSPACEX_DB'));
  assert.deepEqual(task.resolvedTaskDefinition.dependsOn, ['^build']);
});
test('actual web core CLI dry plan binds installed package browser revision to explicit cache without downloads', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const requireWeb = createRequire(join(root, 'apps/web/package.json'));
  const cli = join(dirname(requireWeb.resolve('playwright-core/package.json')), 'cli.js');
  const cache = join(root, '.unused-browser-dry-cache');
  const result = spawnSync(process.execPath, [cli, 'install', '--dry-run', '--only-shell', 'chromium'], {
    encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Chrome Headless Shell/);
  assert.ok(result.stdout.includes(`${cache}/chromium_headless_shell-`));
  assert.doesNotMatch(result.stdout, /Firefox|Webkit|Chrome for Testing/);
});
