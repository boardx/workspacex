import { describe, expect, it, vi } from "vitest";
import { prewarmRelease, requiredReleaseImages, validateReleaseManifest, verifyPrewarmedRelease, type ReleaseManifest } from "../src/release.js";
const revision = "a".repeat(40);
function manifest(): ReleaseManifest {
  const image = { image: `registry.example/team/app@sha256:${"b".repeat(64)}` };
  return { schemaVersion: 1, release: "1.2.3", sourceRevision: revision, platform: "linux/amd64", images: { web: image, api: image, agent: image, sandbox: image, postgres: image, redis: image } };
}
function inspect(argv: readonly string[]) {
  return JSON.stringify([{ Os: "linux", Architecture: "amd64", RepoDigests: [argv.at(-1)], Config: { Labels: { "org.opencontainers.image.revision": revision } } }]);
}
describe("immutable cloud releases", () => {
  it("requires digests, exact schema, and source revision", () => {
    expect(validateReleaseManifest(manifest())).toEqual(manifest());
    for (const image of ["repo/app:latest", "repo/app:v1", "repo/app@sha256:bad", "repo/app@sha256:" + "B".repeat(64)]) {
      expect(() => validateReleaseManifest({ ...manifest(), images: { ...manifest().images, api: { image } } })).toThrow("INVALID_RELEASE_MANIFEST");
    }
    expect(() => validateReleaseManifest({ ...manifest(), token: "secret" })).toThrow("INVALID_RELEASE_MANIFEST");
  });
  it("includes local database images only for Starter", () => {
    expect(requiredReleaseImages(manifest(), "starter")).toHaveLength(6);
    expect(requiredReleaseImages(manifest(), "production").map(x => x.service)).toEqual(["web", "api", "agent", "sandbox"]);
  });
  it("checks real Docker inspection fields without pulling", async () => {
    const execute = vi.fn(async (argv: readonly string[]) => inspect(argv));
    expect(await verifyPrewarmedRelease(manifest(), "starter", execute)).toMatchObject({ checked: ["web", "api", "agent", "sandbox", "postgres", "redis"], cloudVerified: false });
    expect(execute.mock.calls.every(([argv]) => argv.slice(0, 3).join(" ") === "docker image inspect")).toBe(true);
  });
  it.each([
    ["IMAGE_PLATFORM_MISMATCH", { Architecture: "arm64" }],
    ["IMAGE_DIGEST_MISMATCH", { RepoDigests: [] }],
    ["IMAGE_REVISION_MISMATCH", { Config: { Labels: {} } }],
    ["INVALID_IMAGE_INSPECTION", { Os: null }],
  ])("fails closed on %s", async (code, override) => {
    await expect(verifyPrewarmedRelease(manifest(), "production", async argv => JSON.stringify([{ ...JSON.parse(inspect(argv))[0], ...override }]))).rejects.toThrow(code);
  });
  it("sanitizes daemon errors and malformed responses", async () => {
    await expect(verifyPrewarmedRelease(manifest(), "production", async () => { throw new Error("credential=secret"); })).rejects.toThrow("RELEASE_IMAGE_UNAVAILABLE: web");
    await expect(verifyPrewarmedRelease(manifest(), "production", async () => "bad")).rejects.toThrow("RELEASE_IMAGE_UNAVAILABLE");
  });
  it("prewarms then verifies rather than accepting successful pull as proof", async () => {
    const execute = vi.fn(async (argv: readonly string[]) => argv[1] === "pull" ? "downloaded" : inspect(argv));
    await prewarmRelease(manifest(), "production", execute);
    expect(execute.mock.calls.map(([argv]) => argv[1])).toEqual(["pull", "pull", "pull", "pull", "image", "image", "image", "image"]);
    await expect(prewarmRelease(manifest(), "production", async () => "downloaded")).rejects.toThrow("RELEASE_IMAGE_UNAVAILABLE");
  });
});
it("accepts Docker Hub aliases while preserving the repository and digest identity", async () => {
  const fixture = manifest();
  fixture.images.redis = { image: `docker.io/library/redis@sha256:${"b".repeat(64)}` };
  const executor = async (argv: readonly string[]) => argv.at(-1) === fixture.images.redis.image
    ? JSON.stringify([{ Os: "linux", Architecture: "amd64", RepoDigests: [`redis@sha256:${"b".repeat(64)}`], Config: {} }]) : inspect(argv);
  await expect(verifyPrewarmedRelease(fixture, "starter", executor)).resolves.toHaveProperty("cloudVerified", false);
  await expect(verifyPrewarmedRelease(fixture, "starter", async argv => (await executor(argv)).replace('redis@sha256:', 'someone/redis@sha256:'))).rejects.toThrow("IMAGE_DIGEST_MISMATCH: redis");
});
