import { expect, it } from "vitest";
import { createReleaseManifest } from "../src/release-manifest.js";
const revision = "b".repeat(40);
const digest = `registry.example/workspacex/image@sha256:${"a".repeat(64)}`;
const tag = "registry.example/workspacex/image:release";
const input = { schemaVersion: 1, release: "1.0.0", sourceRevision: revision, platform: "linux/arm64", images: Object.fromEntries(["web", "api", "agent", "sandbox", "postgres", "redis"].map(name => [name, { image: tag }])) };
const execute = async (argv: readonly string[]) => argv[1] === "buildx" ? `Digest:    ${digest.split("@")[1]}\n` : argv.includes("--format") ? JSON.stringify([digest]) : JSON.stringify([{ Os: "linux", Architecture: "arm64", RepoDigests: [digest], Config: { Labels: { "org.opencontainers.image.revision": revision } } }]);
it("derives actual repository digests and verifies the release identity without pull/build", async () => {
  const calls: string[][] = [];
  const result = await createReleaseManifest(input, async argv => { calls.push([...argv]); return execute(argv); });
  expect(result.images.web.image).toBe(digest);
  expect(Object.values(result.images).every(value => value.image === digest)).toBe(true);
  expect(calls.every(argv => ["docker image inspect", "docker buildx imagetools"].includes(argv.slice(0, 3).join(" ")))).toBe(true);
});
it("refuses missing digests instead of manufacturing one", async () => {
  await expect(createReleaseManifest(input, async () => "[]")).rejects.toThrow("RELEASE_DIGEST_NOT_UNIQUE: web");
});
it("refuses ambiguous repository digests", async () => {
  await expect(createReleaseManifest(input, async () => JSON.stringify([digest, digest.replace("a".repeat(64), "c".repeat(64))]))).rejects.toThrow("RELEASE_DIGEST_NOT_UNIQUE");
});
it("rejects images from a different source revision", async () => {
  await expect(createReleaseManifest(input, async argv => argv.includes("--format") ? execute(argv) : (await execute(argv)).replace(revision, "c".repeat(40)))).rejects.toThrow("IMAGE_REVISION_MISMATCH: web");
});
it("normalizes a real-style Docker Hub short repository without inventing a digest", async () => {
  const fixture = structuredClone(input);
  fixture.images.redis = { image: "docker.io/library/redis:7" };
  const redisDigest = `redis@sha256:${"d".repeat(64)}`;
  const result = await createReleaseManifest(fixture, async argv => {
    if (argv.at(-1)?.includes("/redis")) return argv[1] === "buildx" ? `Digest:    ${redisDigest.split("@")[1]}\n` : argv.includes("--format") ? JSON.stringify([redisDigest]) : JSON.stringify([{ Os: "linux", Architecture: "arm64", RepoDigests: [redisDigest], Config: {} }]);
    return execute(argv);
  });
  expect(result.images.redis.image).toBe(`docker.io/library/${redisDigest}`);
});
it("refuses local digest metadata when its registry artifact cannot be verified", async () => {
  await expect(createReleaseManifest(input, async argv => { if (argv[1] === "buildx") throw new Error("not published"); return execute(argv); })).rejects.toThrow("RELEASE_REGISTRY_UNAVAILABLE: web");
});
it("refuses a registry response for a different digest", async () => {
  await expect(createReleaseManifest(input, async argv => argv[1] === "buildx" ? `Digest: sha256:${"c".repeat(64)}` : execute(argv))).rejects.toThrow("RELEASE_REGISTRY_DIGEST_MISMATCH: web");
});
