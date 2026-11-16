import { z } from "zod";
import { designWorkbench } from "@repo/contracts";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { aidtPrototypeVersionLabel, type AidtPrototypeVersionReference } from "./aidt-prototype-versions";

export const AIDT_PROTOTYPE_REFERENCE_FIELD = "prototypeReference";
export const AidtPrototypeIdentifierSchema = designWorkbench.PrototypeVersionSummary.shape.id.refine(
  (id) => !!id.trim() && id !== "." && id !== ".." && !/[\u0000-\u001f\u007f]/.test(id),
  "Use an actual native identifier",
);
/** Local persisted metadata format, not a new backend contract or authorization receipt. */
export const AidtPrototypeReferenceSchema = designWorkbench.PrototypeVersionSummary.pick({ seq: true, summary: true, createdAt: true, source: true }).extend({
  designId: AidtPrototypeIdentifierSchema,
  versionId: AidtPrototypeIdentifierSchema,
  designName: designWorkbench.DesignProject.innerType().shape.name,
  frameCount: z.number().int().positive().safe(),
  generatedFrameCount: z.number().int().positive().safe(),
}).strict().refine((reference) => reference.generatedFrameCount <= reference.frameCount, "Generated pages cannot exceed planned pages");

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
export function sameAidtPrototypeVersion(a: Pick<AidtPrototypeVersionReference, "designId" | "versionId">, b: Pick<AidtPrototypeVersionReference, "designId" | "versionId">): boolean {
  return a.designId === b.designId && a.versionId === b.versionId;
}
export function formatAidtPrototypeReference(reference: AidtPrototypeVersionReference): string {
  return `${aidtPrototypeVersionLabel(reference)}；Design ID：${reference.designId}；版本 ID：${reference.versionId}；学生保存的页数记录 ${reference.generatedFrameCount}/${reference.frameCount}。记录结构可读；实际内容、当前访问权限与研究证据仍需原服务和学生核对。`;
}
