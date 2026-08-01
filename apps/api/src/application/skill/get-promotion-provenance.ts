/**
 * 「来自组织大脑」区块的数据源（F67；契约 `getPromotionProvenance`，
 * UC-3.5 R8、R6 AC1）。
 *
 * ⚠ **双向可达**（I-22）：这里是 skill → 源知识/源决策 方向；
 *   反方向（源知识 → skill）见 `onSourceKnowledgeStateChanged` 用的
 *   `PromotionLinkStorePort.loadByKnowledgeItemId`——两者读的是**同一份** `PromotionLink`
 *   记录，不建两份互不关联的副本（domain.md `PromotionLink` 头注释逐字）。
 */
import type { PromotionLinkStorePort } from "./ports";

export interface GetPromotionProvenanceInput {
  readonly skillId: string;
}

export type GetPromotionProvenanceResult =
  | {
      readonly ok: true;
      readonly knowledgeItem: string;
      readonly signedDecision: string;
      readonly reviewConclusion: string;
      readonly applicableScope: string;
      readonly validUntil: string;
      readonly reviewOwner: string;
    }
  | { readonly ok: false; readonly code: "SKILL_NOT_FOUND" };

export async function getPromotionProvenance(
  input: GetPromotionProvenanceInput,
  deps: { readonly links: PromotionLinkStorePort },
): Promise<GetPromotionProvenanceResult> {
  const link = await deps.links.loadBySkillId(input.skillId);
  if (link === null) return { ok: false, code: "SKILL_NOT_FOUND" };

  return {
    ok: true,
    knowledgeItem: link.knowledgeItemId,
    signedDecision: link.signedDecisionId,
    reviewConclusion: link.reviewConclusionId,
    applicableScope: link.applicableScope,
    validUntil: link.validUntil,
    reviewOwner: link.reviewOwnerId,
  };
}
