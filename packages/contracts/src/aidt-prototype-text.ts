import { z } from "zod";
import { PROTOTYPE_MAX_REF_IMAGES } from "./design-workbench";

/** Internal persisted S5 field vocabulary. No new endpoint or authority. */
export const AIDT_PROTOTYPE_TEXT_FIELDS = ["prototypeTextDesign", "prototypeTextVersion", "prototypeTextLineage", "prototypeTextConfirmation", "prototypeTextConfirmedText", "prototypeTextConfirmedLineage", "prototypeTextOutputBinding", "prototypeTextOutputBindings", "prototypeSourceImages", "aidtPrototypeConfirmedHandoff"] as const;
export const aidtPrototypeTextStorageKey = (id: string, field: typeof AIDT_PROTOTYPE_TEXT_FIELDS[number]) => `prototypeText:${id}:${field}`;
export const AIDT_PROTOTYPE_TEXT_MAX_CHARS = 3000;
const identifier = z.string().trim().min(1).max(256);
const revision = z.number().int().positive().max(2147483646);
export const AidtPrototypeInputSelection = z.object({ revision, brainstormId: identifier.optional(), ideaIds: z.array(z.string().min(1).max(256)).min(1).max(8) }).strict();
export type AidtPrototypeInputSelection = z.infer<typeof AidtPrototypeInputSelection>;
export const AidtPrototypeTraceReference = z.object({ stageId: z.number().int().min(1).max(4), revision, entityId: identifier, role: z.enum(["challenge", "interview", "finding", "persona", "hmw", "idea", "brainstorm"]) }).strict();
export const AidtPrototypeIdeaTrace = z.object({ ideaId: identifier, references: AidtPrototypeTraceReference.array().max(48), missing: z.string().max(150).array().max(12) }).strict();
export const AidtPrototypeLineage = z.object({ schemaVersion: z.literal(1), projectId: identifier, stage4Revision: revision, brainstormId: identifier.optional(),
  ideas: AidtPrototypeIdeaTrace.array().min(1).max(8) }).strict();
export type AidtPrototypeLineage = z.infer<typeof AidtPrototypeLineage>;
export type AidtPrototypeTraceReference = z.infer<typeof AidtPrototypeTraceReference>;
export const AidtPrototypeTextConfirmation = z.object({ schemaVersion: z.literal(1), projectId: identifier, designId: identifier,
  stageRevision: revision, textVersion: identifier, text: z.string().min(1).max(AIDT_PROTOTYPE_TEXT_MAX_CHARS).refine(value => !!value.trim()),
  selection: z.string().min(1).max(2500), lineage: z.string().min(1).max(6000) }).strict();
export type AidtPrototypeTextConfirmation = z.infer<typeof AidtPrototypeTextConfirmation>;
export const AidtPrototypeTextConfirmationMetadata = AidtPrototypeTextConfirmation.omit({ text: true, lineage: true });
export const AidtPrototypeTextOutputBinding = z.object({ schemaVersion: z.literal(1), projectId: identifier, designId: identifier, versionId: identifier,
  textStageRevision: revision, textVersion: identifier, textSha256: z.string().regex(/^[a-f0-9]{64}$/), lineageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["image", "native"]), bindingMethod: z.enum(["application-image-save", "student-selected-native-version"]),
  boundBy: identifier, boundAt: z.string().datetime(), providerIndependentlyVerified: z.literal(false) }).strict();
export type AidtPrototypeTextOutputBinding = z.infer<typeof AidtPrototypeTextOutputBinding>;

/** Project only the explicitly named prototype, never all S5 sibling records. */
export function projectAidtPrototypeTextEntity(fields: Readonly<Record<string, string>>, id: string): Record<string, string> | null {
  try {
    const record = z.record(z.string().max(6000)).safeParse(JSON.parse(fields[`prototypeEntity:${id}`] ?? ""));
    if (!record.success) return null;
    for (const field of AIDT_PROTOTYPE_TEXT_FIELDS) {
      const value = fields[aidtPrototypeTextStorageKey(id, field)];
      if (value !== undefined) record.data[field] = value;
    }
    return record.data;
  } catch { return null; }
}

/** A student's saved content-bound confirmation, not a permission or validation receipt. */
export function readAidtPrototypeTextConfirmationFields(fields: Readonly<Record<string, string>>): AidtPrototypeTextConfirmation | null {
  try {
    const raw = fields.prototypeTextConfirmation;
    if (!raw || raw.length > 6000) return null;
    const metadata = AidtPrototypeTextConfirmationMetadata.safeParse(JSON.parse(raw));
    if (!metadata.success) return null;
    const value = AidtPrototypeTextConfirmation.safeParse({ ...metadata.data, text: fields.prototypeTextConfirmedText, lineage: fields.prototypeTextConfirmedLineage });
    return value.success ? value.data : null;
  } catch { return null; }
}

export function isAidtPrototypeTextConfirmationCurrent(fields: Readonly<Record<string, string>>) {
  const value = readAidtPrototypeTextConfirmationFields(fields);
  let lineage: z.infer<typeof AidtPrototypeLineage> | null = null;
  try { lineage = AidtPrototypeLineage.parse(JSON.parse(fields.prototypeTextLineage ?? "")); } catch { return false; }
  if (!lineage) return false;
  if (!aidtPrototypeLineageMatchesSelection(lineage, fields.prototypeIdeaSource)) return false;
  return Boolean(value && value.projectId === lineage.projectId && value.text === fields.prototypeTextDesign
    && value.textVersion === fields.prototypeTextVersion && value.selection === fields.prototypeIdeaSource && value.lineage === fields.prototypeTextLineage);
}

export function aidtPrototypeLineageMatchesSelection(lineage: AidtPrototypeLineage, raw?: string) {
  try {
    const selected = AidtPrototypeInputSelection.safeParse(JSON.parse(raw ?? ""));
    return selected.success && new Set(selected.data.ideaIds).size === selected.data.ideaIds.length
      && lineage.stage4Revision === selected.data.revision && lineage.ideas.length === selected.data.ideaIds.length
      && lineage.brainstormId === selected.data.brainstormId
      && lineage.ideas.every((idea, index) => idea.ideaId === selected.data.ideaIds[index]);
  } catch { return false; }
}

/** Application upload acknowledgments for immutable native reference-image IDs;
 * not a provider claim or an independent authorization grant. */
export const AidtPrototypeSourceImages = z.object({ schemaVersion: z.literal(1), projectId: identifier, designId: identifier,
  textStageRevision: revision, textVersion: identifier, textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  images: z.array(z.object({ sourceRunId: identifier, artifactId: identifier, versionId: identifier, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    stage4Revision: revision, brainstormId: identifier, nativeImageId: identifier, nativeName: z.string().min(1).max(200), nativeSize: z.number().int().positive(), nativeMime: z.string().min(1).max(150) }).strict()).min(1).max(PROTOTYPE_MAX_REF_IMAGES),
}).strict();
export type AidtPrototypeSourceImages = z.infer<typeof AidtPrototypeSourceImages>;
