/** An external controller measures a real, tightly scoped execution. No skip authorization. */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fingerprint } from './ci-candidate-evidence.mjs';
import { collectDockerRuntime, configurationFingerprint, validateClosedRuntime } from './ci-candidate-runtime.mjs';
import { probeMaterializedSource } from './ci-candidate-source.mjs';
import { materializeGitInput, verifyGitInput } from './ci-candidate-pilot-source.mjs';

export const PILOT_SUITE = 'ci-candidate-evidence-core';
export const PILOT_ARGV = ['/usr/local/bin/node', '--test', '/input/.harness/scripts/ci-candidate-evidence.test.mjs'];
export const PILOT_DEFINITIONS = ['.harness/scripts/ci-candidate-evidence.test.mjs', '.harness/scripts/lib/ci-candidate-evidence.mjs'];
const ID = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const requireFact = (value, reason) => { if (!value) throw new Error(reason); };
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const now = () => new Date().toISOString();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ROOTFS_LIMIT = 1024 ** 3;
const officialNodeReference = ref => typeof ref === 'string' ? ref.replace(/^docker\.io\/library\//, '') : ref;

export function validatePilotPolicy(policy) {
  requireFact(policy?.schemaVersion === 1 && policy.suite === PILOT_SUITE, 'pilot_policy_scope_invalid');
  requireFact(/^(?:docker\.io\/library\/)?node@sha256:[a-f0-9]{64}$/.test(policy.image?.reference ?? '') && ['linux/amd64', 'linux/arm64'].includes(policy.image?.platform) && policy.image?.nodeBinary === PILOT_ARGV[0], 'pilot_image_policy_invalid');
  requireFact(DIGEST.test(policy.image.configDigest ?? '') && Array.isArray(policy.image.rootfsLayers) && policy.image.rootfsLayers.length > 0 && policy.image.rootfsLayers.every(layer => DIGEST.test(layer)), 'pilot_oci_config_and_rootfs_pins_missing');
  requireFact(same(policy.command?.argv, PILOT_ARGV) && policy.command?.expectedTests === 175, 'pilot_command_not_protected');
  const pins = policy.command.definitionBlobs;
  requireFact(Array.isArray(pins) && pins.length === 2 && same(pins.map(pin => pin.path).sort(), [...PILOT_DEFINITIONS].sort()) && pins.every(pin => /^[a-f0-9]{40}$/.test(pin.oid)), 'pilot_definition_pins_missing');
  const { uid, gid } = policy.isolation ?? {};
  requireFact(uid === 65532 && gid === 65532, 'pilot_nonroot_identity_invalid');
  const limits = policy.limits;
  requireFact(Number.isSafeInteger(limits?.timeoutMs) && limits.timeoutMs >= 1000 && limits.timeoutMs <= 120_000 && Number.isSafeInteger(limits?.maxLogBytes) && limits.maxLogBytes >= 1024 && limits.maxLogBytes <= 2_000_000 && limits?.memoryBytes === 536_870_912 && limits?.pidsLimit === 128, 'pilot_resource_policy_invalid');
  requireFact((policy.mode ?? 'shadow') === 'shadow' && (limits.maxSourceBytes ?? 2 * 1024 ** 3) === 2 * 1024 ** 3 && (limits.maxSourceFileBytes ?? 32 * 1024 ** 2) === 32 * 1024 ** 2, 'pilot_shadow_or_source_budget_invalid');
  return policy;
}

/** Only trusted controller code calls this seam; candidate data never supplies argv/env. */
export async function executeDocker(args, options = {}) {
  const { timeoutMs = 30_000, maxStdoutBytes = 2_000_000, maxStderrBytes = 2_000_000, stdoutFile, stderrFile } = options;
  const env = {};
  for (const key of ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) if (process.env[key]) env[key] = process.env[key];
  const stdoutHash = createHash('sha256'), stderrHash = createHash('sha256');
  const stdoutParts = [], stderrParts = [];
  let stdoutBytes = 0, stderrBytes = 0, truncated = false, timedOut = false, ioError = false;
  const stdoutFd = stdoutFile ? openSync(stdoutFile, 'wx', 0o600) : null;
  const stderrFd = stderrFile ? openSync(stderrFile, 'wx', 0o600) : null;
  const child = spawn('docker', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length; stdoutHash.update(chunk);
    if (stdoutBytes > maxStdoutBytes) { truncated = true; child.kill('SIGKILL'); return; }
    try { if (stdoutFd !== null) writeSync(stdoutFd, chunk); else stdoutParts.push(chunk); } catch { ioError = true; child.kill('SIGKILL'); }
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length; stderrHash.update(chunk);
    if (stderrBytes > maxStderrBytes) { truncated = true; child.kill('SIGKILL'); return; }
    try { if (stderrFd !== null) writeSync(stderrFd, chunk); else stderrParts.push(chunk); } catch { ioError = true; child.kill('SIGKILL'); }
  });
  try {
    const result = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (status, signal) => done({ status, signal })); });
    return { ...result, stdout: Buffer.concat(stdoutParts), stderr: Buffer.concat(stderrParts), stdoutBytes, stderrBytes,
      stdoutDigest: `sha256:${stdoutHash.digest('hex')}`, stderrDigest: `sha256:${stderrHash.digest('hex')}`, truncated, timedOut, ioError };
  } finally { clearTimeout(timer); if (stdoutFd !== null) closeSync(stdoutFd); if (stderrFd !== null) closeSync(stderrFd); }
}
const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
function successful(result, reason) { requireFact(result?.status === 0 && !result.timedOut && !result.truncated && !result.signal && !result.ioError, reason); return result; }
function json(result, reason) { const value = JSON.parse(text(successful(result, reason).stdout)); return value; }
const singleton = value => { requireFact(Array.isArray(value) && value.length === 1, 'docker_inspect_not_singleton'); return value[0]; };

