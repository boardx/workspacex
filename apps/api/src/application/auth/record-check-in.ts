/**
 * 到场回写（F16 / UC-1.3 R8）—— 参与者进场后，「分组与签到」板上该人由未到变已到。
 *
 * ## 为什么这是一个独立用例，而不是 `consumeInviteLink` 的一部分
 *
 * `consumeInviteLink`（F15）到「令牌换到一份服务端记录的授予值」为止，**不建**
 * `GuestIdentity` / `project_memberships`——那两件事属于 F16/UC-1.2 的 `JoinByGroupLink`
 * （见该文件文件头逐字）。`JoinByGroupLink` 本身尚未实现（它是另一条 F12 的活），
 * 但「到场回写」作为 F16 title 里明写的一句，其**写入形状**不依赖 `JoinByGroupLink`
 * 的其余部分——它只需要「谁、用哪条链接、进的哪个组」这三样，本用例先把这个写入面
 * 建好并直接测试，等 `JoinByGroupLink` 落地时调用它，而不是让它从两个未落地的功能之间
 * 的缝隙里消失。
 *
 * ## 幂等：掉线重连不产生第二条「在场」记录
 *
 * 同一名单条目在同一项目内，任意时刻至多一条 `ended_at IS NULL` 的会话
 * （迁移 `live_sessions_onsite_participant_uniq`）。仓储把「新建」与「命中既有」
 * 都收进同一次写（同 `invite-link-ports.ts` 「幂等是一次写的性质」的理由），
 * 这里不做「先查后插」。
 */
import type { OrgId } from "../../domain/org-id";
import type { CheckInInput, LiveSessionRepository, LiveSessionRow } from "./live-session-ports";

export interface RecordCheckInDeps {
  readonly liveSessions: LiveSessionRepository;
  readonly now?: () => Date;
}

export interface RecordCheckInUseCaseInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly participantId: string;
  readonly linkId: string;
  readonly guestIdentityId: string;
  readonly groupId: string | null;
  /** 进场时刻的议程环节 id；06-现场协作尚未接入时传 null（见 live-session-ports.ts）。 */
  readonly currentStageId: string | null;
}

export async function recordCheckIn(
  deps: RecordCheckInDeps,
  input: RecordCheckInUseCaseInput,
): Promise<LiveSessionRow> {
  const now = (deps.now ?? (() => new Date()))();
  const checkInInput: CheckInInput = {
    orgId: input.orgId,
    projectId: input.projectId,
    participantId: input.participantId,
    linkId: input.linkId,
    guestIdentityId: input.guestIdentityId,
    groupId: input.groupId,
    currentStageId: input.currentStageId,
    now,
  };
  return deps.liveSessions.checkIn(checkInInput);
}
