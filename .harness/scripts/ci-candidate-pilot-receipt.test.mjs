import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from './lib/ci-candidate-evidence.mjs';
import { gitTreeDigest } from './lib/ci-candidate-source.mjs';
import { normalizeDockerSnapshot } from './lib/ci-candidate-runtime.mjs';
import { createGitHubApi } from './lib/ci-candidate-github.mjs';
import { observeProtectedPilotReceipt, PILOT_RECEIPT_OBSERVER_PATH, readBoundedPilotZip, verifyPilotActualComponents, verifyProtectedPilotJournal } from './lib/ci-candidate-pilot-receipt.mjs';
import { runPilotReceiptObserver } from './ci-candidate-pilot-observer.mjs';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const blob = bytes => createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
const sha = digit => digit.repeat(40), id = digit => digit.repeat(64);
const t = text => `2026-10-05T${text}Z`;
const clone = value => structuredClone(value);
const sourcePath = '.github/workflows/harness-verify.yml';
const pilotPath = '.github/workflows/ci-candidate-runtime-pilot.yml';
const policyPath = '.harness/config/ci-candidate-pilot.json';

function zip(records, { compressed = false, descriptor = false } = {}) {
  const local = [], central = []; let offset = 0;
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
  for (const [name, value] of Array.isArray(records) ? records : Object.entries(records)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), data = compressed ? deflateRawSync(bytes) : bytes;
    const file = Buffer.from(name), flags = 0x800 | (descriptor ? 8 : 0), method = compressed ? 8 : 0, crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8); header.writeUInt16LE(file.length, 26);
    if (!descriptor) { header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(bytes.length, 22); }
    const trailer = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) { trailer.writeUInt32LE(0x08074b50); trailer.writeUInt32LE(crc, 4); trailer.writeUInt32LE(data.length, 8); trailer.writeUInt32LE(bytes.length, 12); }
    local.push(header, file, data, trailer);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(0x314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(flags, 8); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(file.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, file); offset += header.length + file.length + data.length + trailer.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function fixture({ imageIdType = 'config' } = {}) {
  const repository = { id: 1, full_name: 'boardx/workspacex', default_branch: 'main', private: false };
  const controllerSha = sha('1'), pilotControllerSha = sha('2'), baseSha = sha('3'), headSha = sha('4'), mergeSha = sha('5');
  const pins = [{ path: '.harness/scripts/ci-candidate-evidence.test.mjs', oid: blob('fixed Node test') }, { path: '.harness/scripts/lib/ci-candidate-evidence.mjs', oid: blob('fixed oracle') }];
  const policy = { schemaVersion: 1, mode: 'shadow', suite: 'ci-candidate-evidence-core', image: { reference: `docker.io/library/node@sha256:${id('a')}`, platform: 'linux/amd64', nodeBinary: '/usr/local/bin/node', configDigest: `sha256:${id('b')}`, rootfsLayers: [`sha256:${id('c')}`] }, command: { argv: ['/usr/local/bin/node', '--test', '/input/.harness/scripts/ci-candidate-evidence.test.mjs'], expectedTests: 175, definitionBlobs: pins }, limits: { timeoutMs: 120000, maxLogBytes: 2000000, memoryBytes: 536870912, pidsLimit: 128, maxSourceBytes: 2147483648, maxSourceFileBytes: 33554432 }, isolation: { uid: 65532, gid: 65532 } };
  const config = { identityPaths: ['package.json', 'pnpm-lock.yaml'], suites: [{ id: 'fullstack-smoke', owner: { workflow: sourcePath, job: 'fullstack-smoke' }, eligibleSourceEvents: ['pull_request', 'merge_group'], execution: { actualStepNames: ['Execute trusted full-stack smoke', 'Execute trace disclosure geometry'], actualStepNamePatterns: [], artifactNamePatterns: ['^phase-01-fullstack-smoke-evidence-[0-9]+$'] } }] };
  const contents = { [policyPath]: JSON.stringify(policy), '.harness/config/ci-suite-ownership.json': JSON.stringify(config), [pilotPath]: 'protected main controller', [sourcePath]: 'protected source workflow', [PILOT_RECEIPT_OBSERVER_PATH]: 'protected receipt observer', '.github/actions/ci-candidate-identity/action.yml': 'protected checkout recorder', [pins[0].path]: 'fixed Node test', [pins[1].path]: 'fixed oracle', 'package.json': '{"private":true}', 'pnpm-lock.yaml': 'lockfileVersion: 9', 'apps/product.mjs': 'actual candidate source' };
  const entries = Object.entries(contents).map(([path, text]) => ({ path, oid: blob(text), mode: '100644' })).sort((a, b) => a.path < b.path ? -1 : 1), tree = gitTreeDigest(entries);
  const objects = new Map([controllerSha, pilotControllerSha, baseSha, headSha, mergeSha].map(value => [value, { sha: value, tree, parents: value === mergeSha ? [baseSha, headSha] : [baseSha], entries: clone(entries) }]));
  const repo = { id: 1, full_name: repository.full_name };
  const run = (runId, workflowId, path, head, event, started, completed) => ({ id: runId, run_attempt: 1, workflow_id: workflowId, path, head_sha: head, head_branch: event === 'pull_request' ? 'candidate' : 'main', event, status: 'completed', conclusion: 'success', repository: repo, head_repository: repo, run_started_at: started, updated_at: completed, created_at: started, pull_requests: [] });
  const pilotRun = run(20, 200, pilotPath, pilotControllerSha, 'workflow_dispatch', t('10:00:00'), t('10:01:10'));
  const observerRun = { ...run(30, 300, PILOT_RECEIPT_OBSERVER_PATH, controllerSha, 'workflow_run', t('10:02:00'), t('10:02:00')), status: 'in_progress', conclusion: null };
  const originalRun = run(10, 100, sourcePath, headSha, 'pull_request', t('09:00:00'), t('09:10:00'));
  originalRun.pull_requests = [{ number: 7, base: { sha: baseSha }, head: { sha: headSha } }];
  const step = (name, number, start, end) => ({ name, number, status: 'completed', conclusion: 'success', started_at: start, completed_at: end });
  const pilotJob = { id: 21, run_id: 20, name: 'protected-pilot', status: 'completed', conclusion: 'success', started_at: t('10:00:01'), completed_at: t('10:01:09'), runner_id: 222, runner_group_id: 0, runner_name: 'GitHub Actions 2', labels: ['ubuntu-latest'], steps: [step('Set up job', 1, t('10:00:01'), t('10:00:02')), step('Checkout protected supervisor', 2, t('10:00:02'), t('10:00:04')), step('Set up controller Node', 3, t('10:00:04'), t('10:00:06')), step('Pull fixed isolated Node image', 4, t('10:00:06'), t('10:00:09')), step('Start trusted runtime supervisor', 5, t('10:00:10'), t('10:01:00')), step('Retain isolated pilot receipt', 6, t('10:01:01'), t('10:01:08'))] };
  const originalJob = { id: 11, run_id: 10, name: 'fullstack-smoke', status: 'completed', conclusion: 'success', started_at: t('09:00:00'), completed_at: t('09:09:00'), runner_id: 111, runner_group_id: 0, labels: ['ubuntu-latest'], steps: [step('Set up job', 1, t('09:00:00'), t('09:00:01')), step('Checkout', 2, t('09:00:01'), t('09:00:02')), step('Record candidate checkout and runtime identity', 3, t('09:00:03'), t('09:00:07')), step('Execute trusted full-stack smoke', 4, t('09:00:08'), t('09:08:00')), step('Execute trace disclosure geometry', 5, t('09:08:00'), t('09:09:00'))] };
  const identity = { schemaVersion: 1, sha: mergeSha, tree, parents: [baseSha, headSha], workflowRef: `${repository.full_name}/${sourcePath}@refs/pull/7/merge`, workflowSha: mergeSha, toolchain: { node: 'v22.1.0', pnpm: 'unavailable', python: '3.12.0', docker: '28.0.0' }, environment: { platform: 'linux', arch: 'x64', imageOS: 'ubuntu24', imageVersion: '20261005.1', runnerEnvironment: 'github-hosted', runnerOS: 'Linux' }, candidate: { prNumber: 7, baseSha, headSha } };
  const originalLogs = `${t('09:00:05')} CI_CANDIDATE_IDENTITY_V1:${Buffer.from(JSON.stringify(identity)).toString('base64')}\n`;
  const candidate = { sourceRunId: 10, sourceRunAttempt: 1, workflowId: 100, workflowPath: sourcePath, event: 'pull_request', prNumber: 7, baseSha, headSha, mergeSha, fullTree: tree, parents: [baseSha, headSha] };
  const definitionBlob = entries.find(entry => entry.path === pilotPath).oid;
  const controller = { sha: pilotControllerSha, tree, parents: [baseSha], workflowDefinitionBlob: definitionBlob };
  const authority = { source: 'protected-pilot-bootstrap', apiBootstrapVerified: true, apiVerified: false, protectedVerified: false, definitionTrusted: true, repositoryId: 1, workflowId: 200, path: pilotPath, ref: 'refs/heads/main', event: 'workflow_dispatch', headSha: pilotControllerSha, workflowSha: pilotControllerSha, checkoutSha: pilotControllerSha, controllerTree: tree, definitionBlob, runId: 20, runAttempt: 1, jobId: 21, jobName: 'protected-pilot', jobStartedAt: pilotJob.started_at, runnerId: 222, runnerGroupId: 0, runnerName: pilotJob.runner_name, runnerEnvironment: 'github-hosted', sourceRunId: 10, supervisorStep: { name: 'Start trusted runtime supervisor', number: 5, startedAt: t('10:00:10') }, observedAt: t('10:00:20') };
  const bootstrap = { schemaVersion: 1, protectedVerified: false, apiVerified: false, authority, controller, candidate, policyFingerprint: fingerprint(policy) };
  const files = entries.map(entry => ({ path: entry.path, fsMode: 0o444, size: Buffer.byteLength(contents[entry.path]), digest: digest(contents[entry.path]), type: 'file', gitMode: entry.mode, oid: entry.oid }));
  const dirNames = new Set(['.']); for (const entry of entries) { const parts = entry.path.split('/'); for (let i = 1; i < parts.length; i++) dirNames.add(parts.slice(0, i).join('/')); }
  const directories = [...dirNames].sort().map(path => ({ path, fsMode: 0o555, type: 'directory' }));
  const materialized = entries.map(entry => { const file = files.find(item => item.path === entry.path); return { ...entry, size: file.size, sha256: file.digest }; });
  const sourceProbe = { schemaVersion: 1, kind: 'source-metadata-probe', verified: false, eligible: false, complete: true, source: { sha: mergeSha, tree, collection: 'materialized-git-export', indexDigest: null, entriesDigest: fingerprint(entries), files, directories, materializedDigest: fingerprint({ files, directories }) }, dependencies: { profile: 'protected-no-install', roots: [], count: 0, bytes: 0, digest: fingerprint({ files: [], directories: [] }), files: [], directories: [] }, inventory: { kind: 'actual-test-inventory', suite: policy.suite, count: 1, tests: [{ file: pins[0].path, project: 'node:test-whole-file', id: 'protected-fixed-entrypoint' }], verified: false } };
  sourceProbe.inventory.digest = fingerprint(sourceProbe.inventory.tests);
  const imageId = imageIdType === 'manifest' ? policy.image.reference.split('@')[1] : policy.image.configDigest;
  const image = { reference: policy.image.reference, imageId, platform: policy.image.platform, rootfsLayers: policy.image.rootfsLayers };
  const rootfs = ['/usr/local/bin/node', '/lib/ld-linux.so.2', '/lib/libc.so.6'].map((path, i) => ({ path, type: 'regular', mode: i < 2 ? '0755' : '0644', sizeInBytes: 3, sha256: digest(`tool-${i}`) })).sort((a, b) => a.path < b.path ? -1 : 1);
  const tools = rootfs.map(({ type, ...tool }) => ({ ...tool, fileType: 'regular' }));
  const toolchainClosure = { source: 'immutable-image-rootfs', independentlyRead: true, imageId, rootfsLayers: policy.image.rootfsLayers, entries: tools, rootfsClosure: { source: 'docker-cp-stopped-image-container', containerId: id('8'), imageId, rootfsLayers: policy.image.rootfsLayers, archiveDigest: digest('rootfs measured bytes'), entryInventoryFingerprint: fingerprint(rootfs), byteCount: 4096, entryCount: rootfs.length, complete: true, imageContainer: { id: id('8'), imageId, status: 'created', running: false, started: false, readonlyRootfs: true, mounts: [] } } };
  const mount = { source: '/runner/trusted-receipt/execution/input', destination: '/input', treeFingerprint: fingerprint(materialized) };
  const env = ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=22.1.0', 'YARN_VERSION=1.22.0', 'HOME=/out', 'TMPDIR=/out', 'CI=true', 'VITEST='];
  const tmpfs = { destination: '/out', options: 'rw,nosuid,nodev,noexec,size=64m,uid=65532,gid=65532,mode=0700' };
  const runtimePolicy = { profile: 'closed-node-no-install-v1', image: { ref: policy.image.reference, id: imageId, os: 'linux', architecture: 'amd64', rootfsLayers: policy.image.rootfsLayers }, container: { user: '65532:65532', workingDir: '/input', entrypoint: [policy.command.argv[0]], cmd: policy.command.argv.slice(1), env, mounts: [mount], outputTmpfs: tmpfs }, tools: tools.map(({ path, sha256, mode }) => ({ path, sha256, mode })) };
  const rawImage = { Id: imageId, RepoDigests: [policy.image.reference], Os: 'linux', Architecture: 'amd64', RootFS: { Type: 'layers', Layers: policy.image.rootfsLayers } };
  const info = { ID: 'actual-docker-daemon', OSType: 'linux', Architecture: 'x86_64', ServerVersion: '28.5.0', KernelVersion: '6.8', SecurityOptions: ['name=seccomp,profile=builtin'] };
  const container = { Id: id('7'), Image: imageId, Created: t('10:00:24'), RestartCount: 0, State: { Status: 'created', Running: false, Pid: 0, StartedAt: '0001-01-01T00:00:00Z', FinishedAt: '0001-01-01T00:00:00Z', ExitCode: 0, OOMKilled: false, Error: '' }, Config: { User: '65532:65532', Env: env, WorkingDir: '/input', Entrypoint: runtimePolicy.container.entrypoint, Cmd: runtimePolicy.container.cmd, Volumes: null }, HostConfig: { Privileged: false, ReadonlyRootfs: true, NetworkMode: 'none', IpcMode: 'private', PidMode: '', UTSMode: '', UsernsMode: '', CgroupnsMode: 'private', CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Devices: [], DeviceRequests: null, VolumesFrom: null, Links: null, PortBindings: {}, ExtraHosts: null, GroupAdd: null, PublishAllPorts: false, Runtime: 'runc', Binds: null, Mounts: [{ Type: 'bind', Source: mount.source, Target: '/input', ReadOnly: true, BindOptions: { Propagation: 'rprivate', NonRecursive: true } }], Tmpfs: { '/out': tmpfs.options }, RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } }, Mounts: [{ Type: 'bind', Source: mount.source, Destination: '/input', RW: false, Propagation: 'rprivate' }] };
  const pre = normalizeDockerSnapshot({ info, container, image: rawImage, collectedAt: t('10:00:25') });
  const terminal = clone(container); terminal.State = { ...terminal.State, Status: 'exited', StartedAt: t('10:00:30'), FinishedAt: t('10:00:35') };
  const post = normalizeDockerSnapshot({ info, container: terminal, image: rawImage, collectedAt: t('10:00:40') });
  const logs = { stdout: Buffer.from('# tests 175\n# pass 175\n'), stderr: Buffer.alloc(0) };
  const resources = { memoryBytes: 536870912, memorySwapBytes: 536870912, pidsLimit: 128, autoRemove: false, restartPolicy: { Name: 'no', MaximumRetryCount: 0 } };
  const receipt = { schemaVersion: 1, profile: 'closed-node-no-install-v1', scope: 'local-unprotected', protectedVerified: false, verified: false, runFull: true, skip: false, reuseAuthorized: false, suite: policy.suite, policyFingerprint: fingerprint(policy), controller: { startedAt: t('10:00:21'), completedAt: t('10:00:42'), nonce: 'fixed-controller-fixture', candidateCodeExecutedOnHost: false }, suiteExecuted: true, executionSuccessful: true, measurementComplete: true, proofComplete: true, blockers: ['protected_supervisor_authority_not_supplied'], gitInput: { sha: mergeSha, tree, parents: [baseSha, headSha], entriesFingerprint: fingerprint(entries), materializedFingerprint: fingerprint(materialized), fileCount: entries.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0), definitionBlobs: pins }, sourceProbe, image, toolchainClosure, preExecutionSnapshot: pre, postExecutionSnapshot: post, runtimePolicy, resourceObservation: { pre: resources, post: clone(resources) }, execution: { startedAt: t('10:00:29'), finishedAt: t('10:00:41'), actualArgv: policy.command.argv, timedOut: false, daemonExitCode: 0, oomKilled: false, daemonError: '', daemonStartedAt: t('10:00:30'), daemonFinishedAt: t('10:00:35'), status: 'exited', diagnostic: { untrustedCandidateOutput: true, expectedTests: 175, reportedTests: 175 } }, outputDigests: { stdout: { digest: digest(logs.stdout), bytes: logs.stdout.length }, stderr: { digest: digest(logs.stderr), bytes: 0 }, candidateControlled: true }, cleanup: [{ id: id('7'), removed: true }, { id: id('8'), removed: true }], inputRemoved: true, rootfsArchiveDiscarded: true };
  const report = { schemaVersion: 1, mode: 'shadow-manual-pilot', skip: false, runFull: true, apiVerified: false, protectedVerified: false, pilotStarted: true, pilotCompleted: true, reasons: [], bootstrap: { schemaVersion: 1, bootstrapVerified: true, apiVerified: false, protectedVerified: false, runFull: true, skip: false, reasons: [], authority, repository: { id: 1, fullName: repository.full_name, defaultBranch: 'main', public: true } }, candidate, controller, policyFingerprint: fingerprint(policy), pilot: receipt };
  const pull = { number: 7, state: 'open', merged: false, mergeable: true, merge_commit_sha: mergeSha, updated_at: t('09:00:00'), base: { sha: baseSha, ref: 'main', repo }, head: { sha: headSha, repo } };
  const originalArtifact = { id: 12, name: 'phase-01-fullstack-smoke-evidence-10', size_in_bytes: 100, expired: false, digest: digest('original artifact'), created_at: t('09:09:10'), updated_at: t('09:09:15'), workflow_run: { id: 10, head_sha: headSha } };
  const artifact = { id: 22, name: 'ci-candidate-runtime-pilot-20-1', size_in_bytes: 0, expired: false, digest: '', created_at: t('10:01:02'), updated_at: t('10:01:03'), workflow_run: { id: 20, repository_id: 1, head_repository_id: 1, head_branch: 'main', head_sha: pilotControllerSha } };
  const value = { repository, policy, config, contents, entries, objects, pilotRun, observerRun, originalRun, pilotJob, originalJob, identity, originalLogs, candidate, bootstrap, receipt, report, rootfs, logs, pull, artifact, originalArtifact, history: [originalRun], requests: [], counts: new Map(), hook: null };
  value.repack = options => {
    delete receipt.receiptFingerprint; receipt.receiptFingerprint = fingerprint(receipt);
    const records = { 'protected-bootstrap.json': JSON.stringify(bootstrap), 'pilot-supervisor-report.json': JSON.stringify(report), 'execution/pilot-receipt.json': JSON.stringify(receipt), 'execution/image-rootfs-inventory.json': JSON.stringify(rootfs), 'execution/image-rootfs-summary.json': JSON.stringify({ schemaVersion: 1, image: receipt.image, toolBytes: receipt.toolchainClosure }), 'execution/candidate.stdout': logs.stdout, 'execution/candidate.stderr': logs.stderr };
    value.records = records; value.archive = zip(records, options); artifact.size_in_bytes = value.archive.length; artifact.digest = digest(value.archive);
  };
  value.repack();
  value.api = async (path, options = {}) => {
    value.requests.push({ path, options }); const nth = (value.counts.get(path) ?? 0) + 1; value.counts.set(path, nth);
    if (value.hook) { const override = await value.hook(path, options, nth); if (override !== undefined) return override; }
    if (path === '') return clone(repository);
    if (path === '/actions/runs/20' || path === '/actions/runs/20/attempts/1') return clone(pilotRun);
    if (path === '/actions/runs/30') return clone(observerRun);
    if (path === '/actions/runs/10' || path === '/actions/runs/10/attempts/1') return clone(originalRun);
    if (/^\/actions\/workflows\/(100|200|300)$/.test(path)) { const workflowId = Number(path.split('/').at(-1)); return { id: workflowId, path: workflowId === 100 ? sourcePath : workflowId === 200 ? pilotPath : PILOT_RECEIPT_OBSERVER_PATH, state: 'active' }; }
    if (path.startsWith('/actions/workflows/100/runs?')) return { total_count: value.history.length, workflow_runs: clone(value.history) };
    if (path.startsWith('/actions/runs/20/attempts/1/jobs?')) return { total_count: 1, jobs: [clone(pilotJob)] };
    if (path.startsWith('/actions/runs/10/attempts/1/jobs?')) return { total_count: 1, jobs: [clone(originalJob)] };
    if (path.startsWith('/actions/runs/20/artifacts?')) return { total_count: 1, artifacts: [clone(artifact)] };
    if (path.startsWith('/actions/runs/10/artifacts?')) return { total_count: 1, artifacts: [clone(originalArtifact)] };
    if (path === '/actions/artifacts/22/zip') { assert.equal(options.binary, true); return Buffer.from(value.archive); }
    if (path === '/actions/jobs/11/logs') { assert.equal(options.raw, true); return value.originalLogs; }
    if (path === '/pulls/7') return clone(pull);
    if (path.startsWith('/git/commits/')) { const object = objects.get(path.split('/').at(-1)); assert.ok(object, path); return { sha: object.sha, tree: { sha: object.tree }, parents: object.parents.map(sha => ({ sha })) }; }
    if (path.startsWith('/git/trees/')) { const object = [...objects.values()].find(object => path === `/git/trees/${object.tree}?recursive=1`); assert.ok(object, path); return { sha: object.tree, truncated: false, tree: object.entries.map(entry => ({ path: entry.path, mode: entry.mode, sha: entry.oid, type: 'blob' })) }; }
    if (path.startsWith('/git/blobs/')) { const oid = path.split('/').at(-1), text = Object.values(contents).find(text => blob(text) === oid); assert.ok(text, path); return { sha: oid, size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(text).toString('base64') }; }
    throw new Error(`Unexpected fixture API ${path}`);
  };
  value.options = { api: value.api, repositoryName: repository.full_name, sourceRunId: 20, observerRunId: 30, observerRunAttempt: 1, actualCheckout: { sha: controllerSha, tree, parents: [baseSha] }, expectedObserverSha: controllerSha, observerRef: 'refs/heads/main', observerEvent: 'workflow_run', policy, now: Date.parse(t('10:03:00')) };
  return value;
}
const observe = value => observeProtectedPilotReceipt(value.options);
const closed = result => { assert.equal(result.scopedProtectedReceiptVerified, false); assert.equal(result.skip, false); assert.equal(result.runFull, true); assert.equal(result.reuseAuthorized, false); assert.ok(result.reasons.length > 0); };

