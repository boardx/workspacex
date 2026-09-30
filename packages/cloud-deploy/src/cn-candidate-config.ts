import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink, rmdir, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { deploymentConfigSchema } from "./config";
import { assertTrustedPath } from "./trusted-path";

export const candidateIdentitySchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  release: z.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  attemptId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/),
}).strict();
export type CandidateIdentity = z.infer<typeof candidateIdentitySchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const candidateReceiptSchema = candidateIdentitySchema.extend({
  schemaVersion: z.literal(1), baselineSha256: digest, candidateSha256: digest,
  allowedDiff: z.literal("provision.release"),
}).strict();
export type CandidateReceipt = z.infer<typeof candidateReceiptSchema>;
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
    receipt: `${directory}/receipt.json`, active: "/etc/workspacex-cn/deployment.json" };
}
async function privateRead(path: string): Promise<string> {
  await assertTrustedPath(path, { trustedRoot: "/", kind: "file", private: true });
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 65536) throw new Error("UNTRUSTED_CONFIGURATION_FILE");
    return await handle.readFile("utf8"); } finally { await handle.close(); }
}
async function privateDirectory(path: string) {
  await assertTrustedPath(dirname(path), { trustedRoot: "/", kind: "directory" });
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await assertTrustedPath(path, { trustedRoot: "/", kind: "directory", private: true });
}
async function writeExclusive(path: string, bytes: string) {
  await assertTrustedPath(dirname(path), { trustedRoot: "/", kind: "directory", private: true });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path: string) { const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
async function replaceActive(path: string, expected: string, bytes: string) {
  if (await privateRead(path) !== expected) throw new Error("ACTIVE_CONFIGURATION_CHANGED");
  const temporary = `${path}.candidate-${process.pid}-${createHash("sha256").update(bytes).digest("hex").slice(0,12)}`;
  await writeExclusive(temporary, bytes);
  try { if (await privateRead(path) !== expected) throw new Error("ACTIVE_CONFIGURATION_CHANGED"); await rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
/** All writers must hold the deployment lock; this additional lock serializes this CLI. */
export async function candidateConfigHostAction(action: "prepare" | "verify" | "commit" | "restore", identityInput: CandidateIdentity) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("CANDIDATE_CONFIG_ROOT_REQUIRED");
  if (!["prepare", "verify", "commit", "restore"].includes(action)) throw new Error("CANDIDATE_ACTION_INVALID");
  const identity = candidateIdentitySchema.parse(identityInput), paths = candidateConfigurationPaths(identity);
  await assertTrustedPath("/etc/workspacex-cn", { trustedRoot: "/", kind: "directory", private: true });
  const lock = "/etc/workspacex-cn/candidate-config.lock";
  await mkdir(lock, { mode: 0o700 }); // stale/crashed lock fails closed; never steal it
  try {
    const directories = ["/etc/workspacex-cn/candidate-configs", `/etc/workspacex-cn/candidate-configs/${identity.revision}`, paths.directory];
    for (const directory of directories) {
      if (action === "prepare") await privateDirectory(directory);
      else await assertTrustedPath(directory, { trustedRoot: "/", kind: "directory", private: true });
    }
    if (action === "prepare") {
      let receiptExists = true;
      try { await lstat(paths.receipt); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") receiptExists = false; else throw error; }
      if (!receiptExists) {
        const baseline = await privateRead(paths.active), candidate = createCandidateConfiguration(baseline, identity);
        await writeExclusive(paths.baseline, baseline);
        await writeExclusive(paths.candidate, candidate.candidateBytes);
        await writeExclusive(paths.receipt, `${JSON.stringify(candidate.receipt)}\n`);
        await syncDirectory(paths.directory);
      }
    }
    const baseline = await privateRead(paths.baseline), candidate = await privateRead(paths.candidate);
    const receipt = candidateReceiptSchema.parse(JSON.parse(await privateRead(paths.receipt)));
    const active = await privateRead(paths.active);
    const state = verifyCandidateConfiguration(baseline, candidate, receipt, identity, active);
    if (action === "commit" && state === "prepared") await replaceActive(paths.active, active, candidate);
    if (action === "restore" && state === "activated") await replaceActive(paths.active, active, baseline);
    return { ok: true, ...identity, configFile: paths.candidate, receiptFile: paths.receipt,
      baselineSha256: receipt.baselineSha256, candidateSha256: receipt.candidateSha256,
      state: action === "commit" ? "activated" : action === "restore" ? "prepared" : state };
  } finally { await rmdir(lock); }
}
