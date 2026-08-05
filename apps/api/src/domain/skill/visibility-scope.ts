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

import { decideCapabilityVisibility } from "../identity/capability-listing";

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
 * 本函数**不判断组织成员资格**，所以它给 `decide()` 的 org 层传 `null`。
 *
 * ⚠ 这不是「偷懒填个占位」：`decide()` 里 `scopePassed` 的计算**不依赖 `org.role`**
 *   （见 `permission-decision.ts` 的 `decide`——`scopeLayer.passed` 只由 `scope` 与
 *   `teamId` 决定）。而本函数读的正是 `scopeLayer.passed`。填一个假的 `"admin"`
 *   会在语义上撒谎（声称判过成员资格），填 `null` 则如实表达「这一问不归我答」，
 *   且对返回值没有任何影响。
 *
 * 成员资格由**另一条路**判：仓储按 `guard()` 出门、controller 用
 * `decideCapabilityVisibility(...).allowed` 经 `discloseDecided()` 放行，那里
 * `orgRole` 是从 `org_memberships` 真实读出来的。
 */
const ORG_MEMBERSHIP_NOT_JUDGED_HERE = null;

/**
 * 供 `decide()` 记录用的 decision id。
 *
 * ⚠ 本函数是**纯谓词**，它的返回值是 boolean，`decisionId` 不进任何响应，
 *   所以这里用一个固定字符串而不是随机 id——随机 id 看起来像能关联到某次审计，
 *   实际上关联不到任何东西（同 `skill-gate-adapters.ts` 里 traceId 那条哨兵的理由）。
 *   需要可关联的决策时走的是 `discloseDecided()` 那条路，那里的 id 是真的。
 */
const SKILL_SCOPE_PREDICATE_DECISION_ID = "skill-visibility-scope-predicate";

/**
 * 四入口共用的**唯一**可见性判定。
 *
 * ## ⚠ 实现已于 2026-08-05（#459）改为**委托**，函数体内不再自己比字段
 *
 * 改之前这里有三行比较（`org-wide` 恒真；`team-only` 比 `ownerTeamId` 与
 * `requesterTeamId`），而 `domain/identity/capability-listing.ts` 的
 * `decideCapabilityVisibility` 判的是**同样三个字段**。两份实现＝同一事实两处声明，
 * 正是 AGENTS.md 点名、本仓已漂移五次的形状。
 *
 * coord-main 裁决 `decideCapabilityVisibility` 为单一事实源，三条理由：
 *   ① **信息量单向可导**——`PermissionDecision` 能导出 boolean，boolean 导不回
 *      `PermissionDecision`（丢了「为什么」）。单一事实源要选信息量大的那个。
 *   ② **A 有机械门控（`lint-permission-paths`），B 没有**。选无门的当事实源
 *      等于让有门的去迁就无门的——拿门换方便。
 *   ③ 收敛后 I-14「四入口共用一个过滤器」仍成立，且那一个恰好是**带门的**。
 *
 * ⚠ 读的是 `scopeLayer.passed` 而**不是** `allowed`：`allowed` 还要求组织成员资格
 *   （`org.role !== null`），而本函数的签名里根本没有 `orgRole`，判不了那一层。
 *   用 `allowed` 会让每一次调用都因为 `NO_ORG_MEMBERSHIP` 返回 false，把整个
 *   列表判空——那是一次"看起来收敛了、其实换了语义"的改动。
 *
 * 语义与改之前**逐点等价**（`visibility-scope-delegates.test.ts` 用穷举断言）：
 *   · `org-wide` ⇒ `scopePassed` 恒真；
 *   · `team-only` ⇒ `teamId !== null && teamId === ownerTeamId`，
 *     两者任一为 null 都判不可见（不把 `null === null` 当同一个团队——
 *     那会让一个配置错误意外对所有无团队成员可见）。
 */
export function isSkillVisibleTo(input: VisibilityCheckInput): boolean {
  return decideCapabilityVisibility({
    decisionId: SKILL_SCOPE_PREDICATE_DECISION_ID,
    orgRole: ORG_MEMBERSHIP_NOT_JUDGED_HERE,
    requesterTeamId: input.requesterTeamId,
    scope: input.visibility,
    ownerTeamId: input.ownerTeamId,
  }).scopeLayer.passed;
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
