/**
 * 契约束 `subtask-run` —— 异步子任务派发（issue #2664）的运行时类型单一事实源。
 *
 * ## 背景
 *
 * `apps/deep-agent-service` 的 `spawn_async_task` 工具（issue #2664）供主 deep agent
 * 判断某类子任务可并行处理时调用：**不同步等待**子任务结果，而是把子任务描述转交给
 * TS 侧的独立子任务 run 队列（`apps/api/src/application/agent-run/subtask-run-queue.ts`
 * 的 `executeQueuedSubtaskRuns`）异步执行。
 *
 * 本文件定义这条"子任务 run"记录的形状——`apps/api`（写入/查询）与 `apps/web`
 * （issue #2666 的后台任务面板 UI）共用同一份状态机，不各自声明一遍
 * （AGENTS.md「同一事实不得声明在两处」）。
 *
 * ⚠ issue #2664 对应的 PR（#2675）尚未合并到 main 时，本文件按该 PR diff 里
 * `packages/contracts/src/subtask-run.ts` 的形状原样落地——是同一份契约的两次独立
 * 落笔，不是分叉；#2675 合并时若形状有出入，以先合并的为准，另一侧改成引用它。
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
 * 靠这个字段把子任务结果归拢到发起它的那次主对话下面。
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

/* ── issue #2666：前端查询接口的契约（GET /agent-runs/:runId/subtask-runs）───────
 *
 * `apps/deep-agent-service`/`spawn_async_task` 侧没有暴露任何面向浏览器的查询或推送
 * 通路（读过 #2675 diff 确认：只有内部 `POST /internal/subtask-runs` 回调入口）。
 * 这里新增一个最小可行的只读查询端点，供前端轮询——不做 WebSocket/SSE，取舍见
 * `subtask-run.controller.ts` 头注与本 PR 说明。 */
export const ListSubtaskRunsResult = z.object({
  parentRunId: z.string(),
  subtaskRuns: z.array(SubtaskRun),
});
export type ListSubtaskRunsResult = z.infer<typeof ListSubtaskRunsResult>;
