import assert from 'node:assert/strict';
import { CLOSED_NODE_PROFILE, CLOSED_RUNTIME_PROFILE, SUPERVISOR_STEP, collectDockerRuntime, configurationFingerprint, normalizeDockerSnapshot, validateClosedRuntime } from './lib/ci-candidate-runtime.mjs';
import { fingerprint } from './lib/ci-candidate-evidence.mjs';
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');

const now = Date.parse('2026-10-05T12:00:00Z');
const at = seconds => new Date(now + seconds * 1000).toISOString();
const id = 'a'.repeat(64);
const imageId = fingerprint('reviewed image configuration');
const layers = [fingerprint('rootfs diff id 1'), fingerprint('rootfs diff id 2')];
const imageRef = `registry.example/ci/node@${fingerprint('reviewed OCI manifest')}`;

// Synthetic oracle only. Real inspect + independent image-rootfs extraction
// supply measurements; a protected GitHub supervisor separately supplies trust.
function fixture(profile = CLOSED_NODE_PROFILE) {
  const mounts = profile === CLOSED_NODE_PROFILE
    ? [{ source: '/sealed/source', destination: '/input', treeFingerprint: fingerprint('source bytes') }]
    : [{ source: '/sealed/source', destination: '/candidate', treeFingerprint: fingerprint('source bytes') }, { source: '/sealed/deps', destination: '/dependencies', treeFingerprint: fingerprint('dependency bytes') }];
  const env = ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/out', 'NODE_VERSION=22.20.0'];
  const tmpfs = 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700';
  const raw = {
    info: { ID: 'independently inspected daemon', OSType: 'linux', Architecture: 'x86_64', ServerVersion: '28.4.0', KernelVersion: '6.8.0', SecurityOptions: ['name=seccomp,profile=builtin', 'name=cgroupns'] },
    container: {
      Id: id, Image: imageId, Created: at(-10), RestartCount: 0,
      State: { Status: 'created', Running: false, Pid: 0, StartedAt: '0001-01-01T00:00:00Z', FinishedAt: '0001-01-01T00:00:00Z', ExitCode: 0, OOMKilled: false, Error: '' },
      Config: { User: '1000:1000', Env: env, WorkingDir: profile === CLOSED_NODE_PROFILE ? '/input' : '/candidate', Entrypoint: ['/usr/local/bin/node'], Cmd: ['--test', `${mounts[0].destination}/probe.test.mjs`], Volumes: null },
      HostConfig: { Privileged: false, ReadonlyRootfs: true, NetworkMode: 'none', IpcMode: 'private', PidMode: '', UTSMode: '', UsernsMode: '', CgroupnsMode: 'private', CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Devices: [], DeviceRequests: null, VolumesFrom: null, Links: null, PublishAllPorts: false, PortBindings: {}, ExtraHosts: null, GroupAdd: null, Runtime: 'runc', Sysctls: null, StorageOpt: null, Tmpfs: { '/out': tmpfs }, Binds: null, Mounts: mounts.map(mount => ({ Type: 'bind', Source: mount.source, Target: mount.destination, ReadOnly: true, BindOptions: { Propagation: 'rprivate', NonRecursive: true } })), RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } },
      Mounts: mounts.map(mount => ({ Type: 'bind', Source: mount.source, Destination: mount.destination, RW: false, Propagation: 'rprivate' })),
    },
    image: { Id: imageId, RepoDigests: [imageRef], Os: 'linux', Architecture: 'amd64', RootFS: { Type: 'layers', Layers: [...layers] } },
  };
  const snapshot = normalizeDockerSnapshot({ ...raw, collectedAt: at(0) });
  const terminalRaw = structuredClone(raw);
  terminalRaw.container.State = { Status: 'exited', Running: false, Pid: 0, StartedAt: at(5), FinishedAt: at(15), ExitCode: 0, OOMKilled: false, Error: '' };
  const executionSnapshot = normalizeDockerSnapshot({ ...terminalRaw, collectedAt: at(20) });
  const policy = { profile, image: { ref: imageRef, id: imageId, os: 'linux', architecture: 'amd64', rootfsLayers: [...layers] }, container: { user: '1000:1000', workingDir: raw.container.Config.WorkingDir, entrypoint: [...raw.container.Config.Entrypoint], cmd: [...raw.container.Config.Cmd], env: [...env], mounts, outputTmpfs: { destination: '/out', options: tmpfs } }, tools: [{ path: '/usr/local/bin/node', sha256: fingerprint('actual executable bytes'), mode: '0755' }], supervisor: { repositoryId: 42, workflowId: 7, path: '.github/workflows/closed-runtime-pilot.yml', ref: 'refs/heads/main', workflowSha: 'b'.repeat(40), definitionFingerprint: fingerprint('protected controller definition closure'), stepName: SUPERVISOR_STEP, candidateStepName: 'Execute closed Node candidate', event: 'workflow_dispatch', runId: 100, runAttempt: 1, jobId: 101 } };
  const authority = { source: 'protected-supervisor', apiVerified: true, definitionVerified: true, ...policy.supervisor, runId: 100, runAttempt: 1, jobId: 101, jobStartedAt: at(-30), supervisorStartedAt: at(-20), firstCandidateAt: at(5), hostCandidateCodeExecuted: false, captureStep: { name: SUPERVISOR_STEP, number: 1, status: 'completed', conclusion: 'success', startedAt: at(-25), completedAt: at(2) }, candidateStep: { name: policy.supervisor.candidateStepName, number: 2, status: 'completed', conclusion: 'success', startedAt: at(3), completedAt: at(18) }, snapshotFingerprint: snapshot.fingerprint, executionSnapshotFingerprint: executionSnapshot.fingerprint, containerId: id, imageId, daemonId: raw.info.ID, logDigest: fingerprint('independently fetched capture logs'), toolBytes: { source: 'immutable-image-rootfs', independentlyRead: true, imageId, rootfsLayers: [...layers], entries: [{ ...policy.tools[0], sizeInBytes: 8192, fileType: 'regular' }] }, mountInputs: mounts.map(mount => ({ ...mount, immutable: true, hostCandidateWritable: false, sourceType: 'directory', containsSockets: false, containsDevices: false, containsFifos: false, containsEscapingSymlinks: false })) };
  const imageContainerId = 'd'.repeat(64);
  authority.toolBytes.rootfsClosure = { source: 'docker-cp-stopped-image-container', containerId: imageContainerId, imageId, rootfsLayers: [...layers], archiveDigest: fingerprint('independently read whole-rootfs archive bytes'), entryInventoryFingerprint: fingerprint('actual archive header inventory'), byteCount: 1048576, entryCount: 20, complete: true, imageContainer: { id: imageContainerId, imageId, status: 'created', running: false, started: false, readonlyRootfs: true, mounts: [] } };
  return { raw, terminalRaw, snapshot, executionSnapshot, policy, authority };
}

