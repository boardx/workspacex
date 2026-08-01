/**
 * `generateImprovementProposal` —— 契约变更提案生成（F68；UC-3.6 R3 阶段三步骤 5）。
 *
 * ⚠ 前置条件：聚合项的人工归类必须是 `contract-solvable`（V6/AC4）——
 *   `implementation-defect` / `model-limited` / 未归类都返回 `NOT_CONTRACT_SOLVABLE`，
 *   不产出任何 diff（不是「产出但标记不可用」，是**结构上不调用生成**）。
 *
 * ⚠ 产出落为 `vN+1`，且**直接进入 `待审核`**（同 F67 `PromotionSkillStorePort` 的
 *   "自动生成 ≠ 自动发布，跳过草稿" 纪律——本用例产出本身就是"已提交"的机器产出，
 *   仍需人工复核这一道门禁齐全才能生效）。`vN` 在整个过程中不被触碰、不改变状态。
 *   这是本 feature 的判断调用：`usecases.md` 字面写"落为 vN+1 · 草稿"，
 *   但草稿态需要额外一次人工"提交审核"动作，而该动作不在本 feature 的四条
 *   verification 范围内，故与 F67 同一先例合并为一步，减少一个未覆盖的中间态。
 */
import { canGenerateProposal } from "../../domain/skill/suggestion-aggregation";
import type { SuggestionCategory } from "../../domain/skill/suggestion-aggregation";
import { diffContract, isSchemaBreaking, type ProposalDiffEntry } from "../../domain/skill/improvement-proposal";
import type { DeclarativeContract } from "../../domain/skill/declarative-contract";
import { nextVersionNumber, contentHashOf, type SkillVersionSnapshot } from "../../domain/skill/version-chain";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { ImprovementProposalStorePort, SkillVersionStorePort } from "./ports";

export interface GenerateImprovementProposalInput {
  readonly proposalId: string;
  readonly skillId: string;
  readonly draftVersionId: string;
  readonly category: SuggestionCategory | null;
  readonly proposedContract: DeclarativeContract;
}

export type GenerateImprovementProposalResult =
  | {
      readonly ok: true;
      readonly proposalId: string;
      readonly baseVersionId: string;
      readonly draftVersionId: string;
      readonly diff: readonly ProposalDiffEntry[];
      readonly schemaBreaking: boolean;
      readonly machineGenerated: true;
    }
  | { readonly ok: false; readonly code: SkillErrorCode };

export async function generateImprovementProposal(
  input: GenerateImprovementProposalInput,
  deps: { readonly versions: SkillVersionStorePort; readonly proposals: ImprovementProposalStorePort },
): Promise<GenerateImprovementProposalResult> {
  if (!canGenerateProposal(input.category)) {
    return { ok: false, code: "NOT_CONTRACT_SOLVABLE" };
  }

  const history = await deps.versions.loadChain(input.skillId);
  const base = history.find((v) => v.state === "已生效");
  if (base === undefined) {
    return { ok: false, code: "SKILL_NOT_ENABLED" };
  }

  const diff = diffContract(base.content, input.proposedContract);
  const schemaBreaking = isSchemaBreaking(base.content, input.proposedContract);

  const draft: SkillVersionSnapshot = Object.freeze({
    versionId: input.draftVersionId,
    skillId: input.skillId,
    versionNumber: nextVersionNumber(history),
    content: input.proposedContract,
    contentHash: contentHashOf(input.proposedContract),
    // ⚠ 直接进 `待审核`，见文件头注释：机器产出的提案已经是"已提交"状态。
    state: "待审核",
  });

  await deps.versions.saveChain(input.skillId, [...history, draft]);
  await deps.proposals.save({
    proposalId: input.proposalId,
    skillId: input.skillId,
    baseVersionId: base.versionId,
    draftVersionId: input.draftVersionId,
    schemaBreaking,
    machineGenerated: true,
    humanEdits: 0,
  });

  return {
    ok: true,
    proposalId: input.proposalId,
    baseVersionId: base.versionId,
    draftVersionId: input.draftVersionId,
    diff,
    schemaBreaking,
    machineGenerated: true,
  };
}
