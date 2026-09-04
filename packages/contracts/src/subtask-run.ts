/**
 * 契约束 `subtask-run` —— 异步子任务派发（issue #2664）的运行时类型单一事实源。
 *
 * ## 背景
 *
 * `apps/deep-agent-service` 新增 `spawn_async_task` 工具（issue #2664），供主 deep agent
 * 判断某类子任务可并行处理时调用：**不同步等待**子任务结果，而是把子任务描述转交给
 * TS 侧既有的 run 队列机制（`apps/api/src/application/agent-run/execute-run.ts` 的
 * `executeQueuedRuns`/`claimQueued` 同一套"领取→执行→写回"节奏，见
 * `apps/api/src/application/agent-run/subtask-run-queue.ts`）异步执行。
 *
 * 本文件定义这条"子任务 run"记录的形状——TS 两端（api 与后续 web，见 issue #2666 的 UI
 * 消费）与 Python 侧（`spawn_async_task` 的返回值形状）共用同一份状态机，不各自声明一遍
 * （AGENTS.md「同一事实不得声明在两处」）。
 *
 * ## 状态机
 *
 * `pending`（已入队，尚未被领取）→ `running`（已被 `claimQueued` 领取，正在执行）
 * → `completed`（执行成功，`result` 非空）| `failed`（执行失败，`error` 非空，不影响
 * 同批次其它子任务）。四态之外没有第五态；不可逆——`completed`/`failed` 是终态。
 */
import { z } from "zod";

/** 子任务 run 的状态机，见本文件头注。 */
export const SubtaskRunStatus = z.enum(["pending", "running", "completed", "failed"]);
export type SubtaskRunStatus = z.infer<typeof SubtaskRunStatus>;

/**
 * 一条子任务 run 记录。
 *
 * `parentRunId` 关联回派发它的主 agent run（`agent_runs.id`）——issue #2666 的 UI 展示
 * 靠这个字段把子任务结果归拢到发起它的那次主对话下面，本契约束只保证这个字段"存在且
 * 指向真实父 run"，UI 消费逻辑不在本 issue 范围内。
 *
 * `result`/`error` 互斥：终态为 `completed` 时 `result` 非 null、`error` 为 null；终态为
 * `failed` 时相反；非终态（`pending`/`running`）两者都为 null。
 */
export const SubtaskRun = z.object({
  id: z.string(),
  parentRunId: z.string(),
  /** 子任务的目标描述——`spawn_async_task` 调用时模型给出的自然语言任务说明。 */
  description: z.string(),
  /** 子任务需要的额外上下文（父对话摘录、约束条件等）。可选——不是每个子任务都需要。 */
  context: z.string().nullable(),
  status: SubtaskRunStatus,
  result: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubtaskRun = z.infer<typeof SubtaskRun>;

/** `spawn_async_task` 一次调用 ⇒ 一次入队请求的输入形状。 */
export const EnqueueSubtaskRunInput = z.object({
  parentRunId: z.string(),
  description: z.string().min(1),
  context: z.string().nullable().optional(),
});
export type EnqueueSubtaskRunInput = z.infer<typeof EnqueueSubtaskRunInput>;
