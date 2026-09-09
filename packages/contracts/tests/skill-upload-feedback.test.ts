import { describe, expect, it } from "vitest";
import { DraftFromRunResult, operations, SkillImportUploadJob, SkillImportUploadPolicy } from "../src/skill-development";

const digest = "a".repeat(64);
const now = "2026-09-09T00:00:00Z";
describe("upload and failure-derived draft proposal boundaries", () => {
  it("requires server policy without accepting client upload digests as proof", () => {
    const policy = { policyRevision: "policy-1", maxArchiveBytes: 100, maxExtractedBytes: 500, maxEntries: 10, maxPathDepth: 5, maxCompressionRatio: 10, expiresAfterSeconds: 60 };
    expect(SkillImportUploadPolicy.safeParse(policy).success).toBe(true);
    expect(SkillImportUploadPolicy.safeParse({ ...policy, maxEntries: 0 }).success).toBe(false);
    const request = { filename: "skills.zip", declaredBytes: 30, expectedPolicyRevision: "policy-1", idempotencyKey: "upload-request" };
    expect(operations.uploadSkillImportArchive.in.safeParse(request).success).toBe(true);
    expect(operations.uploadSkillImportArchive.in.safeParse({ ...request, archiveDigest: digest }).success).toBe(false);
    expect(operations.uploadSkillImportArchive.in.safeParse({ ...request, validated: true }).success).toBe(false);
  });
  it("only completed preflight exposes an accepted archive digest", () => {
    const job = { jobId: "job-1", uploadId: "upload-1", filename: "skills.zip", policyRevision: "policy-1", submittedAt: now, idempotencyKey: "upload-request", status: "queued" };
    expect(SkillImportUploadJob.safeParse(job).success).toBe(true);
    expect(SkillImportUploadJob.safeParse({ ...job, archiveDigest: digest }).success).toBe(false);
    const completed = { ...job, status: "succeeded", completedAt: now, archiveDigest: digest, actualBytes: 30, expiresAt: "2026-09-10T00:00:00Z" };
    expect(SkillImportUploadJob.safeParse(completed).success).toBe(true);
    expect(SkillImportUploadJob.safeParse({ ...completed, archiveDigest: undefined }).success).toBe(false);
  });
  it("derives failure attribution on the server rather than accepting a caller's snapshot", () => {
    const request = { runId: "run-1", sourceVersionId: "version-1", idempotencyKey: "draft-request" };
    expect(operations.createSkillDraftFromRun.in.safeParse(request).success).toBe(true);
    expect(operations.createSkillDraftFromRun.in.safeParse({ ...request, skillVersionIds: ["forged"] }).success).toBe(false);
    expect(operations.createSkillDraftFromRun.in.safeParse({ ...request, draftId: "overwrite-existing" }).success).toBe(false);
  });
  it("requires the derived draft lineage to match a version from the failed run", () => {
    const result = { draft: { skillId: "skill-1", draftId: "draft-1", revision: 1, snapshotDigest: digest, manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest, sizeBytes: 1 }], sourcePin: null, basedOnPublishedVersionId: "version-1", updatedAt: now },
      origin: { runId: "run-1", agentId: "agent-1", agentVersionId: "agent-version-1", skillVersionIds: ["version-1"], modelConfigRef: null, mcpSnapshotRef: null, failureCode: "MODEL_CALL_FAILED" }, sourceVersionId: "version-1" };
    expect(DraftFromRunResult.safeParse(result).success).toBe(true);
    expect(DraftFromRunResult.safeParse({ ...result, sourceVersionId: "other" }).success).toBe(false);
    expect(DraftFromRunResult.safeParse({ ...result, origin: { ...result.origin, skillVersionIds: [] } }).success).toBe(false);
    expect(DraftFromRunResult.safeParse({ ...result, draft: { ...result.draft, basedOnPublishedVersionId: null } }).success).toBe(false);
  });
});
