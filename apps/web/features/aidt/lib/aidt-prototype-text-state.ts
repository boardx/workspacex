import { z } from "zod";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { AIDT_PROTOTYPE_TEXT_MAX_CHARS, AidtPrototypeLineage, AidtPrototypeTextConfirmation as confirmation,
  AidtPrototypeTextOutputBinding as output, readAidtPrototypeTextConfirmationFields, isAidtPrototypeTextConfirmationCurrent, aidtPrototypeLineageMatchesSelection } from "@repo/contracts/aidt-prototype-text";
export { AIDT_PROTOTYPE_TEXT_FIELDS, aidtPrototypeTextStorageKey, AIDT_PROTOTYPE_TEXT_MAX_CHARS, AidtPrototypeLineage } from "@repo/contracts/aidt-prototype-text";
export type { AidtPrototypeTraceReference } from "@repo/contracts/aidt-prototype-text";
const identifier = z.string().trim().min(1).max(256);
export type AidtPrototypeTextConfirmation = z.infer<typeof confirmation>;
export type AidtPrototypeTextOutputBinding = z.infer<typeof output>;

function read<T>(schema: z.ZodType<T>, raw?: string): T | null {
  if (!raw || raw.length > 6000) return null;
  try { const value = schema.safeParse(JSON.parse(raw)); return value.success ? value.data : null; } catch { return null; }
}
export const readAidtPrototypeLineage = (draft: AidtUiStageDraft) => read(AidtPrototypeLineage, draft.fields.prototypeTextLineage);
export function readAidtPrototypeTextConfirmation(draft: AidtUiStageDraft): AidtPrototypeTextConfirmation | null {
  return readAidtPrototypeTextConfirmationFields(draft.fields);
}
export const readAidtPrototypeTextOutputBinding = (draft: AidtUiStageDraft) => read(output, draft.fields.prototypeTextOutputBinding);
export const readAidtPrototypeTextOutputBindings = (draft: AidtUiStageDraft) => read(output.array(), draft.fields.prototypeTextOutputBindings) ?? [];

/** Content comparison is exact, not an authorization grant or a quality verdict. */
export function isAidtPrototypeTextConfirmed(draft: AidtUiStageDraft) {
  return isAidtPrototypeTextConfirmationCurrent(draft.fields);
}

export function editAidtPrototypeText(draft: AidtUiStageDraft, text: string, version: string): AidtUiStageDraft {
  if (text.length > AIDT_PROTOTYPE_TEXT_MAX_CHARS || !identifier.safeParse(version).success || text === (draft.fields.prototypeTextDesign ?? "")) return draft;
  return { ...draft, fields: { ...draft.fields, prototypeTextRequired: "true", prototypeTextDesign: text, prototypeTextVersion: version,
    prototypeTextConfirmation: "", aidtPrototypeConfirmedHandoff: "" } };
}

export function confirmAidtPrototypeText(draft: AidtUiStageDraft, projectId: string, designId: string, stageRevision: number): AidtUiStageDraft | null {
  const lineage = readAidtPrototypeLineage(draft);
  if (!lineage?.brainstormId || lineage.projectId !== projectId || !aidtPrototypeLineageMatchesSelection(lineage, draft.fields.prototypeIdeaSource)) return null;
  const parsed = confirmation.safeParse({ schemaVersion: 1, projectId, designId, stageRevision, textVersion: draft.fields.prototypeTextVersion,
    text: draft.fields.prototypeTextDesign, selection: draft.fields.prototypeIdeaSource, lineage: draft.fields.prototypeTextLineage });
  if (!parsed.success || parsed.data.text !== draft.fields.prototypeTextDesign) return null;
  const { text, lineage: confirmedLineage, ...metadata } = parsed.data;
  return { ...draft, fields: { ...draft.fields, prototypeTextRequired: "true", prototypeTextConfirmation: JSON.stringify(metadata),
    prototypeTextConfirmedText: text, prototypeTextConfirmedLineage: confirmedLineage, aidtPrototypeConfirmedHandoff: "" } };
}

export async function aidtPrototypeTextHashes(value: AidtPrototypeTextConfirmation) {
  const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
  const [textSha256, lineageSha256] = await Promise.all([hash(value.text), hash(value.lineage)]);
  return { textSha256, lineageSha256 };
}

export function bindAidtPrototypeTextOutput(draft: AidtUiStageDraft, projectId: string, designId: string, versionId: string,
  expected: AidtPrototypeTextConfirmation, metadata: Pick<AidtPrototypeTextOutputBinding, "kind" | "bindingMethod" | "boundBy" | "boundAt" | "textSha256" | "lineageSha256">): AidtUiStageDraft {
  if (!readAidtPrototypeLineage(draft)?.brainstormId || !isAidtPrototypeTextConfirmed(draft) || JSON.stringify(readAidtPrototypeTextConfirmation(draft)) !== JSON.stringify(expected)
    || expected.projectId !== projectId || expected.designId !== designId) return draft;
  const stored = read(output.array(), draft.fields.prototypeTextOutputBindings);
  if (draft.fields.prototypeTextOutputBindings && !stored) return draft;
  const prior = readAidtPrototypeTextOutputBinding(draft);
  const previous = stored ?? (prior ? [prior] : []);
  if (new Set(previous.map(value => JSON.stringify([value.designId, value.versionId]))).size !== previous.length) return draft;
  const existing = previous.find(value => value.designId === designId && value.versionId === versionId);
  if (existing && (existing.textVersion !== expected.textVersion || existing.textStageRevision !== expected.stageRevision
    || existing.textSha256 !== metadata.textSha256 || existing.lineageSha256 !== metadata.lineageSha256)) return draft;
  const value = existing ?? output.parse({ schemaVersion: 1, projectId, designId, versionId, textStageRevision: expected.stageRevision,
    textVersion: expected.textVersion, ...metadata, providerIndependentlyVerified: false });
  const bindings = JSON.stringify(existing ? previous : [...previous, value]);
  if (bindings.length > 6000) return draft;
  return { ...draft, fields: { ...draft.fields, prototypeTextOutputBinding: JSON.stringify(value), prototypeTextOutputBindings: bindings, aidtPrototypeConfirmedHandoff: "" } };
}

export function aidtPrototypeOutputMatchesText(draft: AidtUiStageDraft, designId: string, versionId: string) {
  const bound = readAidtPrototypeTextOutputBinding(draft), text = readAidtPrototypeTextConfirmation(draft);
  return Boolean(isAidtPrototypeTextConfirmed(draft) && bound && text && bound.projectId === text.projectId && bound.designId === designId
    && bound.versionId === versionId && bound.textVersion === text.textVersion && bound.textStageRevision === text.stageRevision);
}
