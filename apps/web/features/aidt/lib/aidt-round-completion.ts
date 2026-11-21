import { readAidtDefinition, readAidtDefinitionEvidenceRevision, readAidtDefinitionSelection } from "./aidt-definition";
import type { AidtUiStageDraft, AidtDiscoveryCardDraft, AidtIdeaDraft } from "./aidt-ui-drafts";
import { isProblemReflectionConfirmed } from "./aidt-problem-reflection";
import { parseAidtSurpriseReflection } from "./aidt-surprise-reflection";
import { readAidtIdeaClassification } from "./aidt-idea-classification";
import { aidtIdeaReadiness, aidtCompleteIdeas } from "./aidt-idea-readiness";
import { isAidtReflectionConfirmed, isVerificationQuestionConfirmed } from "./aidt-verification-loop";
import { parseAidtResearchMaterial, researchMaterialKey, isAidtResearchImage } from "./aidt-research-material-reference";
import { readAidtPrototypeReference } from "./aidt-prototype-reference";

export type RoundSource = { stageId: number; revision: number };
export const AIDT_ROUND_COMPLETION_FIELD = "roundCompletion";
/** Student review in the existing working document; never a permission or teacher-grade authority. */
export function aidtRoundMissingOutput(stageId: number, draft: AidtUiStageDraft, context?: { projectId: string; cards?: readonly AidtDiscoveryCardDraft[]; cardsRevision?: number }): string | null {
  const has = (...keys: string[]) => keys.every(key => Boolean(draft.fields[key]?.trim()));
  if (stageId === 1 && (!has("rewrittenTheme") || !isProblemReflectionConfirmed(draft))) return "先核对重写主题与选题反思。";
  if (stageId === 2 && (!has("adoptedGuide") || !draft.discoveryCards?.length || draft.discoveryCards.some(card => !card.participantCode.trim() || !card.headline.trim() || !card.context.trim() || !card.sourceRef.trim()))) return "先核对采纳后的访谈清单与带来源的人物发现卡。";
  if (stageId === 3) {
    const definition = readAidtDefinition(draft.fields);
    const hasStructuredDraft = definition.personas.length || definition.hmws.length || definition.invalid;
    const selectedHmw = hasStructuredDraft ? readAidtDefinitionSelection(draft.fields) : has("hmw") && ["personaAge", "personaInterests", "personaLifestyle", "personaBehavior"].some(key => draft.fields[key]?.trim());
    const surprise = parseAidtSurpriseReflection(draft, context?.cards, context?.cardsRevision);
    const pinned = readAidtDefinitionEvidenceRevision(draft.fields);
    const confirmedHistoricalSource = hasStructuredDraft && pinned && pinned !== context?.cardsRevision && surprise.sourceRevision === pinned
      && surprise.requiresCardRevision && !surprise.invalidCardIds && draft.fields.surpriseConfirmed === "true"
      && Boolean(surprise.priorBelief.trim() && surprise.surprisingFinding.trim());
    if (!selectedHmw || (!surprise.confirmed && !confirmedHistoricalSource)) return "先核对意外发现或暂无、画像与选定HMW。";
  }
  if (stageId === 4) {
    const hasOriginalImage = (idea: AidtIdeaDraft) => { const material = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", idea.id)]); return Boolean(material && material.projectId === context?.projectId && isAidtResearchImage(material)); };
    const readiness = aidtIdeaReadiness(draft.ideas, hasOriginalImage);
    if (readiness.distinctNames < 3 || !readiness.identifiersValid) return "先完善至少三个不同点子的图文。";
    if (!aidtCompleteIdeas(draft.ideas, hasOriginalImage).some(idea => idea.id === draft.selectedIdeaId)) return "请从完整描述单中选择本轮进入原型的点子。";
    if (!readAidtIdeaClassification(draft).confirmed) return "先核对并确认本组点子分类。";
  }
  if (stageId === 5 && (!isVerificationQuestionConfirmed(draft) || !has("beforeTestBelief", "verificationBasis", "verificationLimits") || (!has("version") && !readAidtPrototypeReference(draft)))) return "先核对验证问题、先前看法与原型版本。";
  if (stageId === 6 && !isAidtReflectionConfirmed(draft)) return "先核对本轮认识变化与下一轮行动。";
  return null;
}

export function aidtRoundPayload(projectId: string, stageId: number, draft: AidtUiStageDraft, sources: readonly RoundSource[]): string {
  const fields = Object.fromEntries(Object.entries(draft.fields).filter(([key]) => key !== AIDT_ROUND_COMPLETION_FIELD));
  return JSON.stringify({ projectId, stageId, draft: { ...draft, fields }, sources: [...sources].sort((a, b) => a.stageId - b.stageId) }, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
export async function aidtRoundDigest(payload: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function aidtRoundConfirmation(projectId: string, stageId: number, digest: string, filesReviewed = false): string {
  return JSON.stringify({ schemaVersion: 1, projectId, stageId, digest, ...(filesReviewed ? { filesReviewed: true } : {}) });
}
