/** Review-only recovery proposal. Not exported by the production operation registry.
 * All storage access is scoped by authenticated session organization AND actor.
 * Upload cancellation stops preflight; byte-transfer resumption is not promised.
 */
import { z } from "zod";
import { ImportBatch, SkillImportUploadJob, operations as development } from "./skill-development";
const Id = development.getSkillImportUploadJob.in.shape.uploadId;
const Key = development.uploadSkillImportArchive.in.shape.idempotencyKey;
const Time = SkillImportUploadJob.options[0].shape.submittedAt;
const Revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Retention = z.discriminatedUnion("state", [
  z.object({ state: z.literal("retained") }).strict(),
  z.object({ state: z.literal("expired") }).strict(),
  z.object({ state: z.literal("discarded"), discardedAt: Time }).strict(),
]);
export const SkillImportUploadResource = z.object({
  resourceRevision: Revision, job: SkillImportUploadJob, retention: Retention,
}).strict().superRefine((resource, context) => {
  if (resource.retention.state === "expired" && resource.job.status !== "succeeded") {
    context.addIssue({ code: "custom", message: "expiration is defined by the succeeded job's existing expiresAt" });
  }
  if (resource.retention.state === "discarded" && ["queued", "running"].includes(resource.job.status)) {
    context.addIssue({ code: "custom", message: "in-flight preflight must be cancelled before discard" });
  }
});
const ErrorCode = z.enum(["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "INVALID_CURSOR", "REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT", "JOB_NOT_CANCELLABLE", "UPLOAD_NOT_DISCARDABLE", "SOURCE_IN_USE", "DEPENDENCY_UNAVAILABLE"]);
const Cursor = z.string().min(16).max(2048);
const ListInput = z.object({ cursor: Cursor.nullable(), limit: z.number().int().min(1).max(100) }).strict();
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item).max(100), nextCursor: Cursor.nullable() }).strict();
const UploadPage = page(SkillImportUploadResource).refine(value => new Set(value.items.map(item => item.job.uploadId)).size === value.items.length, "duplicate upload");
const BatchPage = page(ImportBatch).refine(value => new Set(value.items.map(item => item.batchId)).size === value.items.length, "duplicate batch");
const Mutation = z.object({ uploadId: Id, expectedResourceRevision: Revision, idempotencyKey: Key }).strict();
const MutationResult = z.object({ resource: SkillImportUploadResource, idempotencyKey: Key }).strict();
/** Explicit replacement of the existing GET output, not a competing endpoint.
 * Expired/tombstoned metadata stays readable by its owner; archive bytes never do.
 * Storage commits expiration under the resource CAS before returning its snapshot.
 * UPLOAD_EXPIRED is removed from this metadata GET; consuming expired bytes still fails.
 * Existing upload policy GET remains unchanged and is the sole limits/TTL policy source.
 */
