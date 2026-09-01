/**
 * issue #2451 —— `PlanFailureRecovery` 此前把失败原因写死成一句占位文案
 * （`copilotkit-v2-plan-control.tsx` 旧版本），即使 `getPlanLedger.errorCode`
 * 已经能拿到 `agent_runs.error_code` 的真实值（后端改动见 `get-plan-ledger.ts`）。
 *
 * 这里只做一件事：把 `errorCode` 翻成人话，复用 `lib/agent-run.ts` 的
 * `describeAgentRunError`——那是文案的单一事实源（`AGENT_RUN_ERROR_TEXT`
 * Record 只在那一处维护），本文件不新开第二份映射（AGENTS.md「同一事实不得
 * 声明在两处」纪律；本仓已经因为类似的重复维护栽过五次，见该文件顶层约定）。
 *
 * `errorCode` 为 `null`，或不在 `AgentRunError` 枚举内（读模型口径以后可能
 * 变化、或历史脏数据），一律退回一句诚实的通用占位——不编一个看起来更精确、
 * 实则是猜的原因。
 */
import { wave2Runtime } from "@repo/contracts";
import { describeAgentRunError, type AgentRunError } from "@/lib/agent-run";

const GENERIC_PLAN_FAILURE_REASON =
  "执行未完成——账本读模型目前不提供更具体的失败原因，可重试该步或修改输入后重新确认。";

export function describePlanFailureReason(errorCode: string | null): string {
  if (errorCode === null) return GENERIC_PLAN_FAILURE_REASON;
  const parsed = wave2Runtime.AgentRunError.safeParse(errorCode);
  if (!parsed.success) return GENERIC_PLAN_FAILURE_REASON;
  return describeAgentRunError(parsed.data as AgentRunError);
}
