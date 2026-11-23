import { aidtDefinitionSyntheticCardIds } from "./aidt-definition-source-nature";
export { aidtDefinitionSyntheticCardIds, sameAidtDefinitionSyntheticSources, aidtSavedDefinitionSyntheticCardIds, AIDT_DEFINITION_SYNTHETIC_NOTICE } from "./aidt-definition-source-nature";
import { aidtDefinitionCards } from "./aidt-definition";
import { isAidtInterviewArchived, readAidtInterviews, readAidtInterviewMaterials, readAidtInterviewTranscript } from "./aidt-interviews";
import { readAidtStage, readAidtStageRevision } from "./live-aidt-stages";
import type { AidtDiscoveryCardDraft } from "./aidt-ui-drafts";

type Fields = Readonly<Record<string, string>>;
/** A frozen card keeps its original text; current consent is authority, never the old revision. */
export function aidtAuthorizedDefinitionCards(cards: readonly AidtDiscoveryCardDraft[], historicalFields: Fields, currentFields: Fields) {
  const owners = new Map(readAidtInterviews(currentFields).map(record => [record.id, record]));
  return aidtDefinitionCards(cards, historicalFields).flatMap(card => {
    const current = owners.get(card.id);
    if (!current?.consent?.notes || isAidtInterviewArchived(currentFields, card.id)) return [];
    const transcript = readAidtInterviewTranscript(historicalFields, card.id);
    const material = transcript && readAidtInterviewMaterials(historicalFields, card.id).find(item => item.key === transcript.sourceKey);
    if (material?.reference.mime.startsWith("audio/") && !current.consent.audio) return [];
    return [{ ...card, ...(current.consent.photos ? {} : { photoRef: "", photoAttachment: undefined }) }];
  });
}
export const aidtDefinitionCardTextIdentity = (card: AidtDiscoveryCardDraft) => JSON.stringify({ id: card.id, participantCode: card.participantCode,
  headline: card.headline, headlineKind: card.headlineKind, context: card.context, quote: card.quote, sourceRef: card.sourceRef });

/** Existing read-only APIs. Missing current access is not permission to reuse historical content. */
export async function loadAidtAuthorizedDefinitionEvidence(input: {
  projectId: string; revision: number; sessionToken: string; cardIds?: readonly string[]; signal?: AbortSignal;
}) {
  const { stage: current } = await readAidtStage(input.projectId, 2, input.sessionToken, input.signal);
  if (!current || current.projectId !== input.projectId || current.stageId !== 2 || input.signal?.aborted) throw new Error("当前访谈授权无法核对。");
  const source = current.revision === input.revision ? current : await readAidtStageRevision(input.projectId, 2, input.revision, input.sessionToken, input.signal);
  if (!source || source.projectId !== input.projectId || source.stageId !== 2 || source.revision !== input.revision || input.signal?.aborted) throw new Error("冻结访谈版本无法核对。");
  // A historical fetch must not leave the earlier authorization read stale while it was in flight.
  const latest = source.revision === current.revision ? current : (await readAidtStage(input.projectId, 2, input.sessionToken, input.signal)).stage;
  if (!latest || latest.projectId !== input.projectId || latest.stageId !== 2 || input.signal?.aborted) throw new Error("当前访谈授权无法核对。");
  const cards = aidtAuthorizedDefinitionCards(source.content.draft.discoveryCards ?? [], source.content.draft.fields, latest.content.draft.fields);
  if (input.cardIds && (!input.cardIds.length || input.cardIds.some(id => !cards.some(card => card.id === id)))) throw new Error("所选访谈已撤回授权、归档或不再可用。原历史保留，未发送或加入。");
  return { cards, sourceFields: source.content.draft.fields, revision: source.revision, currentRevision: latest.revision,
    syntheticCardIds: aidtDefinitionSyntheticCardIds(input.cardIds ?? cards.map(card => card.id), source.content.draft.fields, latest.content.draft.fields) };
}
