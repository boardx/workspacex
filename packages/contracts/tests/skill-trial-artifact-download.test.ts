import { describe, expect, it } from "vitest";
import { operations, projectSkillTrialArtifact, PublicSkillTrialArtifact, StoredSkillTrialArtifacts, skillTrialArtifactDownloadExchange } from "../src/skill-trial-artifact-download";
const artifact = { artifactId: "artifact-1", sha256: "a".repeat(64), name: "result.html", mime: "text/html", sizeBytes: 12, objectKey: "private/trial-1/result" };
const request = { trialRunId: "trial-1", artifactId: "artifact-1" };
const expiresAt = "2026-09-10T01:02:00Z";
const response = { url: "https://downloads.example.com/downloads/opaque_token", expiresAt, oneTime: true, trialAuthorizationDecisionId: "decision-1" };
const stored = {
  principal: { orgId: "org-1", userId: "actor-1" },
  trial: { orgId: "org-1", actorId: "actor-1", trialRunId: "trial-1", versionId: "version-1", status: "succeeded", artifacts: [artifact] },
  authorization: { decisionId: "decision-1", orgId: "org-1", actorId: "actor-1", trialRunId: "trial-1", artifactId: "artifact-1", allowed: true },
  grant: { grantId: "grant-1", tokenHash: "c".repeat(64), orgId: "org-1", principalUserId: "actor-1", locator: { sourceKind: "skill-trial", trialRunId: "trial-1", skillVersionId: "version-1", artifact }, trialAuthorizationDecisionId: "decision-1", expiresAt, oneTime: true },
  delivery: { url: response.url, expiresAt },
  now: "2026-09-10T01:00:01Z",
  minted: { grantId: "grant-1", rawToken: "opaque_token", redemptionOrigin: "https://downloads.example.com", tokenHash: "c".repeat(64), issuedAt: "2026-09-10T01:00:00Z", expiresAt },
};
const valid = (record: unknown = stored, out: unknown = response, input: unknown = request) => skillTrialArtifactDownloadExchange.safeParse({ request: input, response: out, stored: record }).success;
describe("trial artifact download proposal", () => {
  it("projects metadata without exposing storage keys and marks legacy metadata unavailable", () => {
    const projected = projectSkillTrialArtifact(artifact);
    expect(projected).toEqual({ availability: "downloadable", artifactId: artifact.artifactId, sha256: artifact.sha256, name: artifact.name, mime: artifact.mime, sizeBytes: artifact.sizeBytes });
    expect(PublicSkillTrialArtifact.safeParse({ ...projected, objectKey: artifact.objectKey }).success).toBe(false);
    for (const patch of [{ artifactId: null }, { sha256: null }, { artifactId: undefined, sha256: undefined }]) {
      const legacy = projectSkillTrialArtifact({ ...artifact, ...patch });
      expect(legacy).toEqual({ availability: "unavailable", reason: "legacy-metadata-missing", name: artifact.name, mime: artifact.mime, sizeBytes: artifact.sizeBytes });
      expect(valid({ ...stored, trial: { ...stored.trial, artifacts: [{ ...artifact, ...patch }] } })).toBe(false);
    }
  });
  it("binds the owner-scoped succeeded trial to the real trial download grant", () => {
    expect(valid()).toBe(true);
    for (const principal of [{ ...stored.principal, userId: "other" }, { ...stored.principal, orgId: "other" }]) expect(valid({ ...stored, principal })).toBe(false);
    expect(valid({ ...stored, trial: { ...stored.trial, status: "failed" } })).toBe(false);
    expect(valid(stored, response, { ...request, trialRunId: "other" })).toBe(false);
    expect(valid(stored, response, { ...request, artifactId: "other" })).toBe(false);
    expect(valid({ ...stored, trial: { ...stored.trial, artifacts: [artifact, artifact] } })).toBe(false);
  });
  it("rejects substituted grant subjects, keys, byte metadata or principal", () => {
    for (const patch of [{ artifactId: "other" }, { sha256: "b".repeat(64) }, { objectKey: "other/key" }, { sizeBytes: 13 }, { name: "other" }, { mime: "text/plain" }]) {
      expect(valid({ ...stored, grant: { ...stored.grant, locator: { ...stored.grant.locator, artifact: { ...artifact, ...patch } } } })).toBe(false);
    }
    for (const patch of [{ sourceKind: "file" }, { trialRunId: "other" }, { skillVersionId: "other" }]) expect(valid({ ...stored, grant: { ...stored.grant, locator: { ...stored.grant.locator, ...patch } } })).toBe(false);
    for (const patch of [{ orgId: "other" }, { principalUserId: "other" }, { oneTime: false }]) expect(valid({ ...stored, grant: { ...stored.grant, ...patch } })).toBe(false);
  });
  it("uses a distinct trial authorization receipt, never a fabricated identity.authorize decision", () => {
    expect(valid(stored, { ...response, permissionDecisionId: "fake" })).toBe(false);
    expect(valid(stored, { ...response, trialAuthorizationDecisionId: "other" })).toBe(false);
    for (const patch of [{ allowed: false }, { decisionId: "other" }, { orgId: "other" }, { actorId: "other" }, { trialRunId: "other" }, { artifactId: "other" }]) {
      expect(valid({ ...stored, authorization: { ...stored.authorization, ...patch } })).toBe(false);
    }
  });
  it("keeps the common redemption channel and binds the server-built delivery", () => {
    for (const url of ["https://storage.example.com/private/object", "https://downloads.example.com/downloads/token?objectKey=secret", "https://downloads.example.com/downloads/token#hash", "https://user:secret@downloads.example.com/downloads/token", "http://downloads.example.com/downloads/token"]) {
      expect(operations.issueSkillTrialArtifactDownloadUrl.out.safeParse({ ...response, url }).success).toBe(false);
    }
    expect(valid(stored, { ...response, url: "https://evil.example/downloads/token" })).toBe(false);
    expect(valid(stored, { ...response, expiresAt: "2026-09-11T00:00:00Z" })).toBe(false);
    expect(valid(stored, { ...response, oneTime: false })).toBe(false);
  });
  it("accepts only the two client identifiers and never a caller-supplied authority", () => {
    for (const field of ["objectKey", "actorId", "orgId", "sha256", "versionId", "permissionDecisionId", "allowed", "stored"]) {
      expect(operations.issueSkillTrialArtifactDownloadUrl.in.safeParse({ ...request, [field]: "forged" }).success).toBe(false);
    }
    expect(operations.issueSkillTrialArtifactDownloadUrl.path).toBe("/skill-trial-runs/:trialRunId/artifacts/:artifactId/download-url");
  });
  it("rejects another valid token delivery even when response agrees with it", () => {
    const url = "https://downloads.example.com/downloads/unrelated_grant_token";
    expect(valid({ ...stored, delivery: { ...stored.delivery, url } }, { ...response, url })).toBe(false);
    const wrongOrigin = "https://evil.example/downloads/opaque_token";
    expect(valid({ ...stored, delivery: { ...stored.delivery, url: wrongOrigin } }, { ...response, url: wrongOrigin })).toBe(false);
    expect(valid({ ...stored, grant: { ...stored.grant, grantId: "other" } })).toBe(false);
    expect(valid({ ...stored, grant: { ...stored.grant, tokenHash: "d".repeat(64) } })).toBe(false);
    expect(valid(stored, { ...response, tokenHash: stored.grant.tokenHash })).toBe(false);
  });
  it("rejects jointly malformed, expired or unbound expiration timestamps", () => {
    for (const expiration of ["not-a-date", "2026-09-10T00:00:00Z", stored.now]) {
      expect(valid({ ...stored, grant: { ...stored.grant, expiresAt: expiration }, delivery: { ...stored.delivery, expiresAt: expiration }, minted: { ...stored.minted, expiresAt: expiration } }, { ...response, expiresAt: expiration })).toBe(false);
    }
    const altered = "2026-09-10T01:03:00Z";
    expect(valid({ ...stored, grant: { ...stored.grant, expiresAt: altered }, delivery: { ...stored.delivery, expiresAt: altered } }, { ...response, expiresAt: altered })).toBe(false);
    expect(valid({ ...stored, minted: { ...stored.minted, issuedAt: expiresAt } })).toBe(false);
  });

  it("shares stable-ID uniqueness while allowing multiple unidentified legacy artifacts", () => {
    const distinctBytesSameId = { ...artifact, name: "other.txt", objectKey: "private/other", sha256: "b".repeat(64) };
    expect(StoredSkillTrialArtifacts.safeParse([artifact, distinctBytesSameId]).success).toBe(false);
    expect(valid({ ...stored, trial: { ...stored.trial, artifacts: [artifact, distinctBytesSameId] } })).toBe(false);
    const legacy = { name: artifact.name, mime: artifact.mime, sizeBytes: artifact.sizeBytes, objectKey: artifact.objectKey };
    expect(StoredSkillTrialArtifacts.safeParse([legacy, { ...legacy, artifactId: null, objectKey: "private/other" }]).success).toBe(true);
  });

});
