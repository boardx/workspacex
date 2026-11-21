import { z } from "zod";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";

const record = z.object({ id: z.string(), archived: z.boolean(), cardIds: z.array(z.string()).max(16) });
const interview = z.object({ id: z.string(), code: z.string(), displayName: z.string().optional() });

function read<T>(schema: z.ZodType<T>, raw?: string): T | undefined {
  if (!raw) return undefined;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve a Persona/HMW's explicit references, never the latest interview stage by default. */
export function definitionInterviewCoordinates(stage: SharedStageValue, entityId: string) {
  if (stage.stageId !== 3) return undefined;
  const { fields } = stage.content.draft;
  const selected = read(record, fields[`definitionPersona:${entityId}`] ?? fields[`definitionHmw:${entityId}`]);
  const revision = Number(fields.definitionEvidenceRevision);
  if (!selected || selected.id !== entityId || selected.archived || !selected.cardIds.length
    || !Number.isInteger(revision) || revision < 1 || revision > 2147483647
    || !stage.sourceStageRevisions.some(ref => ref.stageId === 2 && ref.revision === revision)) return undefined;
  return { revision, cardIds: [...new Set(selected.cardIds)] };
}

export function definitionInterviewEvidence(stage: SharedStageValue, entityId: string, source: SharedStageValue) {
  const coords = definitionInterviewCoordinates(stage, entityId);
  if (!coords || source.projectId !== stage.projectId || source.stageId !== 2 || source.revision !== coords.revision) return undefined;
  const { fields, discoveryCards } = source.content.draft;
  const cards = coords.cardIds.flatMap(cardId => {
    const card = discoveryCards?.find(item => item.id === cardId);
    const owner = read(interview, fields[`interviewRecord:${cardId}`]);
    if (!card || owner?.id !== cardId || fields[`interviewConfirmed:${cardId}`] !== "true"
      || fields[`interviewArchived:${cardId}`] === "true") return [];
    return [{ interviewId: owner.id, cardId, interview: owner.displayName ? `${owner.code} · ${owner.displayName}` : owner.code,
      headline: card.headline.slice(0, 300), context: card.context.slice(0, 450), headlineKind: card.headlineKind }];
  });
  return { stageId: 2, revision: coords.revision, cards, unavailableCardIds: coords.cardIds.filter(id => !cards.some(card => card.cardId === id)) };
}
