import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { executeDocker, inspectRootfsTar, observeContainerResources, PILOT_ARGV, PILOT_DEFINITIONS, pilotCreateArgs, runCandidatePilot, validatePilotPolicy } from './lib/ci-candidate-pilot.mjs';
import { materializeGitInput, safeRepositoryPath, verifyGitInput } from './lib/ci-candidate-pilot-source.mjs';

const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const root = resolve(new URL('../../', import.meta.url).pathname);
const image = {
  reference: 'docker.io/library/node@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27',
  platform: 'linux/amd64', nodeBinary: PILOT_ARGV[0],
  configDigest: `sha256:${'b'.repeat(64)}`, rootfsLayers: [`sha256:${'c'.repeat(64)}`],
};
function policy(pins = PILOT_DEFINITIONS.map(path => ({ path, oid: 'a'.repeat(40) }))) {
  return { schemaVersion: 1, mode: 'shadow', suite: 'ci-candidate-evidence-core', image: { ...image },
    command: { argv: [...PILOT_ARGV], expectedTests: 175, definitionBlobs: pins },
    limits: { timeoutMs: 120000, maxLogBytes: 2000000, memoryBytes: 536870912, pidsLimit: 128, maxSourceBytes: 2147483648, maxSourceFileBytes: 33554432 }, isolation: { uid: 65532, gid: 65532 } };
}
function cleanup(path) {
  if (!existsSync(path)) return;
  const walk = directory => { chmodSync(directory, 0o700); for (const name of readdirSync(directory)) { const child = join(directory, name); if (lstatSync(child).isDirectory()) walk(child); } };
  walk(path); rmSync(path, { recursive: true, force: true });
}
function git(root, args) { return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { env: { PATH: process.env.PATH, HOME: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
function fixture(program = "import {test} from 'node:test'; test('fixture', () => {});\n") {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ci-candidate-pilot-test-')));
  const repositoryRoot = join(temp, 'repository'); mkdirSync(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet']);
  for (const [path, bytes] of Object.entries({
    [PILOT_DEFINITIONS[0]]: program, [PILOT_DEFINITIONS[1]]: 'export const localFixture = true;\n',
    'package.json': '{"private":true,"type":"module"}\n', 'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    '.gitattributes': 'exported.txt export-ignore\n', 'exported.txt': 'included complete tree\n',
  })) { const absolute = join(repositoryRoot, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, bytes); }
  const commit = () => { git(repositoryRoot, ['add', '--all']); git(repositoryRoot, ['-c', 'user.name=Local Pilot Test', '-c', 'user.email=local-pilot@example.invalid', 'commit', '--quiet', '-m', 'independent local fixture']); return git(repositoryRoot, ['rev-parse', 'HEAD']); };
  const candidateSha = commit();
  const pins = PILOT_DEFINITIONS.map(path => ({ path, oid: git(repositoryRoot, ['rev-parse', `${candidateSha}:${path}`]) }));
  return { temp, repositoryRoot, candidateSha, pins, commit, destination: join(temp, 'input'), outputDirectory: join(temp, 'receipt') };
}
async function materialize(value) { return materializeGitInput({ ...value, definitionBlobs: value.pins }); }

describe('protected pilot policy and fixed Docker argv', () => {
  it('accepts only shadow fixed command with independently pinned OCI config and complete definition pins', () => assert.equal(validatePilotPolicy(policy()).mode, 'shadow'));
  const changes = [
    ['arbitrary command', p => p.command.argv.push('/input/attacker.mjs')], ['changed suite', p => { p.suite = 'fullstack'; }],
    ['floating image', p => { p.image.reference = 'node:22'; }], ['missing config pin', p => { delete p.image.configDigest; }],
    ['missing layer pins', p => { p.image.rootfsLayers = []; }], ['root UID', p => { p.isolation.uid = 0; }],
    ['reuse mode', p => { p.mode = 'reuse'; }], ['missing test definition', p => p.command.definitionBlobs.pop()],
    ['fake expected count', p => { p.command.expectedTests = 1; }], ['unbounded timeout', p => { p.limits.timeoutMs = 999999; }],
    ['unbounded output', p => { p.limits.maxLogBytes = 99999999; }], ['larger source budget', p => { p.limits.maxSourceBytes++; }],
  ];
  for (const [name, change] of changes) it(`rejects ${name}`, () => { const p = policy(); change(p); assert.throws(() => validatePilotPolicy(p)); });
  it('has one read-only nonrecursive bind and no host/socket/tool/receipt mounts', () => {
    const args = pilotCreateArgs({ policy: policy(), imageId: image.configDigest, sourceDirectory: '/trusted/input', nonce: '11111111-1111-4111-8111-111111111111' });
    assert.deepEqual(args.slice(-3), [image.configDigest, '--test', PILOT_ARGV[2]]);
    assert.equal(args.filter(arg => arg === '--mount').length, 1);
    assert.ok(args.includes('type=bind,source=/trusted/input,target=/input,readonly,bind-propagation=rprivate,bind-recursive=disabled'));
    for (const pair of [['--user', '65532:65532'], ['--network', 'none'], ['--ipc', 'private'], ['--cgroupns', 'private'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges']]) assert.equal(args[args.indexOf(pair[0]) + 1], pair[1]);
    for (const forbidden of ['--privileged', '--pid', '--group-add', '--device', '--volume', '--env-file']) assert.ok(!args.includes(forbidden));
    assert.ok(!args.some(arg => /docker\.sock|GH_TOKEN|GITHUB_TOKEN|\.ssh|node_modules/.test(arg)));
  });
  it('rejects mount option injection', () => assert.throws(() => pilotCreateArgs({ policy: policy(), imageId: image.configDigest, sourceDirectory: '/input,readonly=false', nonce: '11111111-1111-4111-8111-111111111111' })));
  it('collects actual daemon resource limits without copying policy values', () => assert.deepEqual(observeContainerResources({ HostConfig: { Memory: 123, MemorySwap: 456, PidsLimit: 7, AutoRemove: true, RestartPolicy: { Name: 'always', MaximumRetryCount: 9 } } }), { memoryBytes: 123, memorySwapBytes: 456, pidsLimit: 7, autoRemove: true, restartPolicy: { Name: 'always', MaximumRetryCount: 9 } }));
  it('preserves missing resource facts as null so readers fail closed', () => assert.deepEqual(observeContainerResources({ HostConfig: {} }), { memoryBytes: null, memorySwapBytes: null, pidsLimit: null, autoRemove: null, restartPolicy: null }));
});

describe('full Git object materialization rejects ambiguous inputs', () => {
  for (const path of ['../escape', '/absolute', 'a/.git/config', 'a/.GIT/x', 'a//b', 'a\\b', 'a\nb']) it(`rejects path ${JSON.stringify(path)}`, () => assert.equal(safeRepositoryPath(path), false));
  it('ignores export-ignore and dirty/untracked host bytes; measures complete tracked tree', async () => {
    const value = fixture();
    try {
      writeFileSync(join(value.repositoryRoot, 'exported.txt'), 'dirty host bytes'); writeFileSync(join(value.repositoryRoot, 'untracked'), 'outside exact input');
      const result = await materialize(value);
      assert.equal(readFileSync(join(value.destination, 'exported.txt'), 'utf8'), 'included complete tree\n');
      assert.equal(existsSync(join(value.destination, 'untracked')), false); assert.equal(existsSync(join(value.destination, '.git')), false);
      assert.equal(result.tree, git(value.repositoryRoot, ['rev-parse', `${value.candidateSha}^{tree}`])); assert.equal(result.fileCount, 6);
      assert.equal(verifyGitInput({ root: value.destination, entries: result.entries }).fingerprint, result.materializedFingerprint);
    } finally { cleanup(value.temp); }
  });
  it('rejects changed fixed test definition before any Docker calls and keeps fallback', async () => {
    const value = fixture();
    try {
      const p = policy(value.pins); p.command.definitionBlobs[0].oid = 'd'.repeat(40);
      const result = await runCandidatePilot({ ...value, policy: p, executor: () => { throw new Error('Docker must never be called'); } });
      assert.ok(result.blockers.includes('protected_test_definition_changed')); assert.equal(result.suiteExecuted, false);
      assert.equal(result.skip, false); assert.equal(result.runFull, true); assert.equal(result.verified, false); assert.equal(result.reuseAuthorized, false);
    } finally { cleanup(value.temp); }
  });
  it('allows only safe resolved internal Git symlinks', async () => {
    const value = fixture();
    try { symlinkSync('exported.txt', join(value.repositoryRoot, 'safe-link')); value.candidateSha = value.commit(); const result = await materialize(value); assert.equal(readFileSync(join(value.destination, 'safe-link'), 'utf8'), 'included complete tree\n'); assert.equal(result.fileCount, 7); }
    finally { cleanup(value.temp); }
  });
  it('does not confuse commit-message parent text with actual Git commit ancestry', async () => {
    const value = fixture(); const original = value.candidateSha;
    try { writeFileSync(join(value.repositoryRoot, 'exported.txt'), 'second commit'); git(value.repositoryRoot, ['add', '--all']); git(value.repositoryRoot, ['-c', 'user.name=Local', '-c', 'user.email=local@example.invalid', 'commit', '--quiet', '-m', `body\n\nparent ${'f'.repeat(40)}`]); value.candidateSha = git(value.repositoryRoot, ['rev-parse', 'HEAD']); const result = await materialize(value); assert.deepEqual(result.parents, [original]); }
    finally { cleanup(value.temp); }
  });
  for (const [name, mutate, reason] of [
    ['escaping symlink', v => symlinkSync('../outside', join(v.repositoryRoot, 'bad-link')), /escaping_git_symlink/],
    ['absolute symlink', v => symlinkSync('/etc/passwd', join(v.repositoryRoot, 'bad-link')), /unsafe_git_symlink/],
    ['LFS pointer', v => writeFileSync(join(v.repositoryRoot, 'pointer'), 'version https://git-lfs.github.com/spec/v1\noid sha256:aaaa\nsize 1\n'), /unsupported_lfs_pointer/],
    ['LFS attribute', v => writeFileSync(join(v.repositoryRoot, '.gitattributes'), '* filter=lfs\n'), /unsupported_lfs_attributes/],
  ]) it(`rejects ${name}`, async () => { const value = fixture(); try { mutate(value); value.candidateSha = value.commit(); await assert.rejects(materialize(value), reason); } finally { cleanup(value.temp); } });
  it('rejects gitlinks without fetching or initializing submodules', async () => {
    const value = fixture();
    try { git(value.repositoryRoot, ['update-index', '--add', '--cacheinfo', `160000,${value.candidateSha},submodule`]); git(value.repositoryRoot, ['-c', 'user.name=Local', '-c', 'user.email=local@example.invalid', 'commit', '--quiet', '-m', 'gitlink']); value.candidateSha = git(value.repositoryRoot, ['rev-parse', 'HEAD']); await assert.rejects(materialize(value), /unsupported_gitlink/); }
    finally { cleanup(value.temp); }
  });
  for (const [name, mutate, reason] of [
    ['extra regular input', v => writeFileSync(join(v.destination, 'extra'), 'untracked'), /extra_or_special/],
    ['extra empty directory', v => mkdirSync(join(v.destination, 'extra')), /extra_materialized_directory/],
    ['changed file bytes', v => { chmodSync(join(v.destination, 'exported.txt'), 0o600); writeFileSync(join(v.destination, 'exported.txt'), 'changed'); }, /bytes_changed/],
    ['changed executable mode', v => chmodSync(join(v.destination, 'exported.txt'), 0o555), /mode_changed/],
  ]) it(`postverification rejects ${name}`, async () => { const value = fixture(); try { const result = await materialize(value); chmodSync(value.destination, 0o700); mutate(value); assert.throws(() => verifyGitInput({ root: value.destination, entries: result.entries }), reason); } finally { cleanup(value.temp); } });
  it('rejects a daemon image ID outside independently pinned manifest/config identities', async () => {
    const value = fixture(); try {
      const result = await runCandidatePilot({ ...value, policy: policy(value.pins), executor: async args => { assert.equal(args[0], 'image'); return { status: 0, stdout: Buffer.from(JSON.stringify([{ Id: `sha256:${'d'.repeat(64)}`, RepoDigests: [image.reference], Os: 'linux', Architecture: 'amd64', RootFS: { Type: 'layers', Layers: image.rootfsLayers }, Config: { Env: ['PATH=/usr/local/bin:/usr/bin:/bin'] } }])), stderr: Buffer.alloc(0) }; } });
      assert.ok(result.blockers.includes('immutable_image_identity_mismatch'), result.blockers.join(',')); assert.equal(result.proofComplete, false); assert.equal(result.inputRemoved, true);
    } finally { cleanup(value.temp); }
  });
});

function tarEntry(name, bytes, mode = 0o755, type = '0') {
  const header = Buffer.alloc(512); header.write(name); const octal = (value, start, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', start, length, 'ascii');
  octal(mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12); header.fill(32, 148, 156); header[156] = type.charCodeAt(); header.write('ustar\0', 257);
  const sum = header.reduce((sum, byte) => sum + byte, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
function elf() { const bytes = Buffer.alloc(256); bytes.set([127, 69, 76, 70, 2, 1]); bytes.writeBigUInt64LE(64n, 32); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(1, 56); bytes.writeUInt32LE(3, 64); bytes.writeBigUInt64LE(128n, 72); const loader = Buffer.from('/lib64/ld-linux-x86-64.so.2\0'); bytes.writeBigUInt64LE(BigInt(loader.length), 96); loader.copy(bytes, 128); return bytes; }
describe('stopped immutable-image rootfs parser', () => {
  it('hashes real bytes of executable, ELF loader and whole library/rootfs inventory without running them', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'pilot-tar-')); const path = join(temp, 'rootfs.tar');
    const bytes = Buffer.concat([tarEntry('usr/local/bin/node', elf()), tarEntry('lib64/ld-linux-x86-64.so.2', Buffer.from('loader')), tarEntry('lib/libc.so.6', Buffer.from('library'), 0o644), tarEntry('etc/tool', Buffer.from('other bytes'), 0o644), Buffer.alloc(1024)]);
    try { writeFileSync(path, bytes); const result = await inspectRootfsTar(path); assert.equal(result.complete, true); assert.equal(result.archiveDigest, digest(bytes)); assert.equal(result.entryCount, 4); assert.equal(result.node.sha256, digest(elf())); assert.equal(result.loader.sha256, digest(Buffer.from('loader'))); assert.equal(result.libraries.length, 2); }
    finally { cleanup(temp); }
  });
  for (const [name, bytes, reason] of [
    ['path traversal', tarEntry('../escape', Buffer.alloc(0)), /path_invalid/],
    ['special device', tarEntry('dev/attack', Buffer.alloc(0), 0o644, '3'), /unsupported_image/],
    ['malformed checksum', Buffer.alloc(512, 1), /numeric_invalid|checksum_invalid/],
    ['truncated archive', tarEntry('file', Buffer.from('bytes')).subarray(0, 550), /truncated/],
  ]) it(`rejects ${name}`, async () => { const temp = mkdtempSync(join(tmpdir(), 'pilot-tar-')); try { const path = join(temp, 'rootfs.tar'); writeFileSync(path, bytes); await assert.rejects(inspectRootfsTar(path), reason); } finally { cleanup(temp); } });
});

// Explicit opt-in only. These assertions use the real daemon, not fake namespace
// snapshots. Fixture policy is local test-driver input, never protected authority.
const real = process.env.CI_CANDIDATE_PILOT_REAL === '1';
const realIt = (name, fn) => process.env.VITEST ? it.skipIf(!real)(name, fn, 240000) : it(name, { skip: !real, timeout: 240000 }, fn);
describe('real Docker adversarial controller integration (local authority only)', () => {
  const actualPolicy = () => JSON.parse(readFileSync(process.env.CI_CANDIDATE_PILOT_REAL_POLICY ?? join(root, '.harness/config/ci-candidate-pilot.json'), 'utf8'));
  const retainReceipt = (name, result) => {
    if (!process.env.CI_CANDIDATE_PILOT_REAL_OUTPUT) return;
    const directory = join(process.env.CI_CANDIDATE_PILOT_REAL_OUTPUT, 'integration-receipts'); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`), `${JSON.stringify({ testDriverAuthority: 'local-unprotected-fixture', ...result })}\n`, { flag: 'wx', mode: 0o600 });
  };
  realIt('runs the exact 175-test production entrypoint with immutable image, complete Git tree and nonroot isolated daemon state', async () => {
    const outputDirectory = process.env.CI_CANDIDATE_PILOT_REAL_OUTPUT ?? join(mkdtempSync(join(tmpdir(), 'pilot-production-')), 'receipt');
    const result = await runCandidatePilot({ repositoryRoot: root, candidateSha: git(root, ['rev-parse', 'HEAD']), outputDirectory, policy: actualPolicy() });
    assert.equal(result.executionSuccessful, true, result.blockers.join(',')); assert.equal(result.measurementComplete, true, result.blockers.join(',')); assert.equal(result.proofComplete, result.runtimeValidation.toolchainClosureComplete);
    assert.equal(result.execution.diagnostic.reportedTests, 175); assert.equal(result.runtimeValidation.structureValid, true); assert.equal(result.runtimeValidation.executionValid, true);
    assert.equal(result.runtimeValidation.toolBytesValid, true); assert.equal(result.runtimeValidation.mountInputsValid, true); assert.equal(result.runtimeValidation.authorityBound, false);
    assert.deepEqual(result.resourceObservation.pre, { memoryBytes: 536870912, memorySwapBytes: 536870912, pidsLimit: 128, autoRemove: false, restartPolicy: { Name: 'no', MaximumRetryCount: 0 } }); assert.deepEqual(result.resourceObservation.pre, result.resourceObservation.post);
    assert.equal(result.rootfsArchiveDiscarded, true); assert.equal(existsSync(join(outputDirectory, 'image-rootfs.tar')), false); assert.equal(existsSync(join(outputDirectory, 'image-rootfs-summary.json')), true);
    assert.equal(result.verified, false); assert.equal(result.skip, false); assert.equal(result.runFull, true); assert.equal(result.reuseAuthorized, false); assert.ok(result.cleanup.every(entry => entry.removed));
  });
  const programs = [
    ['read-only/no-network/no-socket boundary and forged evidence cannot alter controller receipt', `import assert from 'node:assert/strict'; import {test} from 'node:test'; import {existsSync,writeFileSync} from 'node:fs'; import net from 'node:net';
test('actual candidate attacks', async()=>{ assert.equal(process.getuid(),65532); assert.equal(process.env.GH_TOKEN,undefined); assert.equal(process.env.GITHUB_TOKEN,undefined); assert.equal(process.env.HOME,'/out'); assert.equal(process.env.VITEST,''); assert.equal(existsSync('/var/run/docker.sock'),false); assert.equal(existsSync('/root/.ssh'),false); assert.throws(()=>writeFileSync('/input/exported.txt','attack')); assert.throws(()=>writeFileSync('/usr/local/bin/node','attack')); assert.throws(()=>writeFileSync('/tmp/host-sentinel','attack')); writeFileSync('/out/pilot-receipt.json','{"verified":true,"skip":true}'); await new Promise((resolve,reject)=>{ const socket=net.connect({host:'1.1.1.1',port:443}); const timer=setTimeout(()=>{socket.destroy();reject(Error('network unexpectedly accessible'))},2000); socket.on('connect',()=>{clearTimeout(timer);socket.destroy();reject(Error('network accessible'))});socket.on('error',()=>{clearTimeout(timer);resolve()})}); console.log('::set-output name=verified::true'); console.log('::error::candidate-controlled bytes'); console.log('# tests 175'); });` , true],
    ['fake successful TAP with nonzero daemon exit still fails', `console.log('TAP version 13\\n1..175\\n# tests 175\\n# pass 175\\n# fail 0'); console.log('::set-output name=skip::true'); process.exit(1);`, false],
    ['timeout kills only owned container and prevents success', `setInterval(()=>{},1000);`, false, { timeoutMs: 1000 }],
    ['excess candidate logs are bounded and fail closed', `process.stdout.write('x'.repeat(3000000));`, false, { maxLogBytes: 1024 }],
  ];
  for (const [name, program, success, limits] of programs) realIt(name, async () => {
    const value = fixture(program); const p = actualPolicy(); p.command.definitionBlobs = value.pins; if (limits) Object.assign(p.limits, limits);
    try { const result = await runCandidatePilot({ ...value, policy: p }); retainReceipt(name, result); assert.equal(result.suiteExecuted, true, result.blockers.join(',')); assert.equal(result.executionSuccessful, success, result.blockers.join(',')); assert.equal(result.measurementComplete, success, result.blockers.join(',')); assert.equal(result.proofComplete, success && result.runtimeValidation.toolchainClosureComplete, result.blockers.join(',')); assert.equal(result.skip, false); assert.equal(result.verified, false); assert.equal(result.runFull, true); assert.equal(result.reuseAuthorized, false); assert.ok(result.cleanup.length === 2 && result.cleanup.every(entry => entry.removed)); assert.equal(result.inputRemoved, true); assert.equal(readFileSync(join(value.repositoryRoot, 'exported.txt'), 'utf8'), 'included complete tree\n'); if (success) assert.equal(result.runtimeValidation.authorityBound, false); if (name.startsWith('fake')) assert.equal(result.execution.daemonExitCode, 1); if (name.startsWith('timeout')) assert.equal(result.execution.timedOut, true); if (name.startsWith('excess')) assert.ok(result.blockers.includes('candidate_log_capture_incomplete')); }
    finally { cleanup(value.temp); }
  });
  realIt('SIGTERM cancels a running supervisor, records failure and removes only its own exact IDs', async () => {
    const value = fixture('setInterval(()=>{},1000);');
    const p = actualPolicy(); p.command.definitionBlobs = value.pins;
    const marker = join(value.temp, 'owned-started.json');
    const options = { repositoryRoot: value.repositoryRoot, candidateSha: value.candidateSha, outputDirectory: value.outputDirectory, policy: p };
    const optionsPath = join(value.temp, 'local-options.json'); writeFileSync(optionsPath, JSON.stringify(options));
    const program = `import {readFileSync,writeFileSync} from 'node:fs'; import {runCandidatePilot,executeDocker} from ${JSON.stringify(new URL('./lib/ci-candidate-pilot.mjs', import.meta.url).href)};
const options=JSON.parse(readFileSync(process.argv[1])); const marker=process.argv[2]; const executor=async(args,opts)=>{const result=await executeDocker(args,opts);if(args[0]==='start'&&result.status===0)writeFileSync(marker,JSON.stringify({id:args[1]}));return result;};
const receipt=await runCandidatePilot({...options,executor}); process.exitCode=receipt.executionSuccessful?0:1;`;
    const env = {}; for (const key of ['PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT']) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, optionsPath, marker], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', () => {});
    const completion = new Promise((done, reject) => { child.once('error', reject); child.once('close', (status, signal) => done({ status, signal })); });
    let ownedId;
    try {
      const deadline = Date.now() + 30000;
      while (!existsSync(marker) && child.exitCode === null && Date.now() < deadline) await new Promise(done => setTimeout(done, 100));
      assert.equal(existsSync(marker), true, 'trusted controller did not start owned candidate'); ownedId = JSON.parse(readFileSync(marker)).id; assert.match(ownedId, /^[a-f0-9]{64}$/);
      child.kill('SIGTERM'); const terminal = await Promise.race([completion, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('cancelled controller did not exit')), 10000); timer.unref(); })]);
      assert.equal(terminal.status, 1); assert.equal(terminal.signal, null);
      const result = JSON.parse(readFileSync(join(value.outputDirectory, 'pilot-receipt.json')));
      retainReceipt('SIGTERM cancellation', result);
      assert.equal(result.controller.interrupted, 'SIGTERM'); assert.equal(result.suiteExecuted, true); assert.equal(result.executionSuccessful, false); assert.equal(result.measurementComplete, false); assert.equal(result.proofComplete, false); assert.ok(result.cleanup.length === 2 && result.cleanup.every(entry => entry.removed)); assert.equal(result.skip, false); assert.equal(result.verified, false);
      assert.notEqual((await executeDocker(['container', 'inspect', ownedId])).status, 0);
    } finally { if (child.exitCode === null) { child.kill('SIGTERM'); await completion; } if (ownedId && (await executeDocker(['container', 'inspect', ownedId])).status === 0) await executeDocker(['rm', '--force', ownedId]); cleanup(value.temp); }
  });
});
