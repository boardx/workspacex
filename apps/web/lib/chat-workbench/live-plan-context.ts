"use client";
import { createContext } from "react";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";

/**
 * 底部计划面板（`CopilotKitV2PlanControl`）上报的**进行中**计划。
 *
 * 2026-09-27 人类：「现在有三个地方显示计划，是否多余……怎么进一步统一」→ 按角色分工：
 * - 数据只有一份：进行中时消息流里的计划卡读的就是底部面板那份账本（`todos`），不再各读
 *   各的（此前消息流读执行过程里最后一次 `write_todos`，与账本一度显示 0/3 对 3/3）。
 * - 同一时刻只有一份完整列表：底部面板默认折叠成一行（#3214/#3245 的既有裁决不动），
 *   列表在消息流里；用户展开底部面板（`expanded`）时，消息流里的列表让位。
 * - 本轮结束后消息流里留本轮的计划快照；右栏「进度」页签讲每一步的动作细节。
 *
 * 默认值 = 没有底部面板（只读历史页、老轨道）：消息流照旧用执行过程里的计划，不会因此丢失。
 */
export interface LivePlan {
  /** run 在途且账本有步骤时的步骤快照；否则 null。 */
  readonly todos: readonly PlanTodo[] | null;
  /** 底部面板是否展开（展开即已展示完整列表）。 */
  readonly expanded: boolean;
}
export const NO_LIVE_PLAN: LivePlan = { todos: null, expanded: false };
export const LivePlanContext = createContext<LivePlan>(NO_LIVE_PLAN);
