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
 * 同批次其它子任务）。取消先记录请求，确认后转 `cancelled`；未知结果为 `failed` + cancellation.unknown。终态结果不再发布。
 */
import { z } from "zod";
import { RunArtifactRef } from "./standard-run-status";
import { NativeArtifactPublishInput } from "./native-artifact-publish";
import { limits as sandboxLimits } from "./sandbox-session";
import { ToolCallStartFields, ToolCallEndFields } from "./execution-journal";

/** 子任务 run 的状态机，见本文件头注。 */
export const SubtaskRunStatus = z.enum(["pending", "running", "completed", "failed", "cancelled"]);
export type SubtaskRunStatus = z.infer<typeof SubtaskRunStatus>;
export const SubtaskOutputFilesPolicy=z.object({
  mediaTypes:z.array(NativeArtifactPublishInput.shape.mediaType).min(1).max(12),
  maxFiles:z.number().int().min(1).max(sandboxLimits.maxFiles),
  maxTotalBytes:z.number().int().min(1).max(sandboxLimits.maxRequestBytes),
}).strict();

/**
 * 一条子任务 run 记录。
 *
 * `parentRunId` 关联回派发它的主 agent run（`agent_runs.id`）——issue #2666 的 UI 展示
 * 靠这个字段把子任务结果归拢到发起它的那次主对话下面，本契约束只保证这个字段"存在且
 * 指向真实父 run"，UI 消费逻辑不在本 issue 范围内。
 *
 * `result`/`error` 互斥：终态为 `completed` 时 `result` 非 null、`error` 为 null；终态为
 * `failed` 时相反；`pending`/`running`/`cancelled` 两者都为 null。
 */
/**
 * 子任务执行期间的一次工具调用（issue #3100 D6）。
 *
 * ⚠ **不是第二套工具事件模型**：字段名与校验规则直接取自父 run 账本
 * （`execution-journal.ts` 的 `ToolCallStartFields`/`ToolCallEndFields`），这里只是把
 * 「同一 `toolCallId` 的 start + end 两行」折叠成 UI 要的一条记录——父 run 仍然只有账本
 * 一个事实源，子任务 run 因为不写 `agent_run_steps`/执行账本（它没有自己的 `agent_runs`
 * 行），才需要把这份折叠随子任务记录一起持久化。折叠规则的唯一实现在
 * `apps/api/src/application/agent-run/subtask-run-queue.ts` 的 `foldSubtaskToolCall`。
 *
 * `argsSummary`/`resultSummary` 是**摘要**（provider 侧 `ModelCallProgressEvent.
 * toolArgsSummary`/`toolResultSummary` 已截断的那两个值），不是完整入参/结果——
 * 子任务面板只展示"用了哪些工具"，不承担完整取证。
 *
 * `ok`/`durationMs` 在工具刚宣布调用、结果还没回来时为 `null`——展示层据此显示"进行中"，
 * 不许拿 0 冒充耗时。
 */
export const SubtaskToolCall = z.object({
  toolCallId: ToolCallStartFields.toolCallId,
  toolName: ToolCallStartFields.toolName,
  argsSummary: z.string().nullable(),
  resultSummary: z.string().nullable(),
  ok: ToolCallEndFields.ok.nullable(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();
export type SubtaskToolCall = z.infer<typeof SubtaskToolCall>;

export const SubtaskCancellation = z.object({
  requestedAt: z.string().datetime(), state: z.enum(["pending", "confirmed", "unknown"]),
}).strict();
export const SubtaskRun = z.object({
  cancellation: SubtaskCancellation.optional(),
  id: z.string(),
  parentRunId: z.string(),
  /** 子任务的目标描述——`spawn_async_task` 调用时模型给出的自然语言任务说明。 */
  description: z.string(),
  /** 子任务需要的额外上下文（父对话摘录、约束条件等）。可选——不是每个子任务都需要。 */
  context: z.string().nullable(),
  outputFiles: SubtaskOutputFilesPolicy.optional(),
  snapshot: z.object({agentVersionId:z.string(),skillVersionIds:z.array(z.string()),modelProvider:z.string(),modelId:z.string()}).strict(),
  artifactRefs: z.array(RunArtifactRef),
  /**
   * 这条子任务执行期间上报的工具调用，按首次出现顺序（issue #3100 D6）。
   *
   * **可选，且"缺席"与"空数组"是同一件事：引擎没上报**——不是"没用工具"。持久化层
   * （`PgSubtaskRunStore`）永远给出数组（列默认 `'[]'`），旧行与不报进度的 provider
   * 因此给出空数组；展示层必须诚实说"引擎尚未上报"，不许造假。
   */
  toolCalls: z.array(SubtaskToolCall).optional(),
  status: SubtaskRunStatus,
  result: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubtaskRun = z.infer<typeof SubtaskRun>;

/** `spawn_async_task` 一次调用 ⇒ 一次入队请求的输入形状。 */
export const EnqueueSubtaskRunInput = z.object({
  /** Stable tool-call identity; absent preserves legacy new-task semantics. */
  idempotencyKey: z.string().min(1).max(256).optional(),
  parentRunId: z.string(),
  description: z.string().min(1),
  context: z.string().nullable().optional(),
  outputFiles: SubtaskOutputFilesPolicy.optional(),
  /** Retry copies the original immutable snapshot; a mismatch with the parent fails closed. */
  snapshot: SubtaskRun.shape.snapshot.optional(),
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

/** Durable request: running remains pending until cessation is verified. */
export const CancelSubtaskRunResult = z.object({ subtaskRun: z.union([
  SubtaskRun.extend({status:z.literal("cancelled")}),
  SubtaskRun.extend({status:z.literal("running"),cancellation:SubtaskCancellation.extend({state:z.literal("pending")})}),
  SubtaskRun.extend({status:z.literal("failed"),cancellation:SubtaskCancellation.extend({state:z.literal("unknown")})}),
]) });
export type CancelSubtaskRunResult = z.infer<typeof CancelSubtaskRunResult>;

export const CancelSubtaskRunFailure = z.enum(["cancellation_not_supported_for_running", "terminal_conflict"]);
export type CancelSubtaskRunFailure = z.infer<typeof CancelSubtaskRunFailure>;

/** Expected refusal when a late callback targets an already cancelled parent. */
export const EnqueueSubtaskRunFailure = z.enum(["SUBTASK_PARENT_CANCELLED"]);
