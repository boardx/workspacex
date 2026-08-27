"use client";
import * as React from "react";
import { fetchPlanLedger, type PlanLedgerView } from "@/lib/plan-control-api";

/**
 * issue #2260 —— 顶部阶段指示器与右侧任务检查器此前各自独立取数：前者
 * （`copilotkit-v2-plan-control.tsx`）轮询 REST `getPlanLedger`；后者
 * （`chat-task-inspector.tsx` 的「进度」页签）订阅 AG-UI SSE 的 `STATE_SNAPSHOT`
 * 事件（`lib/agui-plan-todos.ts`）。
 *
 * ## 根因
 *
 * `confirmPlan`/`resumePlanRun`/`retryPlanStep` 触发的续跑（issue #2250）走的是
 * `acceptHumanMessage` + `executor.kick` 的 queued/tick 通路，**从不经过** AG-UI
 * SSE 桥（`accept-message-plan-run-creator.ts` 文件头注原话：这条续跑对浏览器
 * "invisible to a browser network monitor -- it is a server-to-server call"）。
 * 右侧 Inspector 订阅的 SSE 快照在这条通路上因此永远收不到新事件，停在确认前
 * 那一刻的旧值；而顶部指示器读的账本——AG-UI 桥的 `onStep` 与 #2250 新增的
 * confirm-watcher **两条通路都会写入同一张 `chat_plan_ledgers`**
 * （`ingestEnginePlanSnapshot`，两处调用点：`copilotkit-agui.controller.ts` 与
 * `accept-message-plan-run-creator.ts`）——能正确跟着真实 run 状态推进。两个
 * UI 因此展示矛盾的"进度"：顶部说"完成"，右侧还停在旧的未完成计数。
 *
 * ## 修法：账本是唯一在所有通路下都跟得上真实进度的数据源
 *
 * 本 hook 把「轮询 `getPlanLedger`」这段逻辑抽成单一实现，供顶部指示器与右侧
 * 检查器共用——两处不再各自维护一套"现在到哪一步了"的判断（同 AGENTS.md
 * "同一事实不得声明在两处"纪律）。⚠ 这不是把两次网络请求合并成一次共享请求
 * （两棵组件树各自独立 mount/unmount，没有共同的祖先方便共享一个 `useState`
 * 而不做更大的 props-drilling 重构）——本轮只统一"读哪张表"，不去动"谁负责
 * 发这次 HTTP 请求"。3 秒轮询窗口内两处调用至多短暂不同步（同一份 REST 端点，
 * 两次几乎同时的读，差值在毫秒级），不会像修复前那样永久停在两个矛盾的值上
 * （SSE 通路对续跑运行永远不会更新，是无界的陈旧，不是有界的轮询窗口）。
 */
const POLL_INTERVAL_MS = 3000;

export interface UsePlanLedgerPollingResult {
  readonly ledger: PlanLedgerView | null;
  readonly refetch: () => Promise<void>;
}

export function usePlanLedgerPolling(threadId: string | null): UsePlanLedgerPollingResult {
  const [ledger, setLedger] = React.useState<PlanLedgerView | null>(null);

  const refetch = React.useCallback(async (): Promise<void> => {
    if (threadId === null) { setLedger(null); return; }
    try {
      setLedger(await fetchPlanLedger(threadId));
    } catch {
      // 读失败静默重试（下一轮轮询）——调用方各自已有的错误横幅覆盖"这条线程
      // 出问题了"，这里不需要再叠一层独立错误态（同既有
      // `copilotkit-v2-plan-control.tsx` 的既定纪律）。
    }
  }, [threadId]);

  React.useEffect(() => {
    void refetch();
    if (threadId === null) return;
    const interval = window.setInterval(() => { void refetch(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [threadId, refetch]);

  return { ledger, refetch };
}
