/**
 * Read-only, external verification of ONE protected no-install Node pilot.
 * Archive JSON is data until its completed default-main controller, complete
 * definition closure and actual archive bytes have independently been bound.
 * This is neither fullstack evidence nor an atomic lease/skip authorization.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fingerprint } from './ci-candidate-evidence.mjs';
import { githubPages, parseCheckoutIdentity, resolvePilotCandidate } from './ci-candidate-github.mjs';
import { gitTreeDigest } from './ci-candidate-source.mjs';
import { validateClosedRuntime } from './ci-candidate-runtime.mjs';
import { validatePilotPolicy } from './ci-candidate-pilot.mjs';

export const PILOT_RECEIPT_OBSERVER_PATH = '.github/workflows/ci-candidate-pilot-observer.yml';
const PILOT_PATH = '.github/workflows/ci-candidate-runtime-pilot.yml';
const POLICY_PATH = '.harness/config/ci-candidate-pilot.json';
const SOURCE_PATH = '.github/workflows/harness-verify.yml';
const STEP = 'Start trusted runtime supervisor';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{64}$/;
const integer = value => Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const same = (a, b) => fingerprint(a) === fingerprint(b);
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const requireFact = (value, reason) => { if (!value) { const error = new Error(reason); error.reason = reason; throw error; } };
const success = value => value?.status === 'completed' && value.conclusion === 'success';
const safePath = value => typeof value === 'string' && value && !value.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const sorted = list => [...list].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const INPUTS = new Set(['package.json', '.npmrc', 'pnpm-workspace.yaml', '.nvmrc', 'pnpm-lock.yaml']);
const closure = entries => entries.filter(entry => entry.path.startsWith('.harness/') || entry.path.startsWith('.github/') || INPUTS.has(entry.path));

const MEMBER_LIMITS = Object.freeze({
  'protected-bootstrap.json': 262_144,
  'pilot-supervisor-report.json': 12_000_000,
  'execution/pilot-receipt.json': 12_000_000,
  'execution/image-rootfs-inventory.json': 12_000_000,
  'execution/image-rootfs-summary.json': 2_000_000,
  'execution/candidate.stdout': 2_000_000,
  'execution/candidate.stderr': 2_000_000,
  'pilot-supervisor-summary.md': 65_536,
});
const REQUIRED_MEMBERS = Object.keys(MEMBER_LIMITS).filter(name => name !== 'pilot-supervisor-summary.md');

/** Ordinary ZIP only: no extraction, ZIP64, encryption, symlinks or executable entries. */
export function readBoundedPilotZip(bytes, limits = {}) {
  const maxArchiveBytes = Math.min(limits.maxArchiveBytes ?? 20_000_000, 20_000_000);
  const maxTotalBytes = Math.min(limits.maxTotalBytes ?? 48_000_000, 48_000_000);
  requireFact(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= maxArchiveBytes, 'pilot_zip_archive_budget');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  requireFact(end >= 0, 'pilot_zip_end_missing');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
  requireFact(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === count && count > 0 && count <= 10 && count !== 65_535 && centralSize !== 0xffffffff && centralOffset !== 0xffffffff && centralOffset + centralSize === end, 'pilot_zip_unsupported_layout');
  const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc32 = buffer => { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const extra = buffer => { let at = 0; while (at < buffer.length) { requireFact(at + 4 <= buffer.length, 'pilot_zip_extra_invalid'); const tag = buffer.readUInt16LE(at), size = buffer.readUInt16LE(at + 2); requireFact(tag !== 1 && at + 4 + size <= buffer.length, 'pilot_zip_zip64_or_extra_invalid'); at += 4 + size; } };
  let cursor = centralOffset, total = 0, previousEnd = 0;
  const files = new Map();
  for (let index = 0; index < count; index++) {
    requireFact(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'pilot_zip_central_invalid');
    const needed = bytes.readUInt16LE(cursor + 6), flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28), extraSize = bytes.readUInt16LE(cursor + 30), commentSize = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    requireFact(needed <= 20 && (flags & ~0x0808) === 0 && [0, 8].includes(method) && bytes.readUInt16LE(cursor + 34) === 0 && (mode & 0o170000) !== 0o120000 && compressed !== 0xffffffff && size !== 0xffffffff && offset !== 0xffffffff && nameSize > 0 && nameSize <= 256 && extraSize <= 4096 && commentSize <= 1024 && cursor + 46 + nameSize + extraSize + commentSize <= end, 'pilot_zip_unsupported_entry');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize), name = utf8(nameBytes);
    extra(bytes.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize));
    const directory = name === 'execution/';
    requireFact(directory ? [0, 0o040000].includes(mode & 0o170000) : [0, 0o100000].includes(mode & 0o170000), 'pilot_zip_nonregular_member');
    requireFact((directory || safePath(name)) && (directory || Object.hasOwn(MEMBER_LIMITS, name)) && !files.has(name), 'pilot_zip_member_not_allowed_or_duplicate');
    requireFact(size <= (directory ? 0 : MEMBER_LIMITS[name]) && (total += size) <= maxTotalBytes && offset === previousEnd && offset + 30 <= centralOffset && bytes.readUInt32LE(offset) === 0x04034b50, 'pilot_zip_member_budget_or_overlap');
    const localNameSize = bytes.readUInt16LE(offset + 26), localExtraSize = bytes.readUInt16LE(offset + 28), dataOffset = offset + 30 + localNameSize + localExtraSize;
    requireFact(bytes.readUInt16LE(offset + 4) === needed && bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method && localNameSize === nameSize && localExtraSize <= 4096 && dataOffset + compressed <= centralOffset && bytes.subarray(offset + 30, offset + 30 + localNameSize).equals(nameBytes), 'pilot_zip_local_central_mismatch');
    extra(bytes.subarray(offset + 30 + localNameSize, dataOffset));
    if (!(flags & 8)) requireFact(bytes.readUInt32LE(offset + 14) === crc && bytes.readUInt32LE(offset + 18) === compressed && bytes.readUInt32LE(offset + 22) === size, 'pilot_zip_local_size_mismatch');
    else requireFact([0, crc].includes(bytes.readUInt32LE(offset + 14)) && [0, compressed].includes(bytes.readUInt32LE(offset + 18)) && [0, size].includes(bytes.readUInt32LE(offset + 22)), 'pilot_zip_local_descriptor_mismatch');
    const compressedBytes = bytes.subarray(dataOffset, dataOffset + compressed);
    const inflated = method === 0 ? null : inflateRawSync(compressedBytes, { maxOutputLength: Math.max(1, Math.min(size, MEMBER_LIMITS[name] ?? 0)), info: true });
    requireFact(inflated === null || inflated.engine.bytesWritten === compressedBytes.length, 'pilot_zip_deflate_trailing_data');
    const output = inflated === null ? compressedBytes : inflated.buffer;
    requireFact(output.length === size && crc32(output) === crc, 'pilot_zip_size_or_crc_mismatch');
    previousEnd = dataOffset + compressed;
    if (flags & 8) {
      requireFact(previousEnd + 12 <= centralOffset, 'pilot_zip_descriptor_missing');
      if (bytes.readUInt32LE(previousEnd) === 0x08074b50) previousEnd += 4;
      requireFact(previousEnd + 12 <= centralOffset && bytes.readUInt32LE(previousEnd) === crc && bytes.readUInt32LE(previousEnd + 4) === compressed && bytes.readUInt32LE(previousEnd + 8) === size, 'pilot_zip_descriptor_mismatch');
      previousEnd += 12;
    }
    files.set(name, Buffer.from(output));
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  requireFact(cursor === end && previousEnd === centralOffset && REQUIRED_MEMBERS.every(name => files.has(name)), 'pilot_zip_required_member_missing');
  return { files, archiveDigest: hash(bytes), archiveBytes: bytes.length, uncompressedBytes: total };
}