test('completed protected API execution + independently hashed archive + actual component bindings succeed in scoped shadow only', async () => {
  const value = fixture(), result = await observe(value);
  assert.equal(result.scopedProtectedReceiptVerified, true, JSON.stringify(result.reasons));
  assert.equal(result.stableDuringRead, true); assert.equal(result.apiVerified, true); assert.equal(result.protectedVerified, false); assert.equal(result.skip, false); assert.equal(result.runFull, true); assert.equal(result.reuseAuthorized, false);
  assert.equal(result.components.runtimeValidation.toolchainClosureComplete, true);
  assert.equal(result.components.runtimeValidation.authorityBound, false, 'single API step does not impersonate old two-step authority');
  assert.equal(result.journal.profile, 'single-protected-supervisor-step-v1');
  assert.equal(value.requests.filter(item => item.path === '/actions/runs/20').length, 2);
});
test('Docker 29 manifest image ID and Docker 28 config image ID both bind to protected independent OCI pins', async () => {
  const value = fixture({ imageIdType: 'manifest' }); assert.equal((await observe(value)).scopedProtectedReceiptVerified, true);
});
test('real GitHub API binary transport uses signed redirect without token and reader accepts exact bytes', async () => {
  const value = fixture(), requests = [];
  const api = createGitHubApi({ repository: value.repository.full_name, token: 'observer-secret', fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url) === 'https://signed-storage.example.invalid/receipt') return new Response(value.archive);
    const path = String(url).replace(`https://api.github.com/repos/${value.repository.full_name}`, '');
    if (path === '/actions/artifacts/22/zip') return new Response(null, { status: 302, headers: { location: 'https://signed-storage.example.invalid/receipt' } });
    if (path === '/actions/jobs/11/logs') return new Response(value.originalLogs);
    return Response.json(await value.api(path));
  } });
  const result = await observeProtectedPilotReceipt({ ...value.options, api });
  assert.equal(result.scopedProtectedReceiptVerified, true, JSON.stringify(result.reasons));
  const signed = requests.find(item => item.url.startsWith('https://signed-storage'));
  assert.equal(signed.options.headers, undefined); assert.equal(signed.options.redirect, 'error');
});
for (const [name, change] of [
  ['wrong default branch', v => { v.repository.default_branch = 'other'; }],
  ['foreign source repo', v => { v.pilotRun.head_repository = { id: 999, full_name: 'attacker/repo' }; }],
  ['PR controlled source event', v => { v.pilotRun.event = 'pull_request'; }],
  ['wrong source workflow', v => { v.pilotRun.path = sourcePath; }],
  ['source branch', v => { v.pilotRun.head_branch = 'untrusted'; }],
  ['failed source', v => { v.pilotRun.conclusion = 'failure'; }],
  ['unfinished source', v => { v.pilotRun.status = 'in_progress'; v.pilotRun.conclusion = null; }],
  ['self-hosted runner', v => { v.pilotJob.labels.push('self-hosted'); }],
  ['missing runner ID', v => { delete v.pilotJob.runner_id; }],
  ['ambiguous step', v => { v.pilotJob.steps.push(clone(v.pilotJob.steps[4])); }],
  ['unfinished supervisor step', v => { v.pilotJob.steps[4].status = 'in_progress'; v.pilotJob.steps[4].conclusion = null; }],
  ['candidate pre-supervisor command', v => { v.pilotJob.steps[3].name = 'Run candidate preinstall'; }],
  ['wrong artifact source head', v => { v.artifact.workflow_run.head_sha = sha('f'); }],
  ['wrong artifact source ID', v => { v.artifact.workflow_run.id = 99; }],
  ['expired artifact', v => { v.artifact.expired = true; }],
  ['artifact outside upload window', v => { v.artifact.created_at = t('09:00:00'); }],
  ['missing artifact digest', v => { delete v.artifact.digest; }],
  ['archive digest mismatch', v => { v.artifact.digest = digest('other'); }],
  ['archive size mismatch', v => { v.artifact.size_in_bytes++; }],
  ['wrong observer Git HEAD', v => { v.options.actualCheckout.sha = sha('f'); }],
  ['wrong observer attempt', v => { v.options.observerRunAttempt = 2; }],
  ['non-main observer', v => { v.options.observerRef = 'refs/heads/topic'; }],
  ['unapproved observer mode/event', v => { v.options.observerEvent = 'pull_request'; }],
  ['new PR head', v => { v.pull.head.sha = sha('f'); }],
  ['new PR base', v => { v.pull.base.sha = sha('f'); }],
  ['unknown mergeability', v => { v.pull.mergeable = null; }],
  ['conflict', v => { v.pull.mergeable = false; }],
  ['missing original marker', v => { v.originalLogs = ''; }],
  ['original source attempt changed', v => { v.originalRun.run_attempt = 2; }],
]) test(`falls back on ${name}`, async () => { const value = fixture(); change(value); closed(await observe(value)); });

