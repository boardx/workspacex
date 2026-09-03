/**
 * `platform-members` 束的失败面 —— 一个类，携带契约 `platformMembers.PlatformMembersError`
 * 的一个成员。与 `OrgAdminError` / `AuthError` 同一条理由（见 `auth/org-invite-errors.ts`）：
 * interface 层把它们映射成同一种响应形状，码是契约里的闭合枚举，
 * `all-exceptions.filter.ts` 会再 parse 一次才放进响应体。
 */
import { platformMembers as PM } from "@repo/contracts";
import type { z } from "zod";

export type PlatformMembersReasonCode = z.infer<typeof PM.PlatformMembersError>;

export class PlatformMembersError extends Error {
  readonly reasonCode: PlatformMembersReasonCode;

  constructor(reasonCode: PlatformMembersReasonCode) {
    // 消息只进日志（`lint-error-leak` 禁止 interface 层读 `.message`）。
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "PlatformMembersError";
  }
}
