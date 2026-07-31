/**
 * `RevokeInviteLink` / `ResetAllInviteLinks`（F15 + F16 / UC-1.3）—— **一个用例两个语义**。
 *
 * `linkId` 省略（null）= `[重置全部]`。契约的 `in` 就是这个形状，逐字写着这句话。
 *
 * ## `onsiteSessions` 与 `survivesUntilStageId` 的真值：F16 落地在这里
 *
 * F15 版本里这两项恒为 `0` / `null`，且**说明了原因**：`LiveSession` 那张表还不存在。
 * F16 把 `LiveSessionRepository`（迁移 `live_sessions`）接进来，两条语义分两个方法：
 *
 *   · **单条撤销**（`linkId` 非空）→ `markSurvivesUntilStage`（I-13）：
 *     该链接名下仍在场的会话被标记「保留至 `currentStageId` 结束」，**不立即踢出**。
 *   · **[重置全部]**（`linkId` 为 null）→ `markImmediateEnd`（I-14）：
 *     本项目全部在场会话**立即**结束——「紧急手段，不等环节结束」。
 *
 * `deps.liveSessions` 仍是**可选**的：不传时保持 F15 原有行为（恒 `0`/`null`），
 * 这样 F15 那份测试（`invite-links-model.test.ts`）不必被这次改动牵着改一次断言。
 *
 * ⚠ 「逐人移出」（usecases.md 的语义描述里与 `[重置全部]` 并列的第二种立即生效手段）
 *   **不在当前契约的操作面里**——`revokeInviteLink` 的 `in` 只有
 *   `{ projectId, linkId? }`，没有第三个「按参与者 id 移出」的入参或独立操作。
 *   这里按**已签核的契约形状**实现，不发明一个契约之外的第三分支；
 *   「逐人移出」的落点待契约补一个操作后再接，写在这里而不是让下一个人从缺口里猜。
 *
 * ⚠ I-12（撤销后 ≤5 秒新访问被拒）仍不落在这个文件——它是 `consume-invite-link.ts`
 *   核销路径的性质，理由见 `domain/auth/live-session.ts` 文件头。
 */
import type { OrgId } from "../../domain/org-id";
import { assertCanManageInviteLinks, type InviteLinkActor } from "./invite-link-authz";
import type { InviteLinkRepository } from "./invite-link-ports";
import type { LiveSessionRepository } from "./live-session-ports";

export interface RevokeInviteLinksDeps {
  readonly repo: InviteLinkRepository;
  /** F16。未传时保持 F15 原有行为：`onsiteSessions` 恒 0，`survivesUntilStageId` 恒 null。 */
  readonly liveSessions?: LiveSessionRepository;
  readonly now?: () => Date;
}

export interface RevokeInviteLinksUseCaseInput extends InviteLinkActor {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** null = `[重置全部]`。 */
  readonly linkId: string | null;
  /**
   * 撤销时刻的议程环节 id（I-13 的落点）。06-现场协作尚未接入时传 `null` 或省略——
   * 此时单条撤销仍会撤销令牌本身（I-15），只是没有「保留至哪个环节」这句话可言。
   */
  readonly currentStageId?: string | null;
}

export interface RevokeInviteLinksOutput {
  readonly revokedLinkIds: readonly string[];
  readonly onsiteSessions: number;
  readonly survivesUntilStageId: string | null;
}

export async function revokeInviteLinks(
  deps: RevokeInviteLinksDeps,
  input: RevokeInviteLinksUseCaseInput,
): Promise<RevokeInviteLinksOutput> {
  assertCanManageInviteLinks(input);

  const now = (deps.now ?? (() => new Date()))();
  const result = await deps.repo.revoke({
    orgId: input.orgId,
    projectId: input.projectId,
    linkId: input.linkId,
    now,
  });

  /**
   * ⚠ 「撤销一条不存在的 / 已经撤销过的链接」**不是错误**：契约写着
   * 「幂等重放：重复撤销同一条返回同一结果」。返回空数组即那个结果。
   * 抛 `INVITE_NOT_FOUND` 会让第二次点 [撤销] 弹一个红条，而第一次已经成功了。
   *
   * ⚠ 同一条理由延伸到在场会话：这次调用**没有真正撤销任何链接**（空数组）时，
   *   不再去标记/结束任何在场会话——否则重复点 [撤销] 会一次次把已经在保留期内的
   *   会话往后顺延 `currentStageId`，或把 [重置全部] 的幂等重放变成每次都重新
   *   结束一遍已经结束的会话（无害但会话表会被反复无意义写入）。
   */
  if (deps.liveSessions === undefined || result.revokedLinkIds.length === 0) {
    return { revokedLinkIds: result.revokedLinkIds, onsiteSessions: 0, survivesUntilStageId: null };
  }

  if (input.linkId === null) {
    const ended = await deps.liveSessions.markImmediateEnd({
      orgId: input.orgId,
      projectId: input.projectId,
      now,
    });
    return { revokedLinkIds: result.revokedLinkIds, onsiteSessions: ended.affected, survivesUntilStageId: null };
  }

  const survived = await deps.liveSessions.markSurvivesUntilStage({
    orgId: input.orgId,
    projectId: input.projectId,
    linkIds: result.revokedLinkIds,
    currentStageId: input.currentStageId ?? null,
    now,
  });
  return {
    revokedLinkIds: result.revokedLinkIds,
    onsiteSessions: survived.affected,
    survivesUntilStageId: survived.stageId,
  };
}
