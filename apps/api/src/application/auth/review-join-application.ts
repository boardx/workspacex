/**
 * `ReviewJoinApplication`（F13 / UC-1.2 R4）—— 引导师批准或拒绝一条待批申请。
 *
 * 批准语义：把该手机号写入名单并指定组号，参与者刷新即进场（usecases.md 逐字）。
 * ⚠ 「写名单 + 标记单据 approved」在仓储的同一事务内完成（部分成功禁止，同 F12）。
 * ⚠ 复用 `invite-link-authz.ts` 的「只有本项目的引导师能管」这一句，不新写第二份判据
 *   ——本文件与 F15 的四个写用例共享同一条 `pre`。
 */
import { newParticipantId } from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import { assertCanManageInviteLinks, type InviteLinkActor } from "./invite-link-authz";
import type { JoinApplicationRepository } from "./join-application-ports";

export interface ReviewJoinApplicationDeps {
  readonly repo: JoinApplicationRepository;
  readonly newParticipantId?: () => string;
  readonly now?: () => Date;
}

export interface ReviewJoinApplicationUseCaseInput extends InviteLinkActor {
  readonly orgId: OrgId;
  readonly applicationId: string;
  readonly decision: "approve" | "reject";
  /** `decision = "approve"` 时必填。 */
  readonly groupId: string | null;
}

export interface ReviewJoinApplicationOutput {
  readonly applicationId: string;
  readonly status: "approved" | "rejected";
}

export async function reviewJoinApplication(
  deps: ReviewJoinApplicationDeps,
  input: ReviewJoinApplicationUseCaseInput,
): Promise<ReviewJoinApplicationOutput> {
  assertCanManageInviteLinks(input);

  if (input.decision === "approve" && (input.groupId === null || input.groupId === "")) {
    // 契约允许 groupId: null，但批准动作本身要求指定组号——同一约束已在迁移里
    // 用 CHECK (status <> 'approved' OR group_id IS NOT NULL) 兜底；这里提前判掉，
    // 避免把一个必然违反 CHECK 的写请求送到数据库才发现。
    throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");
  }

  const result = await deps.repo.review({
    orgId: input.orgId,
    applicationId: input.applicationId,
    actorId: input.actorId,
    decision: input.decision,
    groupId: input.decision === "approve" ? input.groupId : null,
    candidateParticipantId: (deps.newParticipantId ?? newParticipantId)(),
    now: (deps.now ?? (() => new Date()))(),
  });

  if (!result.ok) {
    // 「已被处理过」与「并发的另一位引导师抢先处理了」都映射到同一个契约码（VERSION_CHANGED），
    // 因为对当前调用者而言两者是同一件事：你这次操作没有生效，请刷新看最新状态。
    if (result.reason === "not-found") throw new OrgAdminError("AUTH_SERVICE_UNAVAILABLE");
    throw new OrgAdminError("VERSION_CHANGED");
  }

  return { applicationId: result.grant.applicationId, status: result.grant.status };
}
