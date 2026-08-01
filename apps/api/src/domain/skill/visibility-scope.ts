/**
 * Skill 可见性范围过滤（F62；`domain.md` I-14）。
 *
 * ⚠ **四个入口必须共用同一份过滤判定**——列表 / 搜索 / 蓝本绑定面板 / 对话加技能
 *   四处各写一遍就是本仓第 N 次「同一事实多处声明」。`SkillListEntry` 契约枚举
 *   钉住这四个入口的名字，本文件钉住它们共用的**唯一判定函数**。
 *
 * ⚠ 团队归属口径复用既有范式（`list-capabilities.ts` 的
 *   `requesterTeamId` ↔ `ownerTeamId` 单值比对），**不引入 `teamId[]`**——
 *   全仓团队归属一律是单个 `teamId: string | null`
 *   （`apps/api/src/application/identity/ports.ts` 的 `OrgMembershipRow`）。
 *
 * ⚠ 可见性范围是**独立字段**，与 MCP 授权范围、评审状态不合并（notes 逐字）：
 *   本文件只判 `visibility` 一个字段，不掺审核状态——一个 `已启用` 的
 *   `team-only` skill 对非成员依旧不可见，与「是否过审」无关。
 */

/** 两档可见性——与 `SkillListItem.visibility` 同值域（不重写枚举，运行期只接受这两个字符串）。 */
export type SkillVisibilityScope = "org-wide" | "team-only";

export interface VisibilityCheckInput {
  readonly visibility: SkillVisibilityScope;
  /** 该 skill 归属的团队。⚠ 仅 `team-only` 时有意义；`org-wide` 时可为 null 也不影响判定 */
  readonly ownerTeamId: string | null;
  /** 发起请求者当前所在团队。⚠ 单团队口径，取自 `OrgMembershipRow.teamId` */
  readonly requesterTeamId: string | null;
}

/**
 * 四入口共用的**唯一**可见性判定。
 *
 * · `org-wide` ⇒ 恒可见。
 * · `team-only` ⇒ 仅当 `requesterTeamId === ownerTeamId` 时可见——
 *   两者任一为 `null`（skill 未挂团队 / 请求者不在任何团队）都判**不可见**，
 *   而不是把 `null === null` 当作"都没有团队所以算同一个"：
 *   那会让一个配置错误（team-only 但没填 ownerTeamId）意外对所有无团队成员可见。
 */
export function isSkillVisibleTo(input: VisibilityCheckInput): boolean {
  if (input.visibility === "org-wide") return true;
  if (input.ownerTeamId === null || input.requesterTeamId === null) return false;
  return input.ownerTeamId === input.requesterTeamId;
}

/**
 * 列表/搜索场景的批量过滤。**只调用上面那一个函数**，不重新判定。
 *
 * ⚠ I-14 后半句：「接口不返回其存在性」——本函数直接从数组里去掉不可见项，
 *   而不是把它们标记为 `hidden: true` 一起返回；调用方拿到的 `items` 长度
 *   本身就是过滤后的真值，没有第二条路径能把被过滤项的存在性透出去。
 */
export function filterVisibleSkills<
  T extends { readonly visibility: SkillVisibilityScope; readonly ownerTeamId: string | null },
>(skills: readonly T[], requesterTeamId: string | null): readonly T[] {
  return skills.filter((s) =>
    isSkillVisibleTo({
      visibility: s.visibility,
      ownerTeamId: s.ownerTeamId,
      requesterTeamId,
    }),
  );
}
