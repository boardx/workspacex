import { describe, expect, it } from "vitest";
import { existingOperationDeltas, operations, SkillImportUploadResource, skillImportRecoveryExchanges as exchange, skillImportRecoveryReplay, skillImportPreflightCompletion, skillImportUploadGcEligibility } from "../src/skill-import-recovery";
import { operations as development } from "../src/skill-development";
const now = "2026-09-10T01:00:00Z";
const job = { uploadId: "upload-1", jobId: "job-1", submittedAt: "2026-09-10T00:00:00Z", idempotencyKey: "original-key", filename: "skill.zip", policyRevision: "policy-1", status: "queued" };
const resource = { resourceRevision: 1, job, retention: { state: "retained" } };
const request = { uploadId: job.uploadId, expectedResourceRevision: 1, idempotencyKey: "cancel-key" };
const cancelled = { ...resource, resourceRevision: 2, job: { ...job, status: "cancelled", completedAt: now } };
const response = { resource: cancelled, idempotencyKey: request.idempotencyKey };
const stored = { resource, references: { ownPreflight: false, externalConsumers: false }, now };
const cancel = (req: unknown = request, res: unknown = response, record: unknown = stored) => exchange.cancelSkillImportUpload.safeParse({ request: req, response: res, stored: record }).success;
describe("upload and import recovery proposal", () => {
  it("extends the original metadata GET and preserves succeeded expiration once", () => {
    expect(existingOperationDeltas.getSkillImportUploadJob.path).toBe(development.getSkillImportUploadJob.path);
    const success = { ...resource, job: { ...job, status: "succeeded", completedAt: now, archiveDigest: "a".repeat(64), actualBytes: 12, expiresAt: "2026-09-11T01:00:00Z" }, retention: { state: "expired" } };
    expect(SkillImportUploadResource.safeParse(success).success).toBe(true);
    expect(exchange.getSkillImportUploadJob.safeParse({ request: { uploadId: job.uploadId }, stored: { resource: success, now }, response: success }).success).toBe(false);
    expect(SkillImportUploadResource.safeParse({ ...success, expiresAt: now }).success).toBe(false);
    expect(SkillImportUploadResource.safeParse({ ...resource, retention: { state: "expired" } }).success).toBe(false);
    expect(exchange.getSkillImportUploadJob.safeParse({ request: { uploadId: job.uploadId }, stored: { resource: success, now: "2026-09-12T01:00:00Z" }, response: success }).success).toBe(true);
    expect(exchange.getSkillImportUploadJob.safeParse({ request: { uploadId: "other" }, stored: { resource: success, now: "2026-09-12T01:00:00Z" }, response: success }).success).toBe(false);
  });
  it("cancels queued/running preflight while preserving original job identity", () => {
    expect(cancel()).toBe(true);
    expect(cancel(request, response, { ...stored, resource: { ...resource, job: { ...job, status: "running", startedAt: now } } })).toBe(true);
    for (const patch of [{ jobId: "other" }, { uploadId: "other" }, { idempotencyKey: "changed-key" }, { filename: "other.zip" }, { policyRevision: "other" }]) {
      expect(cancel(request, { ...response, resource: { ...cancelled, job: { ...cancelled.job, ...patch } } })).toBe(false);
    }
    expect(cancel(request, response, { ...stored, references: { ownPreflight: false, externalConsumers: true } })).toBe(false);
  });
  it("rejects stale revisions, revision jumps, wrong receipts and forged ownership", () => {
    expect(cancel({ ...request, expectedResourceRevision: 2 })).toBe(false);
    expect(cancel(request, { ...response, resource: { ...cancelled, resourceRevision: 3 } })).toBe(false);
    expect(cancel(request, { ...response, idempotencyKey: "other-key" })).toBe(false);
    for (const field of ["actorId", "orgId", "sourceDigest"]) expect(operations.cancelSkillImportUpload.in.safeParse({ ...request, [field]: "forged" }).success).toBe(false);
  });
  it("discards only unreferenced terminal archives without changing their job metadata", () => {
    const req = { ...request, expectedResourceRevision: 2, idempotencyKey: "discard-key" };
    const record = { resource: cancelled, references: { ownPreflight: false, externalConsumers: false }, now };
    const result = { idempotencyKey: req.idempotencyKey, resource: { ...cancelled, resourceRevision: 3, retention: { state: "discarded", discardedAt: now } } };
    const valid = (s: unknown = record, r: unknown = result) => exchange.discardSkillImportUpload.safeParse({ request: req, stored: s, response: r }).success;
    expect(valid()).toBe(true);
    const succeededJob = { ...job, status: "succeeded", completedAt: now, archiveDigest: "a".repeat(64), actualBytes: 12, expiresAt: "2026-09-09T01:00:00Z" };
    const expired = { ...cancelled, job: succeededJob, retention: { state: "expired" } };
    expect(valid({ ...record, resource: expired }, { ...result, resource: { ...result.resource, job: succeededJob } })).toBe(true);
    expect(cancel(request, response, { ...stored, resource: { ...expired, resourceRevision: 1 } })).toBe(false);

    expect(valid({ ...record, references: { ownPreflight: false, externalConsumers: true } })).toBe(false);
    expect(valid({ ...record, resource: { ...cancelled, job } })).toBe(false);
    expect(valid(record, { ...result, resource: { ...result.resource, job: { ...cancelled.job, jobId: "other" } } })).toBe(false);
    expect(valid(record, { ...result, deletedDraftIds: ["draft-1"] })).toBe(false);
    expect(valid({ ...record, resource: { ...result.resource, resourceRevision: 2 } })).toBe(false);
  });
  it("replays only the stored action and exact original request without another write", () => {
    const value = { action: "cancel", request, response, storedReceipt: { action: "cancel", request, response } };
    expect(skillImportRecoveryReplay.safeParse(value).success).toBe(true);
    expect(skillImportRecoveryReplay.safeParse({ ...value, action: "discard" }).success).toBe(false);
    expect(skillImportRecoveryReplay.safeParse({ ...value, request: { ...request, expectedResourceRevision: 2 } }).success).toBe(false);
    expect(skillImportRecoveryReplay.safeParse({ ...value, response: { ...response, resource: { ...cancelled, resourceRevision: 3 } } }).success).toBe(false);
  });
  it("binds upload pagination to the server-scoped page and rejects invented cursor pages", () => {
    const input = { cursor: null, limit: 1 };
    const page = { items: [resource], nextCursor: "opaque-next-token" };
    const value = { request: input, response: page, stored: { input, page, now } };
    expect(exchange.listSkillImportUploads.safeParse(value).success).toBe(true);
    expect(exchange.listSkillImportUploads.safeParse({ ...value, response: { ...page, nextCursor: null } }).success).toBe(false);
    expect(exchange.listSkillImportUploads.safeParse({ ...value, request: { ...input, cursor: "invented-cursor-token" } }).success).toBe(false);
    const repeated = { cursor: page.nextCursor, limit: 1 };
    expect(exchange.listSkillImportUploads.safeParse({ request: repeated, response: page, stored: { input: repeated, page, now } }).success).toBe(false);
    expect(operations.listSkillImportUploads.out.safeParse({ ...page, items: [resource, resource] }).success).toBe(false);
    expect(operations.listSkillImportUploads.in.safeParse({ ...input, actorId: "other" }).success).toBe(false);
  });
  it("reuses batches and rejects a substituted batch after refresh", () => {
    const batch = { batchId: "batch-1", previewId: "preview-1", items: [{ jobId: "import-1", submittedAt: now, idempotencyKey: "import-key", candidateId: "candidate-1", previewId: "preview-1", sourceDigest: "a".repeat(64), attempt: 1, previousAttemptJobId: null, status: "queued" }] };
    const input = { cursor: null, limit: 10 }, page = { items: [batch], nextCursor: null };
    const value = { request: input, response: page, stored: { input, page, now } };
    expect(exchange.listSkillImportBatches.safeParse(value).success).toBe(true);
    expect(exchange.listSkillImportBatches.safeParse({ ...value, response: { ...page, items: [{ ...batch, batchId: "other" }] } }).success).toBe(false);
  });
  it("cancels its own running preflight lease without allowing external consumers", () => {
    const running = { ...stored, resource: { ...resource, job: { ...job, status: "running", startedAt: now } }, references: { ownPreflight: true, externalConsumers: false } };
    expect(cancel(request, response, running)).toBe(true);
    expect(cancel(request, response, { ...running, references: { ownPreflight: true, externalConsumers: true } })).toBe(false);
  });
  it("fences late worker completion with the same resource CAS after cancellation", () => {
    const running = { ...resource, job: { ...job, status: "running", startedAt: now } };
    const completion = { request: { uploadId: job.uploadId, jobId: job.jobId, expectedResourceRevision: 1 },
      stored: { ...stored, resource: running, references: { ownPreflight: true, externalConsumers: false } },
      response: { ...resource, resourceRevision: 2, job: { ...job, status: "succeeded", completedAt: now, archiveDigest: "a".repeat(64), actualBytes: 12, expiresAt: "2026-09-11T01:00:00Z" } } };
    expect(skillImportPreflightCompletion.safeParse(completion).success).toBe(true);
    const cancelledStorage = { ...completion.stored, resource: cancelled };
    expect(skillImportPreflightCompletion.safeParse({ ...completion, stored: cancelledStorage }).success).toBe(false);
    expect(skillImportPreflightCompletion.safeParse({ ...completion, request: { ...completion.request, expectedResourceRevision: 2 }, response: { ...completion.response, resourceRevision: 3 }, stored: cancelledStorage }).success).toBe(false);
    expect(skillImportPreflightCompletion.safeParse({ ...completion, request: { ...completion.request, jobId: "other" } }).success).toBe(false);
  });
  it("waits for its cancelled worker lease to release before discard or GC", () => {
    const req = { ...request, expectedResourceRevision: 2, idempotencyKey: "discard-key" };
    const tombstone = { ...cancelled, resourceRevision: 3, retention: { state: "discarded", discardedAt: now } };
    const record = { ...stored, resource: cancelled, references: { ownPreflight: true, externalConsumers: false } };
    const value = { request: req, stored: record, response: { idempotencyKey: req.idempotencyKey, resource: tombstone } };
    expect(exchange.discardSkillImportUpload.safeParse(value).success).toBe(false);
    expect(exchange.discardSkillImportUpload.safeParse({ ...value, stored: { ...record, references: { ownPreflight: false, externalConsumers: false } } }).success).toBe(true);
    expect(skillImportUploadGcEligibility.safeParse({ ...record, resource: tombstone }).success).toBe(false);
    expect(skillImportUploadGcEligibility.safeParse({ ...record, resource: tombstone, references: { ownPreflight: false, externalConsumers: false } }).success).toBe(true);
    expect(skillImportUploadGcEligibility.safeParse({ ...record, resource: tombstone, references: { ownPreflight: false, externalConsumers: true } }).success).toBe(false);
  });

});
