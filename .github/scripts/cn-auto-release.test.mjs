import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = 'a'.repeat(40);
const main = 'b'.repeat(40);
function run(mode, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cn-auto-'));
  try {
    const log = join(dir, 'calls'); const summary = join(dir, 'summary');
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(a)+'\\n');
if(a[0]==='workflow'){if(process.env.DISPATCH_FAIL==='1')process.exit(1);console.log('queued');}
else if(a[1].includes('/compare/'))console.log(process.env.COMPARE_STATUS||'ahead');
else if(a[1].endsWith('/main-cn'))console.log(process.env.CURRENT_SHA);
else if(a[1].endsWith('/main'))console.log('${main}');
else process.exit(2);
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ['.github/scripts/cn-auto-release.mjs', mode], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: log,
        GITHUB_REPOSITORY: 'boardx/workspacex', RELEASE_SHA: source, CURRENT_SHA: source,
        GITHUB_EVENT_NAME: mode === 'prepare' ? 'push' : 'workflow_dispatch',
        GITHUB_REF: mode === 'prepare' ? 'refs/heads/main-cn' : 'refs/heads/main',
        GITHUB_RUN_ID: '12345', EXPECTED_MAIN_CN_SHA: main, RELEASE_TAG: 'cn-prepared-gha-12345-1', RELEASE_ATTEMPT_ID: 'gha-12345-1',
        GITHUB_STEP_SUMMARY: summary, ...overrides },
    });
    return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
      summary: (() => { try { return readFileSync(summary, 'utf8'); } catch { return ''; } })() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('exact current main-cn main ancestor queues trusted preparation and explicitly denies acceptance', () => {
  const result = run('prepare'); assert.equal(result.status, 0);
  assert.ok(result.calls.some(a => a[1]?.includes(`/compare/${source}...${main}`)));
  const dispatch = result.calls.find(a => a[0] === 'workflow');
  assert.ok(dispatch.includes('prepare-cn-release.yml')); assert.ok(dispatch.includes('release_sha='+source));
  assert.ok(dispatch.includes('auto_promote=true'));
  assert.ok(dispatch.includes('release=v0.0.0-cn-12345')); assert.match(result.summary, /NOT production accepted/);
});
test('wrong source or stale desired ref never dispatches', () => {
  for (const env of [{ CURRENT_SHA: main }, { COMPARE_STATUS: 'diverged' }, { COMPARE_STATUS: 'behind' }]) {
    const result = run('prepare', env); assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some(a => a[0] === 'workflow')); assert.equal(result.summary, '');
  }
});
test('dispatch failure is nonzero and has no queued success summary', () => {
  const result = run('prepare', { DISPATCH_FAIL: '1' });
  assert.notEqual(result.status, 0); assert.equal(result.summary, ''); assert.doesNotMatch(result.stdout, /queued/);
});
test('promotion uses exact frozen tag and branch-push admission without claiming terminal acceptance', () => {
  const result = run('promote'); assert.equal(result.status, 0);
  const dispatch = result.calls.find(a => a[0] === 'workflow');
  assert.ok(dispatch.includes('cn-prepared-gha-12345-1')); assert.ok(dispatch.includes('promotion_mode=branch-push'));
  assert.ok(dispatch.includes('expected_main_cn_sha='+main)); assert.match(result.summary, /NOT production accepted/);
});
test('promotion dispatch failure cannot become production success', () => {
  const result = run('promote', { DISPATCH_FAIL: '1' }); assert.notEqual(result.status, 0); assert.equal(result.summary, '');
});
test('workflow wiring preserves manual verification and gates frozen-tag auto-promotion on preparation success', () => {
  const deploy = readFileSync('.github/workflows/deploy-cn-production.yml', 'utf8');
  const prepare = readFileSync('.github/workflows/prepare-cn-release.yml', 'utf8');
  assert.doesNotMatch(deploy, /push:\n    branches: \[main-cn\]/);
  assert.ok(!deploy.includes('queue-release:'));
  assert.match(deploy, /deploy:\n    if: github.event_name == 'workflow_dispatch'/);
  assert.match(deploy, /--verify-active/);
  assert.doesNotMatch(deploy, /cn-auto-release.mjs prepare/);
  assert.match(prepare, /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.match(prepare, /id: prepared/);
  assert.match(prepare, /RELEASE_TAG: \$\{\{ steps.prepared.outputs.release_tag \}\}/);
  assert.match(prepare, /if: inputs.auto_promote/);
  assert.match(prepare, /cn-auto-release.mjs promote/);
  assert.match(prepare, /export_baseline=auto/);
  assert.match(prepare, /EXPECTED_MAIN_CN_SHA: \$\{\{ steps.prepared.outputs.expected_main_cn_sha \}\}/);
  assert.match(prepare, /echo "expected_main_cn_sha=\$\{expected_main_cn\}"/);
  for (const operation of ['--check-prepare-inputs', '--prepare', 'freeze-tag']) {
    assert.ok(prepare.indexOf(operation) < prepare.indexOf('cn-auto-release.mjs promote'));
  }
  assert.doesNotMatch(prepare, /always\(\).*auto_promote/);
});

test('wrong event or untrusted preparation ref cannot dispatch', () => {
  for (const [mode, env] of [
    ['prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch' }],
    ['prepare', { GITHUB_REF: 'refs/heads/develop' }],
    ['promote', { GITHUB_REF: 'refs/heads/develop' }],
    ['promote', { RELEASE_TAG: 'main' }],
    ['promote', { EXPECTED_MAIN_CN_SHA: '' }],
    ['promote', { CURRENT_SHA: main }],
  ]) {
    const result = run(mode, env); assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some(a => a[0] === 'workflow')); assert.equal(result.summary, '');
  }
});
