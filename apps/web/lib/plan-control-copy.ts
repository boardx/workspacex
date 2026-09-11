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
import { describeAgentRunFailure, type AgentRunError, type AgentRunFailureReason } from "@/lib/agent-run";

const GENERIC_PLAN_FAILURE_REASON =
  "执行未完成——账本读模型目前不提供更具体的失败原因，可重试该步或修改输入后重新确认。";

/**
 * issue #3403 ④ —— 这里此前**只**接 `errorCode`，于是无论真实成因是什么，用户看见的
 * 都是 `MODEL_CALL_FAILED` 那一句「模型这次没能返回可用结果」。人类 2026-09-11 实测
 * 那一幕真正失败的是渲染脚本 `render-office.py`——**把脚本失败说成模型失败会把排查
 * 引向完全错误的方向**，正是 #3280 / #3323 要防的。成因接上后照旧复用
 * `lib/agent-run.ts` 的 `describeAgentRunFailure`（文案单一事实源），本文件不开第二份映射。
 *
 * 成因缺席（老 run、或该失败路径尚未带成因）时逐字退回原来那句——**不编一个成因出来**。
 */
export function describePlanFailureReason(
  errorCode: string | null,
  failureReason?: AgentRunFailureReason | null,
): string {
  if (errorCode === null) return GENERIC_PLAN_FAILURE_REASON;
  const parsed = wave2Runtime.AgentRunError.safeParse(errorCode);
  if (!parsed.success) return GENERIC_PLAN_FAILURE_REASON;
  return describeAgentRunFailure(parsed.data as AgentRunError, failureReason ?? null);
}
