/** Review-only source binding deltas. No production operation registration.
 * sourcePin stays exclusively in SkillDraft. Binding metadata describes comparison readiness,
 * never another copy of the source. Establishing a baseline is deliberately not implemented:
 * a newly rebound draft cannot use the existing merge operation until an explicit complete
 * path review and baseline-creation contract lands. Local files are never a fabricated base.
 */
import { z } from "zod";
import { SkillDraft, SkillImportPreview, UpstreamStatus, operations as development } from "./skill-development";
import { SkillSourceAssessment } from "./skill-source-assessment";
const ExactDraft = development.checkSkillUpstream.in;
const RebindInput = development.importIntoSkillDraft.in;
const Id = ExactDraft.shape.draftId;
const Time = z.string().datetime({ offset: true });
const Reason = z.string().trim().min(1).max(2000);
export const SkillSourceBinding = z.discriminatedUnion("state", [
  z.object({ state: z.literal("detached") }).strict(),
  z.object({ state: z.literal("baseline-required"), previewId: RebindInput.shape.previewId, candidateId: RebindInput.shape.candidateId }).strict(),
  // baselineId points to an immutable, server-owned comparison record. This module cannot create it.
  z.object({ state: z.literal("established"), baselineId: Id }).strict(),
]);
export const SkillSourceBoundDraft = z.object({ draft: SkillDraft, sourceBinding: SkillSourceBinding }).strict().refine(value =>
  (value.draft.sourcePin === null) === (value.sourceBinding.state === "detached"), "source binding readiness must agree with the sole draft sourcePin");
const ErrorCode = z.enum(["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT", "PREVIEW_EXPIRED", "SOURCE_MOVED", "SOURCE_ACCESS_DENIED", "BASELINE_MAPPING_REQUIRED", "BASELINE_REQUIRED", "SOURCE_NOT_BOUND", "DEPENDENCY_UNAVAILABLE"]);
export const operations = {
  detachSkillSource: { method: "POST", path: "/admin/skill-development/skills/:skillId/draft/source/detach", in: ExactDraft.extend({ idempotencyKey: RebindInput.shape.idempotencyKey, reason: Reason }).strict(), out: SkillSourceBoundDraft, err: ErrorCode.options },
  rebindSkillSource: { method: "POST", path: "/admin/skill-development/skills/:skillId/draft/source/rebind", in: RebindInput.extend({ reason: Reason }).strict(), out: SkillSourceBoundDraft, err: ErrorCode.options },
} as const;
const CheckResult = z.union([
  z.object({ state: z.literal("detached") }).strict(),
  z.object({ state: z.literal("baseline-required") }).strict(),
  UpstreamStatus,
]);
/** Replacement shapes on existing paths, not duplicate endpoints. Every check is tied to
 * the exact requested draft. Baseline-required reports no inferred unchanged/fast-forward.
 */
const UpstreamCheckErrors = z.union([...development.checkSkillUpstream.errors.options, z.object({ code: z.literal("SOURCE_ACCESS_DENIED"), message: z.string().min(1).max(2000), retryable: z.literal(false) }).strict()]);
export const existingOperationDeltas = {
  getSkillDraft: { ...development.getSkillDraft, out: SkillSourceBoundDraft },
  checkSkillUpstream: { ...development.checkSkillUpstream, err: UpstreamCheckErrors.options.map(error => error.shape.code.value), errors: UpstreamCheckErrors, out: z.object({ baseline: ExactDraft, result: CheckResult }).strict() },
} as const;
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};
const matchesDraft = (request: z.infer<typeof ExactDraft>, draft: z.infer<typeof SkillDraft>) => request.skillId === draft.skillId && request.draftId === draft.draftId && request.expectedRevision === draft.revision && request.expectedSnapshotDigest === draft.snapshotDigest;
const StoredDraft = z.object({ current: SkillSourceBoundDraft, now: Time }).strict();
const unchangedContent = (before: z.infer<typeof SkillDraft>, after: z.infer<typeof SkillDraft>, now: string) =>
  before.skillId === after.skillId && before.draftId === after.draftId && after.revision === before.revision + 1 &&
  before.manifestPath === after.manifestPath && same(before.files, after.files) && before.basedOnPublishedVersionId === after.basedOnPublishedVersionId && after.updatedAt === now;
/** `stored` is loaded after authenticated organization-admin and draft-resource
 * visibility/write checks; drafts are not restricted to their creator. Rebind additionally
 * verifies the acting user's personal source-connection authorization. Detach requires no
 * remote source access. This server-owned record is never an HTTP input.
 * sourceAccess and currentSourceDigest are freshly checked against the authorized selected
 * source by the adapter. Exact draft/source CAS, audit of old binding and write are atomic.
 * Snapshot digest is computed from actual stored bytes/metadata using the existing digest
 * definition; schema equality alone is not proof that files were preserved in storage.
 */
