import { describe, expect, it } from "vitest";
import { sealReleaseCandidate, verifySealedReleaseCandidate } from "../src/release-candidate.js";

const revision = "a".repeat(40);
const image = (name: string) => ({ image: `registry.example.com/workspacex/${name}@sha256:${"b".repeat(64)}` });
const manifest = Buffer.from(`${JSON.stringify({
  schemaVersion: 1,
  release: "2026.9.15-cn.1",
  sourceRevision: revision,
  platform: "linux/amd64",
  images: { web: image("web"), api: image("api"), agent: image("agent"), sandbox: image("sandbox"), postgres: image("postgres"), redis: image("redis") },
})}\n`);

describe("sealed release candidates", () => {
  it("binds the exact manifest bytes and source revision", () => {
    const seal = sealReleaseCandidate(manifest, new Date("2026-09-15T00:00:00Z"));
    expect(verifySealedReleaseCandidate(seal, manifest, revision).manifest.sourceRevision).toBe(revision);
  });

  it("rejects modified manifests and revision substitution", () => {
    const seal = sealReleaseCandidate(manifest);
    expect(() => verifySealedReleaseCandidate(seal, Buffer.concat([manifest, Buffer.from(" ")]), revision)).toThrow();
    expect(() => verifySealedReleaseCandidate(seal, manifest, "c".repeat(40))).toThrow("RELEASE_CANDIDATE_REVISION_MISMATCH");
  });
});