function reseal(snapshot) {
  const { fingerprint: ignored, ...payload } = snapshot;
  snapshot.fingerprint = fingerprint(payload);
}

function evaluate(value) {
  if (!value.keepSnapshotDigest) { reseal(value.snapshot); if (value.executionSnapshot) reseal(value.executionSnapshot); }
  if (value.authority && !value.keepReceiptDigest) { value.authority.snapshotFingerprint = value.snapshot.fingerprint; value.authority.executionSnapshotFingerprint = value.executionSnapshot?.fingerprint; }
  return validateClosedRuntime(value);
}

function fallback(result, reason) {
  assert.equal(result.skip, false); assert.equal(result.runFull, true); assert.equal(result.verified, false); assert.equal(result.closedProfileValid, false);
  if (reason) assert.ok(result.reasons.includes(reason), `Expected ${reason}; received ${result.reasons.join(', ')}`);
}

describe('closed-runtime synthetic oracle', () => {
  for (const profile of [CLOSED_NODE_PROFILE, CLOSED_RUNTIME_PROFILE]) it(`validates complete independently bound ${profile} without granting production trust`, () => {
    const result = evaluate(fixture(profile));
    assert.equal(result.structureValid, true); assert.equal(result.executionValid, true); assert.equal(result.closedProfileValid, true);
    assert.equal(result.verified, false); assert.equal(result.skip, false); assert.equal(result.runFull, true);
    assert.deepEqual(result.reasons, []); assert.deepEqual(result.missingFacts, []);
    assert.ok(result.structureChecks.every(check => check.passed)); assert.ok(result.executionChecks.every(check => check.passed));
  });
  it('retains real structure and execution measurements while refusing local GitHub impersonation', () => {
    const value = fixture(); value.authority.source = 'local-controller'; value.authority.apiVerified = false;
    const result = evaluate(value); fallback(result, 'supervisor_authority');
    assert.equal(result.structureValid, true); assert.equal(result.executionValid, true);
    assert.equal(result.authorityChecks.find(check => check.name === 'actual_tool_bytes').passed, true);
  });
  it('does not require fabricated GitHub policy IDs to expose local physical measurements', () => {
    const value = fixture(); delete value.policy.supervisor; value.authority.source = 'local-controller'; value.authority.apiVerified = false;
    const result = evaluate(value); fallback(result, 'protected_supervisor_policy');
    assert.equal(result.structureValid, true); assert.equal(result.executionValid, true); assert.equal(result.toolBytesValid, true); assert.equal(result.mountInputsValid, true); assert.equal(result.authorityBound, false);
    assert.ok(result.missingFacts.includes('protected_supervisor_policy'));
  });
  it('separates inspect facts from facts inspect cannot obtain', () => {
    const value = fixture(); value.authority = null;
    const result = evaluate(value); fallback(result, 'supervisor_authority');
    assert.equal(result.structureValid, true); assert.equal(result.executionValid, true);
    assert.deepEqual(result.missingFacts, ['protected_pre_candidate_supervisor_authority', 'actual_immutable_rootfs_tool_bytes', 'actual_whole_rootfs_byte_closure', 'sealed_source_and_dependency_bytes']);
  });
  it('configuration fingerprints ignore only lifecycle and collection time', () => {
    const value = fixture(); assert.equal(configurationFingerprint(value.snapshot), configurationFingerprint(value.executionSnapshot));
    value.executionSnapshot.container.host.NetworkMode = 'host';
    assert.notEqual(configurationFingerprint(value.snapshot), configurationFingerprint(value.executionSnapshot));
  });
  it('retains emulated process and image-byte facts while refusing unmeasured host emulator closure', () => {
    const value = fixture(); value.snapshot.daemon.architecture = 'arm64'; value.executionSnapshot.daemon.architecture = 'arm64';
    const result = evaluate(value); fallback(result, 'native_toolchain_byte_closure');
    assert.equal(result.structureValid, true); assert.equal(result.executionValid, true); assert.equal(result.toolBytesValid, true); assert.equal(result.toolchainClosureComplete, false);
    assert.ok(result.missingFacts.includes('external_emulator_byte_closure'));
  });
  it('does not mutate supplied snapshots, policy or authority', () => {
    const value = fixture(); const before = JSON.stringify(value); validateClosedRuntime(value); assert.equal(JSON.stringify(value), before);
  });
  it('accepts Docker omitempty Sysctls/StorageOpt without inventing inspect values', () => {
    const value = fixture();
    for (const key of ['Sysctls', 'StorageOpt']) { delete value.raw.container.HostConfig[key]; delete value.terminalRaw.container.HostConfig[key]; }
    value.snapshot = normalizeDockerSnapshot({ ...value.raw, collectedAt: at(0) });
    value.executionSnapshot = normalizeDockerSnapshot({ ...value.terminalRaw, collectedAt: at(20) });
    const result = evaluate(value); assert.equal(result.closedProfileValid, true);
    for (const snapshot of [value.snapshot, value.executionSnapshot]) for (const key of ['Sysctls', 'StorageOpt']) assert.equal(Object.hasOwn(snapshot.container.host, key), false);
  });
});

