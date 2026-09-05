/**
 * 契约束 `streaming-transport` —— 签核③（API 契约）落点。Phase 14 F03/F04/F05。
 *
 * 设计签核见 `phases/phase-14-agent-kernel-unification/contracts/streaming-transport/`
 * （`design-signoff.md` status: pending，待人类签核）。翻译自
 * `requirements/02-streaming-transport.md` 的 R3/R4/R6/R7/R9，不发挥。
 *
 * ## 这是什么
 *
 * 网关→前端的真流式事件契约，替代 `wave2-runtime.ts` §5 的轮询契约（该契约随本束
 * 落地而整体作废，见 R6 后置条件；本文件不修改 `wave2-runtime.ts`——那是另一个已
 * 签核束的契约面，废止它是实现阶段的删除工作，不在本轮签核材料的翻译范围内）。
 *
 * ⚠ **`AgentKernelRunStatus` 是新枚举，不是 `wave2-runtime.ts` 的 `AgentRunStatus`
 * 的别名或扩展**——旧枚举的 `awaiting_approval` 按 R6/00-overview「已澄清的设计
 * 决策」被 `awaiting_tool_permission`（本束的 `plan-permissions` 束的一部分状态迁移）
 * 取代，二者不并存。刻意换名字避免"同一个符号名两处声明不同值"这个本仓最高发的
 * 漂移模式。
 *
 * ## 事件模型对齐 AG-UI（00-overview 全局约束 + R7）
 *
 * 六类事件（`token_delta`/`tool_call_start`/`tool_call_end`/`plan_update`/
 * `status_change`/`checkpoint_saved`）直接对齐 CopilotKit AG-UI 协议原生事件类型，
 * 不自造平行格式。`plan_update` 的负载复用 `agui-state-events.ts` 已有的
 * `AguiTodosSnapshot`（而不是重新定义一份 todo 快照形状）。
 */
import { z } from "zod";
import { AguiTodosSnapshot } from "./agui-state-events";

/* ── 一、run 状态机（R6 后置条件：isTerminalRunStatus 覆盖全部非终态）──── */

export const AgentKernelRunStatus = z.enum([
  "queued",
  "running",
  /** 03 plan-permissions 束引入：等待用户确认/编辑计划。 */
  "awaiting_plan_confirmation",
  /** 03 plan-permissions 束引入，取代旧 awaiting_approval（二者不并存）。 */
  "awaiting_tool_permission",
  /** R4 E4：用户主动暂停，或系统保护性暂停（见 `pausedBy`）。 */
  "paused",
  "succeeded",
  "failed",
  /** R4 A1：用户在计划确认阶段选择取消，run 立即终止，不残留在任何非终态。 */
  "cancelled",
]);
export type AgentKernelRunStatus = z.infer<typeof AgentKernelRunStatus>;

export const AGENT_KERNEL_TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"] as const;

