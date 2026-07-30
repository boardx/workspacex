/**
 * F10 的失败面 —— 一个类，携带契约 `orgAdmin.OrgAdminError` 的一个成员。
 *
 * 一个类而不是每码一个类：与 `AuthError` 同一条理由（见 errors.ts）——
 * interface 层把它们映射成同一种响应形状，分成多个类会引来分别 `catch`，
 * 而「令牌不存在」与「令牌已核销」长出不同响应的那一天，V10 就没了。
 *
 * ⚠ 码本身是**契约里的闭合枚举**，不是自由字符串。
 * `all-exceptions.filter.ts` 会拿 `OrgAdminError` 再 parse 一次才放进响应体，
 * 所以即便这里被塞进别的东西，也到不了客户端。
 */
import { orgAdmin as OA } from "@repo/contracts";
import type { z } from "zod";

export type OrgAdminReasonCode = z.infer<typeof OA.OrgAdminError>;

export class OrgAdminError extends Error {
  readonly reasonCode: OrgAdminReasonCode;

  constructor(reasonCode: OrgAdminReasonCode) {
    // 消息只进日志（`lint-error-leak` 禁止 interface 层读 `.message`）。
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "OrgAdminError";
  }
}