async function gitObject(api, sha) {
  requireFact(SHA.test(sha ?? ''), 'pilot_git_sha_invalid');
  const commit = await api(`/git/commits/${sha}`);
  requireFact(commit?.sha === sha && SHA.test(commit.tree?.sha ?? '') && Array.isArray(commit.parents) && commit.parents.every(parent => SHA.test(parent.sha ?? '')), 'pilot_git_commit_invalid');
  const data = await api(`/git/trees/${commit.tree.sha}?recursive=1`);
  requireFact(data?.sha === commit.tree.sha && data.truncated === false && Array.isArray(data.tree), 'pilot_git_tree_incomplete');
  const entries = sorted(data.tree.filter(entry => entry.type !== 'tree').map(entry => ({ path: entry.path, oid: entry.sha, mode: entry.mode })));
  requireFact(entries.length <= 100_000 && gitTreeDigest(entries) === commit.tree.sha, 'pilot_git_full_tree_mismatch');
  return { sha, tree: commit.tree.sha, parents: commit.parents.map(parent => parent.sha), entries };
}
async function jsonAt(api, object, path) {
  const entry = object.entries.find(item => item.path === path && item.mode === '100644');
  requireFact(entry, 'pilot_policy_blob_missing');
  const blob = await api(`/git/blobs/${entry.oid}`);
  requireFact(blob?.sha === entry.oid && blob.encoding === 'base64' && integer(blob.size) && blob.size <= 262_144 && typeof blob.content === 'string', 'pilot_policy_blob_invalid');
  const bytes = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
  requireFact(bytes.length === blob.size && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === entry.oid, 'pilot_policy_git_bytes_mismatch');
  return { value: JSON.parse(utf8(bytes)), blob: entry.oid };
}
// Run-attempt responses have different endpoint URLs from the latest-run route.
// Bind actual identity/status/times, not incidental transport links.
const runProjection = run => Object.fromEntries(['id', 'run_attempt', 'workflow_id', 'path', 'event', 'head_branch', 'head_sha', 'status', 'conclusion', 'run_started_at', 'updated_at', 'repository', 'head_repository', 'pull_requests'].map(key => [key, run[key]]));
function repositoryRun(run, repository) {
  requireFact(integer(run?.id) && integer(run.run_attempt) && integer(run.workflow_id) && run.repository?.id === repository.id && run.repository.full_name === repository.full_name && run.head_repository?.id === repository.id && run.head_repository.full_name === repository.full_name, 'pilot_run_foreign_or_invalid');
}
async function completedSource(api, repository, id) {
  const run = await api(`/actions/runs/${id}`);
  repositoryRun(run, repository);
  requireFact(run.id === id && run.path === PILOT_PATH && run.head_branch === 'main' && run.event === 'workflow_dispatch' && SHA.test(run.head_sha) && success(run), 'pilot_source_not_completed_main_dispatch');
  const attempt = await api(`/actions/runs/${id}/attempts/${run.run_attempt}`);
  requireFact(same(runProjection(attempt), runProjection(run)), 'pilot_source_attempt_identity_changed');
  const workflow = await api(`/actions/workflows/${run.workflow_id}`);
  requireFact(workflow?.id === run.workflow_id && workflow.path === PILOT_PATH && workflow.state === 'active', 'pilot_source_workflow_changed');
  const jobs = await githubPages(api, `/actions/runs/${id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  const matches = jobs.filter(job => job.name === 'protected-pilot');
  requireFact(matches.length === 1, 'pilot_protected_job_missing_or_ambiguous');
  const job = matches[0];
  requireFact(integer(job.id) && job.run_id === id && success(job) && integer(job.runner_id) && job.runner_group_id === 0 && typeof job.runner_name === 'string' && job.runner_name && Array.isArray(job.labels) && job.labels.includes('ubuntu-latest') && !job.labels.includes('self-hosted'), 'pilot_completed_hosted_job_required');
  const steps = job.steps;
  requireFact(Array.isArray(steps) && new Set(steps.map(step => step.name)).size === steps.length && new Set(steps.map(step => step.number)).size === steps.length, 'pilot_source_steps_ambiguous');
  const supervisor = steps.filter(step => step.name === STEP);
  requireFact(supervisor.length === 1 && integer(supervisor[0].number) && success(supervisor[0]), 'pilot_supervisor_step_not_completed');
  const prefix = steps.slice(0, steps.indexOf(supervisor[0]));
  const expectedPrefix = ['Checkout protected supervisor', 'Set up controller Node', 'Pull fixed isolated Node image'];
  requireFact(expectedPrefix.every(name => prefix.filter(step => step.name === name && success(step)).length === 1) && prefix.every(step => ['Set up job', ...expectedPrefix].includes(step.name) && success(step)), 'pilot_pre_supervisor_execution_not_protected');
  requireFact(steps.filter(step => step.name === 'Retain isolated pilot receipt' && success(step) && step.number > supervisor[0].number).length === 1, 'pilot_receipt_upload_step_not_successful');
  const artifacts = await githubPages(api, `/actions/runs/${id}/artifacts`, 'artifacts');
  const name = `ci-candidate-runtime-pilot-${id}-${run.run_attempt}`;
  const matching = artifacts.filter(item => item.name === name);
  requireFact(matching.length === 1, 'pilot_artifact_missing_or_ambiguous');
  const artifact = matching[0];
  requireFact(integer(artifact.id) && artifact.expired === false && integer(artifact.size_in_bytes) && artifact.size_in_bytes <= 20_000_000 && DIGEST.test(artifact.digest ?? '') && artifact.workflow_run?.id === run.id && artifact.workflow_run.repository_id === repository.id && artifact.workflow_run.head_repository_id === repository.id && artifact.workflow_run.head_sha === run.head_sha && artifact.workflow_run.head_branch === 'main', 'pilot_artifact_source_or_digest_invalid');
  const upload = steps.find(step => step.name === 'Retain isolated pilot receipt');
  requireFact([run.run_started_at, run.updated_at, job.started_at, job.completed_at, supervisor[0].started_at, supervisor[0].completed_at, upload.started_at, upload.completed_at, artifact.created_at, artifact.updated_at].every(value => Number.isFinite(time(value))) && time(run.run_started_at) <= time(job.started_at) && time(job.started_at) <= time(supervisor[0].started_at) && time(supervisor[0].completed_at) <= time(upload.started_at) && time(upload.completed_at) <= time(job.completed_at) && time(job.completed_at) <= time(run.updated_at) && time(artifact.created_at) >= time(upload.started_at) && time(artifact.updated_at) < time(upload.completed_at) + 1000, 'pilot_artifact_or_step_time_invalid');
  return { run, attempt, workflow, jobs, job, artifacts, artifact };
}

/** One real API step contains the pre-capture, actual candidate execution and post-capture. */
export function verifyProtectedPilotJournal({ receipt, bootstrap, report, sourceRun, sourceJob, policy, sourceObject } = {}) {
  const result = { journalVerified: false, profile: 'single-protected-supervisor-step-v1', skip: false, runFull: true, reuseAuthorized: false, reasons: [] };
  try {
    const authority = bootstrap?.authority, step = sourceJob?.steps?.find(item => item.name === STEP);
    requireFact(success(sourceRun) && success(sourceJob) && success(step), 'pilot_journal_completed_api_step_required');
    requireFact(authority?.source === 'protected-pilot-bootstrap' && authority.apiBootstrapVerified === true && authority.apiVerified === false && authority.protectedVerified === false && authority.definitionTrusted === true && authority.event === 'workflow_dispatch' && authority.ref === 'refs/heads/main' && authority.path === PILOT_PATH, 'pilot_bootstrap_cannot_self_authenticate');
    requireFact(authority.repositoryId === sourceRun.repository.id && authority.workflowId === sourceRun.workflow_id && authority.runId === sourceRun.id && authority.runAttempt === sourceRun.run_attempt && authority.jobId === sourceJob.id && authority.jobName === sourceJob.name && authority.runnerId === sourceJob.runner_id && authority.runnerGroupId === sourceJob.runner_group_id && authority.runnerName === sourceJob.runner_name && authority.runnerEnvironment === 'github-hosted' && authority.jobStartedAt === sourceJob.started_at && authority.headSha === sourceRun.head_sha && authority.workflowSha === sourceRun.head_sha && authority.checkoutSha === sourceRun.head_sha && authority.controllerTree === sourceObject.tree, 'pilot_bootstrap_api_binding_mismatch');
    const definition = sourceObject.entries.find(entry => entry.path === PILOT_PATH);
    requireFact(definition?.mode === '100644' && authority.definitionBlob === definition.oid && same(authority.supervisorStep, { name: step.name, number: step.number, startedAt: step.started_at }), 'pilot_bootstrap_definition_or_step_mismatch');
    requireFact(bootstrap.schemaVersion === 1 && bootstrap.apiVerified === false && bootstrap.protectedVerified === false && report.bootstrap?.bootstrapVerified === true && report.bootstrap.apiVerified === false && report.bootstrap.protectedVerified === false && same(report.bootstrap.authority, authority), 'pilot_bootstrap_json_inconsistent');
    requireFact(same(bootstrap.controller, report.controller) && same(report.controller, { sha: sourceObject.sha, tree: sourceObject.tree, parents: sourceObject.parents, workflowDefinitionBlob: definition.oid }) && same(bootstrap.candidate, report.candidate) && authority.sourceRunId === bootstrap.candidate.sourceRunId, 'pilot_controller_or_candidate_json_inconsistent');
    requireFact(bootstrap.policyFingerprint === fingerprint(policy) && report.policyFingerprint === fingerprint(policy) && receipt.policyFingerprint === fingerprint(policy), 'pilot_policy_fingerprint_mismatch');
    const before = receipt.preExecutionSnapshot, after = receipt.postExecutionSnapshot, execution = receipt.execution;
    const clocks = [step.started_at, authority.observedAt, receipt.controller?.startedAt, before?.container?.createdAt, before?.collectedAt, execution?.startedAt, after?.container?.state?.startedAt, after?.container?.state?.finishedAt, after?.collectedAt, execution?.finishedAt, receipt.controller?.completedAt, step.completed_at];
    requireFact(clocks.every(value => Number.isFinite(time(value))), 'pilot_journal_clock_missing');
    requireFact(time(step.started_at) <= time(authority.observedAt) && time(authority.observedAt) <= time(receipt.controller.startedAt) && time(receipt.controller.startedAt) <= time(before.container.createdAt) && time(before.container.createdAt) <= time(before.collectedAt) && time(before.collectedAt) <= time(execution.startedAt) && time(execution.startedAt) <= time(after.container.state.startedAt) && time(after.container.state.startedAt) <= time(after.container.state.finishedAt) && time(after.container.state.finishedAt) <= time(after.collectedAt) && time(after.collectedAt) <= time(execution.finishedAt) && time(execution.finishedAt) <= time(receipt.controller.completedAt) && time(receipt.controller.completedAt) < time(step.completed_at) + 1000 && time(after.container.state.finishedAt) - time(after.container.state.startedAt) <= policy.limits.timeoutMs, 'pilot_journal_outside_api_step_or_order');
    requireFact(before.container.state.status === 'created' && before.container.state.running === false && before.container.state.pid === 0 && before.container.state.startedAt === '0001-01-01T00:00:00Z' && receipt.controller.candidateCodeExecutedOnHost === false && !receipt.controller.interrupted && execution.daemonStartedAt === after.container.state.startedAt && execution.daemonFinishedAt === after.container.state.finishedAt && execution.daemonExitCode === after.container.state.exitCode && execution.oomKilled === after.container.state.oomKilled && execution.daemonError === after.container.state.error && execution.status === after.container.state.status && execution.timedOut === false && same(execution.actualArgv, policy.command.argv), 'pilot_actual_execution_binding_mismatch');
    result.journalVerified = true;
    result.apiStep = { name: step.name, number: step.number, startedAt: step.started_at, completedAt: step.completed_at };
  } catch (error) { result.reasons.push(error.reason ?? 'pilot_journal_validation_exception'); }
  return result;
}

async function candidateSnapshot(api, repository, candidate, protectedObjects, authority, config, now) {
  requireFact(integer(candidate?.sourceRunId) && integer(candidate.sourceRunAttempt) && integer(candidate.prNumber) && [candidate.baseSha, candidate.headSha, candidate.mergeSha, candidate.fullTree].every(value => SHA.test(value ?? '')) && same(candidate.parents, [candidate.baseSha, candidate.headSha]) && candidate.workflowPath === SOURCE_PATH && ['pull_request', 'merge_group'].includes(candidate.event), 'pilot_original_candidate_binding_invalid');
  const run = await api(`/actions/runs/${candidate.sourceRunId}`);
  repositoryRun(run, repository);
  requireFact(run.run_attempt === candidate.sourceRunAttempt && run.workflow_id === candidate.workflowId && run.path === SOURCE_PATH && run.event === candidate.event && run.head_sha === (run.event === 'pull_request' ? candidate.headSha : candidate.mergeSha) && success(run), 'pilot_original_source_changed_or_failed');
  const attempt = await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}`);
  requireFact(same(runProjection(run), runProjection(attempt)), 'pilot_original_source_attempt_changed');
  const jobs = await githubPages(api, `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  const matches = jobs.filter(job => job.name === 'fullstack-smoke');
  requireFact(matches.length === 1 && success(matches[0]), 'pilot_original_checkout_job_missing');
  const job = matches[0], identity = parseCheckoutIdentity(await api(`/actions/jobs/${job.id}/logs`, { raw: true }), job);
  requireFact(identity.sha === candidate.mergeSha && identity.tree === candidate.fullTree && same(identity.parents, candidate.parents) && identity.candidate.baseSha === candidate.baseSha && (run.event === 'pull_request' ? identity.candidate.headSha === candidate.headSha && identity.candidate.prNumber === candidate.prNumber && identity.workflowRef === `${repository.full_name}/${SOURCE_PATH}@refs/pull/${candidate.prNumber}/merge` : identity.candidate.headSha === candidate.mergeSha) && SHA.test(identity.workflowSha), 'pilot_original_actual_checkout_mismatch');
  const object = await gitObject(api, candidate.mergeSha), base = await gitObject(api, candidate.baseSha), workflow = await gitObject(api, identity.workflowSha);
  requireFact(object.tree === candidate.fullTree && same(object.parents, candidate.parents), 'pilot_actual_candidate_git_mismatch');
  requireFact([...protectedObjects, base, object, workflow].every(item => same(closure(item.entries), closure(protectedObjects[0].entries))), 'pilot_candidate_control_definition_closure_changed');
  const pull = await api(`/pulls/${candidate.prNumber}`);
  requireFact(pull?.number === candidate.prNumber && pull.head?.repo?.id === repository.id && pull.base?.repo?.id === repository.id && pull.base.ref === 'main' && pull.head.sha === candidate.headSha && pull.base.sha === candidate.baseSha && pull.state === 'open' && pull.mergeable === true && pull.merged === false && (run.event === 'merge_group' || pull.merge_commit_sha === candidate.mergeSha), 'pilot_pr_head_base_or_conflict_changed');
  const artifacts = await githubPages(api, `/actions/runs/${run.id}/artifacts`, 'artifacts');
  // This existing protected resolver reconstructs actual checkout+definition
  // facts BETWEEN fresh unfiltered API catalog snapshots. Related IDs include
  // every same-PR old head OR same immutable API head across PRs, each checked
  // through direct latest and that exact attempt, including listed attempt 1.
  // Its authority
  // below was just reconstructed from APIs, never copied from archive JSON.
  const resolved = await resolvePilotCandidate({ api, repositoryName: repository.full_name, sourceRunId: candidate.sourceRunId, authority, config, now });
  requireFact(resolved?.skip === false && resolved.runFull === true && resolved.protectedVerified === false && resolved.historyObservation?.stableDuringRead === true && resolved.historyObservation.measurementBound === true && resolved.historyObservation.skipAuthorization === false && same(resolved.candidate, { prNumber: candidate.prNumber, baseSha: candidate.baseSha, headSha: candidate.headSha, mergeSha: candidate.mergeSha, sourceTree: candidate.fullTree, parents: candidate.parents, mergeable: true, headCurrent: true }) && same(resolved.producer, { runId: candidate.sourceRunId, runAttempt: candidate.sourceRunAttempt, workflowId: candidate.workflowId, path: candidate.workflowPath, event: candidate.event, headSha: run.head_sha }), 'pilot_fresh_candidate_resolver_binding_changed');
  const observation = resolved.historyObservation, statistics = observation.statistics;
  requireFact(observation.indexCompletenessVerified === false && observation.atomicLease === false && statistics?.catalogObservationOnly === true && statistics.indexCompletenessVerified === false && statistics.atomicLease === false && integer(statistics.runCount) && statistics.runCount <= 10_000 && integer(statistics.workflowPageCount) && statistics.workflowPageCount <= 100 && Array.isArray(statistics.relatedRunIds) && statistics.relatedRunIds.includes(run.id) && Array.isArray(observation.latestAttempts) && observation.latestAttempts.length === statistics.relatedRunIds.length && same(observation.latestAttempts.map(item => item.runId), statistics.relatedRunIds), 'pilot_fresh_history_observation_invalid');
  return { run, attempt, jobs, artifacts, identity, object, base, workflow, pull,
    history: observation.latestAttempts, historyStatistics: statistics,
    freshCandidate: resolved.candidate, freshProducer: resolved.producer,
    historyFingerprints: observation.snapshotFingerprints };
}

function actualComponents(receipt, archive, candidate, object, policy) {
  requireFact(receipt?.schemaVersion === 1 && receipt.profile === 'closed-node-no-install-v1' && receipt.suite === policy.suite && receipt.scope === 'local-unprotected' && receipt.skip === false && receipt.runFull === true && receipt.verified === false && receipt.protectedVerified === false && receipt.reuseAuthorized === false && receipt.apiVerified !== true && receipt.suiteExecuted === true && receipt.executionSuccessful === true && receipt.measurementComplete === true && receipt.proofComplete === true, 'pilot_receipt_self_authority_or_incomplete');
  const { receiptFingerprint, ...payload } = receipt;
  requireFact(DIGEST.test(receiptFingerprint ?? '') && receiptFingerprint === fingerprint(payload), 'pilot_receipt_fingerprint_mismatch');
  const input = receipt.gitInput, probe = receipt.sourceProbe, entries = object.entries;
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  requireFact(input?.sha === candidate.mergeSha && input.tree === object.tree && same(input.parents, object.parents) && input.entriesFingerprint === fingerprint(entries) && input.fileCount === entries.length && same(input.definitionBlobs, policy.command.definitionBlobs) && policy.command.definitionBlobs.every(pin => entries.some(entry => entry.path === pin.path && entry.oid === pin.oid && entry.mode === '100644')), 'pilot_complete_git_input_mismatch');
  const files = probe?.source?.files;
  requireFact(probe?.schemaVersion === 1 && probe.complete === true && probe.verified === false && probe.eligible === false && probe.source.sha === input.sha && probe.source.tree === input.tree && probe.source.collection === 'materialized-git-export' && probe.source.entriesDigest === fingerprint(entries) && Array.isArray(files) && files.length === entries.length && new Set(files.map(file => file.path)).size === files.length, 'pilot_source_probe_incomplete_or_mismatched');
  const bytes = sorted(files.map(file => {
    const entry = byPath.get(file.path);
    // source-probe records the resolved, root-relative target, rather than raw
    // link bytes (which may contain ../). Linux and macOS expose link modes
    // differently; the resolved tracked-input closure supplies containment.
    const targetEntry = byPath.get(file.target);
    const containedTarget = safePath(file.target) && (targetEntry ? targetEntry.mode !== '120000' : entries.some(entry => entry.path.startsWith(`${file.target}/`)));
    requireFact(entry && entry.oid === file.oid && entry.mode === file.gitMode && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= policy.limits.maxSourceFileBytes && DIGEST.test(file.digest ?? '') && (entry.mode === '120000' ? file.type === 'symlink' && containedTarget && [0o755, 0o777].includes(file.fsMode) : file.type === 'file' && file.fsMode === (entry.mode === '100755' ? 0o555 : 0o444)), 'pilot_source_actual_bytes_or_mode_invalid');
    return { ...entry, size: file.size, sha256: file.digest };
  }));
  requireFact(input.materializedFingerprint === fingerprint(bytes) && input.totalBytes === bytes.reduce((sum, file) => sum + file.size, 0) && input.totalBytes <= policy.limits.maxSourceBytes, 'pilot_source_materialization_fingerprint_mismatch');
  const directories = probe.source.directories, expectedDirectories = new Set(['.']);
  for (const entry of entries) { const parts = entry.path.split('/'); for (let count = 1; count < parts.length; count++) expectedDirectories.add(parts.slice(0, count).join('/')); }
  requireFact(Array.isArray(directories) && directories.length === expectedDirectories.size && new Set(directories.map(item => item.path)).size === directories.length && directories.every(item => expectedDirectories.has(item.path) && item.type === 'directory' && item.fsMode === 0o555) && probe.source.materializedDigest === fingerprint({ files, directories }) && same(probe.dependencies, { profile: 'protected-no-install', roots: [], count: 0, bytes: 0, digest: fingerprint({ files: [], directories: [] }), files: [], directories: [] }), 'pilot_materialized_source_or_dependency_inventory_mismatch');
  const inventory = probe.inventory;
  const tests = [{ file: policy.command.argv[2].replace('/input/', ''), project: 'node:test-whole-file', id: 'protected-fixed-entrypoint' }];
  requireFact(inventory?.kind === 'actual-test-inventory' && inventory.suite === policy.suite && inventory.count === 1 && inventory.verified === false && same(inventory.tests, tests) && inventory.digest === fingerprint(tests), 'pilot_fixed_test_inventory_mismatch');
  const pinnedImageIds = [policy.image.reference.split('@')[1], policy.image.configDigest];
  requireFact(pinnedImageIds.includes(receipt.image?.imageId) && same(receipt.image, { reference: policy.image.reference, imageId: receipt.image.imageId, platform: policy.image.platform, rootfsLayers: policy.image.rootfsLayers }), 'pilot_immutable_image_pin_mismatch');
  const rootfs = JSON.parse(utf8(archive.files.get('execution/image-rootfs-inventory.json'))), summary = JSON.parse(utf8(archive.files.get('execution/image-rootfs-summary.json')));
  const tools = receipt.toolchainClosure, root = tools?.rootfsClosure;
  requireFact(summary?.schemaVersion === 1 && same(summary.image, receipt.image) && same(summary.toolBytes, tools) && Array.isArray(rootfs) && rootfs.length > 0 && rootfs.length <= 100_000 && new Set(rootfs.map(entry => entry.path)).size === rootfs.length && root?.entryCount === rootfs.length && root.entryInventoryFingerprint === fingerprint(sorted(rootfs)), 'pilot_rootfs_inventory_digest_mismatch');
  for (const entry of rootfs) requireFact(typeof entry.path === 'string' && entry.path.startsWith('/') && (safePath(entry.path.slice(1)) || (entry.path === '/' && entry.type === 'directory')) && ['regular', 'directory', 'symlink', 'hardlink'].includes(entry.type) && /^[0-7]{4}$/.test(entry.mode ?? '') && Number.isSafeInteger(entry.sizeInBytes) && entry.sizeInBytes >= 0 && (entry.type === 'regular' ? DIGEST.test(entry.sha256 ?? '') : entry.sizeInBytes === 0), 'pilot_rootfs_actual_inventory_invalid');
  const rootfsByPath = new Map(rootfs.map(entry => [entry.path, entry])), toolsByPath = new Map((tools.entries ?? []).map(entry => [entry.path, entry]));
  requireFact(Array.isArray(tools.entries) && tools.entries.length > 0 && tools.entries.every(tool => { const entry = rootfsByPath.get(tool.path); return entry?.type === 'regular' && entry.sha256 === tool.sha256 && entry.mode === tool.mode && entry.sizeInBytes === tool.sizeInBytes && tool.fileType === 'regular'; }) && rootfs.filter(entry => entry.type === 'regular' && /(?:^|\/)[^/]+\.so(?:\.|$)/.test(entry.path)).every(entry => toolsByPath.has(entry.path)), 'pilot_tool_bytes_not_in_complete_rootfs');
  const runtime = receipt.runtimePolicy;
  requireFact(runtime?.profile === receipt.profile && runtime.image.id === receipt.image.imageId && runtime.image.ref.replace(/^docker\.io\/library\//, '') === policy.image.reference.replace(/^docker\.io\/library\//, '') && runtime.image.os === 'linux' && runtime.image.architecture === policy.image.platform.split('/')[1] && same(runtime.image.rootfsLayers, policy.image.rootfsLayers) && runtime.container.user === `${policy.isolation.uid}:${policy.isolation.gid}` && runtime.container.workingDir === '/input' && same([...runtime.container.entrypoint, ...runtime.container.cmd], policy.command.argv) && runtime.container.mounts?.length === 1 && runtime.container.mounts[0].destination === '/input' && runtime.container.mounts[0].treeFingerprint === input.materializedFingerprint && same(runtime.tools, tools.entries.map(({ path, sha256, mode }) => ({ path, sha256, mode }))), 'pilot_runtime_policy_not_bound_to_protected_policy');
  const env = runtime.container.env, requiredEnv = ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/out', 'TMPDIR=/out', 'CI=true', 'VITEST='];
  requireFact(Array.isArray(env) && new Set(env.map(item => item.split('=')[0])).size === env.length && requiredEnv.every(item => env.includes(item)) && env.every(item => requiredEnv.includes(item) || /^(NODE_VERSION|YARN_VERSION)=[0-9]+\.[0-9]+\.[0-9]+$/.test(item)), 'pilot_runtime_environment_not_fixed');
  const resource = receipt.resourceObservation?.pre;
  requireFact(resource?.memoryBytes === policy.limits.memoryBytes && resource.memorySwapBytes === policy.limits.memoryBytes && resource.pidsLimit === policy.limits.pidsLimit && resource.autoRemove === false && same(resource.restartPolicy, { Name: 'no', MaximumRetryCount: 0 }), 'pilot_actual_resource_observation_missing_or_changed');
  requireFact(same(resource, receipt.resourceObservation.post), 'pilot_actual_resource_configuration_changed');
  for (const [field, name] of [['stdout', 'execution/candidate.stdout'], ['stderr', 'execution/candidate.stderr']]) {
    const captured = archive.files.get(name), declared = receipt.outputDigests?.[field];
    requireFact(declared?.bytes === captured.length && declared.bytes <= policy.limits.maxLogBytes && declared.digest === hash(captured), 'pilot_actual_log_digest_mismatch');
  }
  requireFact(receipt.outputDigests.candidateControlled === true && receipt.inputRemoved === true && receipt.rootfsArchiveDiscarded === true && Array.isArray(receipt.cleanup) && receipt.cleanup.length === 2 && new Set(receipt.cleanup.map(item => item.id)).size === 2 && receipt.cleanup.every(item => item.removed === true && [root.containerId, receipt.preExecutionSnapshot.container.id].includes(item.id)) && root.containerId !== receipt.preExecutionSnapshot.container.id && ID.test(root.containerId), 'pilot_actual_cleanup_or_container_identity_incomplete');
  const mount = runtime.container.mounts[0];
  const validation = validateClosedRuntime({ snapshot: receipt.preExecutionSnapshot, executionSnapshot: receipt.postExecutionSnapshot, policy: runtime,
    authority: { source: 'local-readonly-controller', apiVerified: false, toolBytes: tools,
      mountInputs: [{ ...mount, immutable: true, hostCandidateWritable: false, sourceType: 'directory', containsSockets: false, containsDevices: false, containsFifos: false, containsEscapingSymlinks: false }] } });
  requireFact(validation.structureValid && validation.executionValid && validation.toolBytesValid && validation.toolchainClosureComplete && validation.mountInputsValid, 'pilot_independent_runtime_comparison_failed');
  return { sourceTree: object.tree, gitEntriesFingerprint: fingerprint(entries), materializedFingerprint: input.materializedFingerprint, imageId: receipt.image.imageId, rootfsInventoryFingerprint: root.entryInventoryFingerprint, toolBytesFingerprint: fingerprint(tools.entries), configurationFingerprint: receipt.preExecutionSnapshot.fingerprint, terminalFingerprint: receipt.postExecutionSnapshot.fingerprint, outputDigests: receipt.outputDigests, runtimeValidation: validation };
}

/** Comparison-only diagnostic for real LOCAL receipts; supplied objects are not authority. */
export function verifyPilotActualComponents({ receipt, archiveFiles, candidate, gitObject: object, policy } = {}) {
  const result = { componentBindingsVerified: false, apiVerified: false, protectedVerified: false, scopedProtectedReceiptVerified: false, skip: false, runFull: true, reuseAuthorized: false, reasons: [] };
  try {
    validatePilotPolicy(policy);
    requireFact(archiveFiles instanceof Map && [...archiveFiles].every(([name, bytes]) => Object.hasOwn(MEMBER_LIMITS, name) && Buffer.isBuffer(bytes) && bytes.length <= MEMBER_LIMITS[name]), 'pilot_component_archive_member_invalid');
    requireFact(object?.sha === candidate?.mergeSha && object.tree === candidate.fullTree && same(object.parents, candidate.parents) && gitTreeDigest(object.entries) === object.tree, 'pilot_component_git_inventory_invalid');
    result.components = actualComponents(receipt, { files: archiveFiles }, candidate, object, policy);
    result.componentBindingsVerified = true;
  } catch (error) { result.reasons.push(error.reason ?? 'pilot_actual_component_validation_exception'); }
  return result;
}

/** No candidate code, archive command or filesystem extraction is executed. */
export async function observeProtectedPilotReceipt(input = {}) {
  const result = { schemaVersion: 1, mode: 'protected-pilot-receipt-shadow', scopedProtectedReceiptVerified: false, apiVerified: false, protectedVerified: false, reuseAuthorized: false, skip: false, runFull: true, stableDuringRead: false, skipAuthorization: false, reasons: [], scope: 'ci-candidate-evidence-core / closed-node-no-install-v1', residualRace: 'Read-only snapshots are not an atomic lease; a new attempt or failure can begin after the final read.' };
  try {
    const { api, repositoryName, sourceRunId, observerRunId, observerRunAttempt, actualCheckout, expectedObserverSha, observerRef, observerEvent, policy, now = Date.now() } = input;
    requireFact(typeof api === 'function' && /^[\w.-]+\/[\w.-]+$/.test(repositoryName ?? '') && integer(sourceRunId) && integer(observerRunId) && integer(observerRunAttempt) && sourceRunId !== observerRunId && Number.isFinite(now), 'pilot_receipt_observer_inputs_invalid');
    requireFact(observerRef === 'refs/heads/main' && ['workflow_run', 'workflow_dispatch'].includes(observerEvent) && SHA.test(expectedObserverSha ?? '') && actualCheckout?.sha === expectedObserverSha, 'pilot_receipt_observer_main_checkout_required');
    const repository = await api('');
    requireFact(integer(repository?.id) && repository.full_name === repositoryName && repository.default_branch === 'main', 'pilot_receipt_default_main_required');
    const observer = await api(`/actions/runs/${observerRunId}`);
    repositoryRun(observer, repository);
    requireFact(observer.run_attempt === observerRunAttempt && observer.head_sha === actualCheckout.sha && observer.path === PILOT_RECEIPT_OBSERVER_PATH && observer.head_branch === 'main' && observer.event === observerEvent && observer.status === 'in_progress' && observer.conclusion === null, 'pilot_receipt_observer_api_identity_invalid');
    const observerWorkflow = await api(`/actions/workflows/${observer.workflow_id}`);
    requireFact(observerWorkflow?.id === observer.workflow_id && observerWorkflow.path === PILOT_RECEIPT_OBSERVER_PATH && observerWorkflow.state === 'active', 'pilot_receipt_observer_workflow_invalid');
    const observerObject = await gitObject(api, actualCheckout.sha);
    requireFact(observerObject.tree === actualCheckout.tree && same(observerObject.parents, actualCheckout.parents) && observerObject.entries.some(entry => entry.path === PILOT_RECEIPT_OBSERVER_PATH && entry.mode === '100644'), 'pilot_receipt_actual_observer_git_mismatch');
    const protectedPolicy = await jsonAt(api, observerObject, POLICY_PATH);
    requireFact(policy === undefined || same(policy, protectedPolicy.value), 'pilot_receipt_local_policy_changed');
    const fixedPolicy = validatePilotPolicy(protectedPolicy.value);
    const config = (await jsonAt(api, observerObject, '.harness/config/ci-suite-ownership.json')).value;
    const before = await completedSource(api, repository, sourceRunId);
    requireFact(time(before.run.updated_at) <= now && now - time(before.run.updated_at) <= 86_400_000, 'pilot_completed_receipt_expired');
    const sourceObject = await gitObject(api, before.run.head_sha);
    requireFact(same(closure(sourceObject.entries), closure(observerObject.entries)), 'pilot_source_observer_controller_closure_changed');
    const step = before.job.steps.find(item => item.name === STEP);
    const definition = sourceObject.entries.find(entry => entry.path === PILOT_PATH && entry.mode === '100644');
    requireFact(definition, 'pilot_source_definition_missing');
    const independentBootstrapAuthority = { source: 'protected-pilot-bootstrap', apiBootstrapVerified: true, apiVerified: false, protectedVerified: false, definitionTrusted: true, repositoryId: repository.id, workflowId: before.run.workflow_id, path: PILOT_PATH, ref: 'refs/heads/main', event: before.run.event, headSha: before.run.head_sha, checkoutSha: before.run.head_sha, workflowSha: before.run.head_sha, controllerTree: sourceObject.tree, definitionBlob: definition.oid, runId: before.run.id, runAttempt: before.run.run_attempt, jobId: before.job.id, runnerId: before.job.runner_id, supervisorStep: { name: step.name, number: step.number, startedAt: step.started_at } };
    const archiveBytes = await api(`/actions/artifacts/${before.artifact.id}/zip`, { binary: true });
    requireFact(Buffer.isBuffer(archiveBytes) && archiveBytes.length === before.artifact.size_in_bytes && hash(archiveBytes) === before.artifact.digest, 'pilot_downloaded_archive_digest_or_size_mismatch');
    const archive = readBoundedPilotZip(archiveBytes);
    const parse = name => JSON.parse(utf8(archive.files.get(name)));
    const bootstrap = parse('protected-bootstrap.json'), report = parse('pilot-supervisor-report.json'), receipt = parse('execution/pilot-receipt.json');
    requireFact(report.schemaVersion === 1 && report.mode === 'shadow-manual-pilot' && report.skip === false && report.runFull === true && report.apiVerified === false && report.protectedVerified === false && report.pilotStarted === true && report.pilotCompleted === true && Array.isArray(report.reasons) && report.reasons.length === 0 && same(report.pilot, receipt), 'pilot_supervisor_report_incomplete_or_untrusted');
    const originalBefore = await candidateSnapshot(api, repository, bootstrap.candidate, [observerObject, sourceObject], independentBootstrapAuthority, config, now);
    const journal = verifyProtectedPilotJournal({ receipt, bootstrap, report, sourceRun: before.run, sourceJob: before.job, sourceObject, policy: fixedPolicy });
    requireFact(journal.journalVerified, journal.reasons[0] ?? 'pilot_journal_not_verified');
    const components = actualComponents(receipt, archive, bootstrap.candidate, originalBefore.object, fixedPolicy);
    const originalAfter = await candidateSnapshot(api, repository, bootstrap.candidate, [observerObject, sourceObject], independentBootstrapAuthority, config, now);
    const after = await completedSource(api, repository, sourceRunId);
    const observerAfter = await api(`/actions/runs/${observerRunId}`);
    requireFact(same(originalBefore, originalAfter) && same(before, after) && same({ ...runProjection(observer), updated_at: null }, { ...runProjection(observerAfter), updated_at: null }), 'pilot_api_identity_changed_during_archive_measurement');
    result.stableDuringRead = true;
    result.scopedProtectedReceiptVerified = true;
    result.apiVerified = true;
    result.observer = { runId: observer.id, runAttempt: observer.run_attempt, headSha: observer.head_sha, workflowId: observer.workflow_id, path: observer.path };
    result.source = { runId: before.run.id, runAttempt: before.run.run_attempt, headSha: before.run.head_sha, workflowId: before.run.workflow_id, path: before.run.path, jobId: before.job.id, runnerId: before.job.runner_id };
    result.candidate = bootstrap.candidate;
    result.artifact = { id: before.artifact.id, name: before.artifact.name, digest: archive.archiveDigest, sizeInBytes: archive.archiveBytes };
    result.policyFingerprint = fingerprint(fixedPolicy);
    result.controllerClosureFingerprint = fingerprint(closure(observerObject.entries));
    result.journal = journal;
    result.components = components;
    result.historyObservation = { statistics: originalBefore.historyStatistics,
      indexCompletenessVerified: false, atomicLease: false, skipAuthorization: false };
    result.snapshotFingerprints = [fingerprint({ pilot: before, original: originalBefore }), fingerprint({ pilot: after, original: originalAfter })];
    result.observedAt = new Date(now).toISOString();
  } catch (error) {
    result.reasons.push(typeof error?.reason === 'string' && /^[a-z0-9_:-]{1,160}$/.test(error.reason) ? error.reason : 'pilot_receipt_read_or_validation_exception');
  }
  return result;
}
