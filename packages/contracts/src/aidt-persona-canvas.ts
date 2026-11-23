import { z } from "zod";
import * as canvas from "./canvas";

/** Local encoding inside the existing AIDT stage-fields envelope. No new operation or permission. */
const metadataPrefix = "definitionPersonaCanvas:";
const templatePrefix = "definitionPersonaTemplate:";
export const AIDT_PERSONA_CANVAS_FIELD_LENGTH = 6000;
export const AIDT_PERSONA_CANVAS_MAX_TEMPLATE_PARTS = 16;
export const aidtPersonaCanvasKey = (entityId: string) => metadataPrefix + entityId;
export const aidtPersonaCanvasCodeKey = (entityId: string) => metadataPrefix + entityId + ":code";
export const aidtPersonaTemplatePartKey = (entityId: string, index: number) => templatePrefix + entityId + ":" + index;
const reference = z.string().min(1).max(256);
const revision = z.number().int().positive().max(2147483647);
export const AidtPersonaCanvasMetadata = z.object({
  orgId: reference, projectId: reference, sourceRevision: revision, definitionRevision: revision.optional(),
  cardIds: z.array(reference).min(1).max(16), syntheticCardIds: z.array(reference).max(16).optional(), threadId: reference, messageId: reference,
  templateKey: z.literal("persona"), templateVersion: z.number().int().positive(),
  templateParts: z.number().int().min(1).max(AIDT_PERSONA_CANVAS_MAX_TEMPLATE_PARTS),
}).strict();

/** Reads one explicitly named saved entity. Its model/student content remains interpretation, not primary evidence. */
export function readStoredAidtPersonaCanvas(fields: Readonly<Record<string, string>>, entityId: string) {
  try {
    const metadata = AidtPersonaCanvasMetadata.safeParse(JSON.parse(fields[aidtPersonaCanvasKey(entityId)] ?? "null"));
    if (!metadata.success) return null;
    const value = metadata.data;
    const code = fields[aidtPersonaCanvasCodeKey(entityId)];
    if (!code || code.length > AIDT_PERSONA_CANVAS_FIELD_LENGTH) return null;
    const parts = Array.from({ length: value.templateParts }, (_, index) => fields[aidtPersonaTemplatePartKey(entityId, index)]);
    if (parts.some(part => !part || part.length > AIDT_PERSONA_CANVAS_FIELD_LENGTH)) return null;
    const template = canvas.operations.listTemplates.out.shape.templates.element.safeParse(JSON.parse(parts.join("")));
    if (!template.success || template.data.key !== value.templateKey || template.data.version !== value.templateVersion) return null;
    return { code, template: template.data, source: {
      orgId: value.orgId, projectId: value.projectId, revision: value.sourceRevision, definitionRevision: value.definitionRevision,
      cardIds: value.cardIds, syntheticCardIds: value.syntheticCardIds, threadId: value.threadId, messageId: value.messageId,
    } };
  } catch { return null; }
}
export type AidtStoredPersonaCanvas = NonNullable<ReturnType<typeof readStoredAidtPersonaCanvas>>;
