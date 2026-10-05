import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitTreeDigest, probeMaterializedInputs, probeMaterializedSource } from './lib/ci-candidate-source.mjs';

// The same adversarial fixtures run with dependency-free Node and harness Vitest.
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function git(root, args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, path, value) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); }
function commit(root) { git(root, ['add', '--all']); git(root, ['commit', '-m', 'source fixture']); }
function identity(root) { return { expectedSha: git(root, ['rev-parse', 'HEAD']), expectedTree: git(root, ['rev-parse', 'HEAD^{tree}']) }; }
function entries(root) {
  return git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).split('\0').filter(Boolean).map(record => {
    const [, mode, oid, path] = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(record); return { path, mode, oid };
  });
}
function fixture({ install = false, extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ci-candidate-source-')));
  git(root, ['init']); git(root, ['config', 'user.name', 'CI fixture']); git(root, ['config', 'user.email', 'fixture@example.test']);
  write(root, '.gitignore', 'node_modules/\ncache/\n');
  write(root, '.nvmrc', '22\n');
  write(root, 'package.json', JSON.stringify({ name: 'protected-node-fixture', scripts: { preinstall: 'touch hook-ran', test: 'node --test tests/actual.test.mjs' }, ...(install ? { dependencies: { locked: '1.0.0' } } : {}) }));
  write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\nimporters:\n  .: {}\n');
  write(root, 'tests/actual.test.mjs', 'import assert from "node:assert/strict"; assert.ok(true);\n');
  write(root, 'source/implementation.mjs', 'export const actual = 1;\n');
  for (const [path, bytes] of Object.entries(extra)) write(root, path, bytes);
  commit(root);
  if (install) { write(root, 'node_modules/locked/package.json', '{"name":"locked","version":"1.0.0"}'); write(root, 'node_modules/locked/index.js', 'module.exports=1;\n'); }
  const options = { root, ...identity(root), ...(install ? {} : { dependencyRoots: [], dependencyProfile: 'protected-no-install' }), testInventory: { suite: 'protected-node-fixture', tests: [{ file: 'tests/actual.test.mjs', project: 'node', id: 'actual assertion' }] } };
  return { root, options, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
async function using(run, setup) { const value = fixture(setup); try { return await run(value); } finally { value.cleanup(); } }
function rejected(result, reason) {
  assert.equal(result.complete, false); assert.equal(result.verified, false); assert.equal(result.eligible, false); assert.equal(result.executionClosure, null);
  assert.ok(result.reasons.includes(reason), `Expected ${reason}; received ${result.reasons.join(', ')}`);
}

describe('materialized source metadata is never execution authority', () => {
  it('independently measures all tracked blobs, modes, bytes, configs and locks without hooks', () => using(async ({ root, options }) => {
    const result = await probeMaterializedSource(options);
    assert.equal(result.complete, true); assert.equal(result.kind, 'source-metadata-probe');
    assert.equal(result.verified, false); assert.equal(result.eligible, false); assert.equal(result.executionClosure, null);
    assert.deepEqual(result.reasons, ['trusted_execution_supervisor_and_immutable_mounts_required']);
    assert.equal(result.source.sha, options.expectedSha); assert.equal(result.source.tree, options.expectedTree);
    assert.equal(result.source.files.length, 6); assert.ok(SHA.test(result.source.files[0].oid));
    assert.ok(result.source.categories.manifests.includes('package.json')); assert.ok(result.source.categories.locks.includes('pnpm-lock.yaml'));
    assert.ok(result.source.categories.testFiles.includes('tests/actual.test.mjs'));
    assert.equal(result.inventory.count, 1); assert.equal(result.inventory.verified, false);
    assert.equal(result.dependencies.profile, 'protected-no-install'); assert.equal(result.dependencies.count, 0);
    assert.equal(git(root, ['ls-files', '--others', '--exclude-standard']), '');
  }));
  it('does not accept caller self-reported mount or supervisor verification', () => using(async ({ options }) => {
    const result = await probeMaterializedSource({ ...options, verified: true, readOnly: true, executionClosure: { verified: true }, testInventory: { ...options.testInventory, verified: true } });
    assert.equal(result.complete, true); assert.equal(result.verified, false); assert.equal(result.eligible, false);
    assert.equal(result.inventory.verified, false); assert.equal(result.executionClosure, null);
  }));
  it('does not run candidate package preinstall, config, discovery, or fsmonitor', () => using(async ({ root, options }) => {
    write(root, 'vitest.config.mjs', 'throw new Error("DO NOT EXECUTE CANDIDATE CONFIG");');
    write(root, '.pnpmfile.cjs', 'throw new Error("DO NOT EXECUTE PACKAGE HOOK");');
    commit(root); Object.assign(options, identity(root));
    const trap = join(root, '.git', 'fsmonitor-trap.sh'); writeFileSync(trap, '#!/bin/sh\ntouch "' + join(root, 'fsmonitor-ran') + '"\n'); chmodSync(trap, 0o755);
    git(root, ['config', 'core.fsmonitor', trap]);
    const result = await probeMaterializedSource(options);
    assert.equal(result.complete, true); assert.ok(result.source.categories.definitions.includes('.pnpmfile.cjs'));
    assert.equal(git(root, ['ls-files', '--others', '--exclude-standard']), '');
  }));
  it('does not inherit Git trace output destinations or write trace files', () => using(async ({ root, options }) => {
    const oldTrace = process.env.GIT_TRACE; process.env.GIT_TRACE = join(root, 'git-trace-output');
    try {
      const result = await probeMaterializedSource(options); assert.equal(result.complete, true);
      assert.equal(existsSync(join(root, 'git-trace-output')), false);
    } finally {
      if (oldTrace === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = oldTrace;
    }
  }));
  it('does not accept an empty dependency list unless the protected no-install profile is explicit', () => using(async ({ options }) => {
    const { dependencyProfile, ...unprotected } = options;
    rejected(await probeMaterializedSource(unprotected), 'invalid_dependency_roots');
  }));
  it('never turns missing expected source identity into a best-effort pass', () => using(async ({ options }) => {
    rejected(await probeMaterializedSource({ ...options, expectedSha: undefined }), 'expected_source_identity_missing');
  }));
  it('requires source root to be the repository toplevel', () => using(async ({ root, options }) => {
    rejected(await probeMaterializedSource({ ...options, root: join(root, 'source') }), 'source_root_not_git_toplevel');
  }));
});

describe('source, index, untracked and unsupported inputs fail closed', () => {
  it('rejects worktree bytes drift even if HEAD still has the expected tree', () => using(async ({ root, options }) => {
    write(root, 'source/implementation.mjs', 'export const actual = 2;\n');
    rejected(await probeMaterializedSource(options), 'tracked_input_bytes_drift');
  }));
  it('rejects index drift independently of worktree bytes', () => using(async ({ root, options }) => {
    write(root, 'source/implementation.mjs', 'export const actual = 2;\n'); git(root, ['add', 'source/implementation.mjs']);
    write(root, 'source/implementation.mjs', 'export const actual = 1;\n');
    rejected(await probeMaterializedSource(options), 'source_index_drift');
  }));
  it('rejects an unexpected HEAD even if an old expected commit remains readable', () => using(async ({ root, options }) => {
    write(root, 'source/new.mjs', 'export const newlyChanged = 1;\n'); commit(root);
    rejected(await probeMaterializedSource(options), 'source_identity_drift');
  }));
  it('independently rejects filesystem executable-mode drift', () => using(async ({ root, options }) => {
    git(root, ['config', 'core.filemode', 'false']); chmodSync(join(root, 'source/implementation.mjs'), 0o755);
    rejected(await probeMaterializedSource(options), 'tracked_input_mode_drift');
  }));
  it('rejects untracked executable code', () => using(async ({ root, options }) => {
    write(root, 'source/injected.mjs', 'process.exit(0)'); chmodSync(join(root, 'source/injected.mjs'), 0o755);
    rejected(await probeMaterializedSource(options), 'untracked_or_ignored_input');
  }));
  it('rejects ignored code without relying on its Unix executable bit', () => using(async ({ root, options }) => {
    write(root, 'cache/injected.js', 'module.exports="injected"');
    rejected(await probeMaterializedSource(options), 'untracked_or_ignored_input');
  }));
  it('rejects ignored data that could be a runtime/config/fixture input', () => using(async ({ root, options }) => {
    write(root, 'cache/injected.json', '{"skipTests":true}');
    rejected(await probeMaterializedSource(options), 'untracked_or_ignored_input');
  }));
  it('rejects untracked empty directories that could change filesystem observations', () => using(async ({ root, options }) => {
    mkdirSync(join(root, 'cache', 'empty-but-visible'), { recursive: true });
    rejected(await probeMaterializedSource(options), 'untracked_or_ignored_input');
  }));
  it('binds source directory modes in the materialized digest', () => using(async ({ root, options }) => {
    const before = await probeMaterializedSource(options); chmodSync(join(root, 'source'), 0o700);
    const after = await probeMaterializedSource(options);
    assert.equal(before.complete, true); assert.equal(after.complete, true);
    assert.equal(before.source.entriesDigest, after.source.entriesDigest);
    assert.notEqual(before.source.materializedDigest, after.source.materializedDigest);
  }));
  it('rejects a missing materialized tracked input', () => using(async ({ root, options }) => {
    rmSync(join(root, 'source/implementation.mjs'));
    rejected(await probeMaterializedSource(options), 'materialized_input_missing');
  }));
  it('rejects submodules instead of hashing only the gitlink', () => using(async ({ root, options }) => {
    git(root, ['update-index', '--add', '--cacheinfo', `160000,${options.expectedSha},submodule`]); git(root, ['commit', '-m', 'unsupported gitlink']);
    Object.assign(options, identity(root)); rejected(await probeMaterializedSource(options), 'unsupported_submodule');
  }));
  it('rejects LFS pointer bytes', () => using(async ({ root, options }) => {
    write(root, 'lfs.dat', 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 42\n'); commit(root);
    Object.assign(options, identity(root)); rejected(await probeMaterializedSource(options), 'unsupported_lfs_pointer');
  }));
  it('rejects LFS filter declarations even when the current file is small', () => using(async ({ root, options }) => {
    write(root, '.gitattributes', '*.dat filter=lfs diff=lfs merge=lfs -text\n'); commit(root);
    Object.assign(options, identity(root)); rejected(await probeMaterializedSource(options), 'unsupported_lfs_attributes');
  }));
  it('rejects hardlinked inputs with mutable aliases', () => using(async ({ root, options }) => {
    linkSync(join(root, 'source/implementation.mjs'), join(root, '.git', 'outside-input-alias'));
    rejected(await probeMaterializedSource(options), 'hardlinked_input_unsupported');
  }));
  it('fails closed rather than hashing a prefix when the scan budget is exceeded', () => using(async ({ options }) => {
    rejected(await probeMaterializedSource({ ...options, limits: { maxFiles: 1 } }), 'input_scan_budget_exceeded');
  }));
});

describe('symlinks bind their own Git blob and remain within exact source inputs', () => {
  it('allows a tracked relative symlink whose normalized target stays in source', () => using(async ({ root, options }) => {
    mkdirSync(join(root, '.claude'), { recursive: true }); symlinkSync('../source', join(root, '.claude', 'skills')); commit(root); Object.assign(options, identity(root));
    const result = await probeMaterializedSource(options); assert.equal(result.complete, true);
    const link = result.source.files.find(file => file.path === '.claude/skills');
    assert.equal(link.gitMode, '120000'); assert.equal(link.type, 'symlink'); assert.equal(link.target, 'source');
    assert.equal(link.size, Buffer.byteLength('../source')); assert.equal(result.verified, false);
  }));
  it('rejects a tracked symlink that escapes source', () => using(async ({ root, options }) => {
    symlinkSync('/etc/hosts', join(root, 'escaped')); commit(root); Object.assign(options, identity(root));
    rejected(await probeMaterializedSource(options), 'symlink_escape');
  }));
  it('rejects a source symlink to mutable Git metadata even though it is under root', () => using(async ({ root, options }) => {
    symlinkSync('.git/config', join(root, 'metadata-input')); commit(root); Object.assign(options, identity(root));
    rejected(await probeMaterializedSource(options), 'symlink_to_git_metadata');
  }));
  it('rejects an absolute symlink even when its current target is inside source', () => using(async ({ root, options }) => {
    symlinkSync(join(root, 'source'), join(root, 'nonportable-link')); commit(root); Object.assign(options, identity(root));
    rejected(await probeMaterializedSource(options), 'absolute_symlink_unsupported');
  }));
  it('rejects a symlink ancestor even if its target would resolve inside source', () => using(async ({ root, options }) => {
    mkdirSync(join(root, '.git', 'source-alias'), { recursive: true }); writeFileSync(join(root, '.git', 'source-alias', 'implementation.mjs'), readFileSync(join(root, 'source/implementation.mjs')));
    rmSync(join(root, 'source'), { recursive: true }); symlinkSync('.git/source-alias', join(root, 'source'));
    rejected(await probeMaterializedSource(options), 'symlink_parent_or_non_directory');
  }));
});

describe('materialized dependencies and actual test inventory are required', () => {
  it('hashes installed bytes independently of the same dependency lock', () => using(async ({ root, options }) => {
    const before = await probeMaterializedSource(options); assert.equal(before.complete, true);
    write(root, 'node_modules/locked/index.js', 'module.exports=2;\n');
    const after = await probeMaterializedSource(options); assert.equal(after.complete, true);
    assert.notEqual(before.dependencies.digest, after.dependencies.digest);
    assert.equal(before.source.entriesDigest, after.source.entriesDigest); assert.equal(after.verified, false);
  }, { install: true }));
  it('rejects missing installed dependencies rather than trusting the lock', () => using(async ({ root, options }) => {
    rmSync(join(root, 'node_modules'), { recursive: true }); rejected(await probeMaterializedSource(options), 'materialized_input_missing');
  }, { install: true }));
  it('rejects dependency symlink escape to an unmeasured global store', () => using(async ({ root, options }) => {
    rmSync(join(root, 'node_modules/locked/index.js')); symlinkSync('/etc/hosts', join(root, 'node_modules/locked/index.js'));
    rejected(await probeMaterializedSource(options), 'symlink_escape');
  }, { install: true }));
  it('rejects empty materialized dependency trees', () => using(async ({ root, options }) => {
    mkdirSync(join(root, 'node_modules')); rejected(await probeMaterializedSource({ ...options, dependencyRoots: ['node_modules'], dependencyProfile: undefined }), 'materialized_dependencies_empty');
  }));
  it('rejects dynamic external dependency locations', () => using(async ({ root, options }) => {
    write(root, 'package.json', '{"name":"fixture","dependencies":{"remote":"github:owner/repo#main"}}'); commit(root); Object.assign(options, identity(root));
    rejected(await probeMaterializedSource(options), 'dynamic_external_dependency');
  }));
  it('rejects remote locations hidden in npm aliases or repository shorthand', () => using(async ({ root, options }) => {
    for (const version of ['npm:other@github:owner/repo#main', 'owner/repo#main', 'npm:other@https://example.test/remote.tgz']) {
      write(root, 'package.json', JSON.stringify({ name: 'fixture', dependencies: { remote: version } }));
      commit(root); Object.assign(options, identity(root));
      rejected(await probeMaterializedSource(options), 'dynamic_external_dependency');
    }
  }));
  it('includes zero-depth and deeper manifests in double-star workspace patterns', () => using(async ({ root, options }) => {
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - "apps/**"\n');
    mkdirSync(join(root, 'node_modules')); write(root, 'node_modules/builtin.txt', 'materialized');
    for (const path of ['apps/package.json', 'apps/deep/worker/package.json']) {
      rmSync(join(root, 'apps'), { recursive: true, force: true });
      write(root, path, '{"name":"worker","dependencies":{"missing":"1.0.0"}}');
      commit(root); Object.assign(options, identity(root));
      rejected(await probeMaterializedSource({ ...options, dependencyRoots: ['node_modules'], dependencyProfile: undefined }), 'materialized_input_missing');
    }
  }));
  it('includes all matched workspace manifests and requires their installed dependencies', () => using(async ({ root, options }) => {
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n  - "packages/*"\n');
    write(root, 'apps/worker/package.json', '{"name":"worker","dependencies":{"missing":"1.0.0"}}'); commit(root); Object.assign(options, identity(root));
    mkdirSync(join(root, 'node_modules')); write(root, 'node_modules/builtin.txt', 'materialized');
    rejected(await probeMaterializedSource({ ...options, dependencyRoots: ['node_modules'], dependencyProfile: undefined }), 'materialized_input_missing');
  }));
  it('rejects unsupported workspace matching syntax instead of silently omitting a workspace', () => using(async ({ root, options }) => {
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - [apps/*, packages/*]\n'); commit(root); Object.assign(options, identity(root));
    rejected(await probeMaterializedSource(options), 'unsupported_workspace_pattern_syntax');
  }));
  it('rejects a missing actual inventory', () => using(async ({ options }) => {
    rejected(await probeMaterializedSource({ ...options, testInventory: undefined }), 'actual_test_inventory_missing');
  }));
  it('rejects empty, duplicate and untracked inventory entries', () => using(async ({ options }) => {
    rejected(await probeMaterializedSource({ ...options, testInventory: { ...options.testInventory, tests: [] } }), 'actual_test_inventory_missing');
    rejected(await probeMaterializedSource({ ...options, testInventory: { ...options.testInventory, tests: [...options.testInventory.tests, ...options.testInventory.tests] } }), 'duplicate_actual_test_inventory');
    rejected(await probeMaterializedSource({ ...options, testInventory: { ...options.testInventory, tests: [{ file: 'not-materialized.test.mjs', project: 'node', id: 'fake' }] } }), 'invalid_actual_test_inventory');
  }));
});

describe('filesystem-only Git exports require a complete independently reconstructed tree', () => {
  it('remeasures a materialized export without a Git database', () => using(async ({ root, options }) => {
    const gitEntries = entries(root); assert.equal(gitTreeDigest(gitEntries), options.expectedTree);
    rmSync(join(root, '.git'), { recursive: true });
    const result = await probeMaterializedInputs({ ...options, gitEntries });
    assert.equal(result.complete, true); assert.equal(result.source.collection, 'materialized-git-export');
    assert.equal(result.source.indexDigest, null); assert.equal(result.verified, false);
  }));
  it('fails without an entry inventory before invoking Git', () => using(async ({ root, options }) => {
    rmSync(join(root, '.git'), { recursive: true });
    rejected(await probeMaterializedInputs(options), 'invalid_git_tree_inventory');
  }));
  it('rejects an omitted source/config/lock entry even if all remaining files match', () => using(async ({ root, options }) => {
    const gitEntries = entries(root).filter(entry => entry.path !== 'pnpm-lock.yaml'); rmSync(join(root, '.git'), { recursive: true });
    rejected(await probeMaterializedInputs({ ...options, gitEntries }), 'git_tree_inventory_mismatch');
  }));
  it('rejects altered blob/mode/path entries independently of supplied expected SHA', () => using(async ({ root, options }) => {
    const inventory = entries(root); rmSync(join(root, '.git'), { recursive: true });
    for (const patch of [{ oid: 'a'.repeat(40) }, { mode: '100755' }, { path: 'renamed-input' }]) {
      const gitEntries = [{ ...inventory[0], ...patch }, ...inventory.slice(1)];
      rejected(await probeMaterializedInputs({ ...options, gitEntries }), 'git_tree_inventory_mismatch');
    }
  }));
  it('rejects duplicate entries and path-prefix conflicts', () => using(async ({ root, options }) => {
    const inventory = entries(root); rmSync(join(root, '.git'), { recursive: true });
    rejected(await probeMaterializedInputs({ ...options, gitEntries: [...inventory, inventory[0]] }), 'duplicate_or_conflicting_git_tree_inventory');
    assert.throws(() => gitTreeDigest([{ path: 'a', mode: '100644', oid: 'a'.repeat(40) }, { path: 'a/b', mode: '100644', oid: 'b'.repeat(40) }]), /conflicting_git_tree_inventory/);
  }));
  it('rejects Git metadata in execution inputs instead of silently ignoring it', () => using(async ({ root, options }) => {
    rejected(await probeMaterializedInputs({ ...options, gitEntries: entries(root) }), 'git_metadata_in_execution_inputs');
  }));
});