for (const [name, change] of [
  ['self-reported final authority', v => { v.receipt.verified = true; }],
  ['fake bootstrap authority', v => { v.bootstrap.authority.apiVerified = true; }],
  ['wrong controller SHA', v => { v.bootstrap.controller.sha = sha('f'); }],
  ['wrong bootstrap actual runner', v => { v.bootstrap.authority.runnerId = 999; }],
  ['wrong bootstrap attempt', v => { v.bootstrap.authority.runAttempt = 2; }],
  ['policy fingerprint spoof', v => { v.bootstrap.policyFingerprint = digest('fake'); }],
  ['source tree spoof', v => { v.receipt.gitInput.tree = sha('f'); }],
  ['actual source file digest changed', v => { v.receipt.sourceProbe.source.files[0].digest = digest('different'); }],
  ['source input omitted', v => { v.receipt.sourceProbe.source.files.pop(); }],
  ['dependency inventory installed', v => { v.receipt.sourceProbe.dependencies.count = 1; }],
  ['test entrypoint broadened', v => { v.receipt.sourceProbe.inventory.tests[0].file = 'apps/attacker.mjs'; }],
  ['wrong OCI image', v => { v.receipt.image.imageId = digest('unrelated image'); }],
  ['wrong rootfs bytes', v => { v.rootfs[0].sha256 = digest('changed'); }],
  ['unmeasured host toolchain', v => { v.receipt.toolchainClosure.source = 'candidate-json'; }],
  ['missing native emulator bytes', v => { v.receipt.preExecutionSnapshot.daemon.architecture = 'aarch64'; }],
  ['resource missing', v => { delete v.receipt.resourceObservation; }],
  ['resource smaller than fixed policy', v => { v.receipt.resourceObservation.pre.memoryBytes = 1024; }],
  ['resource post execution changed', v => { v.receipt.resourceObservation.post.pidsLimit = 999; }],
  ['candidate executed on host', v => { v.receipt.controller.candidateCodeExecutedOnHost = true; }],
  ['candidate invocation changed', v => { v.receipt.execution.actualArgv = ['node', 'attacker.mjs']; }],
  ['controller starts outside API step', v => { v.receipt.controller.startedAt = t('09:59:59'); }],
  ['post capture before execution', v => { v.receipt.postExecutionSnapshot.collectedAt = t('10:00:29'); }],
  ['candidate failed', v => { v.receipt.execution.daemonExitCode = 1; }],
  ['candidate timed out', v => { v.receipt.execution.timedOut = true; }],
  ['raw candidate log digest mismatched', v => { v.logs.stdout = Buffer.from('attacker altered log'); }],
  ['cleanup missing', v => { v.receipt.cleanup[0].removed = false; }],
]) test(`authenticated archive still falls back on ${name}`, async () => { const value = fixture(); change(value); value.repack(); closed(await observe(value)); });