const violations = [
  ['unreviewed image tag', value => { value.policy.image.ref = 'node:22'; }, 'invalid_closed_profile_policy'],
  ['root policy', value => { value.policy.container.user = '0:0'; }, 'invalid_closed_profile_policy'],
  ['writable tool mount policy', value => { value.policy.tools[0].path = '/input/node'; }, 'invalid_closed_profile_policy'],
  ['missing reviewed tool bytes', value => { delete value.policy.tools[0].sha256; }, 'invalid_closed_profile_policy'],
  ['mutable tool injection environment', value => { value.policy.container.env.push('NODE_OPTIONS=--import=/input/forge.mjs'); }, 'invalid_closed_profile_policy'],
  ['host main trust policy changed', value => { value.policy.supervisor.ref = 'refs/heads/feature'; }, 'protected_supervisor_policy'],
  ['wrong image id', value => { value.snapshot.image.id = fingerprint('another image'); }, 'image_identity'],
  ['wrong container image id', value => { value.snapshot.container.imageId = fingerprint('another image'); }, 'image_identity'],
  ['OCI digest absent', value => { value.snapshot.image.repoDigests = []; }, 'image_identity'],
  ['wrong image architecture', value => { value.snapshot.image.architecture = 'arm64'; }, 'image_platform_and_rootfs'],
  ['wrong image OS', value => { value.snapshot.image.os = 'windows'; }, 'image_platform_and_rootfs'],
  ['missing rootfs layers', value => { value.snapshot.image.rootfsLayers = []; }, 'image_platform_and_rootfs'],
  ['changed rootfs layers', value => { value.snapshot.image.rootfsLayers[0] = fingerprint('mutated'); }, 'image_platform_and_rootfs'],
  ['missing daemon identity', value => { value.snapshot.daemon.id = ''; }, 'daemon_identity'],
  ['daemon security options absent', value => { delete value.snapshot.daemon.securityOptions; }, 'builtin_seccomp'],
  ['daemon default seccomp disabled', value => { value.snapshot.daemon.securityOptions = ['name=seccomp,profile=unconfined']; }, 'builtin_seccomp'],
  ['daemon seccomp missing', value => { value.snapshot.daemon.securityOptions = ['name=cgroupns']; }, 'builtin_seccomp'],
  ['ambiguous daemon seccomp profiles', value => { value.snapshot.daemon.securityOptions.push('name=seccomp,profile=custom'); }, 'builtin_seccomp'],
  ['daemon seccomp profile changed after pre-capture', value => { value.executionSnapshot.daemon.securityOptions = ['name=seccomp,profile=unconfined']; }, 'same_configuration_before_and_after'],
  ['host architecture requires unbound emulator bytes', value => { value.snapshot.daemon.architecture = 'arm64'; }, 'native_toolchain_byte_closure'],
  ['root container', value => { value.snapshot.container.config.user = '0'; }, 'nonroot_readonly'],
  ['privileged container', value => { value.snapshot.container.host.Privileged = true; }, 'nonroot_readonly'],
  ['writable root filesystem', value => { value.snapshot.container.host.ReadonlyRootfs = false; }, 'nonroot_readonly'],
  ['host networking', value => { value.snapshot.container.host.NetworkMode = 'host'; }, 'isolated_namespaces'],
  ['host IPC', value => { value.snapshot.container.host.IpcMode = 'host'; }, 'isolated_namespaces'],
  ['host PID', value => { value.snapshot.container.host.PidMode = 'host'; }, 'isolated_namespaces'],
  ['host UTS', value => { value.snapshot.container.host.UTSMode = 'host'; }, 'isolated_namespaces'],
  ['host user namespace', value => { value.snapshot.container.host.UsernsMode = 'host'; }, 'isolated_namespaces'],
  ['host cgroup namespace', value => { value.snapshot.container.host.CgroupnsMode = 'host'; }, 'isolated_namespaces'],
  ['capability added', value => { value.snapshot.container.host.CapAdd = ['SYS_ADMIN']; }, 'no_capabilities_or_escalation'],
  ['capabilities not completely dropped', value => { value.snapshot.container.host.CapDrop = ['NET_RAW']; }, 'no_capabilities_or_escalation'],
  ['privilege escalation permitted', value => { value.snapshot.container.host.SecurityOpt = []; }, 'no_capabilities_or_escalation'],
  ['unconfined seccomp option', value => { value.snapshot.container.host.SecurityOpt.push('seccomp=unconfined'); }, 'no_capabilities_or_escalation'],
  ['Docker socket group added', value => { value.snapshot.container.host.GroupAdd = ['999']; }, 'no_capabilities_or_escalation'],
  ['host device', value => { value.snapshot.container.host.Devices = [{ PathOnHost: '/dev/sda' }]; }, 'no_devices_or_host_routes'],
  ['required devices inspect field absent', value => { delete value.snapshot.container.host.Devices; }, 'no_devices_or_host_routes'],
  ['custom sysctl override', value => { value.snapshot.container.host.Sysctls = { 'net.ipv4.ip_forward': '1' }; }, 'no_devices_or_host_routes'],
  ['custom storage driver override', value => { value.snapshot.container.host.StorageOpt = { size: '8G' }; }, 'no_devices_or_host_routes'],
  ['unknown sysctl inspect value', value => { value.snapshot.container.host.Sysctls = 'unknown'; }, 'no_devices_or_host_routes'],
  ['wrong sysctl inspect type', value => { value.snapshot.container.host.Sysctls = []; }, 'no_devices_or_host_routes'],
  ['unknown storage inspect value', value => { value.snapshot.container.host.StorageOpt = 'unknown'; }, 'no_devices_or_host_routes'],
  ['GPU device request', value => { value.snapshot.container.host.DeviceRequests = [{ Count: -1 }]; }, 'no_devices_or_host_routes'],
  ['published ports', value => { value.snapshot.container.host.PortBindings = { '80/tcp': [{ HostPort: '8080' }] }; }, 'no_devices_or_host_routes'],
  ['custom runtime', value => { value.snapshot.container.host.Runtime = 'nvidia'; }, 'no_devices_or_host_routes'],
  ['RW source', value => { value.snapshot.container.mounts[0].rw = true; }, 'exact_readonly_source_dependency_mounts'],
  ['shared mount propagation', value => { value.snapshot.container.mounts[0].propagation = 'rshared'; }, 'exact_readonly_source_dependency_mounts'],
  ['Docker socket mounted', value => { value.snapshot.container.mounts.push({ type: 'bind', source: '/var/run/docker.sock', destination: '/var/run/docker.sock', rw: true, propagation: 'rprivate' }); }, 'exact_readonly_source_dependency_mounts'],
  ['mutable host tool mounted', value => { value.snapshot.container.mounts.push({ type: 'bind', source: '/usr/bin/node', destination: '/usr/local/bin/node', rw: false, propagation: 'rprivate' }); }, 'exact_readonly_source_dependency_mounts'],
  ['RW home mounted', value => { value.snapshot.container.mounts.push({ type: 'bind', source: '/home/runner', destination: '/root', rw: true, propagation: 'rprivate' }); }, 'exact_readonly_source_dependency_mounts'],
  ['RW legacy bind', value => { value.snapshot.container.host.Binds = ['/sealed/source:/input:rw']; }, 'nonrecursive_readonly_mount_requests'],
  ['recursive submounts', value => { value.snapshot.container.host.Mounts[0].BindOptions.NonRecursive = false; }, 'nonrecursive_readonly_mount_requests'],
  ['actual command changed', value => { value.snapshot.container.config.cmd = ['-e', 'console.log(true)']; }, 'exact_command_environment'],
  ['actual environment changed', value => { value.snapshot.container.config.envFingerprint = fingerprint(['NODE_OPTIONS=--import=/input/forge.mjs']); }, 'exact_command_environment'],
  ['extra output tmpfs', value => { value.snapshot.container.host.Tmpfs['/root'] = 'rw'; }, 'controlled_output_tmpfs'],
  ['executable output tmpfs', value => { value.snapshot.container.host.Tmpfs['/out'] = 'rw,exec'; }, 'controlled_output_tmpfs'],
  ['automatic restart', value => { value.snapshot.container.host.RestartPolicy = { Name: 'always', MaximumRetryCount: 0 }; }, 'no_automatic_restart'],
  ['process restarted', value => { value.snapshot.container.restartCount = 1; }, 'container_lifecycle_identity'],
  ['terminal snapshot missing', value => { delete value.executionSnapshot; }, 'terminal_docker_snapshot'],
  ['terminal process failed', value => { value.executionSnapshot.container.state.exitCode = 1; }, 'terminal:container_lifecycle_identity'],
  ['terminal OOM', value => { value.executionSnapshot.container.state.oomKilled = true; }, 'terminal:container_lifecycle_identity'],
  ['terminal process still running', value => { value.executionSnapshot.container.state.running = true; }, 'terminal:container_lifecycle_identity'],
  ['candidate started before pre-capture', value => { value.executionSnapshot.container.state.startedAt = at(-1); }, 'execution_after_pre_capture'],
  ['terminal container swapped', value => { value.executionSnapshot.container.id = 'f'.repeat(64); }, 'same_configuration_before_and_after'],
  ['terminal daemon swapped', value => { value.executionSnapshot.daemon.id = 'another daemon'; }, 'same_configuration_before_and_after'],
  ['terminal image swapped', value => { value.executionSnapshot.image.id = fingerprint('another image'); }, 'same_configuration_before_and_after'],
  ['terminal runtime config changed', value => { value.executionSnapshot.container.host.ReadonlyRootfs = false; }, 'same_configuration_before_and_after'],
  ['candidate self-reported authority', value => { value.authority.source = 'pull-request-json'; }, 'supervisor_authority'],
  ['candidate JSON cannot attest actual tool bytes', value => { value.authority.source = 'pull-request-json'; }, 'actual_tool_bytes'],
  ['API authority not independently verified', value => { value.authority.apiVerified = false; }, 'supervisor_authority'],
  ['supervisor definition not protected', value => { value.authority.definitionVerified = false; }, 'supervisor_authority'],
  ['supervisor repository swapped', value => { value.authority.repositoryId++; }, 'supervisor_authority'],
  ['supervisor workflow swapped', value => { value.authority.workflowId++; }, 'supervisor_authority'],
  ['supervisor default-main ref swapped', value => { value.authority.ref = 'refs/pull/1/merge'; }, 'supervisor_authority'],
  ['supervisor checkout revision swapped', value => { value.authority.workflowSha = 'c'.repeat(40); }, 'supervisor_authority'],
  ['supervisor definition closure swapped', value => { value.authority.definitionFingerprint = fingerprint('candidate supervisor'); }, 'supervisor_authority'],
  ['supervisor run identity missing', value => { delete value.authority.runId; }, 'supervisor_authority'],
  ['supervisor attempt identity missing', value => { delete value.authority.runAttempt; }, 'supervisor_authority'],
  ['supervisor job identity missing', value => { delete value.authority.jobId; }, 'supervisor_authority'],
  ['supervisor run swapped against independently expected API facts', value => { value.authority.runId++; }, 'supervisor_authority'],
  ['supervisor attempt swapped against independently expected API facts', value => { value.authority.runAttempt++; }, 'supervisor_authority'],
  ['supervisor job swapped against independently expected API facts', value => { value.authority.jobId++; }, 'supervisor_authority'],
  ['inspect receipt container swapped', value => { value.authority.containerId = 'f'.repeat(64); }, 'independent_inspect_binding'],
  ['inspect receipt snapshot swapped', value => { value.authority.snapshotFingerprint = fingerprint('another snapshot'); value.keepReceiptDigest = true; }, 'independent_inspect_binding'],
  ['inspect receipt terminal snapshot swapped', value => { value.authority.executionSnapshotFingerprint = fingerprint('another snapshot'); value.keepReceiptDigest = true; }, 'independent_inspect_binding'],
  ['inspect receipt log digest absent', value => { delete value.authority.logDigest; }, 'independent_inspect_binding'],
  ['post-hook host recorder cannot attest', value => { value.authority.hostCandidateCodeExecuted = true; }, 'supervisor_before_candidate_code'],
  ['supervisor started after candidate', value => { value.authority.supervisorStartedAt = at(6); }, 'supervisor_before_candidate_code'],
  ['candidate API step precedes supervisor step', value => { value.authority.candidateStep.number = 1; }, 'supervisor_before_candidate_code'],
  ['capture API step was skipped', value => { value.authority.captureStep.conclusion = 'skipped'; }, 'supervisor_before_candidate_code'],
  ['candidate API step failed', value => { value.authority.candidateStep.conclusion = 'failure'; }, 'supervisor_before_candidate_code'],
  ['actual first-candidate time differs from Docker start', value => { value.authority.firstCandidateAt = at(6); }, 'supervisor_before_candidate_code'],
  ['tool bytes missing', value => { delete value.authority.toolBytes; }, 'actual_tool_bytes'],
  ['tool bytes supplied by candidate', value => { value.authority.toolBytes.source = 'candidate-sha256'; }, 'actual_tool_bytes'],
  ['tool bytes not independently read', value => { value.authority.toolBytes.independentlyRead = false; }, 'actual_tool_bytes'],
  ['tool byte image id swapped', value => { value.authority.toolBytes.imageId = fingerprint('another image'); }, 'actual_tool_bytes'],
  ['tool byte rootfs layers swapped', value => { value.authority.toolBytes.rootfsLayers = []; }, 'actual_tool_bytes'],
  ['actual tool SHA missing', value => { delete value.authority.toolBytes.entries[0].sha256; }, 'actual_tool_bytes'],
  ['actual tool SHA differs', value => { value.authority.toolBytes.entries[0].sha256 = fingerprint('another executable'); }, 'actual_tool_bytes'],
  ['tool is only a symlink hash', value => { value.authority.toolBytes.entries[0].fileType = 'symlink'; }, 'actual_tool_bytes'],
  ['empty tool bytes', value => { value.authority.toolBytes.entries[0].sizeInBytes = 0; }, 'actual_tool_bytes'],
  ['whole-rootfs byte closure missing', value => { delete value.authority.toolBytes.rootfsClosure; }, 'whole_rootfs_byte_closure'],
  ['whole-rootfs byte closure incomplete', value => { value.authority.toolBytes.rootfsClosure.complete = false; }, 'whole_rootfs_byte_closure'],
  ['whole-rootfs byte archive hash missing', value => { delete value.authority.toolBytes.rootfsClosure.archiveDigest; }, 'whole_rootfs_byte_closure'],
  ['whole-rootfs byte inventory hash missing', value => { delete value.authority.toolBytes.rootfsClosure.entryInventoryFingerprint; }, 'whole_rootfs_byte_closure'],
  ['whole-rootfs inspected image container had executed code', value => { value.authority.toolBytes.rootfsClosure.imageContainer.started = true; }, 'whole_rootfs_byte_closure'],
  ['whole-rootfs image container has mutable mounts', value => { value.authority.toolBytes.rootfsClosure.imageContainer.mounts.push({ destination: '/usr/bin', rw: true }); }, 'whole_rootfs_byte_closure'],
  ['source bytes not frozen', value => { value.authority.mountInputs[0].immutable = false; }, 'sealed_mount_input_bytes'],
  ['candidate can mutate host input', value => { value.authority.mountInputs[0].hostCandidateWritable = true; }, 'sealed_mount_input_bytes'],
  ['source input digest differs', value => { value.authority.mountInputs[0].treeFingerprint = fingerprint('different input bytes'); }, 'sealed_mount_input_bytes'],
  ['Unix socket hidden in RO input', value => { value.authority.mountInputs[0].containsSockets = true; }, 'sealed_mount_input_bytes'],
  ['device hidden in RO input', value => { value.authority.mountInputs[0].containsDevices = true; }, 'sealed_mount_input_bytes'],
  ['FIFO hidden in RO input', value => { value.authority.mountInputs[0].containsFifos = true; }, 'sealed_mount_input_bytes'],
  ['escaping symlink hidden in RO input', value => { value.authority.mountInputs[0].containsEscapingSymlinks = true; }, 'sealed_mount_input_bytes'],
];

