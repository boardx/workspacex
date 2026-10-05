/**
 * Closed runtime comparison oracle and READ-ONLY Docker inspector.
 * No container is created, started, pulled, exec'd or modified here. Docker
 * inspect proves configuration/image metadata, NOT file bytes or supervision.
 * External authority must be authenticated by protected default-main code from
 * GitHub API/job logs and a supervisor started BEFORE any candidate host code.
 * A candidate-authored snapshot/authority, or a post-install host recorder,
 * supplies no authority. Digests are bindings, not signatures.
 * This module is intentionally not connected to production attestations.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fingerprint } from './ci-candidate-evidence.mjs';

export const CLOSED_RUNTIME_PROFILE = 'closed-tools-v1';
export const CLOSED_NODE_PROFILE = 'closed-node-no-install-v1';
export const SUPERVISOR_STEP = 'Start trusted runtime supervisor';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const IMAGE_REF = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const FULL_PATH = /^\/(?:[^/\x00-\x1f]+\/)*[^/\x00-\x1f]+$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const same = (a, b) => fingerprint(a) === fingerprint(b);
const empty = value => value === null || (Array.isArray(value) && value.length === 0) || (object(value) && Object.keys(value).length === 0);
// Docker HostConfig defines only these maps with JSON omitempty. An omitted
// map means no per-container override; preserve the omission in the snapshot
// instead of inventing measured values. A present unknown/non-map value fails.
const optionalEmptyMap = (host, key) => !own(host, key) || host[key] === null || (object(host[key]) && Object.keys(host[key]).length === 0);
const nativeArchitecture = value => ({ amd64: 'amd64', x86_64: 'amd64', arm64: 'arm64', aarch64: 'arm64' })[value] ?? null;
const path = value => typeof value === 'string' && FULL_PATH.test(value) && !value.split('/').some(part => part === '.' || part === '..');
const hostKeys = ['Privileged', 'ReadonlyRootfs', 'NetworkMode', 'IpcMode', 'PidMode', 'UTSMode', 'UsernsMode', 'CgroupnsMode', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Devices', 'DeviceRequests', 'VolumesFrom', 'Links', 'PublishAllPorts', 'PortBindings', 'ExtraHosts', 'GroupAdd', 'Runtime', 'Sysctls', 'StorageOpt', 'Tmpfs', 'Binds', 'Mounts', 'RestartPolicy'];

function checkedJSON(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_097_152) throw new Error('invalid_docker_response');
  return JSON.parse(value);
}

function singleton(value) {
  if (!Array.isArray(value) || value.length !== 1 || !object(value[0])) throw new Error('invalid_docker_inspect_response');
  return value[0];
}

/** Normalize selected inspect fields; never return credential-bearing Env values. */
export function normalizeDockerSnapshot({ info, container, image, collectedAt }) {
  if (!object(info) || !object(container) || !object(image) || !time(collectedAt)) throw new Error('invalid_docker_snapshot_input');
  const config = container.Config ?? {};
  const host = container.HostConfig ?? {};
  const selectedHost = Object.fromEntries(hostKeys.filter(key => own(host, key)).map(key => [key, host[key]]));
  const payload = {
    schemaVersion: 1, collectedAt,
    daemon: { id: info.ID ?? null, osType: info.OSType ?? null, architecture: info.Architecture ?? null, serverVersion: info.ServerVersion ?? null, kernelVersion: info.KernelVersion ?? null, securityOptions: info.SecurityOptions ?? null },
    container: {
      id: container.Id ?? null, imageId: container.Image ?? null, createdAt: container.Created ?? null, restartCount: container.RestartCount ?? null,
      state: { status: container.State?.Status ?? null, running: container.State?.Running ?? null, pid: container.State?.Pid ?? null, startedAt: container.State?.StartedAt ?? null, finishedAt: container.State?.FinishedAt ?? null, exitCode: container.State?.ExitCode ?? null, oomKilled: container.State?.OOMKilled ?? null, error: container.State?.Error ?? null },
      config: { user: config.User ?? null, envFingerprint: Array.isArray(config.Env) ? fingerprint(config.Env) : null, workingDir: config.WorkingDir ?? null, entrypoint: config.Entrypoint ?? null, cmd: config.Cmd ?? null, declaredVolumes: config.Volumes ?? null },
      host: selectedHost,
      mounts: Array.isArray(container.Mounts) ? container.Mounts.map(mount => ({ type: mount.Type ?? null, source: mount.Source ?? null, destination: mount.Destination ?? null, rw: mount.RW ?? null, propagation: mount.Propagation ?? null })) : null,
    },
    image: { id: image.Id ?? null, repoDigests: image.RepoDigests ?? null, os: image.Os ?? null, architecture: image.Architecture ?? null, rootfsType: image.RootFS?.Type ?? null, rootfsLayers: image.RootFS?.Layers ?? null },
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

/** Stable pre-create/post-exit binding; lifecycle and collection time may differ. */
export function configurationFingerprint(snapshot) {
  const { state, ...container } = snapshot.container;
  return fingerprint({ daemon: snapshot.daemon, image: snapshot.image, container });
}

const execFileAsync = promisify(execFile);
async function dockerRead(args) {
  const result = await execFileAsync('docker', args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 2_097_152, windowsHide: true });
  return result.stdout;
}

/**
 * Only three allowed read commands. Full IDs prevent option/name injection.
 * `execute` is a dependency injection seam for tests/trusted tooling, never PR
 * input. This collector does not authenticate GitHub supervision or tool bytes.
 * Snapshot consumers must independently obtain `authority`; do not copy JSON.
 */
export async function collectDockerRuntime(options = {}) {
  try {
    const { containerId, execute = dockerRead, now = Date.now() } = options ?? {};
    if (!CONTAINER_ID.test(containerId ?? '')) return { readStatus: 'invalid_input', snapshot: null, missingFacts: ['full_container_id_required'] };
    const info = checkedJSON(await execute(['info', '--format', '{{json .}}']));
    const container = singleton(checkedJSON(await execute(['container', 'inspect', containerId])));
    if (container.Id !== containerId || !DIGEST.test(container.Image ?? '')) throw new Error('docker_container_identity_mismatch');
    const image = singleton(checkedJSON(await execute(['image', 'inspect', container.Image])));
    if (image.Id !== container.Image) throw new Error('docker_image_identity_mismatch');
    const snapshot = normalizeDockerSnapshot({ info, container, image, collectedAt: new Date(now).toISOString() });
    return { readStatus: 'ok', snapshot, missingFacts: ['protected_pre_candidate_supervisor_authority', 'actual_immutable_rootfs_tool_bytes', 'actual_whole_rootfs_byte_closure', 'sealed_source_and_dependency_bytes'] };
  } catch (error) {
    const known = ['invalid_docker_response', 'invalid_docker_inspect_response', 'docker_container_identity_mismatch', 'docker_image_identity_mismatch', 'invalid_docker_snapshot_input'];
    return { readStatus: 'unavailable', snapshot: null, missingFacts: [known.includes(error?.message) ? error.message : 'docker_read_failed'] };
  }
}

function policyValid(policy) {
  const image = policy?.image;
  const container = policy?.container;
  const noInstall = policy?.profile === CLOSED_NODE_PROFILE;
  const mountDestinations = noInstall ? ['/input'] : ['/candidate', '/dependencies'];
  if (![CLOSED_RUNTIME_PROFILE, CLOSED_NODE_PROFILE].includes(policy?.profile) || !IMAGE_REF.test(image?.ref ?? '') || !DIGEST.test(image?.id ?? '') || image?.os !== 'linux' || !['amd64', 'arm64'].includes(image?.architecture) || !Array.isArray(image?.rootfsLayers) || image.rootfsLayers.length === 0 || !image.rootfsLayers.every(layer => DIGEST.test(layer))) return false;
  if (!/^[1-9]\d*:[1-9]\d*$/.test(container?.user ?? '') || container?.workingDir !== (noInstall ? '/input' : '/candidate') || !Array.isArray(container?.entrypoint) || !container.entrypoint.every(item => typeof item === 'string') || !Array.isArray(container?.cmd) || container.cmd.length === 0 || !container.cmd.every(item => typeof item === 'string') || !Array.isArray(container?.env) || !container.env.every(item => typeof item === 'string' && /^[A-Z][A-Z0-9_]*=/.test(item) && !/[\x00\r\n]/.test(item) && !/^(?:NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|BASH_ENV|ENV|DOCKER_HOST|PYTHONPATH)=/.test(item))) return false;
  if (!Array.isArray(container?.mounts) || container.mounts.length !== mountDestinations.length || !same(container.mounts.map(mount => mount.destination).sort(), mountDestinations) || !container.mounts.every(mount => path(mount.source) && DIGEST.test(mount.treeFingerprint ?? ''))) return false;
  if (container?.outputTmpfs?.destination !== '/out' || container.outputTmpfs.options !== `rw,nosuid,nodev,noexec,size=64m,uid=${container.user.split(':')[0]},gid=${container.user.split(':')[1]},mode=0700`) return false;
  if (!Array.isArray(policy?.tools) || policy.tools.length === 0 || new Set(policy.tools.map(tool => tool.path)).size !== policy.tools.length || !policy.tools.every(tool => path(tool.path) && !['/candidate', '/dependencies', '/out', '/input'].some(prefix => tool.path === prefix || tool.path.startsWith(`${prefix}/`)) && DIGEST.test(tool.sha256 ?? '') && ['0444', '0555', '0644', '0755'].includes(tool.mode))) return false;
  if (!policy.tools.some(tool => tool.path === (container.entrypoint[0] ?? container.cmd[0]) && ['0555', '0755'].includes(tool.mode))) return false;
  return true;
}

function supervisorPolicyValid(supervisor) {
  return integer(supervisor?.repositoryId) && integer(supervisor?.workflowId) && /^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(supervisor?.path ?? '') && supervisor?.ref === 'refs/heads/main' && GIT_SHA.test(supervisor?.workflowSha ?? '') && DIGEST.test(supervisor?.definitionFingerprint ?? '') && supervisor?.stepName === SUPERVISOR_STEP && typeof supervisor?.candidateStepName === 'string' && supervisor.candidateStepName.length > 0;
}

function structure(snapshot, policy, check, stage = 'initial') {
  const container = snapshot.container;
  const image = snapshot.image;
  const host = container?.host;
  const expected = policy.container;
  check('image_identity', image?.id === policy.image.id && container?.imageId === image?.id && Array.isArray(image?.repoDigests) && image.repoDigests.includes(policy.image.ref));
  check('image_platform_and_rootfs', image?.os === policy.image.os && image?.architecture === policy.image.architecture && image?.rootfsType === 'layers' && same(image?.rootfsLayers ?? null, policy.image.rootfsLayers));
  check('daemon_identity', typeof snapshot.daemon?.id === 'string' && snapshot.daemon.id.length > 0 && snapshot.daemon?.osType === 'linux' && ['amd64', 'x86_64', 'arm64', 'aarch64'].includes(snapshot.daemon?.architecture) && ['serverVersion', 'kernelVersion'].every(key => typeof snapshot.daemon[key] === 'string' && snapshot.daemon[key].length > 0));
  check('builtin_seccomp', Array.isArray(snapshot.daemon?.securityOptions) && snapshot.daemon.securityOptions.every(option => typeof option === 'string' && !option.includes('unconfined')) && same(snapshot.daemon.securityOptions.filter(option => option.startsWith('name=seccomp')), ['name=seccomp,profile=builtin']));
  const created = stage === 'initial' && container?.state?.status === 'created' && container?.state?.running === false && container?.state?.pid === 0;
  const started = time(container?.state?.startedAt) && Date.parse(container?.createdAt) <= Date.parse(container.state.startedAt) && Date.parse(container.state.startedAt) <= Date.parse(snapshot.collectedAt);
  const running = stage === 'initial' && container?.state?.status === 'running' && container?.state?.running === true && integer(container?.state?.pid) && started;
  const exited = stage === 'terminal' && container?.state?.status === 'exited' && container?.state?.running === false && container?.state?.pid === 0 && container?.state?.exitCode === 0 && started && time(container?.state?.finishedAt) && Date.parse(container.state.startedAt) <= Date.parse(container.state.finishedAt) && Date.parse(container.state.finishedAt) <= Date.parse(snapshot.collectedAt);
  check('container_lifecycle_identity', CONTAINER_ID.test(container?.id ?? '') && time(container?.createdAt) && Date.parse(container.createdAt) <= Date.parse(snapshot.collectedAt) && (created || running || exited) && container.restartCount === 0 && container?.state?.oomKilled === false && container?.state?.error === '');
  check('nonroot_readonly', container?.config?.user === expected.user && host?.Privileged === false && host?.ReadonlyRootfs === true);
  check('isolated_namespaces', host?.NetworkMode === 'none' && host?.IpcMode === 'private' && host?.PidMode === '' && host?.UTSMode === '' && host?.UsernsMode === '' && host?.CgroupnsMode === 'private');
  check('no_capabilities_or_escalation', empty(host?.CapAdd) && same(host?.CapDrop ?? null, ['ALL']) && same(host?.SecurityOpt ?? null, ['no-new-privileges']) && empty(host?.GroupAdd));
  check('no_devices_or_host_routes', ['Devices', 'DeviceRequests', 'VolumesFrom', 'Links', 'PortBindings', 'ExtraHosts'].every(key => own(host, key) && empty(host[key])) && ['Sysctls', 'StorageOpt'].every(key => optionalEmptyMap(host, key)) && host?.PublishAllPorts === false && host?.Runtime === 'runc');
  check('exact_command_environment', container?.config?.workingDir === expected.workingDir && same(container?.config?.entrypoint ?? [], expected.entrypoint) && same(container?.config?.cmd ?? null, expected.cmd) && container?.config?.envFingerprint === fingerprint(expected.env) && empty(container?.config?.declaredVolumes));
  const actual = container?.mounts;
  const binds = Array.isArray(actual) ? actual.filter(mount => mount.type === 'bind') : [];
  const tmpfs = Array.isArray(actual) ? actual.filter(mount => mount.type === 'tmpfs') : [];
  check('exact_readonly_source_dependency_mounts', Array.isArray(actual) && actual.length === binds.length + tmpfs.length && binds.length === expected.mounts.length && tmpfs.length <= 1 && tmpfs.every(mount => mount.destination === '/out' && mount.rw === true) && expected.mounts.every(mount => binds.filter(item => item.source === mount.source && item.destination === mount.destination && item.rw === false && item.propagation === 'rprivate').length === 1));
  const requested = host?.Mounts;
  check('nonrecursive_readonly_mount_requests', own(host, 'Binds') && empty(host.Binds) && Array.isArray(requested) && requested.length === expected.mounts.length && expected.mounts.every(mount => requested.filter(item => item.Type === 'bind' && item.Source === mount.source && item.Target === mount.destination && item.ReadOnly === true && item.BindOptions?.Propagation === 'rprivate' && item.BindOptions?.NonRecursive === true).length === 1));
  check('controlled_output_tmpfs', same(host?.Tmpfs ?? null, { [expected.outputTmpfs.destination]: expected.outputTmpfs.options }));
  check('no_automatic_restart', ['no', ''].includes(host?.RestartPolicy?.Name) && host?.RestartPolicy?.MaximumRetryCount === 0);
}

function authorityProof(snapshot, executionSnapshot, authority, policy, check, missing) {
  if (!authority) { missing('protected_pre_candidate_supervisor_authority'); check('supervisor_authority', false); return; }
  const expected = policy.supervisor ?? {};
  const validSupervisor = supervisorPolicyValid(expected);
  if (!validSupervisor) missing('protected_supervisor_policy');
  check('protected_supervisor_policy', validSupervisor);
  const capture = authority.captureStep;
  const candidate = authority.candidateStep;
  check('supervisor_authority', authority.source === 'protected-supervisor' && authority.apiVerified === true && authority.definitionVerified === true && ['repositoryId', 'workflowId', 'path', 'ref', 'workflowSha', 'definitionFingerprint', 'event'].every(key => authority[key] === expected[key]) && ['push', 'workflow_dispatch', 'workflow_run'].includes(authority.event) && ['runId', 'runAttempt', 'jobId'].every(key => integer(expected[key]) && authority[key] === expected[key]));
  check('independent_inspect_binding', authority.snapshotFingerprint === snapshot.fingerprint && authority.executionSnapshotFingerprint === executionSnapshot?.fingerprint && authority.containerId === snapshot.container.id && authority.imageId === snapshot.image.id && authority.daemonId === snapshot.daemon.id && DIGEST.test(authority.logDigest ?? ''));
  check('supervisor_before_candidate_code', authority.hostCandidateCodeExecuted === false && time(authority.supervisorStartedAt) && time(authority.jobStartedAt) && time(authority.firstCandidateAt) && capture?.name === SUPERVISOR_STEP && capture?.status === 'completed' && capture?.conclusion === 'success' && integer(capture?.number) && time(capture?.startedAt) && time(capture?.completedAt) && candidate?.name === expected.candidateStepName && candidate?.status === 'completed' && candidate?.conclusion === 'success' && integer(candidate?.number) && candidate.number > capture.number && time(candidate?.startedAt) && time(candidate?.completedAt) && Date.parse(authority.jobStartedAt) <= Date.parse(capture.startedAt) && Date.parse(capture.startedAt) <= Date.parse(authority.supervisorStartedAt) && Date.parse(authority.supervisorStartedAt) <= Date.parse(snapshot.collectedAt) && Date.parse(snapshot.collectedAt) <= Date.parse(capture.completedAt) && Date.parse(capture.completedAt) <= Date.parse(candidate.startedAt) && Date.parse(candidate.startedAt) <= Date.parse(authority.firstCandidateAt) && authority.firstCandidateAt === executionSnapshot?.container?.state?.startedAt && Date.parse(executionSnapshot?.container?.state?.finishedAt) <= Date.parse(candidate.completedAt));
  const toolBytes = authority.toolBytes;
  const externalByteSource = ['protected-supervisor', 'local-controller', 'local-readonly-controller'].includes(authority.source);
  if (!toolBytes) missing('actual_immutable_rootfs_tool_bytes');
  check('actual_tool_bytes', externalByteSource && toolBytes?.source === 'immutable-image-rootfs' && toolBytes?.independentlyRead === true && toolBytes?.imageId === snapshot.image.id && same(toolBytes?.rootfsLayers ?? null, snapshot.image.rootfsLayers) && Array.isArray(toolBytes?.entries) && toolBytes.entries.length === policy.tools.length && policy.tools.every(tool => toolBytes.entries.filter(entry => entry.path === tool.path && entry.sha256 === tool.sha256 && entry.mode === tool.mode && entry.fileType === 'regular' && integer(entry.sizeInBytes)).length === 1));
  const closure = toolBytes?.rootfsClosure;
  if (!closure) missing('actual_whole_rootfs_byte_closure');
  const imageContainer = closure?.imageContainer;
  check('whole_rootfs_byte_closure', externalByteSource && closure?.source === 'docker-cp-stopped-image-container' && CONTAINER_ID.test(closure?.containerId ?? '') && closure?.imageId === snapshot.image.id && same(closure?.rootfsLayers ?? null, snapshot.image.rootfsLayers) && DIGEST.test(closure?.archiveDigest ?? '') && DIGEST.test(closure?.entryInventoryFingerprint ?? '') && integer(closure?.byteCount) && integer(closure?.entryCount) && closure?.complete === true && imageContainer?.id === closure?.containerId && imageContainer?.imageId === snapshot.image.id && imageContainer?.status === 'created' && imageContainer?.running === false && imageContainer?.started === false && imageContainer?.readonlyRootfs === true && Array.isArray(imageContainer?.mounts) && imageContainer.mounts.length === 0);
  const mounts = authority.mountInputs;
  if (!mounts) missing('sealed_source_and_dependency_bytes');
  check('sealed_mount_input_bytes', externalByteSource && Array.isArray(mounts) && mounts.length === policy.container.mounts.length && policy.container.mounts.every(mount => mounts.filter(entry => entry.source === mount.source && entry.destination === mount.destination && entry.treeFingerprint === mount.treeFingerprint && entry.immutable === true && entry.hostCandidateWritable === false && entry.sourceType === 'directory' && entry.containsSockets === false && entry.containsDevices === false && entry.containsFifos === false && entry.containsEscapingSymlinks === false).length === 1));
}

/**
 * This is a comparison oracle: `closedProfileValid` can be true only with a
 * complete independently authenticated supervisor receipt and actual bytes.
 * `verified` ALWAYS remains false, as do skip decisions; no producer attestation
 * or production candidate-reuse mode is enabled. Real inspect-only snapshots
 * report which constraints were measured and exactly which facts are missing.
 */
export function validateClosedRuntime(options = {}) {
  const result = { profile: CLOSED_RUNTIME_PROFILE, skip: false, runFull: true, verified: false, closedProfileValid: false, structureValid: false, executionValid: false, toolBytesValid: false, toolchainClosureComplete: false, mountInputsValid: false, authorityBound: false, checks: [], structureChecks: [], executionChecks: [], authorityChecks: [], missingFacts: [], reasons: [] };
  const missing = fact => { if (!result.missingFacts.includes(fact)) result.missingFacts.push(fact); };
  const check = (name, passed) => { result.checks.push({ name, passed: passed === true }); if (passed !== true && !result.reasons.includes(name)) result.reasons.push(name); };
  try {
    const { snapshot, executionSnapshot, authority, policy } = options ?? {};
    if (!policyValid(policy)) { check('invalid_closed_profile_policy', false); return result; }
    result.profile = policy.profile;
    if (!snapshot || snapshot.schemaVersion !== 1) { missing('docker_snapshot'); check('snapshot_missing_or_unknown', false); return result; }
    const { fingerprint: recorded, ...payload } = snapshot;
    check('snapshot_fingerprint', DIGEST.test(recorded ?? '') && recorded === fingerprint(payload) && time(snapshot.collectedAt));
    structure(snapshot, policy, check);
    result.structureChecks = [...result.checks];
    result.structureValid = result.reasons.length === 0;
    const beforeExecution = result.checks.length;
    if (!executionSnapshot) {
      missing('terminal_docker_snapshot');
      check('terminal_docker_snapshot', false);
    } else {
      const { fingerprint: finalFingerprint, ...finalPayload } = executionSnapshot;
      check('terminal_snapshot_fingerprint', executionSnapshot.schemaVersion === 1 && DIGEST.test(finalFingerprint ?? '') && finalFingerprint === fingerprint(finalPayload) && time(executionSnapshot.collectedAt));
      structure(executionSnapshot, policy, (name, passed) => check(`terminal:${name}`, passed), 'terminal');
      check('same_configuration_before_and_after', configurationFingerprint(snapshot) === configurationFingerprint(executionSnapshot));
      check('execution_after_pre_capture', Date.parse(snapshot.collectedAt) <= Date.parse(executionSnapshot.container.state.startedAt));
    }
    result.executionChecks = result.checks.slice(beforeExecution);
    result.executionValid = result.structureValid && result.executionChecks.every(item => item.passed);
    const beforeAuthority = result.checks.length;
    // Image bytes can be completely measured while host QEMU/binfmt bytes
    // remain outside that image. Preserve the real execution measurements,
    // but refuse to claim a complete toolchain closure for emulated execution.
    const native = nativeArchitecture(snapshot.daemon?.architecture) === snapshot.image?.architecture;
    if (!native) missing('external_emulator_byte_closure');
    check('native_toolchain_byte_closure', native);
    authorityProof(snapshot, executionSnapshot, authority, policy, check, missing);
    result.authorityChecks = result.checks.slice(beforeAuthority);
    const passed = name => result.authorityChecks.some(item => item.name === name && item.passed);
    result.toolBytesValid = passed('actual_tool_bytes') && passed('whole_rootfs_byte_closure');
    result.toolchainClosureComplete = result.toolBytesValid && native;
    result.mountInputsValid = passed('sealed_mount_input_bytes');
    result.authorityBound = ['protected_supervisor_policy', 'supervisor_authority', 'independent_inspect_binding', 'supervisor_before_candidate_code'].every(passed);
    if (!authority) {
      missing('actual_immutable_rootfs_tool_bytes');
      missing('actual_whole_rootfs_byte_closure');
      missing('sealed_source_and_dependency_bytes');
    }
    result.closedProfileValid = result.reasons.length === 0 && result.missingFacts.length === 0;
  } catch {
    result.closedProfileValid = false;
    result.structureValid = false;
    check('runtime_validation_exception', false);
  }
  return result;
}
