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
    expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ request, response }).success).toBe(true);
    for (const version of [{ ...response.version, versionId: "new-version" }, { ...response.version, skillId: "other" }, { ...response.version, snapshotDigest: "b".repeat(64) }]) expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ request, response: { ...response, version } }).success).toBe(false);
    expect(skillHistoryContentExchanges.getSkillVersionFile.safeParse({ request, response: { ...response, digest: "b".repeat(64) } }).success).toBe(false);
    expect(operations.getSkillVersionFile.in.safeParse({ ...request, path: "../private" }).success).toBe(false);
  });
  it("keeps absent files distinct from empty contents and rejects swapped merge sides", () => {
    const request = { skillId: "skill-1", draftId: "draft-1", expectedRevision: 1, expectedSnapshotDigest: digest, checkedSourceDigest: digest, path: "SKILL.md", expectedFileDigest: null, side: "base" };
    const response = { selection: request, file: { kind: "absent" } };
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ request, response }).success).toBe(true);
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ request, response: { ...response, file: { kind: "present", digest, contentBase64: "" } } }).success).toBe(false);
    const presentRequest = { ...request, expectedFileDigest: digest };
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ request: presentRequest, response: { selection: presentRequest, file: { kind: "present", digest, contentBase64: "" } } }).success).toBe(true);
    for (const patch of [{ side: "upstream" }, { expectedRevision: 2 }, { checkedSourceDigest: "b".repeat(64) }, { path: "other.md" }]) expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ request, response: { ...response, selection: { ...request, ...patch } } }).success).toBe(false);
    expect(skillHistoryContentExchanges.getSkillUpstreamFile.safeParse({ request, response: { ...response, file: { kind: "absent", contentBase64: "" } } }).success).toBe(false);
  });
});
