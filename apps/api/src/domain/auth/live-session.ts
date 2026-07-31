/**
 * `LiveSession`（F16 / UC-1.3 R7）—— 现场会话，撤销语义的锚点。最内层，纯函数。
 *
 * ## 这份文件回答的三个不变量：I-12 / I-13 / I-14
 *
 * · I-12「撤销后 ≤5 秒，新访问被拒」—— **不在这个文件里**。核销路径
 *   （`consume-invite-link.ts` → `invite_links.revoked_at`）与撤销写的是**同一份记录、
 *   同一次事务**，单一数据源没有「传播延迟」这件事：下一次核销请求读到的必然是
 *   撤销后的状态，恒成立、不需要等 5 秒。5 秒是契约给外部缓存/只读副本场景预留的
 *   SLA 上限（domain.md `[待定 G]`），不是本实现要新造一列去满足的宽限期。
 *   `revoke-5s-new-access-denied.test.ts` 断言的正是「立即失效 ⊂ 5 秒内失效」。
 *
 * · I-13「撤销时刻已存在的 LiveSession，在其 survivesUntilStageId 结束之前写操作仍成功；
 *   该环节结束后同一会话的下一次请求即失败」—— 单条撤销的语义，`liveSessionWriteVerdict`
 *   的第二个分支。
 *
 * · I-14「[重置全部] 与逐人移出立即生效，不等环节结束」—— `survivesUntilStageId === null`
 *   且 `revokedAt !== null` 这个组合**恰好**表达它：没有保留环节可言。
 *
 * ## 「当前环节是哪一个」——本文件不回答，也不应该回答
 *
 * 议程环节状态机属 06-现场协作，这个阶段还不存在（design-signoff.md 逐字：
 * 「两条核心不变量的锚点在别的模块里……那个锚点现在既不在本束、也还不存在」）。
 * 与 `expireTemporaryAccess`（F05，同型问题）一样：本束是 `StageEventSource` 的
 * **消费者不是定义者**——`liveSessionWriteVerdict` 只拿调用方传入的 `currentStageId`
 * 做一次字符串比较，不查询、不缓存、不解释它是怎么来的。等 06 束落地，
 * 上游多接一根线，这个函数不用改一个字符。
 */
import { randomBytes } from "node:crypto";
import type { PermissionDecision } from "../identity/permission-decision";

export function newLiveSessionId(): string {
  return `ls-${randomBytes(12).toString("hex")}`;
}

export interface LiveSessionState {
  readonly revokedAt: Date | null;
  /**
   * `null` 在这里有**两种**读法，由 `revokedAt` 消歧：
   *   · `revokedAt === null` ⇒ 未撤销，这一列此时无意义
   *   · `revokedAt !== null` ⇒ 撤销来自 [重置全部] / 逐人移出，**立即生效**（I-14）
   */
  readonly survivesUntilStageId: string | null;
  readonly endedAt: Date | null;
}

export type LiveSessionWriteDenialReason =
  /** 会话已经结束（立即生效撤销，或环节早已推进过去后被显式关闭）。 */
  | "session-ended"
  /** 单条撤销的保留窗口已经过去：请求携带的环节不再是撤销时那一个。 */
  | "stage-advanced-past-survival";

export type LiveSessionWriteVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: LiveSessionWriteDenialReason };

/**
 * 该会话现在能不能继续写操作 —— I-12 ~ I-14 的**唯一判定点**。
 *
 * ⚠ 顺序不能换：先看 `endedAt`（立即生效撤销落库时两列一起写，见迁移
 *   `live_sessions_revoke_shape` 约束），再看 `revokedAt`，最后才比较环节 id。
 *   颠倒顺序不会改变结论，但会让「为什么被拒」这句解释指向错误的分支。
 */
export function liveSessionWriteVerdict(
  state: LiveSessionState,
  currentStageId: string | null,
): LiveSessionWriteVerdict {
  if (state.endedAt !== null) return { allowed: false, reason: "session-ended" };
  if (state.revokedAt === null) return { allowed: true };
  if (state.survivesUntilStageId === null) {
    // I-14：没有保留环节可言，撤销即刻生效。
    return { allowed: false, reason: "session-ended" };
  }
  // I-13：仍是撤销时刻那一个环节 ⇒ 仍允许；环节已经推进 ⇒ 拒绝。
  if (currentStageId === state.survivesUntilStageId) return { allowed: true };
  return { allowed: false, reason: "stage-advanced-past-survival" };
}

/**
 * 「签到板」的到场状态 —— 一条名单条目有没有一个**仍在场**的 `LiveSession`。
 *
 * ⚠ 只看 `endedAt`，不看 `revokedAt`：I-13 的整个意义就是「撤销之后、环节结束之前，
 *   这个人在签到板上仍然是 present」——用 `revokedAt !== null` 当「已离场」的判据，
 *   会让单条撤销在签到板上立即显示成「已离场」，与它自己的保留语义自相矛盾。
 */
export function attendanceOf(session: { readonly endedAt: Date | null } | undefined): "present" | "absent" {
  return session !== undefined && session.endedAt === null ? "present" : "absent";
}

/**
 * 谁能读「分组与签到」看板 —— **与 `canManageInviteLinks` 不同**。
 *
 * usecases.md `GetCheckinBoard.pre` 逐字：「引导师看全部、组长只见本组、观察者只见脱敏聚合」——
 * 三种角色都能读，这条界限只挡「不在这个项目里的人」。签发/撤销链接才是引导师独占。
 */
export function canViewCheckinBoard(projectRole: string | null): boolean {
  return projectRole !== null;
}

/**
 * 「分组与签到」看板的判定 —— `authorize` 表达不了它，理由与
 * `decideInviteLinkManagement` 同型：签到板没有 `acl_bindings` 行。
 *
 * ⚠ 与 `decideInviteLinkManagement` 的**唯一**差别就是 `canViewCheckinBoard`
 *   而不是 `canManageInviteLinks`——本函数只挡「不在这个项目里」，不挡角色。
 *   组长只见本组、观察者只见脱敏聚合，是 `get-checkin-board.ts` 按
 *   `input.actorProjectRole` / `input.actorGroupId` 做的**投影**，不是这里的拒绝面。
 */
export function decideCheckinBoardAccess(input: {
  readonly decisionId: string;
  readonly orgRole: string | null;
  readonly teamId: string | null;
  readonly projectRole: string | null;
  readonly groupId: string | null;
}): PermissionDecision {
  const orgPassed = input.orgRole !== null;
  const projectPassed = canViewCheckinBoard(input.projectRole);
  const allowed = orgPassed && projectPassed;
  return {
    allowed,
    orgLayer: {
      role: input.orgRole as PermissionDecision["orgLayer"]["role"],
      teamId: input.teamId,
      passed: orgPassed,
    },
    projectLayer: {
      role: input.projectRole as NonNullable<PermissionDecision["projectLayer"]>["role"],
      groupId: input.groupId,
      passed: projectPassed,
    },
    scopeLayer: { scope: "org-wide" as const, passed: allowed },
    reasonCode: allowed
      ? null
      : !orgPassed
        ? "NO_ORG_MEMBERSHIP"
        : "NO_PROJECT_ROLE",
    decisionId: input.decisionId,
  };
}
