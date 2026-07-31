/**
 * `RemoveOrgMember`（F11 / O-29 ②）—— 编排。
 *
 * ⚠ **与 `UC-17.2` 的授权撤回结果相反，不得共用同一条代码路径**：这里是「停用访问」——
 * 会话吊销 + 未接受邀请作废 + 配额释放；那里是「删除数据」。本文件**不碰**
 * artifacts / provenance / credentials 中的任何一行，这就是「历史产出与署名保留」
 * 的实现：没有第二处需要保留的东西去保留，因为从没有第一处东西被删除或改写。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgMemberRepository } from "./org-member-ports";
import type { SessionTokenStore } from "./ports";

export interface RemoveOrgMemberDeps {
  readonly repo: OrgMemberRepository;
  readonly sessions: SessionTokenStore;
  readonly now?: () => Date;
}

export interface RemoveOrgMemberInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly userId: string;
}

export interface RemoveOrgMemberOutput {
  readonly revokedSessions: number;
  readonly revokedInvites: number;
  readonly quotaReleased: number;
  /**
   * ⚠ **恒为空数组** —— phase-01 里还没有任务系统（04-agent / project 束的任务模型
   * 尚未落地）。契约 `KNOWN_CONTRACT_GAPS.OA10` 已经记录这一点：空数组是「这次没有
   * 任何未完成任务可以列出」这一**真话**（因为任务这个概念本身还不存在），不是占位——
   * 同 `inviteOrgMember.quotaReserved`（F10）与 `revokeInviteLinks.onsiteSessions`（F15）
   * 的处置。等任务系统落地，这里要改成真查询，而不是被下一个人当作「本来就恒为空」。
   */
  readonly pendingTasks: readonly { readonly kind: string; readonly id: string; readonly label: string }[];
}

export async function removeOrgMember(
  deps: RemoveOrgMemberDeps,
  input: RemoveOrgMemberInput,
): Promise<RemoveOrgMemberOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  // 「不可自移」：usecases.md 的 `pre` 逐字要求 `userId ≠ actorId`。契约 `err` 里没有
  // 专属码——`removeOrgMember.err` 只有 `PROJECT_ROLE_INSUFFICIENT` / `VERSION_CHANGED` /
  // `AUTH_SERVICE_UNAVAILABLE` 三个——⇒ 复用 `PROJECT_ROLE_INSUFFICIENT`：这是「你无权
  // 对这个目标执行这个操作」最贴切的既有码，而不是发明一个契约里没有的码。已记入契约
  // `KNOWN_CONTRACT_GAPS.OA10`，需要专属码时那是人裁。
  if (input.userId === input.actorId) throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const now = (deps.now ?? (() => new Date()))();

  // 步骤一：DB 侧一个事务——删成员行（RETURNING 判断是否真删到）+ 作废其 pending 邀请。
  // 幂等重放：`removed = false` 时后面两步天然返回 0（并非"跳过"，是"没有新东西可做"）。
  const dbResult = await deps.repo.remove(input.orgId, input.userId);

  // 步骤二：会话吊销。这不是同一个 DB 事务的一部分——会话活在 Redis，见本文件头与
  // `org-member-ports.ts` 的同一条说明。`revokeAllForUser` 对已吊销的会话不重复计数，
  // 所以重复调用（幂等重放）天然返回 0，不需要在这里额外判断"要不要吊销"。
  const revokedSessions = await deps.sessions.revokeAllForUser(input.userId, now);

  return {
    revokedSessions,
    revokedInvites: dbResult.revokedInvites,
    // 释放的配额恒等于「这次是否真的删掉了一行成员」——配额账本是 COUNT-based
    // （见 `pg-org-invite-repository.ts` 的用尽判定），删一行成员天然释放恰好一个位置，
    // 不需要第二处账本去同步减一。
    quotaReleased: dbResult.removed ? 1 : 0,
    pendingTasks: [],
  };
}
