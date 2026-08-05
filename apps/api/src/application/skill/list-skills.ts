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
import type { SkillVisibilityScope } from "../../domain/skill/visibility-scope";
import { decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import { discloseDecided, isDisclosed, type Withheld } from "../security/permission-filter";
import type { OrgRole } from "../../domain/identity/roles";
import type { GuardedSkillContract, SkillContractRow } from "./ports";

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
  /**
   * 发起请求者在本组织的角色。`null` = 不是成员。
   *
   * ⚠ #459 新增：改判之前本用例只判「范围」，判不了「是不是成员」，于是一个
   *   已被移出组织的人只要还持有会话就能列出全部 `org-wide` skill。
   *   `decide()` 的 `orgPassed` 补上了这一层。
   */
  readonly orgRole: OrgRole | null;
}

export interface SkillCatalogPort {
  /** ⚠ 只读整份目录，不做团队过滤——过滤统一在本用例里做,基础设施层不得重复判定 */
  listAll(orgId: string): Promise<readonly GuardedSkillContract[]>;
}

export interface ListSkillsResult {
  readonly items: readonly SkillContractRow[];
  /**
   * 被判定挡下的条目。
   *
   * ⚠ **不进契约的 `listSkills.out`**（那里只有 `items`），所以它不过线；
   *   留在返回值里是因为「这个组织没有」与「有但你看不到」必须在系统内部
   *   可分辨（同 `list-capabilities.ts` 对 V10 的处理）。只返回幸存者的话，
   *   这个区分在每一个观察点上都消失了。
   */
  readonly withheld: readonly Withheld[];
  readonly total: number;
}

/** `decisionId` 由调用方提供，本用例因此保持纯函数可测（同 `decide()` 的理由）。 */
export interface ListSkillsDeps {
  readonly catalog: SkillCatalogPort;
  readonly nextDecisionId: () => string;
}

/**
 * ⚠ #459 起，过滤**不再**是 `filterVisibleSkills` 那个 boolean 谓词，而是
 *   `decideCapabilityVisibility` + `discloseDecided`：载荷在判定之前取不出来，
 *   「忘了判定」是类型错误而不是疏漏。I-14「四入口共用一个过滤判定」仍然成立，
 *   而且那一个现在是**带机械门控**（`lint-permission-paths`）的那一个。
 */
export async function listSkills(
  input: ListSkillsInput,
  deps: ListSkillsDeps,
): Promise<ListSkillsResult> {
  const all = await deps.catalog.listAll(input.orgId);

  const items: SkillContractRow[] = [];
  const withheld: Withheld[] = [];

  for (const entry of all) {
    const decision = decideCapabilityVisibility({
      decisionId: deps.nextDecisionId(),
      orgRole: input.orgRole,
      requesterTeamId: input.requesterTeamId,
      scope: entry.facts.scope,
      ownerTeamId: entry.facts.ownerTeamId,
    });
    const disclosed = discloseDecided(entry.row, decision);
    if (isDisclosed(disclosed)) items.push(disclosed.payload);
    else withheld.push(disclosed);
  }

  // 空结果就是 `[]`（A1/V10），本函数天然满足：过滤只会减少条目。
  return { items, withheld, total: items.length };
}
