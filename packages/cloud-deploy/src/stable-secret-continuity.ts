import { lstat, readdir } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { stableDeploymentSecretNames } from "./runtime-environment";
import { readTrustedDeploymentSecret } from "./trusted-generated-secrets";
import { assertTrustedPath } from "./trusted-path";

type Snapshot = string;
async function snapshot(directory: string): Promise<Snapshot> {
  const names = (await readdir(directory)).sort();
  const records = [];
  for (const name of names) {
    const stat = await lstat(join(directory, name));
    records.push([name, stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.size, stat.mtimeMs, stat.ctimeMs]);
  }
  const stat = await lstat(directory);
  return JSON.stringify([stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.mtimeMs, stat.ctimeMs, records]);
}

/** Compare current production identity to the revision-independent candidate path.
 * The result is deliberately value-free and path-free for release receipts.
 */
export async function verifyStableSecretContinuity(baselineDirectory: string, stableDirectory: string): Promise<{ ready: true; matchedCount: number; noMutation: true }> {
  if (stableDirectory.startsWith(`${baselineDirectory}/`)) throw new Error("STABLE_SECRET_DIRECTORY_VERSION_SCOPED");
  await assertTrustedPath(baselineDirectory, { trustedRoot: "/", kind: "directory", private: true });
  await assertTrustedPath(stableDirectory, { trustedRoot: "/", kind: "directory", private: true });
  const required = [...stableDeploymentSecretNames].sort();
  const observed = (await readdir(stableDirectory)).sort();
  if (required.length !== 12 || JSON.stringify(observed) !== JSON.stringify(required)) throw new Error("STABLE_SECRET_SET_MISMATCH");
  const beforeBaseline = await snapshot(baselineDirectory);
  const beforeStable = await snapshot(stableDirectory);
  let matchedCount = 0;
  for (const name of required) {
    const baseline = Buffer.from(await readTrustedDeploymentSecret(baselineDirectory, name));
    const stable = Buffer.from(await readTrustedDeploymentSecret(stableDirectory, name));
    if (!timingSafeEqual(baseline, stable)) throw new Error("STABLE_SECRET_ROTATION_DETECTED");
    matchedCount++;
  }
  if (beforeBaseline !== await snapshot(baselineDirectory) || beforeStable !== await snapshot(stableDirectory)) throw new Error("STABLE_SECRET_MUTATED_DURING_PREFLIGHT");
  return { ready: true, matchedCount, noMutation: true };
}