/** 与 `AGENT_KERNEL_TERMINAL_STATUSES` 是同一份事实的机械投影，不许在别处重写判断逻辑。 */
export function isTerminalRunStatus(status: AgentKernelRunStatus): boolean {
  return (AGENT_KERNEL_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const PausedBy = z.enum(["user", "system"]);
export type PausedBy = z.infer<typeof PausedBy>;

/* ── 二、六类流式事件（AG-UI 对齐，R3 步骤 2）─────────────────────────── */

export const TokenDeltaEvent = z.object({
  type: z.literal("token_delta"),
  runId: z.string(),
  seq: z.number().int().min(0),
  delta: z.string(),
  emittedAt: z.string(),
}).strict();

export const ToolCallStartEvent = z.object({
  type: z.literal("tool_call_start"),
  runId: z.string(),
  seq: z.number().int().min(0),
  toolCallId: z.string(),
  toolName: z.string(),
  /** 完整入参，不是截断摘要（R6 后置条件）。 */
  args: z.record(z.unknown()),
  emittedAt: z.string(),
}).strict();

export const ToolCallEndEvent = z.object({
  type: z.literal("tool_call_end"),
  runId: z.string(),
  seq: z.number().int().min(0),
  toolCallId: z.string(),
  ok: z.boolean(),
  /** 完整出参/结果，不是截断摘要（R6 后置条件）。 */
  result: z.unknown().nullable(),
  emittedAt: z.string(),
}).strict();

export const PlanUpdateEvent = z.object({
  type: z.literal("plan_update"),
  runId: z.string(),
  seq: z.number().int().min(0),
  /** 复用 agui-state-events 的既有 todo 快照形状，不新造平行格式。 */
  plan: AguiTodosSnapshot,
  emittedAt: z.string(),
}).strict();

export const StatusChangeEvent = z.object({
  type: z.literal("status_change"),
  runId: z.string(),
  seq: z.number().int().min(0),
  status: AgentKernelRunStatus,
  pausedBy: PausedBy.nullable(),
  emittedAt: z.string(),
}).strict();

export const CheckpointSavedEvent = z.object({
  type: z.literal("checkpoint_saved"),
  runId: z.string(),
  seq: z.number().int().min(0),
  checkpointId: z.string(),
  emittedAt: z.string(),
}).strict();

export const KernelStreamEvent = z.discriminatedUnion("type", [
  TokenDeltaEvent, ToolCallStartEvent, ToolCallEndEvent,
  PlanUpdateEvent, StatusChangeEvent, CheckpointSavedEvent,
]);
export type KernelStreamEvent = z.infer<typeof KernelStreamEvent>;

/*
 * ── 二·五、对齐 AG-UI 原生事件类型（R7："直接对齐...不自造平行格式"）────────
 *
 * `aguiEventTypeFor` 是这句话的机械落点：六类事件里的每一个具体值，都能指到
 * `@ag-ui/core`（本仓 `apps/web`/`apps/api` 已经在用的同一个包、同一个版本）的一个
 * **真实存在**的 `EventType` 成员，而不是本文件自己发明的字符串。`tests/wave2-runtime/
 * agui-event-schema.test.ts` 逐一构造六类事件的样例，断言这里返回的每一个值都出现在
 * 真实安装的 `EventType` 枚举里——不是抄一份值相同但两处声明的镜像。
 *
 * 映射并不是"六个都塞进 CUSTOM"——那样才是自造平行格式的做法。凡是 AG-UI 已经有
 * 原生一等公民概念的地方（增量文本、工具调用起止、run 的成功/失败终态、todo 快照）
 * 都用那个原生类型；只有 AG-UI 协议本身没有对应概念的地方（`awaiting_tool_permission`/
 * `paused` 这类本仓特有的非终态、以及 `checkpoint_saved` 这个 AG-UI 完全没有的概念）
 * 才落到 `CUSTOM`——而 `CUSTOM {name,value}` 本身就是 AG-UI 协议原生声明的扩展轴
 * （见 `agui-state-events.ts` 文件头："两轴并用,不 fork 协议"），不是本仓另起的东西。
 *
 * `plan_update` 对齐 `STATE_SNAPSHOT` 而不是 `STATE_DELTA`：`AguiTodosSnapshot` 每次都是
 * **完整**快照（不是增量 patch），且 `apps/web/lib/agui-plan-todos.ts` 已经在用
 * `STATE_SNAPSHOT { snapshot: { todos } }` 消费 `write_todos` 的既有事件——延续同一个
 * 事实源，不是另创一套。
 *
 * `succeeded`/`cancelled` 都对齐 `RUN_FINISHED`：AG-UI 协议没有独立的 "cancelled" 生命
 * 周期事件，`RUN_FINISHED` 是两者共同的"这个 run 的执行结束了"信号，区别（是否真的
 * 产出了结果）由 `KernelStreamEvent` 自身的 `status` 字段承载，不需要 wire 层再分叉。
 */
import type { EventType as AguiEventType } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";

export function aguiEventTypeFor(event: KernelStreamEvent): AguiEventType {
  switch (event.type) {
    case "token_delta":
      return EventType.TEXT_MESSAGE_CONTENT;
    case "tool_call_start":
      return EventType.TOOL_CALL_START;
    case "tool_call_end":
      return EventType.TOOL_CALL_END;
    case "plan_update":
      return EventType.STATE_SNAPSHOT;
    case "checkpoint_saved":
      // AG-UI 协议没有"checkpoint"这个原生概念——CUSTOM 是协议自己声明的扩展轴
      // （见上方文件头注释），不是本文件自造的平行格式。
      return EventType.CUSTOM;
    case "status_change":
      switch (event.status) {
        case "running":
          // `running` 在本仓可以从 `paused`/`awaiting_*` 多次重新进入，而 AG-UI 的
          // `RUN_STARTED` 语义上是"一次 run 生命周期只发生一次"的开端事件（且要求
          // `threadId`，本事件的窄 payload 里没有这个字段）——用它会把一个可重复
          // 发生的信号误建模成只发生一次的信号，因此归 `CUSTOM`。
          return EventType.CUSTOM;
        case "succeeded":
        case "cancelled":
          return EventType.RUN_FINISHED;
        case "failed":
          return EventType.RUN_ERROR;
        default:
          // queued / awaiting_plan_confirmation / awaiting_tool_permission / paused ——
          // AG-UI 协议没有对应的原生非终态概念，落 CUSTOM（协议自身的扩展轴）。
          return EventType.CUSTOM;
      }
  }
}

/* ── 三、订阅与断线重连（R3 步骤 4，R4 E2）────────────────────────────── */

export const SubscribeRunEventsInput = z.object({
  runId: z.string().min(1),
  /** 重连时携带最后已知事件序号，网关据此补发断点之后的事件（不丢不重复）。 */
  lastKnownSeq: z.number().int().min(0).nullable(),
}).strict();
export type SubscribeRunEventsInput = z.infer<typeof SubscribeRunEventsInput>;

export const ReconnectState = z.enum(["reconnecting", "restored", "failed"]);
export type ReconnectState = z.infer<typeof ReconnectState>;

/* ── 四、放开一消息一 run 约束（F05，R4 E4）───────────────────────────── */

export const AgentRunAttempt = z.object({
  runId: z.string(),
  /** 同一逻辑 run 的续跑序号，从 1 开始；首次执行为 1。 */
  attemptSeq: z.number().int().min(1),
  messageId: z.string(),
  resumedFromCheckpointId: z.string().nullable(),
  status: AgentKernelRunStatus,
  createdAt: z.string(),
}).strict();
export type AgentRunAttempt = z.infer<typeof AgentRunAttempt>;

/* ── 五、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  /** WebSocket 端点：R3 步骤 1-2，六类事件即时转发。 */
  subscribeRunEvents: {
    method: "WS",
    path: "/agent-runs/:runId/events",
    in: SubscribeRunEventsInput,
    out: KernelStreamEvent,
  },
  /** F05：同一条用户消息的全部续跑记录，仍映射到同一条消息。 */
  listRunAttemptsForMessage: {
    method: "GET",
    path: "/messages/:messageId/agent-run-attempts",
    in: z.object({ messageId: z.string().min(1) }).strict(),
    out: z.object({ attempts: z.array(AgentRunAttempt) }).strict(),
    err: ["MESSAGE_NOT_VISIBLE"] as const,
  },
};
