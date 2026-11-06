import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
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
  return { calls, env: options.env, run: () => runAffectedTests(options) };
}
test('selected executable web test installs its core Chromium shell before test, using identical environment/base/filter', () => {
  const r = recording(); r.run(); assert.equal(r.calls.length, 3);
  assert.deepEqual(r.calls[0].args, ['turbo', 'run', 'test', '--affected', '--filter=!@repo/api', '--dry=json']);
  assert.equal(r.calls[1].command, process.execPath);
  assert.deepEqual(r.calls[1].args, ['/checkout/apps/web/node_modules/playwright-core/cli.js', 'install', '--with-deps', '--only-shell', 'chromium']);
  assert.deepEqual(r.calls[2].args, [...r.calls[0].args.slice(0, -1), '--', '--bail=1']);
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
  assert.deepEqual(r.calls[1].args, ['turbo', 'run', 'test', '--affected', '--', '--bail=1']);
});
test('fork and same-repository executable web plans install before their identical actual test', () => {
  for (const fork of ['true', 'false']) {
    const r = recording([{ taskId: '@repo/api#test', command: 'vitest run' }, web], { env: { IS_FORK_PR: fork, TURBO_SCM_BASE: 'origin/base', PLAYWRIGHT_BROWSERS_PATH: '/runner/temp/browser' } });
    r.run(); assert.equal(r.calls.length, 3);
    assert.deepEqual(r.calls[2].args, [...r.calls[0].args.slice(0, -1), '--', '--bail=1']);
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

const cloud = { taskId: '@repo/cloud-deploy#test', command: 'vitest run --maxWorkers=1 --minWorkers=1' };
test('selected cloud fixtures run fresh before remaining affected coverage without duplication', () => {
  for (const fork of ['true', 'false']) {
    const r = recording([cloud, { taskId: '@repo/contracts#test', command: 'vitest run' }],
      { env: { IS_FORK_PR: fork, TURBO_SCM_BASE: 'origin/exact-base' } });
    r.run();
    assert.equal(r.calls.length, 3);
    assert.deepEqual(r.calls[1].args, ['turbo', 'run', 'test', '--filter=@repo/cloud-deploy', '--force', '--', '--bail=1']);
    assert.deepEqual(r.calls[2].args, [...r.calls[0].args.slice(0, -1), '--filter=!@repo/cloud-deploy', '--', '--bail=1']);
    for (const call of r.calls) assert.equal(call.options.env, r.env);
  }
});
test('cloud fixture failure fails the gate before other packages can start', () => {
  const calls = [];
  const r = recording([cloud], { execute: (_command, args) => {
    calls.push(args);
    if (args.includes('--dry=json')) return JSON.stringify({ tasks: [cloud] });
    if (args.includes('--filter=@repo/cloud-deploy')) throw Error('CN deadline exceeded');
    throw Error('remaining tests must not start');
  } });
  assert.throws(r.run, /CN deadline exceeded/);
  assert.equal(calls.length, 2);
});
test('nonexistent cloud task does not add an isolated lane or remove coverage', () => {
  const r = recording([{ ...cloud, command: '<NONEXISTENT>' }]); r.run();
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.calls[1].args, [...r.calls[0].args.slice(0, -1), '--', '--bail=1']);
});

test('browser preparation finishes before selected cloud lane and remaining web coverage', () => {
  const r = recording([web, cloud]); r.run();
  assert.equal(r.calls.length, 4);
  assert.ok(r.calls[1].args.includes('install'));
  assert.ok(r.calls[2].args.includes('--force'));
  assert.ok(r.calls[3].args.includes('--filter=!@repo/cloud-deploy'));
});
test('actual full Turbo test plans preserve the exact union across isolated and remaining lanes', () => {
  const plan = args => {
    // Real repository plans exceed spawnSync's 1 MiB default; retain bounded, complete JSON.
    const r = spawnSync('pnpm', ['turbo', 'run', 'test', ...args, '--dry=json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).tasks.filter(t => t.taskId.endsWith('#test') &&
      t.command && t.command !== '<NONEXISTENT>').map(t => t.taskId).sort();
  };
  for (const apiFilter of [[], ['--filter=!@repo/api']]) {
    const original = plan(['--filter=*', ...apiFilter]);
    const isolated = plan(['--filter=@repo/cloud-deploy', '--force']);
    const remaining = plan(['--filter=*', ...apiFilter, '--filter=!@repo/cloud-deploy']);
    assert.deepEqual(isolated, ['@repo/cloud-deploy#test']);
    assert.equal(remaining.includes('@repo/cloud-deploy#test'), false);
    assert.deepEqual([...isolated, ...remaining].sort(), original);
  }
});
test('a validated local UI plan executes the selected real unit runner instead of full affected packages',()=>{
 const selected=[],r=recording([],{
  env:{GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1',RUNNER_TEMP:'/runner/temp'},
  targetedPlan:()=>({mode:'targeted-ui',headSha:'a'.repeat(40)}),
  runSelectedUnit:(...args)=>selected.push(args),
 });
 r.run();assert.equal(r.calls.length,0);assert.equal(selected.length,1);assert.equal(selected[0][2],'/checkout/apps/web');
 assert.equal(selected[0][3].sha,'a'.repeat(40));
});
test('a selected unit failure cannot turn into an empty or successful affected run',()=>{
 const r=recording([],{env:{GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1',RUNNER_TEMP:'/runner/temp'},targetedPlan:()=>({mode:'targeted-ui'}),runSelectedUnit:()=>{throw Error('actual selected failure')}});
 assert.throws(()=>r.run(),/actual selected failure/);
});

test('web shards execute the whole selected web task with dependency builds and never other packages', () => {
  for (const shard of ['1/4', '2/4', '3/4', '4/4']) {
    const r = recording([web, cloud], { env: { IS_FORK_PR: 'false', CI_AFFECTED_WEB_SHARD: shard, PLAYWRIGHT_BROWSERS_PATH: '/runner/browsers' } });
    r.run();
    assert.equal(r.calls.length, 3);
    assert.deepEqual(r.calls[2].args, ['turbo', 'run', 'test', '--filter=web', '--', `--shard=${shard}`, '--bail=1']);
  }
});
test('web shards do no test work when executable web task is not affected', () => {
  const r = recording([cloud], { env: { CI_AFFECTED_WEB_SHARD: '1/4' } }); r.run();
  assert.equal(r.calls.length, 1);
});
test('invalid web shard cannot fall back to repeated full affected execution', () => {
  for (const shard of ['0/4', '5/4', '1/3', '1', '1/4 --passWithNoTests']) {
    const r = recording([], { env: { CI_AFFECTED_WEB_SHARD: shard } });
    assert.throws(r.run, /INVALID_WEB_SHARD/);
  }
});
test('aggregate excludes web only after all dedicated web producers succeeded, preserving fork API fallback', () => {
  for (const fork of ['true', 'false']) {
    const r = recording([web], { env: { IS_FORK_PR: fork, CI_AFFECTED_WEB_SHARDS_RESULT: 'success' }, coreCli: () => { throw Error('web preparation belongs to shards'); } });
    r.run(); assert.equal(r.calls.length, 2);
    assert.deepEqual(r.calls[1].args, [...r.calls[0].args.slice(0, -1), '--filter=!web', '--', '--bail=1']);
    assert.equal(r.calls[1].args.includes('--filter=!@repo/api'), fork === 'false');
  }
});
test('failed, cancelled, missing or skipped producers cannot yield a full-route aggregate success', () => {
  for (const result of ['failure', 'cancelled', '', 'skipped', 'unknown']) {
    const r = recording([], { env: { CI_AFFECTED_WEB_SHARDS_RESULT: result } });
    assert.throws(r.run, /WEB_SHARDS_NOT_SUCCESSFUL/);
  }
});

test('stable aggregate requires every web shard and fails closed on missing producer evidence', async () => {
  const { parse } = await import('yaml');
  const w = parse(readFileSync(new URL('../workflows/harness-verify.yml', import.meta.url), 'utf8'));
  const shard = w.jobs['verify-web-tests'], aggregate = w.jobs['verify-affected'];
  assert.deepEqual(shard.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(shard.strategy['fail-fast'], true);
  assert.equal(shard['continue-on-error'], undefined);
  assert.equal(shard.needs, 'doc-smoke-scope');
  const { sealedImage } = await import('../../.harness/scripts/ci-fullstack-runtime.mjs');
  const catalog = JSON.parse(readFileSync(new URL('../../.harness/playwright-runtime-images.json', import.meta.url), 'utf8'));
  const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  assert.equal(shard.container.image, sealedImage(requireWeb('playwright-core/package.json').version, catalog));
  assert.equal(shard['runs-on'], 'ubuntu-24.04');
  assert.match(shard.if, /github.event_name != 'pull_request' \|\| needs.doc-smoke-scope.outputs.mode != 'targeted-ui'/);
  assert.deepEqual(aggregate.needs, ['doc-smoke-scope', 'verify-web-tests']);
  assert.match(aggregate.if, /^always\(\)/);
  const step = shard.steps.find(s => s.name === 'Complete affected web test shard');
  const remaining = aggregate.steps.find(s => s.name === '受影响模块 test');
  assert.equal(step.run, 'node .github/scripts/run-affected-tests.mjs');
  assert.equal(step.env.CI_AFFECTED_WEB_SHARD, '${{ matrix.shard }}/4');
  assert.equal(remaining.env.CI_AFFECTED_WEB_SHARDS_RESULT, '${{ needs.verify-web-tests.result }}');
  for (const key of ['TURBO_SCM_BASE', 'WORKSPACEX_DB', 'IS_FORK_PR']) assert.equal(step.env[key], remaining.env[key]);
  assert.equal(shard.steps[0].with['fetch-depth'], 0);
  const guard = aggregate.steps[0];
  assert.equal(guard['continue-on-error'], undefined);
  assert.equal(guard.if, undefined);
  const command = /^node -e "([^"]+)"$/.exec(guard.run.trim());
  assert.ok(command, 'guard must remain one directly executable Node expression');
  const evaluateGuard = new Function('process', command[1]);
  for (const event of ['pull_request', 'merge_group', 'push']) for (const scope of ['success', 'failure', 'cancelled', 'skipped', '']) {
    for (const mode of ['full', 'targeted-ui', 'unknown', '']) {
      for (const webResult of ['success', 'failure', 'cancelled', 'skipped', '']) {
        let passed = true;
        try { evaluateGuard({env: {EVENT_NAME: event, SCOPE_RESULT: scope, SCOPE_MODE: mode, WEB_RESULT: webResult}, exit:()=>{throw Error('rejected');}}); } catch { passed = false; }
        assert.equal(passed, scope === 'success' && webResult === (event === 'pull_request' && mode === 'targeted-ui' ? 'skipped' : 'success'));
      }
    }
  }
});

test('installed Vitest executes four disjoint shards with the exact complete test union', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const directory = mkdtempSync(join(tmpdir(), 'wsx-web-shard-proof-'));
  const cli = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
  try {
    writeFileSync(join(directory, 'vitest.config.mjs'), 'export default {test:{include:["*.test.js"],globals:true,maxWorkers:1,minWorkers:1}}');
    for (let i = 0; i < 8; i++) writeFileSync(join(directory, `${i}.test.js`), `test('case ${i}',()=>expect(${i}+1).toBe(${i+1}));`);
    const seen = new Set();
    for (let shard = 1; shard <= 4; shard++) {
      const output = join(directory, `${shard}.json`);
      const r = spawnSync(process.execPath, [cli, 'run', `--shard=${shard}/4`, '--reporter=json', `--outputFile=${output}`, '--bail=1'], { cwd: directory, encoding: 'utf8', timeout: 15000 });
      assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
      const report = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(report.success, true); assert.equal(report.numTotalTests, 2);
      for (const result of report.testResults) { assert.ok(!seen.has(result.name)); seen.add(result.name); }
    }
    assert.deepEqual([...seen].map(name => basename(name)).sort(), Array.from({length:8},(_,i)=>`${i}.test.js`));
    const config = readFileSync(new URL('../../apps/web/vitest.config.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(config, /\bsequencer\s*:/);
    assert.equal(JSON.parse(readFileSync(new URL('../../apps/web/package.json', import.meta.url), 'utf8')).scripts.test, 'vitest run');
  } finally { rmSync(directory, {recursive:true,force:true}); }
});


test('sealed web shards probe the installed browser without APT or browser downloads', () => {
  const r = recording([web], { env: {CI_AFFECTED_WEB_SHARD:'1/4',CI_AFFECTED_BROWSER_PREINSTALLED:'1',PLAYWRIGHT_BROWSERS_PATH:'/ms-playwright'}, coreCli:()=>{throw Error('no installation');} });
  r.run(); assert.equal(r.calls.length, 3);
  assert.match(r.calls[1].args.at(-1), /chromium.launch/);
  assert.ok(!JSON.stringify(r.calls).includes('--with-deps'));
});
test('merge-group web shards force complete selection instead of repeating targeted unit proofs', () => {
  let options;
  const r = recording([], {env:{CI_AFFECTED_WEB_SHARD:'1/4',CI_AFFECTED_WEB_FORCE_FULL:'true'},targetedPlan:input=>{options=input;return {mode:'full'};}});
  r.run(); assert.equal(options.enabled,false);
});

test('container runtime trusts only its checkout under the active Git global config', async () => {
  const { parse } = await import('yaml');
  const { mkdtempSync, mkdirSync, realpathSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const w = parse(readFileSync(new URL('../workflows/harness-verify.yml', import.meta.url), 'utf8'));
  const steps = w.jobs['verify-web-tests'].steps;
  const trust = steps.find(s => s.name === 'Trust checkout under container runtime HOME');
  assert.ok(trust);
  assert.equal(trust.if, undefined); assert.equal(trust['continue-on-error'], undefined);
  assert.ok(steps.indexOf(trust) > steps.findIndex(s => s.uses?.startsWith('actions/checkout@')));
  assert.ok(steps.indexOf(trust) < steps.findIndex(s => s.name === 'Complete affected web test shard'));
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'wsx-git-owner-')));
  try {
    const checkout = join(directory, 'checkout'), unrelated = join(directory, 'unrelated');
    mkdirSync(checkout); mkdirSync(unrelated);
    const env = {...process.env,GIT_CONFIG_GLOBAL:join(directory,'runtime.gitconfig'),GIT_CONFIG_NOSYSTEM:'1',GIT_TEST_ASSUME_DIFFERENT_OWNER:'1',GITHUB_WORKSPACE:checkout};
    for (const cwd of [checkout, unrelated]) {
      const init = spawnSync('git', ['init','--quiet'], {cwd,env,encoding:'utf8'}); assert.equal(init.status,0,init.stderr);
      const before = spawnSync('git', ['status','--porcelain'], {cwd,env,encoding:'utf8'});
      assert.notEqual(before.status,0); assert.match(before.stderr,/dubious ownership/);
    }
    const fix = spawnSync('sh',['-ec',trust.run],{cwd:checkout,env,encoding:'utf8'}); assert.equal(fix.status,0,fix.stderr);
    const after = spawnSync('git',['status','--porcelain'],{cwd:checkout,env,encoding:'utf8'});assert.equal(after.status,0,after.stderr);
    const other = spawnSync('git',['status','--porcelain'],{cwd:unrelated,env,encoding:'utf8'});assert.notEqual(other.status,0);assert.match(other.stderr,/dubious ownership/);
    const entries=spawnSync('git',['config','--global','--get-all','safe.directory'],{env,encoding:'utf8'});assert.equal(entries.stdout.trim(),checkout);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
