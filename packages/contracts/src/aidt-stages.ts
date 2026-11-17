/** AIDT shared working drafts. User approved A+B review; saving never confirms learning completion. */
import { z } from "zod";
export const STAGE_REQUEST_BODY_LIMIT_BYTES = 256 * 1024;
export function isStageRequestTooLarge(value: unknown): boolean { return new TextEncoder().encode(JSON.stringify(value)).length > STAGE_REQUEST_BODY_LIMIT_BYTES; }
export const StageId = z.number().int().min(1).max(6);
// Persisted revisions and SQL pagination parameters use PostgreSQL integer columns.
const maxStageRevision = 2147483647;
const revision = z.number().int().max(maxStageRevision);
const text = z.string().max(6000);
const referenceText = text.refine((v) => !/(?:data:|blob:)/i.test(v), "Use an uploaded reference, not embedded image bytes");
export const ImageAttachment = z.object({attachmentId:z.string().min(1).max(200),threadId:z.string().min(1).max(200),name:text}).strict();
export const DiscoveryCard = z.object({ id: text, participantCode: text, headline: text, headlineKind: z.enum(["quote", "student-summary"]), context: text, quote: text, sourceRef: text, photoRef: referenceText, photoAttachment: ImageAttachment.optional() }).strict();
export const StageDraft = z.object({
  fields: z.record(text).refine((v) => Object.keys(v).length <= 100),
  ideas: z.array(z.object({ id: text, title: text, description: text, image: z.literal("").optional(), imageName: text.optional(), imageAttachment:ImageAttachment.optional() }).strict()).max(100),
  selectedIdeaId: text, selectionReasons: z.record(text).optional(), unboundReason: text.optional(), discoveryCards: z.array(DiscoveryCard).max(100).optional(),
}).strict();
export const SourceStageRevision = z.object({ stageId: StageId, revision: revision.positive() }).strict();
export const SummaryReport = z.object({ markdown: z.string().max(100000), sourceStageRevisions: z.array(SourceStageRevision).max(6).refine((refs) => new Set(refs.map((r) => r.stageId)).size === refs.length, "Use one source revision per stage") }).strict();
export const StageContent = z.object({ schemaVersion: z.literal(1), draft: StageDraft, summaryReport: SummaryReport.optional() }).strict();
export const SharedStage = z.object({ projectId: z.string().min(1), stageId: StageId, revision: revision.positive(), content: StageContent, sourceStageRevisions: z.array(SourceStageRevision), updatedBy: z.string().min(1), updatedAt: z.string().datetime() });
export const StageSummary = z.object({ stageId: StageId, revision: revision.nonnegative(), updatedBy: z.string().nullable(), updatedAt: z.string().datetime().nullable() });
export const StageError = z.enum(["AIDT_STAGE_NOT_FOUND", "AIDT_STAGE_READONLY", "AIDT_STAGE_REVISION_CONFLICT", "AIDT_STAGE_OPERATION_CONFLICT", "AIDT_STAGE_INVALID", "AIDT_STAGE_TOO_LARGE", "AIDT_STAGE_UNAVAILABLE"]);
const location = z.object({ projectId: z.string().min(1), stageId: StageId });
// Saving appends expectedRevision + 1, so the base must leave room for that new row.
export const SaveInput = location.extend({ operationId: z.string().uuid(), expectedRevision: revision.nonnegative().max(maxStageRevision - 1), content: StageContent, sourceStageRevisions: z.array(SourceStageRevision).max(5) }).strict().superRefine((v,ctx) => {
  if (new Set(v.sourceStageRevisions.map((r)=>r.stageId)).size !== v.sourceStageRevisions.length || v.sourceStageRevisions.some((r)=>r.stageId >= v.stageId)) ctx.addIssue({code:"custom",path:["sourceStageRevisions"],message:"Use distinct earlier stages"});
  if (v.content.summaryReport && v.stageId !== 6) ctx.addIssue({code:"custom",path:["content","summaryReport"],message:"Summary report belongs to stage six"});
  if (isStageRequestTooLarge(v)) ctx.addIssue({code:"custom",message:"Stage request too large"});
});
export const operations = {
  list: { method:"GET", path:"/projects/:projectId/aidt/stages", in:z.object({projectId:z.string().min(1)}), out:z.object({items:z.array(StageSummary)}), err:StageError },
  get: { method:"GET", path:"/projects/:projectId/aidt/stages/:stageId", in:location, out:z.object({stage:SharedStage.nullable()}), err:StageError },
  save: { method:"PUT", path:"/projects/:projectId/aidt/stages/:stageId", in:SaveInput, out:z.object({stage:SharedStage,replayed:z.boolean()}), err:StageError },
  history: { method:"GET", path:"/projects/:projectId/aidt/stages/:stageId/revisions", in:location.extend({beforeRevision:revision.positive().optional(),limit:z.number().int().min(1).max(100).default(20)}), out:z.object({items:z.array(SharedStage),nextBeforeRevision:revision.positive().nullable()}), err:StageError },
} as const;
export type SharedStageValue = z.infer<typeof SharedStage>;
export type SaveStageInput = z.infer<typeof SaveInput>;
