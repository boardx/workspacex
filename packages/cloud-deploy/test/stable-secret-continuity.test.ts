import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { stableDeploymentSecretNames } from "../src/runtime-environment";
import { ensureDeploymentSecret } from "../src/secrets";
import { verifyStableSecretContinuity } from "../src/stable-secret-continuity";
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
  expect(await verifyStableSecretContinuity(baseline, stable)).toEqual({ ready: true, matchedCount: 12, noMutation: true });
  expect(await verifyStableSecretContinuity(stable, stable)).toEqual({ ready: true, matchedCount: 12, noMutation: true });
  expect((await readdir(stable)).sort()).toEqual([...stableDeploymentSecretNames].sort());
});
it("blocks a rotated value and a version-scoped directory", async () => {
  const { baseline, stable } = await pair();
  await writeFile(join(stable, "service-key"), "a".repeat(64), { mode: 0o600 });
  await expect(verifyStableSecretContinuity(baseline, stable)).rejects.toThrow("STABLE_SECRET_ROTATION_DETECTED");
  await expect(verifyStableSecretContinuity(baseline, join(baseline, "candidate"))).rejects.toThrow("STABLE_SECRET_DIRECTORY_VERSION_SCOPED");
});