test('candidate stdout cannot confer authority even when it contains a convincing forged supervisor JSON', async () => {
  const value = fixture(); value.logs.stdout = Buffer.from(JSON.stringify({ protectedVerified: true, apiVerified: true, skip: true, daemonExitCode: 0 }));
  value.receipt.outputDigests.stdout = { digest: digest(value.logs.stdout), bytes: value.logs.stdout.length }; value.repack();
  assert.equal((await observe(value)).scopedProtectedReceiptVerified, true, 'actual source/command/exit evidence alone proves the scoped suite; stdout claims are ignored');
});
test('source workflow/controller definition mismatch falls back before downloading a JSON', async () => {
  const value = fixture(), object = value.objects.get(value.pilotRun.head_sha);
  object.entries.find(entry => entry.path === pilotPath).oid = blob('attacker controller'); object.tree = gitTreeDigest(object.entries);
  const result = await observe(value); closed(result); assert.ok(result.reasons.includes('pilot_source_observer_controller_closure_changed')); assert.equal(value.requests.some(item => item.options.binary), false);
});
test('missing artifact is a fallback', async () => {
  const value = fixture(); value.hook = path => path.startsWith('/actions/runs/20/artifacts?') ? { total_count: 0, artifacts: [] } : undefined; closed(await observe(value));
});
test('API 403 is a fallback without reading candidate bytes', async () => {
  const value = fixture(); value.hook = path => { if (path === '/actions/runs/20') { const error = new Error('denied'); error.reason = 'github_api_http_403'; throw error; } };
  const result = await observe(value); closed(result); assert.deepEqual(result.reasons, ['github_api_http_403']); assert.equal(value.requests.some(item => item.options.binary), false);
});
test('completed producer can start a later attempt while archive/component measurement is underway: rejected', async () => {
  const value = fixture(); value.hook = (path, options, nth) => path === '/actions/runs/20' && nth === 2 ? { ...clone(value.pilotRun), run_attempt: 2, status: 'in_progress', conclusion: null } : undefined;
  closed(await observe(value));
});
test('producer job identity changes on final fresh read: rejected', async () => {
  const value = fixture(); value.hook = (path, options, nth) => path.startsWith('/actions/runs/20/attempts/1/jobs?') && nth === 2 ? { total_count: 1, jobs: [{ ...clone(value.pilotJob), runner_id: 999 }] } : undefined;
  closed(await observe(value));
});
test('artifact replacement after measurement: rejected', async () => {
  const value = fixture(); value.hook = (path, options, nth) => path.startsWith('/actions/runs/20/artifacts?') && nth === 2 ? { total_count: 1, artifacts: [{ ...clone(value.artifact), digest: digest('replaced') }] } : undefined;
  closed(await observe(value));
});
test('old-created run with a newer failed rerun is not hidden by an age/head API filter', async () => {
  const value = fixture(), failure = { ...clone(value.originalRun), id: 9, run_attempt: 2, created_at: '2026-09-01T00:00:00Z', run_started_at: t('10:02:00'), updated_at: t('10:02:30'), conclusion: 'failure' };
  value.history.push(failure); value.hook = path => path === '/actions/runs/9/attempts/2' ? clone(failure) : undefined;
  closed(await observe(value)); assert.ok(value.requests.filter(item => item.path.includes('/workflows/100/runs?')).every(item => !item.path.includes('created') && !item.path.includes('head_sha')));
});
test('history pagination incomplete/shift is never a stable receipt', async () => {
  const value = fixture(); value.hook = path => path.startsWith('/actions/workflows/100/runs?') ? { total_count: 2, workflow_runs: [clone(value.originalRun)] } : undefined; closed(await observe(value));
});
test('oversized advertised complete history budget is a fallback, not a truncation to older green', async () => {
  const value = fixture(); value.hook = path => path.startsWith('/actions/workflows/100/runs?') ? { total_count: 201, workflow_runs: Array.from({ length: 201 }, (_, index) => ({ ...clone(value.originalRun), id: index + 1 })) } : undefined;
  const result = await observe(value); closed(result); assert.ok(result.reasons.includes('pilot_original_history_incomplete'));
});
test('original PR base changes during final measurement and cannot retain an earlier scoped success', async () => {
  const value = fixture(); let changed = false;
  value.hook = (path, options, nth) => { if (path === '/actions/runs/10' && nth > 5) changed = true; if (path === '/pulls/7' && changed) return { ...clone(value.pull), base: { ...value.pull.base, sha: sha('f') } }; };
  closed(await observe(value));
});
test('a future post-read race remains explicit and is not a skip lease', async () => {
  const result = await observe(fixture()); assert.equal(result.scopedProtectedReceiptVerified, true); assert.match(result.residualRace, /not an atomic lease/); assert.equal(result.skipAuthorization, false);
});
test('invalid observer clock/zero source ID always return a fallback', async () => {
  for (const now of [NaN, Infinity]) closed(await observeProtectedPilotReceipt({ ...fixture().options, now }));
  closed(await observeProtectedPilotReceipt({ ...fixture().options, sourceRunId: 0 }));
});

