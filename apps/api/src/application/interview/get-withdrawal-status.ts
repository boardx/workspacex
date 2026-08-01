/**
 * `getWithdrawalStatus`（F89 / uc-6-3 R4）—— 撤回进度只读投影。
 *
 * ⚠ 契约 `getWithdrawalStatus.err` 只有 `DEPENDENCY_UNAVAILABLE`,没有专门的
 *   "找不到这张单据"的码(与 `withdraw-evidence.ts` 报告的契约缺口同一种情形)。
 *   本实现对不存在的 `withdrawalId` 返回 `{ steps: [] }` 而不是抛错——
 *   空数组是"这张单据不存在/查不到"唯一能诚实表达、又不越权新造错误码的形状,
 *   调用方看到空 steps 不会误以为撤回"已完成"(五步恒非空,空集合本身就是异常信号)。
 */
import type { WithdrawalStepRecord } from "../../domain/interview/withdrawal";
import type { WithdrawalRepository } from "./withdrawal-ports";

export interface GetWithdrawalStatusDeps {
  readonly withdrawals: WithdrawalRepository;
}

export interface GetWithdrawalStatusInput {
  readonly withdrawalId: string;
}

export interface GetWithdrawalStatusOutput {
  readonly steps: readonly WithdrawalStepRecord[];
}

export async function getWithdrawalStatus(
  deps: GetWithdrawalStatusDeps,
  input: GetWithdrawalStatusInput,
): Promise<GetWithdrawalStatusOutput> {
  const record = await deps.withdrawals.findById(input.withdrawalId);
  return { steps: record?.steps ?? [] };
}
