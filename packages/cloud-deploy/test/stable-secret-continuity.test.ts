import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { stableDeploymentSecretNames } from "../src/runtime-environment";
import { ensureDeploymentSecret } from "../src/secrets";
import { verifyStableSecretConsumers, verifyStableSecretContinuity } from "../src/stable-secret-continuity";
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
const roots: string[] = [];
async function pair() {
  const baseline = await mkdtemp(join(tmpdir(), "stable-baseline-"));
  const stable = await mkdtemp(join(tmpdir(), "stable-current-"));
  roots.push(baseline, stable);
  for (const name of stableDeploymentSecretNames) {
    const value = await ensureDeploymentSecret(baseline, name);
    await writeFile(join(stable, name), value, { mode: 0o600 });
  }
  return { baseline, stable };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it("proves all 12 values match without changing either directory", async () => {
  const { baseline, stable } = await pair();
  expect(await verifyStableSecretContinuity(baseline, stable, true)).toEqual({ ready: true, matchedCount: 12, noMutation: true });
  expect(await verifyStableSecretContinuity(stable, stable)).toEqual({ ready: true, matchedCount: 12, noMutation: true });
  expect((await readdir(stable)).sort()).toEqual([...stableDeploymentSecretNames].sort());
});
it("blocks a rotated value and a version-scoped directory", async () => {
  const { baseline, stable } = await pair();
  await writeFile(join(stable, "service-key"), "a".repeat(64), { mode: 0o600 });
  await expect(verifyStableSecretContinuity(baseline, stable, true)).rejects.toThrow("STABLE_SECRET_ROTATION_DETECTED");
  await expect(verifyStableSecretContinuity(baseline, join(baseline, "candidate"), true)).rejects.toThrow("STABLE_SECRET_DIRECTORY_VERSION_SCOPED");
});
it("rejects different canonical directories even when all 12 values are identical", async () => {
  const { baseline, stable } = await pair();
  await expect(verifyStableSecretContinuity(baseline, stable)).rejects.toThrow("STABLE_SECRET_DIRECTORY_DRIFT");
  await expect(verifyStableSecretContinuity(stable, stable, true)).rejects.toThrow("STABLE_SECRET_LEGACY_TRANSITION_INVALID");
});
it("statically rejects a service-key/native-binding consumer swap before reading keys", async () => {
  const source = await readFile(new URL("../src/runtime-environment.ts", import.meta.url), "utf8");
  expect(() => verifyStableSecretConsumers(source)).not.toThrow();
  const swapped = source
    .replace('DEEP_AGENT_SERVICE_INTERNAL_KEY: secret["service-key"]', 'DEEP_AGENT_SERVICE_INTERNAL_KEY: secret["native-binding"]')
    .replace('NATIVE_SESSION_BINDING_KEY: secret["native-binding"]', 'NATIVE_SESSION_BINDING_KEY: secret["service-key"]');
  expect(() => verifyStableSecretConsumers(swapped)).toThrow("STABLE_SECRET_CONSUMER_DRIFT");
  const missing = source.replace('NATIVE_SESSION_BINDING_KEY: secret["native-binding"]', 'NATIVE_SESSION_BINDING_KEY: "missing"');
  expect(() => verifyStableSecretConsumers(missing)).toThrow("STABLE_SECRET_CONSUMER_DRIFT");
});
