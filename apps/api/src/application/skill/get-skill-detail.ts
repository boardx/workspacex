/**
 * `getSkillDetail` 的可见性折叠面（F62；`domain.md` I-14）。
 *
 * ⚠ 「不存在」与「存在但可见性范围外」**折成同一个出口** `SKILL_NOT_FOUND`——
 *   与 `mount-skill-to-thread.ts` / `upsert-segment-binding.ts` 对
 *   `SkillVisibilityPort`（F63 可绑定池）的既有折法同一个纪律，只是这里判的
 *   字段是 `visibility`/`ownerTeamId`，不是「是否已启用可绑定」。
 *   两个判据分属两个端口是故意的（`ports.ts` 的 `SkillVisibilityScopePort` 注释）——
 *   不因为都叫「可见性」就合成一个端口，那会让「审核状态」与「可见性范围」
 *   两个独立字段重新粘在一起。
 */
import { isSkillVisibleTo } from "../../domain/skill/visibility-scope";
import type { SkillVisibilityScopePort } from "./ports";

export interface CheckSkillVisibleInput {
  readonly skillId: string;
  /** 发起请求者当前所在团队。单团队口径，同 `visibility-scope.ts` */
  readonly requesterTeamId: string | null;
}

export type CheckSkillVisibleResult =
  | { readonly visible: true }
  /** ⚠ 调用方拿到这个分支后**只能**返回 `SKILL_NOT_FOUND`——不得区分「不存在」与「范围外」 */
  | { readonly visible: false; readonly code: "SKILL_NOT_FOUND" };

/**
 * `getSkillDetail` / 四入口以外任何按 id 直取单个 skill 的路径都先过这一关。
 *
 * ⚠ 本函数不返回 skill 本体——它只回答「能不能看」，取数是调用方的另一步。
 *   这样「判定」与「取数」分离，判定失败时调用方**结构上**无法先把数据取出来
 *   再决定要不要吐给前端（那种写法一旦漏判就是一次存在性泄露）。
 */
export async function checkSkillVisible(
  input: CheckSkillVisibleInput,
  deps: { readonly scope: SkillVisibilityScopePort },
): Promise<CheckSkillVisibleResult> {
  const scope = await deps.scope.scopeOf(input.skillId);
  if (scope === null) {
    return { visible: false, code: "SKILL_NOT_FOUND" };
  }

  const visible = isSkillVisibleTo({
    visibility: scope.visibility,
    ownerTeamId: scope.ownerTeamId,
    requesterTeamId: input.requesterTeamId,
  });

  if (!visible) {
    return { visible: false, code: "SKILL_NOT_FOUND" };
  }

  return { visible: true };
}