/** Missing daemon fields stay null; never backfill an observation from policy. */
export function observeContainerResources(container) {
  const host = container?.HostConfig;
  return { memoryBytes: host?.Memory ?? null, memorySwapBytes: host?.MemorySwap ?? null, pidsLimit: host?.PidsLimit ?? null,
    autoRemove: host?.AutoRemove ?? null, restartPolicy: host?.RestartPolicy ?? null };
}

export function pilotCreateArgs({ policy, imageId, sourceDirectory, nonce, role = 'candidate' }) {
  requireFact(DIGEST.test(imageId) && /^[a-f0-9-]{36}$/.test(nonce), 'pilot_create_identity_invalid');
  const args = ['create', '--name', `ci-candidate-pilot-${role}-${nonce}`, '--label', `ci-candidate-pilot.nonce=${nonce}`, '--label', `ci-candidate-pilot.role=${role}`,
    '--platform', policy.image.platform, '--read-only', '--network', 'none', '--ipc', 'private', '--cgroupns', 'private',
    '--user', '65532:65532', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '536870912',
    '--memory-swap', '536870912', '--runtime', 'runc', '--restart', 'no', '--workdir', '/input',
    '--tmpfs', '/out:rw,nosuid,nodev,noexec,size=64m,uid=65532,gid=65532,mode=0700',
    '--env', 'PATH=/usr/local/bin:/usr/bin:/bin', '--env', 'HOME=/out', '--env', 'TMPDIR=/out', '--env', 'CI=true', '--env', 'VITEST=',
    '--entrypoint', PILOT_ARGV[0]];
  if (sourceDirectory) {
    requireFact(!/[,:\r\n]/.test(sourceDirectory), 'source_mount_path_invalid');
    args.push('--mount', `type=bind,source=${sourceDirectory},target=/input,readonly,bind-propagation=rprivate,bind-recursive=disabled`);
  }
  args.push(imageId, ...(role === 'candidate' ? PILOT_ARGV.slice(1) : ['--version']));
  return args;
}

