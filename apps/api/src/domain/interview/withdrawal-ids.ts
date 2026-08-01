/**
 * `newWithdrawalReceiptId` —— F89 删除回执的可核验 id 生成。
 * 独立成小文件而不是塞进 `withdrawal.ts`：id 生成是基础设施细节（随机数来源),
 * 与 `withdrawal.ts` 的纯步骤计算不是同一种关注点(同 `consent-token.ts` 里
 * `newSigningTokenId` 系列与 `hasCompleteRenderParams` 分离的理由）。
 */
import { randomBytes } from "node:crypto";

export function newWithdrawalReceiptId(): string {
  return `wrcpt-${randomBytes(12).toString("hex")}`;
}

export function newWithdrawalId(): string {
  return `wd-${randomBytes(12).toString("hex")}`;
}
