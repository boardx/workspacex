import { describe, expect, it } from "vitest";
import { operations, SkillImportRequestSource, SkillImportSource, SkillDraft, FrozenTrialDependencies, ImportBatch, ImportJob, PublicationResult, RestoredDraftResult, summarizeImportBatch } from "../src/skill-development";
import { CapabilityTrialRunDependencySnapshot } from "../src/capability-runtime-policy";

const digest = "a".repeat(64);
const source = { kind: "github", repositoryUrl: "https://github.com/boardx/workspacex", selection: "subdirectory", path: "skills/example", requestedRef: "main", authConnectionId: null };
const head = { skillId: "skill-1", draftId: "draft-1", expectedRevision: 3, expectedSnapshotDigest: digest };
const key = "request-1";

describe("skill development proposed trust boundaries", () => {
  it("separates client source intent from server-resolved immutable provenance", () => {
    expect(SkillImportRequestSource.safeParse(source).success).toBe(true);
    expect(SkillImportSource.safeParse(source).success).toBe(false);
    const resolved = { ...source, resolvedCommit: "c".repeat(40) };
    expect(SkillImportSource.safeParse(resolved).success).toBe(true);
    expect(SkillImportRequestSource.safeParse(resolved).success).toBe(false);
    expect(SkillImportRequestSource.safeParse({ kind: "zip", uploadId: "upload-1" }).success).toBe(true);
    expect(SkillImportRequestSource.safeParse({ kind: "zip", uploadId: "upload-1", archiveDigest: digest }).success).toBe(false);
  });
  it("requires coherent root selection and canonical paths", () => {
    expect(SkillImportRequestSource.safeParse({ ...source, selection: "repository-root", path: null }).success).toBe(true);
    expect(SkillImportRequestSource.safeParse({ ...source, selection: "repository-root" }).success).toBe(false);
    for (const path of ["../secret", "a/../b", "a/./b", "a//b", "/root", "a\\b", "a\u0000b", "a\u007fb", "a/"]) {
      expect(SkillImportRequestSource.safeParse({ ...source, path }).success, path).toBe(false);
    }
  });
  it("publishes using a run reference instead of trusting client-declared successful evidence", () => {
    const request = { ...head, idempotencyKey: key, trialRunId: "trial-1" };
    expect(operations.publishSkillDraft.in.safeParse(request).success).toBe(true);
    expect(operations.publishSkillDraft.in.safeParse({ ...request, trialEvidence: { passedAt: "2026-09-09T00:00:00Z" } }).success).toBe(false);
    expect(operations.publishSkillDraft.in.safeParse({ ...head, idempotencyKey: key }).success).toBe(false);
    // Authorization and persisted evidence comparison belong to application integration tests.
  });
  it("requires atomic multi-file CAS and idempotency, permitting empty files", () => {
    const request = { ...head, idempotencyKey: key, mutations: [{ kind: "put", path: "empty.txt", contentBase64: "" }, { kind: "rename", from: "old.md", to: "new.md" }] };
    expect(operations.mutateSkillDraft.in.safeParse(request).success).toBe(true);
    expect(operations.mutateSkillDraft.in.safeParse({ ...request, expectedRevision: undefined }).success).toBe(false);
    expect(operations.mutateSkillDraft.in.safeParse({ ...request, idempotencyKey: undefined }).success).toBe(false);
    expect(operations.mutateSkillDraft.in.safeParse({ ...request, mutations: [] }).success).toBe(false);
    expect(operations.mutateSkillDraft.in.safeParse({ ...request, mutations: [{ kind: "put", path: "a.txt", contentBase64: "not base64!" }] }).success).toBe(false);
  });
  it("requires an explicit upstream resolution without ambiguous optional content", () => {
    const request = { ...head, checkedSourceDigest: digest, idempotencyKey: key, resolutions: [{ path: "a.md", choice: "upstream" }] };
    expect(operations.mergeSkillUpstream.in.safeParse(request).success).toBe(true);
    expect(operations.mergeSkillUpstream.in.safeParse({ ...request, resolutions: [{ path: "a.md", choice: "upstream", contentBase64: "" }] }).success).toBe(false);
    expect(operations.mergeSkillUpstream.in.safeParse({ ...request, resolutions: [{ path: "a.md", choice: "manual", contentBase64: "" }] }).success).toBe(true);
    expect(operations.mergeSkillUpstream.in.safeParse({ ...request, resolutions: [{ path: "a.md", choice: "manual" }] }).success).toBe(false);
  });
  it("restores historical files as a draft, never bypassing the publication operation", () => {
    expect(operations.rollbackSkillVersion.in.safeParse({ ...head, targetVersionId: "version-1", targetSnapshotDigest: digest, reason: "restore", idempotencyKey: key }).success).toBe(true);
    expect(operations.rollbackSkillVersion.out).toBe(RestoredDraftResult);
    expect(FrozenTrialDependencies).toBe(CapabilityTrialRunDependencySnapshot);
  });
  it("requires explicit candidate selection and keeps new imports separate from draft replacement", () => {
    const request = { previewId: "preview-1", expectedPreviewDigest: digest, candidateIds: ["candidate-1"], idempotencyKey: key };
    expect(operations.confirmImport.in.safeParse(request).success).toBe(true);
    expect(operations.confirmImport.in.safeParse({ ...request, candidateIds: [] }).success).toBe(false);
    expect(operations.confirmImport.in.safeParse({ ...request, candidateIds: ["a", "a"] }).success).toBe(false);
    expect(operations.confirmImport.in.safeParse({ ...request, draftId: "silently-overwrite" }).success).toBe(false);
    expect(operations.importIntoSkillDraft.in.safeParse({ ...head, previewId: "preview-1", candidateId: "candidate-1", expectedPreviewDigest: digest, idempotencyKey: key }).success).toBe(true);
  });
  it("retains independently completed items and rejects cross-preview or duplicate batch items", () => {
    const base = { jobId: "job-1", submittedAt: "2026-09-09T00:00:00Z", idempotencyKey: key, candidateId: "candidate-1", previewId: "preview-1", sourceDigest: digest, attempt: 1, previousAttemptJobId: null };
    const queued = { ...base, status: "queued" };
    const failed = { ...base, status: "failed", completedAt: "2026-09-09T00:00:01Z", failure: { code: "DEPENDENCY_UNAVAILABLE", message: "retry available", retryable: true } };
    const cancelled = { ...base, jobId: "job-2", candidateId: "candidate-2", status: "cancelled", completedAt: "2026-09-09T00:00:01Z" };
    const batch = (items: unknown[]) => ImportBatch.parse({ batchId: "batch-1", previewId: "preview-1", items });
    expect(summarizeImportBatch(batch([queued]))).toBe("queued");
    expect(summarizeImportBatch(batch([failed]))).toBe("failed");
    expect(summarizeImportBatch(batch([failed, cancelled]))).toBe("partial");
    expect(summarizeImportBatch(batch([queued, cancelled]))).toBe("running");
    expect(ImportBatch.safeParse({ batchId: "batch-1", previewId: "preview-1", items: [queued, queued] }).success).toBe(false);
    expect(ImportBatch.safeParse({ batchId: "batch-1", previewId: "other", items: [queued] }).success).toBe(false);
    expect(ImportBatch.safeParse({ batchId: "batch-1", previewId: "preview-1", items: [queued, { ...cancelled, sourceDigest: "b".repeat(64) }] }).success).toBe(false);
    expect(ImportBatch.safeParse({ batchId: "batch-1", previewId: "preview-1", items: [queued, { ...cancelled, jobId: queued.jobId }] }).success).toBe(false);
    expect(ImportJob.safeParse({ ...queued, attempt: 2 }).success).toBe(false);
    expect(ImportJob.safeParse({ ...queued, previousAttemptJobId: "earlier" }).success).toBe(false);
    expect(ImportJob.safeParse({ ...queued, attempt: 2, previousAttemptJobId: queued.jobId }).success).toBe(false);
    expect(ImportJob.safeParse({ ...queued, attempt: 2, previousAttemptJobId: "earlier" }).success).toBe(true);
    expect(ImportJob.safeParse({ ...failed, failure: { ...failed.failure, code: "SECRET_INTERNAL_EXCEPTION" } }).success).toBe(false);
  });
  it("rejects publications and restored drafts with contradictory version evidence", () => {
    const now = "2026-09-09T00:00:00Z";
    const published = { skillId: "skill-1", versionId: "version-1", versionNumber: 1, draftId: "draft-1", draftRevision: 3, snapshotDigest: digest, manifestPath: "SKILL.md", publishedAt: now };
    const evidence = { trialRunId: "trial-1", draftRevision: 3, snapshotDigest: digest, passedAt: now,
      dependencySnapshot: { dependencySnapshotId: "00000000-0000-4000-8000-000000000001", capturedAt: now,
        subject: { kind: "skill-draft", skillId: "skill-1", draftId: "draft-1", draftRevision: 3, snapshotDigest: digest },
        modelBinding: { shape: "single", capabilityModelId: "model-1", configRevision: "cfg-1", providerKey: "demo", upstreamModelId: "demo" }, mcpSnapshotRef: null } };
    const result = { published, archivedVersionId: null, evidence };
    expect(PublicationResult.safeParse(result).success).toBe(true);
    for (const patch of [{ skillId: "other" }, { draftId: "other" }, { draftRevision: 2 }, { snapshotDigest: "b".repeat(64) }]) {
      expect(PublicationResult.safeParse({ ...result, published: { ...published, ...patch } }).success).toBe(false);
    }
    const draft = SkillDraft.parse({ skillId: "skill-1", draftId: "draft-1", revision: 4, snapshotDigest: digest, manifestPath: "SKILL.md",
      files: [{ path: "SKILL.md", digest, sizeBytes: 1 }], sourcePin: null, basedOnPublishedVersionId: "version-1", updatedAt: now });
    const restored = { draft, restoredFrom: { versionId: "version-1", snapshotDigest: digest } };
    expect(RestoredDraftResult.safeParse(restored).success).toBe(true);
    expect(RestoredDraftResult.safeParse({ ...restored, restoredFrom: { ...restored.restoredFrom, versionId: "wrong-target" } }).success).toBe(false);
    expect(operations.getSkillVersion.out.safeParse({ version: published, files: draft.files }).success).toBe(true);
  });
});
