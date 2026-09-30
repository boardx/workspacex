/**
 * 通用项目邀请（#4787）的失败面 —— 一个类，携带契约 `projectInvitation.ProjectInvitationReason` 的一个成员。
 *
 * 一个类而不是每码一个类：同 `ProjectError` / `OrgAdminError`——interface 层把它们映射成同一种
 * 响应形状，分成多个类会引来分别 `catch`，然后两个码长出两种响应形状。
 *
 * ⚠ 消息只进日志（`lint-error-leak` 禁止 interface 层读 `.message`）；对外的人话取自契约的
 * `PROJECT_INVITATION_REASON_TEXT[reasonCode]`，不在这里再写一份。
 */
import { projectInvitation as C } from "@repo/contracts";
import type { z } from "zod";

export type ProjectInvitationReasonCode = z.infer<typeof C.ProjectInvitationReason>;

export class ProjectInvitationError extends Error {
  readonly reasonCode: ProjectInvitationReasonCode;
  /** 仅限频类错误：还要等多少秒才能再试。 */
  readonly retryAfterSeconds: number | null;

  constructor(reasonCode: ProjectInvitationReasonCode, retryAfterSeconds: number | null = null) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = "ProjectInvitationError";
  }
}
