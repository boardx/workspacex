/**
 * `RevokeInviteLink` / `ResetAllInviteLinks`（F15 / UC-1.3）—— **一个用例两个语义**。
 *
 * `linkId` 省略（null）= `[重置全部]`。契约的 `in` 就是这个形状，逐字写着这句话。
 *
 * ## 这里**没有**的东西：`onsiteSessions` 与 `survivesUntilStageId` 的真值
 *
 * 契约的 `out` 有这两项，而且明说 `onsiteSessions` 是「契约的一部分」——
 * 二次确认弹层要显示「已在场的 N 人不会被踢出」。
 * **但 `LiveSession` 这张表属于 F16 / UC-1.2（免注册进场），phase-01 里还没有它。**
 *
 * ⇒ 这里返回 `onsiteSessions: 0` / `survivesUntilStageId: null`，并且**说出来**：
 *   那是「本次没有任何在场会话需要保留」这一**真话**（因为进场机制还不存在），
 *   不是「我们数过了，是 0」。等 F16 落地，这两项要改成真查询，
 *   而不是从一个空实现里被下一个人推断成「本来就恒为 0」。
 *   同 `inviteOrgMember.quotaReserved` 的处置。
 *
 * ⚠ 因此 I-12（撤销后 ≤5 秒新访问被拒）与 I-13/I-14（在场会话的存活窗口）
 *   **不在 F15 的可断言面内**——它们是 F16 独立成 feature 的理由（domain.md `[待定 G]`）。
 *   F15 能断言的是它自己的那一半：**撤销后旧链接的下一次使用即失败**，
 *   且**单条撤销只作废该条**（I-15）。两条都在 `invite-links-model.test.ts` 里。
 */
import type { OrgId } from "../../domain/org-id";
import { assertCanManageInviteLinks, type InviteLinkActor } from "./invite-link-authz";
import type { InviteLinkRepository } from "./invite-link-ports";

export interface RevokeInviteLinksDeps {
  readonly repo: InviteLinkRepository;
  readonly now?: () => Date;
}

export interface RevokeInviteLinksUseCaseInput extends InviteLinkActor {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** null = `[重置全部]`。 */
  readonly linkId: string | null;
}

export interface RevokeInviteLinksOutput {
  readonly revokedLinkIds: readonly string[];
  /** 见文件头：F16 之前恒为 0，且这是真话不是占位。 */
  readonly onsiteSessions: number;
  /** 见文件头：F16 之前恒为 null。 */
  readonly survivesUntilStageId: string | null;
}

export async function revokeInviteLinks(
  deps: RevokeInviteLinksDeps,
  input: RevokeInviteLinksUseCaseInput,
): Promise<RevokeInviteLinksOutput> {
  assertCanManageInviteLinks(input);

  const result = await deps.repo.revoke({
    orgId: input.orgId,
    projectId: input.projectId,
    linkId: input.linkId,
    now: (deps.now ?? (() => new Date()))(),
  });

  /**
   * ⚠ 「撤销一条不存在的 / 已经撤销过的链接」**不是错误**：契约写着
   * 「幂等重放：重复撤销同一条返回同一结果」。返回空数组即那个结果。
   * 抛 `INVITE_NOT_FOUND` 会让第二次点 [撤销] 弹一个红条，而第一次已经成功了。
   */
  return { revokedLinkIds: result.revokedLinkIds, onsiteSessions: 0, survivesUntilStageId: null };
}
