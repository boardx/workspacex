/**
 * `listSkills` —— 四入口（library / search / binding-panel / chat-mount）共用的
 * 可见性过滤用例（F62；`domain.md` I-14，契约 `SkillListEntry`）。
 *
 * ⚠ 契约把四个入口建成**同一个操作**的一个 `entry` 参数，而不是四个操作——
 *   这就是 I-14「四个入口必须共用同一份过滤判定」在契约形状上的落点。
 *   本文件**不因 `entry` 分支过滤逻辑**：`entry` 只是调用方标识（供审计/埋点用），
 *   过滤永远只调用 `domain/skill/visibility-scope.ts` 的同一个函数。
 *   四处各写一份判定正是本仓第 N 次「同一事实声明在多处」的既定形状（AGENTS.md 反复提醒）。
 *
 * ⚠ 空结果返回 `[]`（真实空态），**不生成示例 skill**（A1/V10）——本函数天然满足：
 *   过滤只会减少条目，永远不会在空输入上凭空造出条目。
 */
import { filterVisibleSkills, type SkillVisibilityScope } from "../../domain/skill/visibility-scope";

/** 契约 `SkillListEntry` 的四个取值——与 `packages/contracts/src/skills.ts` 同值域 */
export type SkillListEntryName = "library" | "search" | "binding-panel" | "chat-mount";

export interface SkillCatalogEntry {
  readonly skillId: string;
  readonly visibility: SkillVisibilityScope;
  /** 仅 `visibility = team-only` 时有意义 */
  readonly ownerTeamId: string | null;
}

export interface ListSkillsInput {
  readonly orgId: string;
  /** 四入口之一。⚠ 刻意不参与过滤判定——见文件头注释 */
  readonly entry: SkillListEntryName;
  /** 发起请求者当前所在团队。单团队口径，同 `visibility-scope.ts` */
  readonly requesterTeamId: string | null;
}

export interface SkillCatalogPort {
  /** ⚠ 只读整份目录，不做团队过滤——过滤统一在本用例里做,基础设施层不得重复判定 */
  listAll(orgId: string): Promise<readonly SkillCatalogEntry[]>;
}

export interface ListSkillsResult {
  readonly items: readonly SkillCatalogEntry[];
  readonly total: number;
}

export async function listSkills(
  input: ListSkillsInput,
  deps: { readonly catalog: SkillCatalogPort },
): Promise<ListSkillsResult> {
  const all = await deps.catalog.listAll(input.orgId);
  const items = filterVisibleSkills(all, input.requesterTeamId);
  return { items, total: items.length };
}
