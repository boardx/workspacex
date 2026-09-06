/**
 * 后台任务面板（issue #2666）的类型 + mock 数据 —— **刻意不带 `"use client"`**，
 * 同 `lib/mock/chat.ts` 头注同一条理由：类型/纯数据要能被服务端组件 import。
 *
 * `SubtaskRunView` 直接 `z.infer` 自 `@repo/contracts` 的 `subtaskRun.SubtaskRun`——
 * issue #2664/#2666 共用同一份状态机，没有取值分歧，不需要另起一份 `View` 类型
 * （对照 `lib/mock/chat.ts` 头注的判断标准：结构/取值都一致时直接派生）。
 */
import type { z } from "zod";
import { subtaskRun as C } from "@repo/contracts";

export type SubtaskRunStatus = z.infer<typeof C.SubtaskRunStatus>;
export type SubtaskRunView = z.infer<typeof C.SubtaskRun>;

export const SUBTASK_RUN_STATUS_LABEL: Record<SubtaskRunStatus, string> = {
  pending: "排队中",
  running: "进行中",
  completed: "已完成",
  failed: "出错",
  cancelled: "已取消",
};

/** 角标/状态点色调：进行中=ai（正在工作）、已完成=primary、出错=danger、排队=neutral */
export const SUBTASK_RUN_STATUS_TONE: Record<
  SubtaskRunStatus, "primary" | "ai" | "danger" | "neutral"
> = {
  pending: "neutral",
  running: "ai",
  completed: "primary",
  failed: "danger",
  cancelled: "neutral",
};

/** 未到终态（`pending`/`running`）视为"还在后台跑"，供角标计数与轮询是否继续用。 */
export function isSubtaskRunActive(run: SubtaskRunView): boolean {
  return run.status === "pending" || run.status === "running";
}

/** 验收标准三态 mock：一个进行中、一个已完成、一个出错（AC「三个子任务同时可见地在跑」）。 */
export const MOCK_SUBTASK_RUNS: SubtaskRunView[] = [
  {
    id: "subtask-mock-1",
    parentRunId: "run-mock-1",
    description: "调研巴伐利亚州并网许可最新审批时效",
    context: null,
    status: "running",
    result: null,
    error: null,
    createdAt: "2026-09-04T14:32:10.000Z",
    updatedAt: "2026-09-04T14:32:40.000Z",
  },
  {
    id: "subtask-mock-2",
    parentRunId: "run-mock-1",
    description: "汇总本地 EPC 产能名单与报价区间",
    context: null,
    status: "completed",
    result: "已确认 4 家可承接的本地 EPC，报价区间 ￥3.2–4.1/W，详见附表。",
    error: null,
    createdAt: "2026-09-04T14:32:05.000Z",
    updatedAt: "2026-09-04T14:33:52.000Z",
  },
  {
    id: "subtask-mock-3",
    parentRunId: "run-mock-1",
    description: "核算补贴退坡后的电价套利窗口",
    context: null,
    status: "failed",
    result: null,
    error: "行业数据库 MCP 授权超时，未能取到 2026Q3 电价曲线",
    createdAt: "2026-09-04T14:32:15.000Z",
    updatedAt: "2026-09-04T14:33:05.000Z",
  },
];
