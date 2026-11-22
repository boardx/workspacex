import { AIDT_CANDIDATE_ACTIONS } from "@repo/contracts/aidt-candidate-request";
import {
  addAidtDefinitionEntity, confirmedAidtDefinitionSurprises, readAidtDefinition,
  readAidtDefinitionEvidenceRevision, saveAidtDefinitionHmw, type AidtDefinitionPersona,
} from "./aidt-definition";
import { parseAidtDefinitionProposal, type AidtDefinitionProposal, type AidtDefinitionTurn } from "./aidt-definition-chat";
import type { AidtPersonaSource } from "./aidt-persona-candidates";
import { isAidtSurpriseConfirmed } from "./aidt-surprise-reflection";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

export type AidtHmwCandidate = {
  id: string; threadId: string; messageId: string; source: AidtPersonaSource;
  personaIds: readonly string[]; proposal: Extract<AidtDefinitionProposal, { kind: "hmw" }>;
};
export const aidtHmwCandidateSourceKey = (id: string) => "definitionHmwCandidate:" + id;

export function aidtHmwGenerationPrompt(cards: readonly AidtDiscoveryCardDraft[], personas: readonly AidtDefinitionPersona[], requested: number) {
  return [AIDT_CANDIDATE_ACTIONS.hmw,
    `请基于以下获准访谈发现、本组研讨与已确认画像，提出最多${Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1}个有差异的“我们如何……”（HMW）候选。证据只支持一个就只输出一个。`,
    "明确帮助谁、改善什么体验，保留不同解决路径，不提前锁定App或某个方案。不把AI建议写成小组已确认结论。",
    "每个候选输出一个独立aidt-definition JSON围栏，kind为hmw，字段沿用text、rationale、cardIds、personaIds、surpriseIds。无需画布。学生会预览、选择和修改，再明确加入；本轮不要保存、发布或确认产物。",
    "已确认画像：", ...personas.map(persona => JSON.stringify(persona)),
    "已保存访谈发现：", ...cards.map(card => JSON.stringify({ id: card.id, participantCode: card.participantCode,
      headline: card.headline, headlineKind: card.headlineKind, context: card.context, quote: card.quote, sourceRef: card.sourceRef })),
  ].join("\n");
}

export async function collectAidtHmwCandidates(input: {
  source: AidtPersonaSource; personaIds: readonly string[]; threadId: string; messages: readonly AidtDefinitionTurn[];
}): Promise<AidtHmwCandidate[]> {
  if (!input.threadId) return [];
  const candidates: AidtHmwCandidate[] = [];
  const seen = new Set<string>();
  for (const message of input.messages) {
    if (message.role !== "assistant" || !message.id || typeof message.content !== "string") continue;
    let ordinal = 0;
    for (const block of message.content.matchAll(/(?:^|\n)```aidt-definition[ \t]*\n([\s\S]*?)\n```(?=\n|$)/gu)) {
      try {
        const proposal = parseAidtDefinitionProposal(JSON.parse(block[1]!));
        if (proposal?.kind !== "hmw" || !proposal.text.trim()) continue;
        const signature = proposal.text.trim().replace(/\s+/gu, " ");
        if (seen.has(signature)) continue;
        seen.add(signature);
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([
          input.source.orgId, input.source.projectId, input.source.revision, input.source.definitionRevision, [...input.source.cardIds].sort(),
          [...input.personaIds].sort(), input.threadId, message.id, ordinal++, proposal,
        ])));
        const id = "ai-hmw-" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
        candidates.push({ id, threadId: input.threadId, messageId: message.id, source: input.source, personaIds: input.personaIds, proposal });
      } catch { /* Other prose stays in the native conversation. */ }
    }
  }
  return candidates;
}

export function addAidtHmwCandidate(draft: AidtUiStageDraft, candidate: AidtHmwCandidate, cards: readonly AidtDiscoveryCardDraft[], revision?: number): AidtUiStageDraft {
  if (parseAidtDefinitionProposal(candidate.proposal)?.kind !== "hmw" || !candidate.proposal.text.trim()) return draft;
  if (!revision || revision !== candidate.source.revision || !isAidtSurpriseConfirmed(draft, cards, revision) || draft.fields[aidtHmwCandidateSourceKey(candidate.id)]) return draft;
  const pinned = readAidtDefinitionEvidenceRevision(draft.fields);
  if (pinned !== null && pinned !== revision) return draft;
  const available = new Set(cards.map(card => card.id));
  const selectedCards = [...new Set(candidate.source.cardIds)];
  const personas = readAidtDefinition(draft.fields).personas.filter(persona => persona.confirmed && !persona.archived);
  const selectedPersonas = [...new Set(candidate.personaIds)];
  if (!selectedCards.length || selectedCards.some(id => !available.has(id)) || !selectedPersonas.length || selectedPersonas.some(id => !personas.some(persona => persona.id === id))) return draft;
  let next = addAidtDefinitionEntity(draft, "hmw", candidate.id, { name: candidate.proposal.text.slice(0, 80), personaIds: selectedPersonas,
    source: { revision, cardIds: selectedCards, available } });
  if (next === draft) return draft;
  const entity = readAidtDefinition(next.fields).hmws.find(item => item.id === candidate.id);
  if (!entity) return draft;
  const surprises = new Set(confirmedAidtDefinitionSurprises(draft.fields).map(item => item.id));
  next = saveAidtDefinitionHmw(next, { ...entity, text: candidate.proposal.text, rationale: candidate.proposal.rationale ?? "",
    surpriseIds: (candidate.proposal.surpriseIds ?? []).filter(id => surprises.has(id)), confirmed: false,
  }, revision);
  const fields = { ...next.fields, [aidtHmwCandidateSourceKey(candidate.id)]: JSON.stringify({
    orgId: candidate.source.orgId, projectId: candidate.source.projectId, sourceRevision: revision, definitionRevision: candidate.source.definitionRevision, cardIds: selectedCards, syntheticCardIds: candidate.source.syntheticCardIds,
    personaIds: selectedPersonas, threadId: candidate.threadId, messageId: candidate.messageId,
  }) };
  return Object.keys(fields).length <= 95 && Object.values(fields).every(value => value.length <= 6000) ? { ...next, fields } : draft;
}
