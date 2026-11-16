import { z } from "zod";
import { AidtPrototypeIdentifierSchema, AidtPrototypeReferenceSchema } from "@repo/contracts/aidt-return-reflection";
export { AidtPrototypeIdentifierSchema, AidtPrototypeReferenceSchema } from "@repo/contracts/aidt-return-reflection";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import type { AidtPrototypeVersionReference } from "./aidt-prototype-versions";
import { aidtPrototypeVersionLabel } from "./aidt-prototype-label";

export const AIDT_PROTOTYPE_REFERENCE_FIELD = "prototypeReference";
export const AIDT_ITERATION_PROTOTYPE_REFERENCE_FIELD = "iterationPrototypeReference";
export const AIDT_ITERATION_PROTOTYPE_RELATION_FIELD = "iterationPrototypeRelation";
export const AIDT_ITERATION_FEEDBACK_FIELD = "iterationFeedbackReference";
export const AIDT_ITERATION_REASON_FIELD = "iterationChangeReason";
/** Structure validation only: never implies current access or independently verified evidence. */
export function parseAidtPrototypeReference(raw: string | null | undefined): AidtPrototypeVersionReference | null {
  if (!raw || raw.length > 6000) return null;
  try {
    const parsed = AidtPrototypeReferenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function readAidtPrototypeReference(draft: AidtUiStageDraft): AidtPrototypeVersionReference | null {
  return parseAidtPrototypeReference(draft.fields[AIDT_PROTOTYPE_REFERENCE_FIELD]);
}
export function readAidtIterationPrototypeReference(draft: AidtUiStageDraft): AidtPrototypeVersionReference | null {
  return parseAidtPrototypeReference(draft.fields[AIDT_ITERATION_PROTOTYPE_REFERENCE_FIELD]);
}
export function updateAidtPrototypeReference(draft: AidtUiStageDraft, reference: AidtPrototypeVersionReference | null): AidtUiStageDraft {
  const serialized = reference === null ? "" : JSON.stringify(AidtPrototypeReferenceSchema.parse(reference));
  if (serialized.length > 6000) throw new Error("AIDT_PROTOTYPE_REFERENCE_TOO_LARGE");
  return { ...draft, fields: { ...draft.fields, [AIDT_PROTOTYPE_REFERENCE_FIELD]: serialized, reflectionConfirmed: "" } };
}
/** Even typing an old label again does not restore a native selection marker. */
export function updateAidtPrototypeVersionText(draft: AidtUiStageDraft, text: string): AidtUiStageDraft {
  const cleared = updateAidtPrototypeReference(draft, null);
  return { ...cleared, fields: { ...cleared.fields, version: text } };
}
/** Iteration output is separate from the tested prototype and frozen question. */
export function updateAidtIterationPrototypeReference(draft: AidtUiStageDraft, reference: AidtPrototypeVersionReference | null): AidtUiStageDraft {
  const serialized = reference === null ? "" : JSON.stringify(AidtPrototypeReferenceSchema.parse(reference));
  if (serialized.length > 6000) throw new Error("AIDT_PROTOTYPE_REFERENCE_TOO_LARGE");
  return { ...draft, fields: { ...draft.fields, [AIDT_ITERATION_PROTOTYPE_REFERENCE_FIELD]: serialized, [AIDT_ITERATION_PROTOTYPE_RELATION_FIELD]: "", reflectionConfirmed: "" } };
}
export function updateAidtIterationVersionText(draft: AidtUiStageDraft, text: string): AidtUiStageDraft {
  const cleared = updateAidtIterationPrototypeReference(draft, null);
  return { ...cleared, fields: { ...cleared.fields, newVersion: text } };
}
export function updateAidtIterationBasis(draft: AidtUiStageDraft, field: typeof AIDT_ITERATION_FEEDBACK_FIELD | typeof AIDT_ITERATION_REASON_FIELD, text: string): AidtUiStageDraft {
  return { ...draft, fields: { ...draft.fields, [field]: text, [AIDT_ITERATION_PROTOTYPE_RELATION_FIELD]: "", reflectionConfirmed: "" } };
}
/** A student's explicit historical relation; no server verification or quality verdict. */
export const AidtIterationPrototypeRelationSchema = z.object({
  schemaVersion: z.literal(1),
  questionSnapshot: z.string().min(1).max(6000),
  producedDesignId: AidtPrototypeIdentifierSchema,
  producedVersionId: AidtPrototypeIdentifierSchema,
  feedbackReference: z.string().trim().min(1).max(2000),
  changeReason: z.string().trim().min(1).max(2000),
}).strict();
export type AidtIterationPrototypeRelation = z.infer<typeof AidtIterationPrototypeRelationSchema>;
export function readAidtIterationPrototypeRelation(draft: AidtUiStageDraft): AidtIterationPrototypeRelation | null {
  const raw = draft.fields[AIDT_ITERATION_PROTOTYPE_RELATION_FIELD];
  if (!raw || raw.length > 6000) return null;
  try { const parsed = AidtIterationPrototypeRelationSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; } catch { return null; }
}
export function sameAidtPrototypeVersion(a: Pick<AidtPrototypeVersionReference, "designId" | "versionId">, b: Pick<AidtPrototypeVersionReference, "designId" | "versionId">): boolean {
  return a.designId === b.designId && a.versionId === b.versionId;
}
export function formatAidtPrototypeReference(reference: AidtPrototypeVersionReference): string {
  return `${aidtPrototypeVersionLabel(reference)}；Design ID：${reference.designId}；版本 ID：${reference.versionId}；学生保存的页数记录 ${reference.generatedFrameCount}/${reference.frameCount}。记录结构可读；实际内容、当前访问权限与研究证据仍需原服务和学生核对。`;
}