const RebindStored = StoredDraft.extend({ assessment: SkillSourceAssessment, preview: SkillImportPreview, sourceAccess: z.literal("allowed"), currentSourceDigest: RebindInput.shape.expectedPreviewDigest }).strict();
export const sourceBindingExchanges = {
  detachSkillSource: z.object({ request: operations.detachSkillSource.in, response: operations.detachSkillSource.out, stored: StoredDraft }).strict().refine(({ request, response, stored }) =>
    matchesDraft(request, stored.current.draft) && stored.current.sourceBinding.state !== "detached" && unchangedContent(stored.current.draft, response.draft, stored.now) && response.sourceBinding.state === "detached" && response.draft.sourcePin === null,
  "detach preserves draft content and lineage, clears binding and advances CAS without contacting upstream"),
  rebindSkillSource: z.object({ request: operations.rebindSkillSource.in, response: operations.rebindSkillSource.out, stored: RebindStored }).strict().refine(({ request, response, stored }) => {
    const preview = stored.preview;
    return matchesDraft(request, stored.current.draft) && unchangedContent(stored.current.draft, response.draft, stored.now) &&
      stored.assessment.compatibility === "compatible" && same(stored.assessment.preview, preview) &&
      Date.parse(stored.assessment.expiresAt) > Date.parse(stored.now) && Date.parse(preview.expiresAt) > Date.parse(stored.now) &&
      request.previewId === preview.previewId && request.expectedPreviewDigest === preview.previewDigest &&
      preview.pin.sourceDigest === stored.currentSourceDigest && preview.candidates.some(candidate => candidate.candidateId === request.candidateId) &&
      same(response.draft.sourcePin, preview.pin) && response.sourceBinding.state === "baseline-required" &&
      response.sourceBinding.previewId === preview.previewId && response.sourceBinding.candidateId === request.candidateId;
  }, "rebind uses an authorized compatible exact candidate and leaves baseline creation outstanding"),
  getSkillDraft: z.object({ request: development.getSkillDraft.in, response: SkillSourceBoundDraft, stored: SkillSourceBoundDraft }).strict().refine(({ request, response, stored }) => request.skillId === stored.draft.skillId && same(response, stored), "read returns the authoritative draft and readiness"),
  checkSkillUpstream: z.object({ request: ExactDraft, response: existingOperationDeltas.checkSkillUpstream.out, stored: z.object({ current: SkillSourceBoundDraft, result: CheckResult }).strict() }).strict().refine(({ request, response, stored }) => {
    const state = stored.current.sourceBinding.state;
    return matchesDraft(request, stored.current.draft) && same(request, response.baseline) && same(response.result, stored.result) &&
      (state === "established" ? !["detached", "baseline-required"].includes(response.result.state) : response.result.state === state);
  }, "upstream check must not invent an ancestor or hide baseline-required"),
};
/** Mandatory precondition before existing merge; controller adoption remains future work.
 * Revision change also invalidates old upstream reviews, AI patch baselines and trial evidence
 * through their existing exact-draft CAS. Published versions and Agent pins are untouched.
 */
export const sourceBindingMergeEligibility = z.object({ request: development.mergeSkillUpstream.in, stored: SkillSourceBoundDraft }).strict().refine(({ request, stored }) =>
  stored.sourceBinding.state === "established" && matchesDraft(request, stored.draft), "detached or baseline-required sources cannot merge; stale draft evidence cannot be reused");

/** Server-owned receipt loaded by organization, actor, action and idempotency key.
 * Resolve an exact receipt before fresh CAS evaluation: a lost response must replay
 * the committed result, even if the current draft subsequently advanced. The adapter
 * atomically commits receipt + mutation; mismatched key payload is a conflict.
 */
export const sourceBindingReplay = z.discriminatedUnion("action", [
  z.object({ action: z.literal("detach"), request: operations.detachSkillSource.in, response: SkillSourceBoundDraft,
    storedReceipt: z.object({ action: z.literal("detach"), request: operations.detachSkillSource.in, response: SkillSourceBoundDraft }).strict() }).strict(),
  z.object({ action: z.literal("rebind"), request: operations.rebindSkillSource.in, response: SkillSourceBoundDraft,
    storedReceipt: z.object({ action: z.literal("rebind"), request: operations.rebindSkillSource.in, response: SkillSourceBoundDraft }).strict() }).strict(),
]).refine(({ action, request, response, storedReceipt }) => same(request, storedReceipt.request) && same(response, storedReceipt.response) &&
  request.skillId === response.draft.skillId && request.draftId === response.draft.draftId && response.draft.revision === request.expectedRevision + 1 &&
  (action === "detach" ? response.sourceBinding.state === "detached" : response.sourceBinding.state === "baseline-required"),
"replay must return the same actor-scoped committed action and result without a second mutation");