export const existingOperationDeltas = {
  getSkillImportUploadJob: { method: development.getSkillImportUploadJob.method, path: development.getSkillImportUploadJob.path,
    in: development.getSkillImportUploadJob.in, out: SkillImportUploadResource, err: ["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const },
} as const;
export const operations = {
  listSkillImportUploads: { method: "GET", path: "/admin/skill-development/import-uploads", in: ListInput, out: UploadPage, err: ErrorCode.options },
  listSkillImportBatches: { method: "GET", path: "/admin/skill-development/import-batches", in: ListInput, out: BatchPage, err: ErrorCode.options },
  cancelSkillImportUpload: { method: "POST", path: "/admin/skill-development/import-uploads/:uploadId/cancellations", in: Mutation, out: MutationResult, err: ErrorCode.options },
  discardSkillImportUpload: { method: "POST", path: "/admin/skill-development/import-uploads/:uploadId/discards", in: Mutation, out: MutationResult, err: ErrorCode.options },
} as const;
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
};
/** Cursor is opaque and authenticated, bound to owner, list kind and an immutable
 * ordered ID fence. New uploads/batches do not enter that pagination session.
 * Adapter verifies it before querying; no cursor content is accepted as authority.
 * `stored` below is the resulting authorized storage page, including lookahead.
 */
const retentionMatchesTime = (resource: z.infer<typeof SkillImportUploadResource>, now: string) =>
  resource.job.status !== "succeeded" || resource.retention.state === "discarded" ||
  (resource.retention.state === "expired") === (Date.parse(now) >= Date.parse(resource.job.expiresAt));
const listExchange = <T>(output: z.ZodType<{ items: T[]; nextCursor: string | null }>, checkItem: (item: T, now: string) => boolean = () => true) => z.object({
  request: ListInput, response: output,
  stored: z.object({ input: ListInput, page: output, now: Time }).strict(),
}).strict().refine(({ request, response, stored }) => equal(request, stored.input) && equal(response, stored.page) &&
  response.items.every((item: T) => checkItem(item, stored.now)) && response.items.length <= request.limit && (response.nextCursor === null ||
    response.items.length === request.limit && response.nextCursor !== request.cursor), "list must match the owner-scoped stored page and continuation");
// Server-owned references: the resource's own preflight can be cancelled while
// retaining its byte lease until the worker acknowledges cancellation and releases it.
const SourceReferences = z.object({ ownPreflight: z.boolean(), externalConsumers: z.boolean() }).strict();
const StoredMutation = z.object({ resource: SkillImportUploadResource, references: SourceReferences, now: Time }).strict();
const freshMutation = z.object({ request: Mutation, response: MutationResult, stored: StoredMutation }).strict()
  .refine(({ request, response, stored }) => request.uploadId === stored.resource.job.uploadId &&
    request.expectedResourceRevision === stored.resource.resourceRevision &&
    response.resource.resourceRevision === stored.resource.resourceRevision + 1 &&
    response.idempotencyKey === request.idempotencyKey && retentionMatchesTime(stored.resource, stored.now),
  "mutation must use the stored upload revision and increment it exactly once");
/** Cancellation CAS fences late completion: workers must use the same resource revision.
 * Cancellation rejects external consumers only; it does not wait for its own worker.
 * Discard and GC require both the own-worker lease and external references released.
 * Discard is a tombstone committed atomically with the reference check. GC follows later
 * under the same reference rules; it must never cascade to imported drafts or versions.
 */
export const skillImportRecoveryExchanges = {
  getSkillImportUploadJob: z.object({ request: development.getSkillImportUploadJob.in, response: SkillImportUploadResource,
    stored: z.object({ resource: SkillImportUploadResource, now: Time }).strict() }).strict().refine(({ request, response, stored }) =>
    request.uploadId === stored.resource.job.uploadId && equal(response, stored.resource) && retentionMatchesTime(response, stored.now), "read must return the owner-scoped stored resource"),
  listSkillImportUploads: listExchange(UploadPage, retentionMatchesTime),
  listSkillImportBatches: listExchange(BatchPage),
  cancelSkillImportUpload: freshMutation.refine(({ response, stored }) => {
    const before = stored.resource, after = response.resource;
    if (stored.references.externalConsumers || before.retention.state !== "retained" || !["queued", "running"].includes(before.job.status) || after.job.status !== "cancelled") return false;
    const { status: _status, ...original } = before.job;
    const { status: _nextStatus, completedAt, ...cancelled } = after.job;
    // Running jobs lose startedAt because the existing cancelled variant has none.
    const { startedAt: _startedAt, ...identity } = original as typeof original & { startedAt?: string };
    return equal(identity, cancelled) && equal(before.retention, after.retention) && completedAt === stored.now;
  }, "only the same in-flight upload may be cancelled with the original job and submission identity"),
  discardSkillImportUpload: freshMutation.refine(({ response, stored }) => {
    const before = stored.resource, after = response.resource;
    return !stored.references.ownPreflight && !stored.references.externalConsumers && before.retention.state !== "discarded" &&
      !["queued", "running"].includes(before.job.status) && equal(before.job, after.job) &&
      after.retention.state === "discarded" && after.retention.discardedAt === stored.now;
  }, "discard requires an unreferenced terminal upload and preserves its job metadata"),
};
/** Idempotency receipt is loaded under (organization, actor, action, key). A replay
 * returns this exact prior result even if current state advanced; no second CAS write.
 */
export const skillImportRecoveryReplay = z.object({
  action: z.enum(["cancel", "discard"]), request: Mutation, response: MutationResult,
  storedReceipt: z.object({ action: z.enum(["cancel", "discard"]), request: Mutation, response: MutationResult }).strict(),
}).strict().refine(({ action, request, response, storedReceipt }) => action === storedReceipt.action &&
  equal(request, storedReceipt.request) && equal(response, storedReceipt.response) &&
  request.uploadId === response.resource.job.uploadId && request.idempotencyKey === response.idempotencyKey &&
  response.resource.resourceRevision === request.expectedResourceRevision + 1,
"replay must match the original owner-scoped action, request and committed response");

/** Server-only worker commit, not a client operation. The storage adapter must compare
 * the current resource revision atomically with this result write. Cancelling advances
 * that same revision, so a completion racing behind cancellation cannot resurrect it.
 * Own-worker reference release is a separate storage action, including after rejection.
 */
export const skillImportPreflightCompletion = z.object({
  request: z.object({ uploadId: Id, jobId: Id, expectedResourceRevision: Revision }).strict(),
  response: SkillImportUploadResource,
  stored: StoredMutation,
}).strict().refine(({ request, response, stored }) => {
  const before = stored.resource, after = response;
  if (!stored.references.ownPreflight || before.job.status !== "running" ||
    before.retention.state !== "retained" || after.retention.state !== "retained" ||
    request.uploadId !== before.job.uploadId || request.jobId !== before.job.jobId ||
    request.expectedResourceRevision !== before.resourceRevision ||
    after.resourceRevision !== before.resourceRevision + 1 ||
    (after.job.status !== "succeeded" && after.job.status !== "failed")) return false;
  return after.job.uploadId === before.job.uploadId && after.job.jobId === before.job.jobId &&
    after.job.idempotencyKey === before.job.idempotencyKey && after.job.submittedAt === before.job.submittedAt &&
    after.job.filename === before.job.filename && after.job.policyRevision === before.job.policyRevision &&
    after.job.completedAt === stored.now && retentionMatchesTime(after, stored.now);
}, "preflight completion must commit against the still-running resource's current revision and job identity");
/** Storage/GC guard only. Atomic byte deletion must recheck these owner-scoped leases;
 * a cancelled job alone is not proof that its worker has released the archive bytes.
 */
export const skillImportUploadGcEligibility = StoredMutation.refine(stored =>
  stored.resource.retention.state === "discarded" && !stored.references.ownPreflight && !stored.references.externalConsumers,
"GC requires a tombstone and every source reference released");
