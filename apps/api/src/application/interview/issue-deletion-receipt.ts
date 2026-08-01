/**
 * `issueDeletionReceipt`（F89 / uc-6-3 R4 第 05 步）—— ≤30 天物理删除后出回执。
 *
 * ⚠ 本 feature 不执行物理删除本身（归 22-files/17-gov）,这里只守一件事：
 *   **回执一旦发出就是对受访者的承诺**,所以第 05 步没有真正被外部流程标记完成之前,
 *   一律 `ERASURE_NOT_COMPLETE`(E3)——不存在"先发回执、事后补删除"的路径。
 */
import { newWithdrawalReceiptId } from "../../domain/interview/withdrawal-ids";
import { isPhysicalDeleteComplete } from "../../domain/interview/withdrawal";
import { ErasureNotCompleteError } from "./errors";
import type { ConsentKeyValue } from "./consent-token-ports";
import type { WithdrawalRepository } from "./withdrawal-ports";

export interface IssueDeletionReceiptDeps {
  readonly withdrawals: WithdrawalRepository;
  readonly now?: () => Date;
}

export interface IssueDeletionReceiptInput {
  readonly withdrawalId: string;
}

export interface IssueDeletionReceiptOutput {
  readonly scope: readonly ConsentKeyValue[];
  readonly completedAt: string;
  readonly verifiableId: string;
}

export async function issueDeletionReceipt(
  deps: IssueDeletionReceiptDeps,
  input: IssueDeletionReceiptInput,
): Promise<IssueDeletionReceiptOutput> {
  const record = await deps.withdrawals.findById(input.withdrawalId);
  // 找不到单据也走 `ERASURE_NOT_COMPLETE`——契约没有专门的"找不到"码(同
  // `getWithdrawalStatus` 的契约缺口),而"没有这张单据"与"这张单据没删完"在
  // "能不能发回执"这件事上结论一致,都是"不能"。
  if (!record || !isPhysicalDeleteComplete(record.steps) || record.physicalDeleteCompletedAt === null) {
    throw new ErasureNotCompleteError(input.withdrawalId);
  }

  const verifiableId = newWithdrawalReceiptId();
  await deps.withdrawals.saveReceipt(input.withdrawalId, verifiableId);

  return {
    scope: record.scope,
    completedAt: record.physicalDeleteCompletedAt.toISOString(),
    verifiableId,
  };
}
