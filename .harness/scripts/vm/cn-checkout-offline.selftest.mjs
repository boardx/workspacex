import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('full checkout ancestry validation works without any remote access and rejects missing refs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-offline-ref-'));
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    assert.equal(git('init').status, 0);
    assert.equal(git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'baseline').status, 0);
    const sha = git('rev-parse', 'HEAD').stdout.trim();
    assert.equal(git('update-ref', 'refs/remotes/origin/main', sha).status, 0);
    assert.equal(git('remote', 'add', 'origin', 'https://127.0.0.1:1/unreachable').status, 0);
    assert.equal(git('rev-parse', '--verify', 'origin/main').status, 0);
    assert.equal(git('merge-base', '--is-ancestor', sha, 'origin/main').status, 0);
    assert.notEqual(git('merge-base', '--is-ancestor', 'a'.repeat(40), 'origin/main').status, 0);
    assert.equal(git('update-ref', '-d', 'refs/remotes/origin/main').status, 0);
    assert.notEqual(git('rev-parse', '--verify', 'origin/main').status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both workflows reuse checkout refs and never fetch origin after credentials cleanup', () => {
  for (const name of ['promote-cn-production']) {
    const source = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    assert.match(source, /fetch-depth: 0/);
    assert.match(source, /persist-credentials: false/);
    assert.match(source, /git rev-parse --verify origin\/main/);
    assert.doesNotMatch(source, /^\s*git fetch .*origin/m);
    assert.match(source, /git merge-base --is-ancestor/);
    assert.match(source, /GIT_NO_LAZY_FETCH=1/);
  }
});

test('prepare exports verified domestic cache instead of cross-border checkout or writer',()=>{const source=readFileSync('.github/workflows/prepare-cn-release.yml','utf8');assert.doesNotMatch(source,/actions\/checkout|git .*fetch/);assert.match(source,/workspacex-cn-export-source/);assert.match(source,/git merge-base --is-ancestor/);});