describe('closed-runtime fail-closed contract', () => {
  for (const [name, mutate, reason] of violations) it(name, () => { const value = fixture(); mutate(value); fallback(evaluate(value), reason); });
  it('corrupt snapshot cannot be authenticated by a copied authority', () => {
    const value = fixture(); value.snapshot.container.host.ReadonlyRootfs = false; value.keepSnapshotDigest = true;
    fallback(evaluate(value), 'snapshot_fingerprint');
  });
  it('malformed data or validation exceptions never grant trust', () => {
    for (const value of [undefined, null, {}, { policy: {} }, { get policy() { throw new Error('malformed'); } }]) fallback(validateClosedRuntime(value));
  });
  it('existing fullstack open host topology fails several independent constraints', () => {
    const value = fixture(); const host = value.snapshot.container.host;
    host.NetworkMode = 'host'; host.IpcMode = 'host'; host.ReadonlyRootfs = false; host.CapDrop = null; host.SecurityOpt = null;
    value.snapshot.container.mounts.push({ type: 'bind', source: '/var/run/docker.sock', destination: '/var/run/docker.sock', rw: true, propagation: 'rprivate' });
    const result = evaluate(value); fallback(result);
    for (const reason of ['nonroot_readonly', 'isolated_namespaces', 'no_capabilities_or_escalation', 'exact_readonly_source_dependency_mounts']) assert.ok(result.reasons.includes(reason));
  });
});