test('bounded ZIP reads ordinary stored, deflated and streaming data-descriptor archives without extracting anything', () => {
  const value = fixture();
  for (const options of [{}, { compressed: true }, { compressed: true, descriptor: true }]) assert.ok(readBoundedPilotZip(zip(value.records, options)).files.get('execution/pilot-receipt.json').length > 0);
});
for (const [name, build] of [
  ['path traversal', v => zip({ ...v.records, '../run.sh': 'do not execute' })],
  ['arbitrary JSON member', v => zip({ ...v.records, 'candidate-authority.json': '{}' })],
  ['large tar member', v => zip({ ...v.records, 'execution/image-rootfs.tar': 'tar' })],
  ['missing required JSON', v => { const records = { ...v.records }; delete records['protected-bootstrap.json']; return zip(records); }],
  ['truncated central directory', v => v.archive.subarray(0, v.archive.length - 5)],
  ['CRC corruption', v => { const bytes = Buffer.from(v.archive); bytes[60] ^= 1; return bytes; }],
  ['encrypted member', v => { const bytes = Buffer.from(v.archive); bytes.writeUInt16LE(0x801, 6); return bytes; }],
  ['oversized inflation', v => zip({ ...v.records, 'execution/candidate.stdout': Buffer.alloc(2_000_001) }, { compressed: true })],
  ['duplicate exact filename', v => zip([...Object.entries(v.records), ['protected-bootstrap.json', '{}']])],
  ['ZIP64 version', v => { const bytes = Buffer.from(v.archive); bytes.writeUInt16LE(45, 4); return bytes; }],
  ['symlink entry', v => { const bytes = Buffer.from(v.archive), at = bytes.readUInt32LE(bytes.length - 6); bytes.writeUInt32LE((0o120777 << 16) >>> 0, at + 38); return bytes; }],
]) test(`bounded ZIP rejects ${name}`, () => assert.throws(() => readBoundedPilotZip(build(fixture()))));
test('malformed JSON is data and returns a read fallback', async () => {
  const value = fixture(); value.records['protected-bootstrap.json'] = '{malicious'; value.archive = zip(value.records); value.artifact.size_in_bytes = value.archive.length; value.artifact.digest = digest(value.archive); closed(await observe(value));
});
test('journal cannot invent a second candidate API step to upgrade the old runtime oracle', () => {
  const value = fixture(); const result = verifyProtectedPilotJournal({ receipt: value.receipt, bootstrap: value.bootstrap, report: value.report, sourceRun: value.pilotRun, sourceJob: value.pilotJob, sourceObject: value.objects.get(value.pilotRun.head_sha), policy: value.policy });
  assert.equal(result.journalVerified, true); assert.equal(result.profile, 'single-protected-supervisor-step-v1'); assert.equal(result.reuseAuthorized, false);
});
test('component-only diagnostic proves comparisons while supplied local receipt/objects confer no protected/API authority', () => {
  const value = fixture();
  const result = verifyPilotActualComponents({ receipt: value.receipt, archiveFiles: readBoundedPilotZip(value.archive).files, candidate: value.candidate, gitObject: value.objects.get(value.candidate.mergeSha), policy: value.policy });
  assert.equal(result.componentBindingsVerified, true, JSON.stringify(result.reasons)); assert.equal(result.apiVerified, false); assert.equal(result.protectedVerified, false); assert.equal(result.scopedProtectedReceiptVerified, false); assert.equal(result.reuseAuthorized, false);
});
test('normalized tracked symlink to an in-root directory supports actual macOS 0755 mode without permitting escaping targets', () => {
  const value = fixture(), raw = '../../.harness';
  value.entries.push({ path: '.claude/skills/evidence', oid: blob(raw), mode: '120000' }); value.entries.sort((a, b) => a.path < b.path ? -1 : 1);
  const object = { sha: value.candidate.mergeSha, tree: gitTreeDigest(value.entries), parents: value.candidate.parents, entries: value.entries };
  value.candidate.fullTree = object.tree;
  const source = value.receipt.sourceProbe.source;
  source.files.push({ path: '.claude/skills/evidence', fsMode: 0o755, size: Buffer.byteLength(raw), digest: digest(raw), type: 'symlink', target: '.harness', gitMode: '120000', oid: blob(raw) }); source.files.sort((a, b) => a.path < b.path ? -1 : 1);
  source.directories.push({ path: '.claude', fsMode: 0o555, type: 'directory' }, { path: '.claude/skills', fsMode: 0o555, type: 'directory' }); source.directories.sort((a, b) => a.path < b.path ? -1 : 1);
  source.tree = object.tree; source.entriesDigest = fingerprint(value.entries); source.materializedDigest = fingerprint({ files: source.files, directories: source.directories });
  Object.assign(value.receipt.gitInput, { tree: object.tree, entriesFingerprint: fingerprint(value.entries), fileCount: value.entries.length, totalBytes: source.files.reduce((sum, file) => sum + file.size, 0), materializedFingerprint: fingerprint(source.files.map(file => ({ path: file.path, mode: file.gitMode, oid: file.oid, size: file.size, sha256: file.digest }))) });
  value.receipt.runtimePolicy.container.mounts[0].treeFingerprint = value.receipt.gitInput.materializedFingerprint;
  value.repack();
  const args = { receipt: value.receipt, archiveFiles: readBoundedPilotZip(value.archive).files, candidate: value.candidate, gitObject: object, policy: value.policy };
  assert.equal(verifyPilotActualComponents(args).componentBindingsVerified, true);
  source.files.find(file => file.type === 'symlink').target = '../../outside'; source.materializedDigest = fingerprint({ files: source.files, directories: source.directories }); value.repack();
  assert.equal(verifyPilotActualComponents({ ...args, archiveFiles: readBoundedPilotZip(value.archive).files }).componentBindingsVerified, false);
});
test('whole-rootfs inventory permits only an ordinary zero-sized root directory special case', () => {
  const value = fixture(); value.rootfs.unshift({ path: '/', type: 'directory', mode: '0755', sizeInBytes: 0 });
  value.receipt.toolchainClosure.rootfsClosure.entryCount++; value.receipt.toolchainClosure.rootfsClosure.entryInventoryFingerprint = fingerprint(value.rootfs); value.repack();
  const args = () => ({ receipt: value.receipt, archiveFiles: readBoundedPilotZip(value.archive).files, candidate: value.candidate, gitObject: value.objects.get(value.candidate.mergeSha), policy: value.policy });
  assert.equal(verifyPilotActualComponents(args()).componentBindingsVerified, true);
  value.rootfs[0].type = 'regular'; value.rootfs[0].sha256 = digest(''); value.receipt.toolchainClosure.rootfsClosure.entryInventoryFingerprint = fingerprint(value.rootfs); value.repack();
  assert.equal(verifyPilotActualComponents(args()).componentBindingsVerified, false);
});
test('CLI off mode does no lookup and writes report/summary even without candidate inputs', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'pilot-reader-off-'));
  try { let called = false; const result = await runPilotReceiptObserver({ CI_CANDIDATE_MODE: 'off', CI_CANDIDATE_OUTPUT_DIR: temp }, { api: async () => { called = true; } }); closed(result); assert.equal(called, false); assert.equal(JSON.parse(readFileSync(join(temp, 'pilot-observer-report.json'), 'utf8')).skip, false); assert.ok(readFileSync(join(temp, 'summary.md'), 'utf8').includes('runFull=true')); } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('CLI bootstrap exceptions still retain a fail-closed upload receipt', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'pilot-reader-error-'));
  try { const result = await runPilotReceiptObserver({ CI_CANDIDATE_OUTPUT_DIR: temp }); closed(result); assert.ok(readFileSync(join(temp, 'pilot-observer-report.json'), 'utf8')); } finally { rmSync(temp, { recursive: true, force: true }); }
});
