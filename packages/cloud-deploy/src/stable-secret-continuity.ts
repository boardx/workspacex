import { lstat, readFile, readdir } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { stableDeploymentSecretNames } from "./runtime-environment";
import { readTrustedDeploymentSecret } from "./trusted-generated-secrets";
import { assertTrustedPath } from "./trusted-path";
import ts from "typescript";

const expectedConsumers: Record<string, string> = {
  APP_DB_PASSWORD: "app-password", MIGRATION_DB_PASSWORD: "owner-password", DIAG_DB_PASSWORD: "diag-password",
  AGENT_DB_PASSWORD: "agent-password", MEMORY_DB_PASSWORD: "memory-password",
  MEMORY_DB_OWNER_PASSWORD: "memory-owner-password", REDIS_PASSWORD: "redis-password",
  MODEL_CREDENTIAL_KEY: "model-cipher", EMAIL_VERIFICATION_SECRET: "email-verification",
  NATIVE_SESSION_BINDING_KEY: "native-binding", DEEP_AGENT_SERVICE_INTERNAL_KEY: "service-key",
  NATIVE_SESSION_SERVICE_KEY: "service-key", PROVISION_ADMIN_PASSWORD: "admin-password",
};

/** Inspect the actual producer source without loading runtimeEnvironment or creating keys. */
export function verifyStableSecretConsumers(sourceText: string): void {
  const source = ts.createSourceFile("runtime-environment.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const observed: Record<string, string> = {};
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ts.isElementAccessExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "secret" &&
        ts.isStringLiteral(node.initializer.argumentExpression)) {
      const consumer = node.name.text;
      if (consumer in observed) throw new Error("STABLE_SECRET_CONSUMER_DRIFT");
      observed[consumer] = node.initializer.argumentExpression.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (JSON.stringify(Object.entries(observed).sort()) !== JSON.stringify(Object.entries(expectedConsumers).sort()))
    throw new Error("STABLE_SECRET_CONSUMER_DRIFT");
}

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
export async function verifyStableSecretContinuity(baselineDirectory: string, stableDirectory: string, allowLegacyBaseline = false): Promise<{ ready: true; matchedCount: number; noMutation: true }> {
  if (baselineDirectory !== stableDirectory && !allowLegacyBaseline) throw new Error("STABLE_SECRET_DIRECTORY_DRIFT");
  if (allowLegacyBaseline && baselineDirectory === stableDirectory) throw new Error("STABLE_SECRET_LEGACY_TRANSITION_INVALID");
  if (stableDirectory.startsWith(`${baselineDirectory}/`)) throw new Error("STABLE_SECRET_DIRECTORY_VERSION_SCOPED");
  verifyStableSecretConsumers(await readFile(new URL("./runtime-environment.ts", import.meta.url), "utf8"));
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
