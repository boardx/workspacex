/**
 * `isAssetVisibleTo` -- F140 (`uc-23-6` R7 规则 7, domain I-12 / I-14; 与 `skills` I-14 同形)。
 *
 * ⚠ **四个入口（列表 / 搜索 / 绑定面板 / Context Pack）必须共用同一份判定**——四处各写一遍
 *   就是本仓第 N 次「同一事实多处声明」（`domain.md` I-12/I-14 逐字）。本文件钉住这唯一判定。
 *   与 `domain/skill/visibility-scope.ts` 结构同形（同一模式，不同字面量域），刻意不复用
 *   同一个函数体——`AssetVisibility` 是三值（含 `private-draft`），`SkillVisibilityScope`
 *   是两值，字面量域不同（`asset-governance.ts` `KNOWN_CONTRACT_GAPS.AG8`），同一函数体
 *   会在类型层面把两套语义悄悄合并成一套。
 *
 * ⚠ **降级不是删除**（R7 规则 7）：`private-draft` 的可见性收敛为 `{ownerId}`，不是清空整个
 *   记录。`writeAssetGovernanceVisibility`（F135/F139）已经把 `visibility` 与 `teamIds`
 *   写成这个收敛后的值；本文件只负责「给定这份已收敛的治理记录，某个请求者是否看得见」，
 *   不关心它是怎么收敛到这个值的（那是 F138/F139 的状态机）。
 */

export type AssetVisibilityScope = "specified-teams" | "whole-org" | "private-draft";

export interface AssetVisibilityCheckInput {
  readonly visibility: AssetVisibilityScope;
  readonly teamIds: readonly string[];
  readonly ownerId: string;
  readonly requesterId: string;
  /** ⚠ 单值团队归属口径（`identity.OrgMembershipRow.teamId`），不引入 `teamId[]` */
  readonly requesterTeamId: string | null;
}

/**
 * 唯一判定：`whole-org` 恒可见；`specified-teams` 需请求者团队命中 `teamIds`；
 * `private-draft`（含降级终态）仅 `ownerId` 本人可见。
 */
export function isAssetVisibleTo(input: AssetVisibilityCheckInput): boolean {
  if (input.visibility === "whole-org") return true;
  if (input.visibility === "private-draft") return input.requesterId === input.ownerId;
  // specified-teams
  if (input.requesterTeamId === null) return false;
  return input.teamIds.includes(input.requesterTeamId);
}

/**
 * 四入口共用的批量过滤场景对应的「入口」名——纯粹用于反证「四处结果逐字相同」，
 * 不代表这四个入口各自的完整实现都在本束落地（`getAssetOrphanStatus` 之外三处的
 * 后端路由不在本契约束范围内，见 `usecases.md`）。
 */
export type AssetVisibilityEntry = "list" | "search" | "binding-panel" | "context-pack";

export const ASSET_VISIBILITY_ENTRIES: readonly AssetVisibilityEntry[] = [
  "list",
  "search",
  "binding-panel",
  "context-pack",
];

/**
 * 列表/搜索/绑定面板/Context Pack 场景的批量过滤。**只调用上面那一个函数**，不重新判定。
 *
 * ⚠ I-12 后半句「四处 0 命中」——本函数直接从数组里去掉不可见项，调用方拿到的
 *   `length` 本身就是过滤后的真值，没有第二条路径能把被过滤项的存在性透出去。
 */
export function filterVisibleAssets<
  T extends { readonly visibility: AssetVisibilityScope; readonly teamIds: readonly string[]; readonly ownerId: string },
>(assets: readonly T[], requesterId: string, requesterTeamId: string | null): readonly T[] {
  return assets.filter((a) =>
    isAssetVisibleTo({
      visibility: a.visibility,
      teamIds: a.teamIds,
      ownerId: a.ownerId,
      requesterId,
      requesterTeamId,
    }),
  );
}

/**
 * 直读场景：范围外**不返回其存在性**（404 非 403，与 `skills` I-14 同形）。
 *
 * `record === null`（真的不存在）与「存在但对这个请求者不可见」在这里落到**同一个出口**——
 * 调用方拿到的都是 `null`，没有第二条路径能区分两者。
 */
export function readVisibleAsset<
  T extends { readonly visibility: AssetVisibilityScope; readonly teamIds: readonly string[]; readonly ownerId: string },
>(record: T | null, requesterId: string, requesterTeamId: string | null): T | null {
  if (record === null) return null;
  if (!isAssetVisibleTo({ visibility: record.visibility, teamIds: record.teamIds, ownerId: record.ownerId, requesterId, requesterTeamId })) {
    return null;
  }
  return record;
}