describe('read-only Docker inspector', () => {
  function fakeExecute(value, overrides = {}) {
    const calls = [];
    return { calls, execute: async args => {
      calls.push(args);
      const key = args.join(' ');
      if (key in overrides) { if (overrides[key] instanceof Error) throw overrides[key]; return overrides[key]; }
      if (args[0] === 'info') return JSON.stringify(value.raw.info);
      if (args[0] === 'container') return JSON.stringify([value.raw.container]);
      if (args[0] === 'image') return JSON.stringify([value.raw.image]);
      throw new Error('Unexpected Docker command');
    } };
  }
  it('uses exactly info and two inspect reads, returns measured structure but no trust', async () => {
    const value = fixture(); const fake = fakeExecute(value);
    const result = await collectDockerRuntime({ containerId: id, execute: fake.execute, now });
    assert.equal(result.readStatus, 'ok'); assert.deepEqual(result.snapshot, value.snapshot);
    assert.deepEqual(fake.calls, [['info', '--format', '{{json .}}'], ['container', 'inspect', id], ['image', 'inspect', imageId]]);
    assert.deepEqual(result.missingFacts, ['protected_pre_candidate_supervisor_authority', 'actual_immutable_rootfs_tool_bytes', 'actual_whole_rootfs_byte_closure', 'sealed_source_and_dependency_bytes']);
    assert.equal('authority' in result, false); assert.equal('toolBytes' in result.snapshot, false);
  });
  it('never discloses credential-bearing container environment values', async () => {
    const value = fixture(); value.raw.container.Config.Env.push('API_SECRET=do-not-emit-this');
    const result = await collectDockerRuntime({ containerId: id, execute: fakeExecute(value).execute, now });
    assert.equal(result.readStatus, 'ok'); assert.ok(!JSON.stringify(result).includes('do-not-emit-this'));
  });
  for (const containerId of ['', 'name', '-all', id + ';docker run hostile', id.slice(0, 12), null]) it(`rejects container argument ${JSON.stringify(containerId)} before invoking Docker`, async () => {
    const fake = fakeExecute(fixture()); const result = await collectDockerRuntime({ containerId, execute: fake.execute });
    assert.equal(result.readStatus, 'invalid_input'); assert.equal(result.snapshot, null); assert.deepEqual(fake.calls, []);
  });
  it('permission/API failures return unavailable without leaking stderr', async () => {
    const fake = fakeExecute(fixture(), { 'info --format {{json .}}': new Error('permission denied with secret stderr') });
    const result = await collectDockerRuntime({ containerId: id, execute: fake.execute });
    assert.equal(result.readStatus, 'unavailable'); assert.deepEqual(result.missingFacts, ['docker_read_failed']);
    assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(fake.calls.length, 1);
  });
  it('truncated or non-JSON inspect output fails closed', async () => {
    for (const output of ['{', '[]', '{}', JSON.stringify([fixture().raw.container, fixture().raw.container])]) {
      const fake = fakeExecute(fixture(), { [`container inspect ${id}`]: output });
      assert.equal((await collectDockerRuntime({ containerId: id, execute: fake.execute })).readStatus, 'unavailable');
      assert.equal(fake.calls.length, 2);
    }
  });
  it('container/image identity changes between read commands fail closed', async () => {
    const value = fixture(); value.raw.image.Id = fingerprint('another image');
    const result = await collectDockerRuntime({ containerId: id, execute: fakeExecute(value).execute });
    assert.deepEqual(result.missingFacts, ['docker_image_identity_mismatch']);
  });
  it('malformed collector options or getter exceptions produce no snapshot', async () => {
    assert.equal((await collectDockerRuntime(null)).readStatus, 'invalid_input');
    assert.equal((await collectDockerRuntime({ get containerId() { throw new Error('malformed'); } })).snapshot, null);
  });
});
