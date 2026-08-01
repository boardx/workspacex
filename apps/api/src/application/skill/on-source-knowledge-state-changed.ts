/**
 * 源知识状态变化 → skill 侧联动（F67；契约 `onSourceKnowledgeStateChanged`，
 * UC-3.5 E5/E6/E7、R6 AC3、V8/V9）。
 *
 * 三个效果**结构上互斥**（`effectForSourceKnowledgeState` 是一个纯函数，
 * 不是三个调用方各写各的 if）：
 *   · `待复核` → `annotate`（标「源方法已过期」，**不自动停用**——D-j 待人类裁决，
 *     本文按 `usecases.md`「标注不停用」落地）
 *   · `被推翻` / `被撤销` → `disable`（自动转已停用，**不硬删**，进行中项目不受影响——
 *     停用只改 `Skill.status`，不碰任何绑定/挂载记录，同 `restore-skill.ts` 的结构性理由）
 *   · `被替代` → `new-version`（发新版、旧版归档）
 *
 * ⚠ **判断调用（本实现的一处保守选择，供复核）**：`被替代` 产生的新版本落在
 *   `草稿`，**不直接置为生效**。`usecases.md` 只写「发新版、旧版归档」，没有明写
 *   这条自动路径是否豁免双重门禁；本文件选择**不豁免**——I-23「自动生成的版本
 *   初始状态绝不为已启用/生效」没有为「触发源本身是一次人类裁决」开一个例外，
 *   放宽这条闸门属于本 feature 范围之外的裁决，因此按更保守的一侧落地：
 *   旧版本仍归档（domain.md I-6 的既有语义），新版本需要走正常发布流程才能生效。
 */
import { effectForSourceKnowledgeState } from "../../domain/skill/promotion-link";
import { createDraftVersion } from "../../domain/skill/version-chain";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { KnowledgeChangeEffect, SourceKnowledgeState } from "../../domain/skill/promotion-link";
import type {
  PromotionLinkStorePort,
  SkillVersionStorePort,
  SourceKnowledgeLinkageStorePort,
} from "./ports";

export interface OnSourceKnowledgeStateChangedInput {
  readonly knowledgeItemId: string;
  readonly newState: SourceKnowledgeState;
  readonly replacedByKnowledgeId: string | null;
}

export type OnSourceKnowledgeStateChangedResult =
  | {
      readonly ok: true;
      readonly effect: KnowledgeChangeEffect;
      readonly skillId: string;
      readonly versionId: string | null;
    }
  | { readonly ok: false; readonly code: SkillErrorCode };

export async function onSourceKnowledgeStateChanged(
  input: OnSourceKnowledgeStateChangedInput,
  deps: {
    readonly links: PromotionLinkStorePort;
    readonly linkage: SourceKnowledgeLinkageStorePort;
    readonly versions: SkillVersionStorePort;
  },
): Promise<OnSourceKnowledgeStateChangedResult> {
  const link = await deps.links.loadByKnowledgeItemId(input.knowledgeItemId);
  if (link === null) return { ok: false, code: "SKILL_NOT_FOUND" };

  const effect = effectForSourceKnowledgeState(input.newState);

  try {
    if (effect === "annotate") {
      await deps.linkage.annotateExpired(link.skillId);
      return { ok: true, effect, skillId: link.skillId, versionId: null };
    }

    if (effect === "disable") {
      await deps.linkage.disable(link.skillId);
      return { ok: true, effect, skillId: link.skillId, versionId: null };
    }

    // effect === "new-version"（被替代）
    const current = await deps.linkage.currentEffectiveContract(link.skillId);
    if (current === null) {
      // 结构上不应发生（一个被联动到的 skill 应当有生效版本）；不臆造内容，明确失败。
      return { ok: false, code: "DEPENDENCY_UNAVAILABLE" };
    }

    const history = await deps.versions.loadChain(link.skillId);
    const draft = createDraftVersion(history, {
      versionId: `${link.skillId}-replacement-${history.length + 1}`,
      skillId: link.skillId,
      content: current.content,
    });
    await deps.versions.saveChain(link.skillId, [...history, draft]);

    // 源知识指针随替代前移，但只在「被替代」这一种效果下移动——
    // `被推翻`/`被撤销`的知识「转为反例资产，不删除」，PromotionLink 仍指回它，供审计回溯。
    if (input.replacedByKnowledgeId !== null) {
      await deps.links.save({ ...link, knowledgeItemId: input.replacedByKnowledgeId });
    }

    return { ok: true, effect, skillId: link.skillId, versionId: draft.versionId };
  } catch {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE" };
  }
}