/** Parse data only; never extract or execute image files or invoke candidate ldd. */
export async function inspectRootfsTar(path) {
  const iterator = createReadStream(path)[Symbol.asyncIterator]();
  const archiveHash = createHash('sha256');
  let pending = Buffer.alloc(0), total = 0;
  const take = async (size, consume) => {
    const parts = [];
    while (size) {
      if (!pending.length) { const next = await iterator.next(); requireFact(!next.done, 'image_rootfs_tar_truncated'); pending = next.value; archiveHash.update(pending); }
      const count = Math.min(size, pending.length), bytes = pending.subarray(0, count);
      if (consume) consume(bytes); else parts.push(bytes);
      pending = pending.subarray(count); size -= count; total += count;
      requireFact(total <= ROOTFS_LIMIT, 'image_rootfs_over_budget');
    }
    return consume ? null : Buffer.concat(parts);
  };
  const string = buffer => buffer.toString('utf8').replace(/\0.*$/s, '');
  const numeric = buffer => { const value = string(buffer).trim(); requireFact(/^[0-7]*$/.test(value), 'image_tar_numeric_invalid'); return parseInt(value || '0', 8); };
  const safe = value => { let name = value.replace(/^\.\//, '').replace(/\/$/, ''); if (['.', ''].includes(name)) return ''; requireFact(!name.startsWith('/') && !/[\x00-\x1f\x7f\\]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..'), 'image_tar_path_invalid'); return `/${name}`; };
  const entries = [], nodePrefixes = new Map();
  let pax = {}, globalPax = {}, longPath = null, longLink = null, zeroHeaders = 0;
  while (true) {
    const header = await take(512);
    if (header.every(byte => byte === 0)) { if (++zeroHeaders === 2) break; continue; }
    requireFact(zeroHeaders === 0, 'image_tar_mixed_end_marker');
    const expected = numeric(header.subarray(148, 156));
    let checksum = 0; for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    requireFact(expected === checksum, 'image_tar_header_checksum_invalid');
    const type = String.fromCharCode(header[156] || 48);
    let size = numeric(header.subarray(124, 136));
    if (['x', 'g', 'L', 'K'].includes(type)) {
      requireFact(size <= 1024 ** 2, 'image_tar_metadata_over_budget');
      const data = await take(size); await take((512 - size % 512) % 512);
      if (type === 'L') longPath = string(data).replace(/\n$/, '');
      else if (type === 'K') longLink = string(data).replace(/\n$/, '');
      else {
        const values = {}; let offset = 0;
        while (offset < data.length) { const space = data.indexOf(32, offset), length = Number(data.subarray(offset, space).toString('ascii'));
          requireFact(space > offset && Number.isSafeInteger(length) && length > space - offset && offset + length <= data.length, 'image_tar_pax_invalid');
          const line = data.subarray(space + 1, offset + length - 1).toString('utf8'), equal = line.indexOf('=');
          requireFact(equal > 0, 'image_tar_pax_invalid'); values[line.slice(0, equal)] = line.slice(equal + 1); offset += length; }
        if (type === 'g') globalPax = { ...globalPax, ...values }; else pax = values;
      }
      continue;
    }
    const metadata = { ...globalPax, ...pax };
    const prefix = string(header.subarray(345, 500));
    const name = metadata.path ?? longPath ?? `${prefix ? `${prefix}/` : ''}${string(header.subarray(0, 100))}`;
    const path = safe(name);
    if (metadata.size) { requireFact(/^[0-9]+$/.test(metadata.size), 'image_tar_pax_size_invalid'); size = Number(metadata.size); }
    requireFact(Number.isSafeInteger(size) && size >= 0 && size <= ROOTFS_LIMIT, 'image_tar_entry_size_invalid');
    const mode = numeric(header.subarray(100, 108)) & 0o7777;
    const target = metadata.linkpath ?? longLink ?? string(header.subarray(157, 257));
    requireFact(['0', '1', '2', '5'].includes(type) && (!['1', '2', '5'].includes(type) || size === 0), 'unsupported_image_rootfs_entry');
    const hash = createHash('sha256'); let nodePrefix = Buffer.alloc(0);
    await take(size, bytes => { hash.update(bytes); if (path === PILOT_ARGV[0] && nodePrefix.length < 65_536) nodePrefix = Buffer.concat([nodePrefix, bytes.subarray(0, 65_536 - nodePrefix.length)]); });
    await take((512 - size % 512) % 512);
    if (path) entries.push({ path, type: type === '0' ? 'regular' : type === '1' ? 'hardlink' : type === '2' ? 'symlink' : 'directory', mode: mode.toString(8).padStart(4, '0'), sizeInBytes: size, ...(type === '0' ? { sha256: `sha256:${hash.digest('hex')}` } : target ? { target } : {}), ...(Object.keys(metadata).length ? { pax: metadata } : {}) });
    if (nodePrefix.length) nodePrefixes.set(path, nodePrefix);
    pax = {}; longPath = null; longLink = null;
  }
  // Remaining blocks may only be ordinary tar padding.
  requireFact(pending.every(byte => byte === 0), 'image_tar_trailing_data');
  for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) { archiveHash.update(chunk); total += chunk.length; requireFact(total <= ROOTFS_LIMIT && chunk.every(byte => byte === 0), 'image_tar_trailing_data'); }
  requireFact(entries.length > 0 && entries.length <= 100_000 && new Set(entries.map(entry => entry.path)).size === entries.length, 'image_tar_inventory_invalid');
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  function regular(path) {
    for (let depth = 0; depth < 40; depth++) {
      const direct = byPath.get(path);
      if (direct?.type === 'regular') return direct;
      if (direct?.type === 'hardlink') { path = safe(direct.target.replace(/^\//, '')); continue; }
      if (direct?.type === 'symlink') { path = posix.resolve(posix.dirname(path), direct.target); continue; }
      let parent = posix.dirname(path), changed = false;
      while (parent !== '/') { const link = byPath.get(parent); if (link?.type === 'symlink') { path = posix.join(posix.resolve(posix.dirname(parent), link.target), posix.relative(parent, path)); changed = true; break; } parent = posix.dirname(parent); }
      requireFact(changed, 'image_runtime_link_unresolved');
    }
    throw new Error('image_runtime_symlink_cycle');
  }
  const node = regular(PILOT_ARGV[0]);
  requireFact(node.sizeInBytes > 0 && ['0755', '0555'].includes(node.mode), 'image_node_not_regular_executable');
  const elf = nodePrefixes.get(node.path);
  requireFact(elf && elf.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && elf[4] === 2 && elf[5] === 1, 'image_node_elf_unsupported');
  const offset = Number(elf.readBigUInt64LE(32)), entrySize = elf.readUInt16LE(54), count = elf.readUInt16LE(56);
  requireFact(entrySize >= 56 && count > 0 && offset + entrySize * count <= elf.length, 'image_node_elf_headers_unclosed');
  let interpreter = null;
  for (let index = 0; index < count; index++) { const at = offset + entrySize * index;
    if (elf.readUInt32LE(at) === 3) { const start = Number(elf.readBigUInt64LE(at + 8)), size = Number(elf.readBigUInt64LE(at + 32)); requireFact(start + size <= elf.length, 'image_node_interpreter_unclosed'); interpreter = string(elf.subarray(start, start + size)); } }
  requireFact(typeof interpreter === 'string' && interpreter.startsWith('/'), 'image_node_loader_missing');
  const loader = regular(interpreter);
  const libraries = entries.filter(entry => entry.type === 'regular' && /(?:^|\/)[^/]+\.so(?:\.|$)/.test(entry.path));
  requireFact(libraries.length > 0, 'image_dynamic_library_inventory_empty');
  return { complete: true, scope: 'whole-stopped-image-rootfs-bytes', archiveDigest: `sha256:${archiveHash.digest('hex')}`, archiveBytes: lstatSync(path).size,
    inventoryFingerprint: fingerprint(entries.sort((a, b) => a.path < b.path ? -1 : 1)), entryCount: entries.length, entries,
    node: { ...node, fileType: 'regular' }, loader: { requestedPath: interpreter, ...loader, fileType: 'regular' }, libraries };
}

function readonlyCleanup(path) {
  if (!existsSync(path)) return;
  const walk = directory => { chmodSync(directory, 0o700); for (const name of readdirSync(directory)) { const child = join(directory, name); if (lstatSync(child).isDirectory()) walk(child); } };
  walk(path); rmSync(path, { recursive: true, force: true });
}

export async function runCandidatePilot({ repositoryRoot, candidateSha, outputDirectory, policy, executor = executeDocker } = {}) {
  const startedAt = now();
  validatePilotPolicy(policy);
  let output = resolve(outputDirectory);
  requireFact(!existsSync(output), 'pilot_receipt_directory_already_exists');
  mkdirSync(output, { recursive: true, mode: 0o700 });
  output = realpathSync(output);
  const input = join(output, 'input');
  const nonce = randomUUID();
  const owned = [];
  const receipt = { schemaVersion: 1, profile: 'closed-node-no-install-v1', scope: 'local-unprotected', protectedVerified: false, verified: false,
    runFull: true, skip: false, reuseAuthorized: false, suite: policy.suite, policyFingerprint: fingerprint(policy),
    controller: { startedAt, nonce, candidateCodeExecutedOnHost: false }, suiteExecuted: false, executionSuccessful: false, measurementComplete: false, proofComplete: false, blockers: ['protected_supervisor_authority_not_supplied'] };
  let cancelled = null, cancellationCleanup;
  const cancel = signal => {
    if (cancelled) return;
    cancelled = signal; receipt.controller.interrupted = signal;
    // A cancelled docker wait client does not kill its container. Stop only IDs
    // returned by this controller's successful create before normal finally.
    cancellationCleanup = Promise.all(owned.map(id => executor(['kill', id]).catch(() => ({ status: 1 }))));
  };
  const onTerm = () => cancel('SIGTERM'), onInt = () => cancel('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  const docker = async (args, options = {}) => { requireFact(!cancelled, 'pilot_controller_cancelled'); return executor(args, options); };
  const read = async args => text(successful(await docker(args), 'docker_read_failed').stdout);
  async function create(role, imageId, sourceDirectory) {
    const args = pilotCreateArgs({ policy, imageId, sourceDirectory, nonce, role });
    let id;
    try { const result = await docker(args); if (result.status !== 0 || result.timedOut || result.truncated) receipt.controller.dockerCreateError = { status: result.status, stderr: text(result.stderr).slice(0, 2048) }; id = text(successful(result, 'docker_create_failed').stdout).trim(); requireFact(ID.test(id), 'docker_create_id_invalid'); }
    catch (error) {
      // A lost create response is recovered only by this unique nonce-labelled
      // name. Never enumerate, prune, or remove unrelated containers.
      try { const value = singleton(json(await docker(['container', 'inspect', `ci-candidate-pilot-${role}-${nonce}`]), 'docker_recovery_failed'));
        if (ID.test(value.Id) && value.Config?.Labels?.['ci-candidate-pilot.nonce'] === nonce && value.Config.Labels['ci-candidate-pilot.role'] === role) owned.push(value.Id);
      } catch { /* preserve original failure */ }
      throw error;
    }
    // This exact ID was returned by our own successful create; keep it for
    // cleanup even if a following inspect fails. Never discover IDs broadly.
    owned.push(id);
    const value = singleton(json(await docker(['container', 'inspect', id]), 'created_container_unreadable'));
    requireFact(value.Id === id && value.Config?.Labels?.['ci-candidate-pilot.nonce'] === nonce && value.Config.Labels['ci-candidate-pilot.role'] === role, 'created_container_ownership_mismatch');
    return id;
  }
  let source;
  try {
    source = await materializeGitInput({ repositoryRoot, candidateSha, destination: input, definitionBlobs: policy.command.definitionBlobs });
    receipt.gitInput = { sha: source.sha, tree: source.tree, parents: source.parents, entriesFingerprint: source.entriesFingerprint,
      materializedFingerprint: source.materializedFingerprint, fileCount: source.fileCount, totalBytes: source.totalBytes, definitionBlobs: policy.command.definitionBlobs };
    const probe = await probeMaterializedSource({ root: input, expectedSha: source.sha, expectedTree: source.tree, gitEntries: source.entries,
      dependencyRoots: [], dependencyProfile: 'protected-no-install', testInventory: { suite: policy.suite, tests: [{ file: PILOT_DEFINITIONS[0], project: 'node:test-whole-file', id: 'protected-fixed-entrypoint' }] },
      limits: { maxBytes: 2 * 1024 ** 3, maxFileBytes: 32 * 1024 ** 2, maxFiles: 100_000 } });
    requireFact(probe.complete === true, `source_probe_incomplete:${(probe.reasons ?? probe.missingFacts ?? []).join(',')}`);
    receipt.sourceProbe = probe;
    const image = singleton(json(await docker(['image', 'inspect', policy.image.reference]), 'immutable_image_not_available'));
    const allowedImageIds = [policy.image.reference.slice(policy.image.reference.indexOf('@') + 1), policy.image.configDigest];
    requireFact(allowedImageIds.includes(image.Id) && Array.isArray(image.RepoDigests) && image.RepoDigests.some(ref => officialNodeReference(ref) === officialNodeReference(policy.image.reference)) && image.Os === 'linux' && image.Architecture === policy.image.platform.split('/')[1] && image.RootFS?.Type === 'layers' && same(image.RootFS.Layers, policy.image.rootfsLayers), 'immutable_image_identity_mismatch');
    requireFact(!image.Config?.Volumes && (image.Config?.Env ?? []).every(value => /^(PATH|NODE_VERSION|YARN_VERSION)=/.test(value)), 'image_hidden_volume_or_environment');
    receipt.image = { reference: policy.image.reference, imageId: image.Id, platform: policy.image.platform, rootfsLayers: image.RootFS.Layers };
    const probeId = await create('rootfs', image.Id);
    const archivePath = join(output, 'image-rootfs.tar');
    const copied = successful(await docker(['cp', `${probeId}:/.`, '-'], { stdoutFile: archivePath, maxStdoutBytes: ROOTFS_LIMIT, timeoutMs: 120_000 }), 'image_rootfs_copy_failed');
    const closure = await inspectRootfsTar(archivePath);
    requireFact(closure.archiveDigest === copied.stdoutDigest && closure.archiveBytes === copied.stdoutBytes, 'image_rootfs_archive_digest_mismatch');
    const probeAfter = singleton(json(await docker(['container', 'inspect', probeId]), 'image_probe_identity_unreadable'));
    requireFact(probeAfter.Id === probeId && probeAfter.Image === image.Id && probeAfter.State?.Status === 'created' && probeAfter.State.Running === false && probeAfter.RestartCount === 0, 'image_probe_ran_or_changed');
    const toolEntries = [...new Map([closure.node, closure.loader, ...closure.libraries].map(entry => [entry.path, { path: entry.path, sha256: entry.sha256, mode: entry.mode, sizeInBytes: entry.sizeInBytes, fileType: 'regular' }])).values()].sort((a, b) => a.path < b.path ? -1 : 1);
    writeFileSync(join(output, 'image-rootfs-inventory.json'), `${JSON.stringify(closure.entries)}\n`, { flag: 'wx', mode: 0o600 });
    receipt.toolchainClosure = { source: 'immutable-image-rootfs', independentlyRead: true, imageId: image.Id, rootfsLayers: image.RootFS.Layers,
      entries: toolEntries,
      rootfsClosure: { source: 'docker-cp-stopped-image-container', containerId: probeId, imageId: image.Id, rootfsLayers: image.RootFS.Layers,
        archiveDigest: closure.archiveDigest, entryInventoryFingerprint: closure.inventoryFingerprint, byteCount: closure.archiveBytes, entryCount: closure.entryCount, complete: true,
        imageContainer: { id: probeId, imageId: image.Id, status: probeAfter.State.Status, running: probeAfter.State.Running, started: probeAfter.State.StartedAt !== '0001-01-01T00:00:00Z', readonlyRootfs: probeAfter.HostConfig.ReadonlyRootfs, mounts: probeAfter.Mounts } } };
    // Persist the measured-byte receipt and inventory before deleting only the
    // large archive created above. Candidate containers never mount this folder.
    writeFileSync(join(output, 'image-rootfs-summary.json'), `${JSON.stringify({ schemaVersion: 1, image: receipt.image, toolBytes: receipt.toolchainClosure })}\n`, { flag: 'wx', mode: 0o600 });
    rmSync(archivePath);
    receipt.rootfsArchiveDiscarded = true;
    const id = await create('candidate', image.Id, input);
    const before = await collectDockerRuntime({ containerId: id, execute: read });
    requireFact(before.readStatus === 'ok', 'container_preinspect_failed');
    receipt.preExecutionSnapshot = before.snapshot;
    const actualRaw = singleton(json(await docker(['container', 'inspect', id]), 'candidate_configuration_unreadable'));
    receipt.resourceObservation = { pre: observeContainerResources(actualRaw) };
    const expectedEnv = [...(image.Config.Env ?? [])];
    for (const value of ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/out', 'TMPDIR=/out', 'CI=true', 'VITEST=']) { const key = value.split('=')[0]; const at = expectedEnv.findIndex(entry => entry.startsWith(`${key}=`)); if (at >= 0) expectedEnv[at] = value; else expectedEnv.push(value); }
    requireFact(Array.isArray(actualRaw.Config.Env) && new Set(actualRaw.Config.Env.map(value => value.split('=')[0])).size === expectedEnv.length && same([...actualRaw.Config.Env].sort(), [...expectedEnv].sort()), 'candidate_environment_not_exact');
    const env = actualRaw.Config.Env;
    const runtimePolicy = { profile: receipt.profile, image: { ref: image.RepoDigests.find(ref => officialNodeReference(ref) === officialNodeReference(policy.image.reference)), id: image.Id, os: 'linux', architecture: image.Architecture, rootfsLayers: image.RootFS.Layers },
      container: { user: '65532:65532', workingDir: '/input', entrypoint: [PILOT_ARGV[0]], cmd: PILOT_ARGV.slice(1), env,
        mounts: [{ source: input, destination: '/input', treeFingerprint: source.materializedFingerprint }], outputTmpfs: { destination: '/out', options: 'rw,nosuid,nodev,noexec,size=64m,uid=65532,gid=65532,mode=0700' } },
      tools: toolEntries.map(({ path, sha256, mode }) => ({ path, sha256, mode })) };
    receipt.runtimePolicy = runtimePolicy;
    const preValidation = validateClosedRuntime({ snapshot: before.snapshot, policy: runtimePolicy });
    requireFact(preValidation.structureValid === true, `candidate_container_not_closed:${preValidation.reasons.join(',')}`);
    requireFact(same(receipt.resourceObservation.pre, { memoryBytes: policy.limits.memoryBytes, memorySwapBytes: policy.limits.memoryBytes, pidsLimit: policy.limits.pidsLimit, autoRemove: false, restartPolicy: { Name: 'no', MaximumRetryCount: 0 } }), 'candidate_resource_or_restart_policy_changed');
    const actualInput = verifyGitInput({ root: input, entries: source.entries });
    requireFact(actualInput.fingerprint === source.materializedFingerprint, 'candidate_input_changed_before_start');
    receipt.execution = { startedAt: now(), actualArgv: [...actualRaw.Config.Entrypoint, ...actualRaw.Config.Cmd], timedOut: false };
    successful(await docker(['start', id]), 'candidate_start_failed');
    receipt.suiteExecuted = true;
    const waited = await docker(['wait', id], { timeoutMs: policy.limits.timeoutMs });
    if (waited.timedOut) {
      receipt.execution.timedOut = true;
      await docker(['kill', id]);
    } else successful(waited, 'candidate_wait_failed');
    const after = await collectDockerRuntime({ containerId: id, execute: read });
    requireFact(after.readStatus === 'ok', 'container_postinspect_failed');
    receipt.postExecutionSnapshot = after.snapshot;
    const terminal = singleton(json(await docker(['container', 'inspect', id]), 'candidate_terminal_unreadable'));
    receipt.resourceObservation.post = observeContainerResources(terminal);
    requireFact(same(receipt.resourceObservation.pre, receipt.resourceObservation.post), 'candidate_resource_configuration_changed');
    receipt.execution = { ...receipt.execution, finishedAt: now(), daemonExitCode: terminal.State?.ExitCode, oomKilled: terminal.State?.OOMKilled, daemonError: terminal.State?.Error,
      daemonStartedAt: terminal.State?.StartedAt, daemonFinishedAt: terminal.State?.FinishedAt, status: terminal.State?.Status };
    requireFact(terminal.Id === id && terminal.Image === image.Id && terminal.State?.Status === 'exited' && terminal.State.Running === false && terminal.RestartCount === 0, 'candidate_terminal_identity_changed');
    requireFact(configurationFingerprint(before.snapshot) === configurationFingerprint(after.snapshot), 'candidate_runtime_configuration_changed');
    const logs = await docker(['logs', id], { stdoutFile: join(output, 'candidate.stdout'), stderrFile: join(output, 'candidate.stderr'), maxStdoutBytes: policy.limits.maxLogBytes, maxStderrBytes: policy.limits.maxLogBytes });
    successful(logs, 'candidate_log_capture_incomplete');
    receipt.outputDigests = { stdout: { digest: logs.stdoutDigest, bytes: logs.stdoutBytes }, stderr: { digest: logs.stderrDigest, bytes: logs.stderrBytes }, candidateControlled: true };
    const diagnostic = readFileSync(join(output, 'candidate.stdout'), 'utf8');
    receipt.execution.diagnostic = { untrustedCandidateOutput: true, expectedTests: 175, reportedTests: Number(diagnostic.match(/^# tests ([0-9]+)$/m)?.[1]) || null };
    const postInput = verifyGitInput({ root: input, entries: source.entries });
    requireFact(postInput.fingerprint === source.materializedFingerprint, 'candidate_input_changed_during_execution');
    const authority = { source: 'local-controller', apiVerified: false, toolBytes: receipt.toolchainClosure,
      mountInputs: [{ source: input, destination: '/input', treeFingerprint: source.materializedFingerprint, immutable: true, hostCandidateWritable: false,
        sourceType: 'directory', containsSockets: false, containsDevices: false, containsFifos: false, containsEscapingSymlinks: false }] };
    receipt.runtimeValidation = validateClosedRuntime({ snapshot: before.snapshot, executionSnapshot: after.snapshot, authority, policy: runtimePolicy });
    receipt.fullyMaterializedToolchain = receipt.runtimeValidation.toolchainClosureComplete === true;
    requireFact(receipt.runtimeValidation.structureValid && receipt.runtimeValidation.executionValid && receipt.runtimeValidation.toolBytesValid && receipt.runtimeValidation.mountInputsValid, `runtime_execution_incomplete:${receipt.runtimeValidation.reasons.join(',')}`);
    requireFact(!receipt.execution.timedOut && terminal.State.ExitCode === 0 && terminal.State.OOMKilled === false && terminal.State.Error === '' && text(waited.stdout).trim() === '0', 'candidate_failed_or_killed');
    receipt.executionSuccessful = true;
    receipt.measurementComplete = true;
    receipt.proofComplete = receipt.runtimeValidation.toolchainClosureComplete === true;
    if (!receipt.proofComplete) receipt.blockers.push('external_emulator_byte_closure');
  } catch (error) {
    receipt.blockers.push(error?.message ?? 'pilot_controller_exception');
  } finally {
    await cancellationCleanup;
    if (cancelled) { receipt.proofComplete = false; receipt.measurementComplete = false; receipt.executionSuccessful = false; if (!receipt.blockers.includes('pilot_controller_cancelled')) receipt.blockers.push('pilot_controller_cancelled'); }
    receipt.cleanup = [];
    for (const id of [...owned].reverse()) {
      const result = await executor(['rm', '--force', id]).catch(() => ({ status: 1 }));
      receipt.cleanup.push({ id, removed: result.status === 0 && !result.timedOut });
      if (result.status !== 0 || result.timedOut) { receipt.proofComplete = false; receipt.measurementComplete = false; receipt.blockers.push('owned_container_cleanup_failed'); }
    }
    if (existsSync(input)) { try { readonlyCleanup(input); receipt.inputRemoved = true; } catch { receipt.proofComplete = false; receipt.measurementComplete = false; receipt.blockers.push('owned_input_cleanup_failed'); } }
    receipt.controller.completedAt = now();
    receipt.receiptFingerprint = fingerprint(receipt);
    writeFileSync(join(output, 'pilot-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
  }
  return receipt;
}
