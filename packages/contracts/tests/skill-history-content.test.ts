import { describe, expect, it } from "vitest";
import { operations, skillHistoryContentExchanges } from "../src/skill-history-content";
const digest = "a".repeat(64);
describe("immutable history content proposal", () => {
  it("lists a complete side-digest manifest without duplicate or nonexistent rows", () => {
    const request = { skillId: "skill-1", draftId: "draft-1", expectedRevision: 1, expectedSnapshotDigest: digest, checkedSourceDigest: digest };
    const entry = { path: "SKILL.md", baseDigest: null, localDigest: digest, upstreamDigest: digest };
    const response = { review: request, entries: [entry] };
    expect(skillHistoryContentExchanges.listSkillUpstreamFiles.safeParse({ request, response }).success).toBe(true);
    expect(skillHistoryContentExchanges.listSkillUpstreamFiles.safeParse({ request, response: { ...response, entries: [entry, entry] } }).success).toBe(false);
    expect(skillHistoryContentExchanges.listSkillUpstreamFiles.safeParse({ request, response: { ...response, entries: [{ ...entry, localDigest: null, upstreamDigest: null }] } }).success).toBe(false);
  });
  it("rejects current/different version contents masquerading as requested historical files", () => {
    const request = { skillId: "skill-1", versionId: "version-1", snapshotDigest: digest, path: "SKILL.md", expectedFileDigest: digest };
    const response = { version: { skillId: "skill-1", versionId: "version-1", snapshotDigest: digest }, path: "SKILL.md", digest, contentBase64: "YQ==" };
    const stored = { version: response.version, entry: { path: request.path, digest, sizeBytes: 1 } };
    expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ stored, request, response }).success).toBe(true);
    for (const version of [{ ...response.version, versionId: "new-version" }, { ...response.version, skillId: "other" }, { ...response.version, snapshotDigest: "b".repeat(64) }]) expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ stored, request, response: { ...response, version } }).success).toBe(false);
    expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ stored, request, response: { ...response, digest: "b".repeat(64) } }).success).toBe(false);
    expect(operations.getSkillVersionFile.in.safeParse({ ...request, path: "../private" }).success).toBe(false);
  });
  it("keeps absent files distinct from empty contents and rejects swapped merge sides", () => {
    const request = { skillId: "skill-1", draftId: "draft-1", expectedRevision: 1, expectedSnapshotDigest: digest, checkedSourceDigest: digest, path: "SKILL.md", expectedFileDigest: null, side: "base" };
    const response = { selection: request, file: { kind: "absent" } };
    const review = { skillId: request.skillId, draftId: request.draftId, expectedRevision: request.expectedRevision, expectedSnapshotDigest: request.expectedSnapshotDigest, checkedSourceDigest: request.checkedSourceDigest };
    const stored = { review, entries: [{ path: request.path, baseDigest: null, localDigest: digest, upstreamDigest: digest }] };
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request, response }).success).toBe(true);
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request, response: { ...response, file: { kind: "present", digest, contentBase64: "" } } }).success).toBe(false);
    const presentRequest = { ...request, expectedFileDigest: digest };
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored: { ...stored, entries: [{ ...stored.entries[0], baseDigest: digest }] }, request: presentRequest, response: { selection: presentRequest, file: { kind: "present", digest, contentBase64: "" } } }).success).toBe(true);
    for (const patch of [{ side: "upstream" }, { expectedRevision: 2 }, { checkedSourceDigest: "b".repeat(64) }, { path: "other.md" }]) expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request, response: { ...response, selection: { ...request, ...patch } } }).success).toBe(false);
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request, response: { ...response, file: { kind: "absent", contentBase64: "" } } }).success).toBe(false);
  });
  it("rejects a request and response agreeing on a forged version digest or identity", () => {
    const version = { skillId: "skill-1", versionId: "version-1", snapshotDigest: digest };
    const stored = { version, entry: { path: "SKILL.md", digest, sizeBytes: 1 } };
    const forged = "b".repeat(64);
    const request = { ...version, path: "SKILL.md", expectedFileDigest: forged };
    const response = { version, path: request.path, digest: forged, contentBase64: "Yg==" };
    expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ stored, request, response }).success).toBe(false);
    for (const patch of [{ versionId: "other" }, { skillId: "other" }, { snapshotDigest: forged }]) {
      expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ stored, request: { ...request, ...patch, expectedFileDigest: digest }, response: { ...response, version: { ...version, ...patch }, digest } }).success).toBe(false);
    }
    expect(operations.getSkillVersionFile.in.safeParse({ ...request, stored }).success).toBe(false);
  });
  it("rejects jointly forged upstream digests and absence against the stored review", () => {
    const review = { skillId: "skill-1", draftId: "draft-1", expectedRevision: 1, expectedSnapshotDigest: digest, checkedSourceDigest: digest };
    const stored = { review, entries: [{ path: "SKILL.md", baseDigest: digest, localDigest: digest, upstreamDigest: null }] };
    const forged = "b".repeat(64);
    for (const side of ["base", "local"] as const) {
      for (const expectedFileDigest of [null, forged]) {
        const request = { ...review, path: "SKILL.md", side, expectedFileDigest };
        const file = expectedFileDigest === null ? { kind: "absent" } : { kind: "present", digest: forged, contentBase64: "Yg==" };
        expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request, response: { selection: request, file } }).success).toBe(false);
      }
    }
    const request = { ...review, path: "SKILL.md", side: "upstream", expectedFileDigest: null };
    const response = { selection: request, file: { kind: "absent" } };
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request, response }).success).toBe(true);
    for (const patch of [{ path: "unknown.md" }, { draftId: "other" }, { expectedRevision: 2 }, { checkedSourceDigest: forged }, { expectedSnapshotDigest: forged }, { skillId: "other" }]) {
      const altered = { ...request, ...patch };
      expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ stored, request: altered, response: { ...response, selection: altered } }).success).toBe(false);
    }
    expect(operations.getSkillUpstreamFile.in.safeParse({ ...request, stored }).success).toBe(false);
  });

});
