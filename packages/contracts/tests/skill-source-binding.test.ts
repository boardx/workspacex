import { describe, expect, it } from "vitest";
import { operations, existingOperationDeltas, sourceBindingReplay, sourceBindingExchanges, sourceBindingMergeEligibility, SkillSourceBoundDraft } from "../src/skill-source-binding";
const digest = "a".repeat(64), nextDigest = "b".repeat(64);
const now = "2026-09-10T00:00:00Z";
const pin = { source: { kind: "github", repositoryUrl: "https://github.com/example/skills", selection: "repository-root", path: null, requestedRef: "main", resolvedCommit: "c".repeat(40), authConnectionId: "my-connection" }, sourceDigest: digest };
const draft = { skillId: "skill-1", draftId: "draft-1", revision: 3, snapshotDigest: digest, manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest, sizeBytes: 42 }], sourcePin: pin, basedOnPublishedVersionId: "published-1", updatedAt: "2026-09-09T00:00:00Z" };
const current = { draft, sourceBinding: { state: "established", baselineId: "old-baseline" } };
const preview = { previewId: "preview-1", previewDigest: nextDigest, pin: { ...pin, source: { ...pin.source, repositoryUrl: "https://github.com/example/new-skills" } }, expiresAt: "2026-09-11T00:00:00Z", candidates: [{ candidateId: "candidate-1", name: "new-skill", manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest: nextDigest, sizeBytes: 99 }], warnings: [] }] };
const assessment = { assessmentId: "assessment-1", assessmentDigest: digest, pin: preview.pin, expiresAt: preview.expiresAt, compatibility: "compatible", preview };
const exact = { skillId: draft.skillId, draftId: draft.draftId, expectedRevision: 3, expectedSnapshotDigest: digest };
const request = { ...exact, previewId: preview.previewId, candidateId: "candidate-1", expectedPreviewDigest: nextDigest, reason: "Switch source explicitly", idempotencyKey: "binding-request-1" };
const response = { draft: { ...draft, revision: 4, snapshotDigest: nextDigest, sourcePin: preview.pin, updatedAt: now }, sourceBinding: { state: "baseline-required", previewId: preview.previewId, candidateId: request.candidateId } };
const stored = { current, now, assessment, preview, sourceAccess: "allowed", currentSourceDigest: digest };
describe("source binding review-only boundary", () => {
  it("rebinds from the authorized exact compatible candidate without importing its files or inventing a base", () => {
    expect(sourceBindingExchanges.rebindSkillSource.safeParse({ request, response, stored }).success).toBe(true);
    for (const changed of [{ files: preview.candidates[0]!.files }, { manifestPath: "other.md" }, { basedOnPublishedVersionId: null }, { revision: 5 }, { sourcePin: pin }]) expect(sourceBindingExchanges.rebindSkillSource.safeParse({ request, response: { ...response, draft: { ...response.draft, ...changed } }, stored }).success).toBe(false);
    expect(sourceBindingExchanges.rebindSkillSource.safeParse({ request, response: { ...response, sourceBinding: { state: "established", baselineId: "invented-local-base" } }, stored }).success).toBe(false);
  });
  it("rejects stale CAS, mismatched preview/candidate, expired authorization and moved source", () => {
    for (const changed of [{ expectedRevision: 2 }, { expectedSnapshotDigest: nextDigest }, { previewId: "other" }, { candidateId: "other" }, { expectedPreviewDigest: digest }]) expect(sourceBindingExchanges.rebindSkillSource.safeParse({ request: { ...request, ...changed }, response, stored }).success).toBe(false);
    for (const changed of [{ sourceAccess: "denied" }, { currentSourceDigest: nextDigest }, { now: preview.expiresAt }, { assessment: { ...assessment, expiresAt: now } }, { preview: { ...preview, expiresAt: now } }, { assessment: { assessmentId: assessment.assessmentId, assessmentDigest: digest, pin: preview.pin, expiresAt: preview.expiresAt, compatibility: "unsupported", reasons: ["No Skill"] } }]) expect(sourceBindingExchanges.rebindSkillSource.safeParse({ request, response, stored: { ...stored, ...changed } }).success).toBe(false);
    for (const extra of [{ sourcePin: preview.pin }, { resolvedCommit: "d".repeat(40) }, { sourceDigest: digest }]) expect(operations.rebindSkillSource.in.safeParse({ ...request, ...extra }).success).toBe(false);
  });
  it("detaches without remote access and preserves files/lineage while clearing comparison metadata", () => {
    const detach = { request: { ...exact, reason: "Source unavailable", idempotencyKey: "detach-request-1" }, stored: { current, now }, response: { draft: { ...draft, revision: 4, updatedAt: now, sourcePin: null }, sourceBinding: { state: "detached" } } };
    expect(sourceBindingExchanges.detachSkillSource.safeParse(detach).success).toBe(true);
    expect(sourceBindingExchanges.detachSkillSource.safeParse({ ...detach, response: { ...detach.response, draft: { ...detach.response.draft, files: preview.candidates[0]!.files } } }).success).toBe(false);
    expect(SkillSourceBoundDraft.safeParse({ ...detach.response, sourceBinding: { state: "detached", baselineId: "old-baseline" } }).success).toBe(false);
    expect(SkillSourceBoundDraft.safeParse({ draft, sourceBinding: { state: "detached" } }).success).toBe(false);
  });
  it("exposes baseline-required on existing reads and refuses false unchanged or fast-forward checks", () => {
    expect(sourceBindingExchanges.getSkillDraft.safeParse({ request: { skillId: draft.skillId }, response, stored: response }).success).toBe(true);
    const baseline = { ...exact, expectedRevision: 4, expectedSnapshotDigest: nextDigest };
    const check = { request: baseline, response: { baseline, result: { state: "baseline-required" } }, stored: { current: response, result: { state: "baseline-required" } } };
    expect(sourceBindingExchanges.checkSkillUpstream.safeParse(check).success).toBe(true);
    for (const result of [{ state: "unchanged", checkedPin: preview.pin }, { state: "fast-forward", checkedPin: preview.pin, changedPaths: ["SKILL.md"] }]) expect(sourceBindingExchanges.checkSkillUpstream.safeParse({ ...check, response: { baseline, result }, stored: { current: response, result } }).success).toBe(false);
    expect(sourceBindingExchanges.checkSkillUpstream.safeParse({ ...check, request: exact }).success).toBe(false);
  });
  it("blocks existing merges after binding changes and rejects evidence for an older draft", () => {
    const merge = { ...exact, checkedSourceDigest: digest, resolutions: [], idempotencyKey: "merge-request-1" };
    expect(sourceBindingMergeEligibility.safeParse({ request: merge, stored: current }).success).toBe(true);
    expect(sourceBindingMergeEligibility.safeParse({ request: { ...merge, expectedRevision: 4, expectedSnapshotDigest: nextDigest }, stored: response }).success).toBe(false);
    expect(sourceBindingMergeEligibility.safeParse({ request: merge, stored: { ...current, draft: { ...draft, revision: 4 } } }).success).toBe(false);
  });
});

it("declares source authorization recovery on the inherited upstream check", () => {
  expect(existingOperationDeltas.checkSkillUpstream.err).toContain("SOURCE_ACCESS_DENIED");
  expect(existingOperationDeltas.checkSkillUpstream.errors.safeParse({ code: "SOURCE_ACCESS_DENIED", message: "Reconnect your source", retryable: false }).success).toBe(true);
});
it("replays committed binding results without requiring the original draft to remain current", () => {
  const replay = { action: "rebind", request, response, storedReceipt: { action: "rebind", request, response } };
  expect(sourceBindingReplay.safeParse(replay).success).toBe(true);
  for (const change of [{ reason: "different" }, { idempotencyKey: "other" }, { candidateId: "other" }]) expect(sourceBindingReplay.safeParse({ ...replay, request: { ...request, ...change } }).success).toBe(false);
  expect(sourceBindingReplay.safeParse({ ...replay, response: { ...response, draft: { ...response.draft, revision: 5 } } }).success).toBe(false);
  expect(sourceBindingReplay.safeParse({ ...replay, storedReceipt: { ...replay.storedReceipt, action: "detach" } }).success).toBe(false);
});
