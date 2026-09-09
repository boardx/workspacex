"use client";
/**
 * issue #3261 —— 「这一轮 run 为什么失败」在产品面上的**唯一**一处算法。
 *
 * ## 修的是什么
 *
 * PR #3229（issue #3211 ①）把失败成因做成了有界枚举 `AgentRunFailureReason`，写进
 * `agent_runs.failure_reason`，前端 `describeAgentRunFailure` 也能把它译成人话。
 * 但成因只走到了**恢复路径**（刷新 / 切回来时 `handleRunRestored` 的那次权威读）：
 * 失败**当场**走的是 AG-UI `RUN_ERROR` → `copilotkit.subscribe({ onError })`，而
 * `RUN_ERROR` 事件上只有一个枚举码（`copilotkit-agui.controller.ts`：
 * `write({ type: RUN_ERROR, message: outcome.error, code: outcome.error })`），
 * 成因在 wire 上**没有位置**。于是同一个失败，刷新前后说的是两句不同的话——
 * 尤其 `executor_defect`（我们自己的执行器抛异常）在活路径上与「模型没给结果」
 * 逐字相同，线上没人分得开我们的 bug 和模型的问题。
 *
 * ## 为什么是"补一次权威读"，不是"把成因塞上 wire"
 *
 * 本仓今晚第八次撞上「同一事实在两处各算一遍」，纪律是**收敛为单一来源**，不是让两处
 * 各自改对。成因的单一事实源是 `agent_runs.failure_reason`；恢复路径已经在读它，且那条
 * 读法已经被 e2e 跑过。让活路径也读同一处（`GET /agent-runs/:runId` → `AgentRunView`），
 * 两条路径就只剩**一个**成因来源、**一个**文案函数。
 * 把成因另发一份到 AG-UI 事件里则相反：那是给同一个事实开第二份副本，
 * 还要动 AG-UI 的事件形状。
 *
 * ⚠ 顺序是安全的：控制器只有在 `outcome.kind === "failed"` 之后才写 `RUN_ERROR`，
 * 而那个 outcome 是 `failRun` 落库之后才产生的——`RUN_ERROR` 到达客户端时，
 * `failure_reason` 已经在库里。读不到时**逐字回落**到只按码说话的旧文案，不编成因。
 */
import { getAgentRun } from "./agent-run";
import type { AgentRunFailureReason } from "./agent-run";
import { describeCopilotkitV2RunError, isAgentRunTerminalErrorCode } from "./copilotkit-v2-error-copy";

/** 权威读回来的、本模块真正用到的那两个字段。 */
export interface FailedRunFacts {
  readonly error?: string | null;
  readonly failureReason?: AgentRunFailureReason | null;
}

/**
 * run 的权威视图 → 横幅正文。**两条路径共用这一个函数**：失败当场（`onError` 补读之后）
 * 与刷新后恢复（`handleRunRestored`）。它是"失败横幅说什么"的唯一算法。
 *
 * `fallbackCode` 是 wire 上那个码：视图里没有 `error` 时（老快照）用它兜底，
 * 这样活路径至少不会比修改前更差。
 */
export function describeFailedRunBanner(view: FailedRunFacts, fallbackCode?: string | null): string {
  return describeCopilotkitV2RunError(view.error ?? fallbackCode ?? null, view.failureReason ?? null);
}

/**
 * 活路径：AG-UI `RUN_ERROR` 到手之后，向 `agent_runs` 补一次权威读，把成因取回来。
 *
 * 返回值一定是"可以直接显示的一句话"——读失败、没有 runId、或这个码根本不是 run 的
 * 终态码（传输层码天然没有成因）时，逐字返回只按码说话的旧文案，**不**多打这次请求。
 */
export async function resolveLiveRunFailureBanner(params: {
  readonly runId: string | null;
  readonly code: string | null | undefined;
  readonly bearer?: string;
  /** 注入点，只为测试；生产恒为 `getAgentRun`。 */
  readonly fetchRun?: typeof getAgentRun;
}): Promise<string> {
  const { runId, code, bearer } = params;
  const codeOnly = describeCopilotkitV2RunError(code);
  // 传输层码（`THREAD_NOT_VISIBLE` / `AGENT_RUN_TIMEOUT` / 原始网络异常文案……）不是
  // run 的终态码，`agent_runs` 上不会有对应成因——不为它们多打一次请求。
  if (runId === null || !isAgentRunTerminalErrorCode(code)) return codeOnly;
  try {
    const view = await (params.fetchRun ?? getAgentRun)(runId, bearer);
    if (view.status !== "failed") return codeOnly;
    return describeFailedRunBanner(view, code);
  } catch {
    // 读不到就如实退回旧文案：这条路径已经在报一个失败了，不该再叠一个失败上去。
    return codeOnly;
  }
}
