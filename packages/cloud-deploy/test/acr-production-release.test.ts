import { describe, expect, it, vi } from "vitest";
import {
  asCanonicalReleaseManifest,
  createAcrProductionReleaseManifest,
  prepareAcrProductionRelease,
  validateAcrProductionReleaseManifest,
} from "../src/acr-production-release.js";
import type { ReleaseManifest } from "../src/release.js";

const revision = "a".repeat(40);
const digest = "b".repeat(64);
const prefix = "registry.cn-hangzhou.aliyuncs.com/workspacex-cn";
const artifact = (service: string) => ({ image: `${prefix}/${service}@sha256:${digest}` });
const release: ReleaseManifest = {
  schemaVersion: 1,
  release: "1.2.3",
  sourceRevision: revision,
  platform: "linux/amd64",
  images: {
    web: artifact("web"), api: artifact("api"), agent: artifact("agent"), sandbox: artifact("sandbox"),
    postgres: { image: `docker.io/library/postgres@sha256:${digest}` },
    redis: { image: `docker.io/library/redis@sha256:${digest}` },
  },
};

describe("ACR production release", () => {
  it("derives exactly four immutable application images from the canonical release", () => {
    const manifest = createAcrProductionReleaseManifest(release, prefix);
    expect(Object.keys(manifest.images)).toEqual(["web", "api", "agent", "sandbox"]);
    expect(JSON.stringify(manifest)).not.toContain("postgres");
    expect(JSON.stringify(manifest)).not.toContain("redis");
  });

  it("rejects mutable tags, extra images, and images outside the new ACR namespace", () => {
    const manifest = createAcrProductionReleaseManifest(release, prefix);
    expect(() => validateAcrProductionReleaseManifest({ ...manifest, images: { ...manifest.images, web: { image: `${prefix}/web:latest` } } }, prefix)).toThrow("INVALID_ACR_PRODUCTION_RELEASE_MANIFEST");
    expect(() => validateAcrProductionReleaseManifest({ ...manifest, images: { ...manifest.images, redis: artifact("redis") } }, prefix)).toThrow("INVALID_ACR_PRODUCTION_RELEASE_MANIFEST");
    expect(() => validateAcrProductionReleaseManifest({ ...manifest, images: { ...manifest.images, api: { image: `registry.cn-hangzhou.aliyuncs.com/old/api@sha256:${digest}` } } }, prefix)).toThrow("ACR_IMAGE_OUTSIDE_NAMESPACE: api");
  });

  it("pulls all four digests and proves digest, platform, and revision", async () => {
    const manifest = createAcrProductionReleaseManifest(release, prefix);
    const execute = vi.fn(async (argv: readonly string[]) => argv[1] === "pull" ? "pulled" : JSON.stringify([{
      Os: "linux", Architecture: "amd64", RepoDigests: [argv.at(-1)], Config: { Labels: { "org.opencontainers.image.revision": revision } },
    }]));
    await expect(prepareAcrProductionRelease(manifest, prefix, execute)).resolves.toMatchObject({
      checked: ["web", "api", "agent", "sandbox"], cloudVerified: false,
    });
    expect(execute.mock.calls.map(([argv]) => argv[1])).toEqual(["pull", "image", "pull", "image", "pull", "image", "pull", "image"]);
  });

  it("fails closed when a pull succeeds but the local digest is different", async () => {
    const manifest = createAcrProductionReleaseManifest(release, prefix);
    await expect(prepareAcrProductionRelease(manifest, prefix, async argv => argv[1] === "pull" ? "pulled" : JSON.stringify([{
      Os: "linux", Architecture: "amd64", RepoDigests: [], Config: { Labels: { "org.opencontainers.image.revision": revision } },
    }]))).rejects.toThrow("ACR_IMAGE_DIGEST_MISMATCH: web");
  });

  it("rejoins the production view with Starter base images only when identity matches", () => {
    const manifest = createAcrProductionReleaseManifest(release, prefix);
    expect(asCanonicalReleaseManifest(manifest, release).images.postgres).toEqual(release.images.postgres);
    expect(() => asCanonicalReleaseManifest({ ...manifest, release: "2.0.0" }, release)).toThrow("ACR_RELEASE_IDENTITY_MISMATCH");
  });
});
