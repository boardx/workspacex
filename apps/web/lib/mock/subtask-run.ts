/**
 * 后台任务面板（issue #2666）的故事化 mock 数据 —— **刻意不带 `"use client"`**，
 * 同 `lib/mock/chat.ts` 头注同一条理由：纯数据要能被服务端组件 import。
 *
 * 正式类型与状态展示语义位于 `lib/chat/subtask-run.ts`；这里仅保留故事化 mock 数据，
 * 避免正式聊天路由为了复用类型而把 `lib/mock` 带入运行时闭包。
 */
import type { SubtaskRunView } from "@/lib/chat/subtask-run";

export {
  isSubtaskRunActive,
  SUBTASK_RUN_STATUS_LABEL,
  SUBTASK_RUN_STATUS_TONE,
  type SubtaskRunStatus,
  type SubtaskRunView,
} from "@/lib/chat/subtask-run";

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
