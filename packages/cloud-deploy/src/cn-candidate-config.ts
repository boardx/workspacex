import { createHash } from "node:crypto";
import { constants, fstatSync } from "node:fs";
import { mkdir, open, rename, unlink, rmdir, lstat, readFile, readlink } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { deploymentConfigSchema } from "./config";
import { assertTrustedPath } from "./trusted-path";

export const candidateIdentitySchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  release: z.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  attemptId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
}).strict();
export type CandidateIdentity = z.infer<typeof candidateIdentitySchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const candidateReceiptSchema = candidateIdentitySchema.extend({
  schemaVersion: z.literal(1), baselineSha256: digest, candidateSha256: digest,
  allowedDiff: z.literal("provision.release"),
}).strict();
export type CandidateReceipt = z.infer<typeof candidateReceiptSchema>;
const candidateStateSchema = candidateReceiptSchema.extend({ state: z.enum(["prepared", "activated"]) });
export const configDigest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

/** Copy all canonical fields; only the pinned release may change. Never resolve secrets. */
export function createCandidateConfiguration(baselineBytes: string, identityInput: CandidateIdentity) {
  const identity = candidateIdentitySchema.parse(identityInput);
  const baseline = deploymentConfigSchema.parse(JSON.parse(baselineBytes));
  const candidate = deploymentConfigSchema.parse({ ...baseline, provision: { ...baseline.provision, release: identity.release } });
  const candidateBytes = `${JSON.stringify(candidate, null, 2)}\n`;
  const receipt: CandidateReceipt = { ...identity, schemaVersion: 1, baselineSha256: configDigest(baselineBytes),
    candidateSha256: configDigest(candidateBytes), allowedDiff: "provision.release" };
  return { candidateBytes, receipt };
}
export function verifyCandidateConfiguration(baselineBytes: string, candidateBytes: string, receiptInput: unknown,
  identityInput: CandidateIdentity, activeBytes: string): "prepared" | "activated" {
  const receipt = candidateReceiptSchema.parse(receiptInput), identity = candidateIdentitySchema.parse(identityInput);
  if (!isDeepStrictEqual({ revision: receipt.revision, release: receipt.release, attemptId: receipt.attemptId }, identity)) throw new Error("CANDIDATE_IDENTITY_MISMATCH");
  const expected = createCandidateConfiguration(baselineBytes, identity);
  if (!isDeepStrictEqual(receipt, expected.receipt) || candidateBytes !== expected.candidateBytes) throw new Error("CANDIDATE_CONFIGURATION_CHANGED");
  if (activeBytes === baselineBytes) return "prepared";
  if (activeBytes === candidateBytes) return "activated";
  throw new Error("ACTIVE_CONFIGURATION_CHANGED");
}
export function candidateConfigurationPaths(identityInput: CandidateIdentity) {
  const identity = candidateIdentitySchema.parse(identityInput);
  const directory = `/etc/workspacex-cn/candidate-configs/${identity.revision}/${identity.attemptId}`;
  return { directory, baseline: `${directory}/baseline.json`, candidate: `${directory}/deployment.json`,
    receipt: `${directory}/receipt.json`, state: `${directory}/state.json`, active: "/etc/workspacex-cn/deployment.json" };
}
async function privateRead(path: string): Promise<string> {
  await assertTrustedPath(path, { trustedRoot: "/", kind: "file", private: true });
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 65536) throw new Error("UNTRUSTED_CONFIGURATION_FILE");
    return await handle.readFile("utf8"); } finally { await handle.close(); }
}
async function privateDirectory(path: string) {
  await assertTrustedPath(dirname(path), { trustedRoot: "/", kind: "directory" });
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await assertTrustedPath(path, { trustedRoot: "/", kind: "directory", private: true });
  if ((await lstat(path)).gid !== 0) throw new Error("UNTRUSTED_CONFIGURATION_GROUP");
}
async function writeExclusive(path: string, bytes: string) {
  await assertTrustedPath(dirname(path), { trustedRoot: "/", kind: "directory", private: true });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600) throw new Error("UNTRUSTED_CONFIGURATION_FILE");
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle.close(); }
}
async function syncDirectory(path: string) { const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
async function replaceActive(path: string, expected: string, bytes: string) {
  if (await privateRead(path) !== expected) throw new Error("ACTIVE_CONFIGURATION_CHANGED");
  const temporary = `${path}.candidate-${process.pid}-${createHash("sha256").update(bytes).digest("hex").slice(0,12)}`;
  await writeExclusive(temporary, bytes);
  try { if (await privateRead(path) !== expected) throw new Error("ACTIVE_CONFIGURATION_CHANGED"); await rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

const canonicalDeploymentLock = "/var/lib/workspacex-cn/runtime/release.lock";
/** fdinfo proves this inherited open file description already holds an exclusive flock.
 * Running flock here would acquire an absent lock and therefore cannot prove the caller held it.
 */
export function assertInheritedLockMetadata(target: { dev: number; ino: number; uid: number; gid: number; mode: number },
  inherited: { dev: number; ino: number; uid: number; gid: number; mode: number; isFile(): boolean }, link: string, fdinfo: string) {
  if (link !== canonicalDeploymentLock || !inherited.isFile() || inherited.dev !== target.dev || inherited.ino !== target.ino ||
    inherited.uid !== 0 || inherited.gid !== 0 || (inherited.mode & 0o777) !== 0o600 || target.gid !== 0 ||
    !fdinfo.split("\n").some(line => new RegExp(`^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+-?\\d+\\s+[0-9a-fA-F]+:[0-9a-fA-F]+:${target.ino}\\s+0\\s+EOF$`).test(line))) {
    throw new Error("CANONICAL_DEPLOYMENT_LOCK_UNPROVEN");
  }
}
async function assertInheritedDeploymentLock() {
  try {
    await assertTrustedPath(canonicalDeploymentLock, { trustedRoot: "/", kind: "file", private: true });
    const target = await lstat(canonicalDeploymentLock), inherited = fstatSync(9);
    assertInheritedLockMetadata(target, inherited, await readlink("/proc/self/fd/9"), await readFile("/proc/self/fdinfo/9", "utf8"));
  } catch { throw new Error("CANONICAL_DEPLOYMENT_LOCK_UNPROVEN"); }
}

/** Requires an already held inherited canonical deployment lock, plus local CLI serialization. */
export async function candidateConfigHostAction(action: "prepare" | "verify" | "commit" | "restore", identityInput: CandidateIdentity) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("CANDIDATE_CONFIG_ROOT_REQUIRED");
  if (!["prepare", "verify", "commit", "restore"].includes(action)) throw new Error("CANDIDATE_ACTION_INVALID");
  const identity = candidateIdentitySchema.parse(identityInput), paths = candidateConfigurationPaths(identity);
  await assertInheritedDeploymentLock();
  // Shared parent is root-owned and may grant the runner read/traverse access
  // to sealed manifests. Only the candidate subtree and config files are private.
  await assertTrustedPath("/etc/workspacex-cn", { trustedRoot: "/", kind: "directory" });
  const lock = "/etc/workspacex-cn/candidate-config.lock";
  await mkdir(lock, { mode: 0o700 }); // stale/crashed lock fails closed; never steal it
  try {
    const directories = ["/etc/workspacex-cn/candidate-configs", `/etc/workspacex-cn/candidate-configs/${identity.revision}`, paths.directory];
    for (const directory of directories) {
      if (action === "prepare") await privateDirectory(directory);
      else {
        await assertTrustedPath(directory, { trustedRoot: "/", kind: "directory", private: true });
        if ((await lstat(directory)).gid !== 0) throw new Error("UNTRUSTED_CONFIGURATION_GROUP");
      }
    }
    if (action === "prepare") {
      let receiptExists = true;
      try { await lstat(paths.receipt); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") receiptExists = false; else throw error; }
      if (!receiptExists) {
        const baseline = await privateRead(paths.active), candidate = createCandidateConfiguration(baseline, identity);
        await writeExclusive(paths.baseline, baseline);
        await writeExclusive(paths.candidate, candidate.candidateBytes);
        await writeExclusive(paths.state, `${JSON.stringify({ ...candidate.receipt, state: "prepared" })}\n`);
        await writeExclusive(paths.receipt, `${JSON.stringify(candidate.receipt)}\n`);
        await syncDirectory(paths.directory);
      }
    }
    const baseline = await privateRead(paths.baseline), candidate = await privateRead(paths.candidate);
    const receipt = candidateReceiptSchema.parse(JSON.parse(await privateRead(paths.receipt)));
    const active = await privateRead(paths.active);
    const byteState = verifyCandidateConfiguration(baseline, candidate, receipt, identity, active);
    const stateBytes = await privateRead(paths.state), marker = candidateStateSchema.parse(JSON.parse(stateBytes));
    const { state: markerState, ...markerReceipt } = marker;
    if (!isDeepStrictEqual(markerReceipt, receipt)) throw new Error("CANDIDATE_STATE_CHANGED");
    // Equal bytes cannot reveal whether the same-version activation was accepted.
    // For unequal bytes, the actual config recovers a crash after config rename and
    // before marker rename; the next commit/restore reconciles the protected marker.
    const state = baseline === candidate ? markerState : byteState;
    if (action === "commit" && state === "prepared" && active !== candidate) await replaceActive(paths.active, active, candidate);
    if (action === "restore" && state === "activated" && active !== baseline) await replaceActive(paths.active, active, baseline);
    if (action === "commit" || action === "restore") {
      const nextState = action === "commit" ? "activated" : "prepared";
      if (markerState !== nextState) await replaceActive(paths.state, stateBytes, `${JSON.stringify({ ...receipt, state: nextState })}\n`);
    }
    return { ok: true, ...identity, configFile: paths.candidate, receiptFile: paths.receipt,
      baselineSha256: receipt.baselineSha256, candidateSha256: receipt.candidateSha256,
      state: action === "commit" ? "activated" : action === "restore" ? "prepared" : state };
  } finally { await rmdir(lock); }
}
