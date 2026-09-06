/**
 * #435 —— AgentRun 只读轮询的真实 API 薄封装。
 *
 * ## 为什么单独一个文件，而不是塞进 `lib/live-chat.ts`
 *
 * 它们是**两个契约束**：`lib/live-chat.ts` 的文件头把自己的范围写死在
 * `@repo/contracts` 的 `chat` 束上，而 AgentRun 住在 `wave2Runtime` 束
 * （`packages/contracts/src/wave2-runtime.ts:200-215`）。混进去会让那句范围声明
 * 变成一句会说谎的注释——本仓踩过多次。
 *
 * ## 轮询，不是 SSE
 *
 * 契约原文（`wave2-runtime.ts:200-202`）：Wave 2 的 run 传输就是**轮询**，客户端
 * 用有界退避并在**终态**停下，这一刀里没有 SSE 变体。本文件只提供单次读，
 * 退避与终止条件由调用方（`chat-live-message-panel.tsx`）持有。
 *
 * ## 不合成、不兜底
 *
 * 这里只把服务端的 `AgentRunView` 原样交出去。run 的状态、错误码、
 * `resultMessageId` 全部以服务端为准；读不到就报错，**不返回一个假的 "succeeded"**，
 * 也不在客户端编造回复文本。助手回复始终来自 `listMessages` 的持久行。
 */
import { wave2Runtime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type AgentRunView = z.infer<typeof wave2Runtime.AgentRunView>;
export type AgentRunStatus = z.infer<typeof wave2Runtime.AgentRunStatus>;
export type AgentRunError = z.infer<typeof wave2Runtime.AgentRunError>;

/**
 * UX-9 track B 第 7 项修复（2026-08-23 回归）—— run 的终态错误码此前被原样印给用户
 * （「执行失败（MODEL_CALL_FAILED）」），是仅供排障的稳定枚举，不是人话。
 * 这里给每个契约枚举值一句人读文案；原始 code 仍然可取（调用方放进 `title`），
 * 不是被抹掉，只是不再是用户第一眼看到的东西。
 *
 * ⚠ 这个 Record 的 key 集合与 `wave2-runtime.ts` 的 `AgentRunError` 枚举是同一件事——
 * 新增枚举值时 TypeScript 会在这里报"缺 key"，不会静默漏译。
 */
const AGENT_RUN_ERROR_TEXT: Record<AgentRunError, string> = {
  HITL_REJECTED: "已被人工拒绝执行",
  MODEL_PROVIDER_NOT_CONFIGURED: "所选模型服务尚未配置，请联系管理员",
  SKILL_VERSION_UNAVAILABLE: "所需的 skill 版本当前不可用",
  AGENT_VERSION_UNAVAILABLE: "所选 Agent 版本已不可用，请重新选择 Agent 后再试",
  MODEL_CALL_FAILED: "模型这次没能返回可用结果",
  CHAT_WRITEBACK_FAILED: "回复已生成，但写入对话失败",
  TOOL_LOOP_LIMIT_EXCEEDED: "工具调用次数超出上限，模型未能给出最终答案",
  // Phase 14 F01（kernel-gateway 契约束 R4 A1）：网关下发前健康检查未过，请求根本
  // 没有发出去——与 MODEL_CALL_FAILED（调用已发起、内核/模型出错）是不同的事实。
  KERNEL_UNAVAILABLE: "服务暂时不可用，请稍后重试",
  // issue #2860：执行它的服务进程重启了，run 被回收器收敛成终态——不是模型出错，重发即可。
  RUN_INTERRUPTED: "上一条任务因服务重启被中断了，请重新发送",
};

/** 终态错误码 → 人读文案。`code` 为 `null`（读不到具体原因）时给一句诚实的兜底。 */
export function describeAgentRunError(code: AgentRunError | null): string {
  if (code === null) return "执行失败，原因未知";
  return AGENT_RUN_ERROR_TEXT[code] ?? `执行失败（${code}）`;
}

/**
 * run 的**终态**集合，唯一事实源取自契约的状态机
 * （`wave2-runtime.ts:110-112` 的枚举 + `20260805110000_wave2_agent_run_execution.sql:46-64`
 * 的转移触发器：`queued → running → writeback_pending → succeeded`，`failed` 可从
 * 任一非终态进入，终态不再离开）。
 *
 * ⚠ 轮询必须在这里停。把 `writeback_pending` 也当终态是错的：#413 的写回正是在
 * 那个状态下才发生，提前停轮询会让「恰好一条回复」在界面上永远不出现。
 *
 * ⚠ #519 之后 `failed` 仍然是**这一轮**轮询的终点，但不再是「这个 run 永远到此为止」：
 * `CHAT_WRITEBACK_FAILED` 的 run 可以由人显式调 `retryAgentRun` 重开回
 * `writeback_pending`。上面那句注释在 #519 之前为真、现在只在「不做任何人类动作」的
 * 前提下为真。**UX-9 track B 第 7 项修复**补上了这一半：`retryAgentRun`（下方薄封装）
 * 与消息流里的重试入口（`chat-live-message-panel.tsx`）都已接上——这句注释此前说
 * 「没有客户端调用、没有 UI 入口」，不要再把那句话读成现状。
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set<AgentRunStatus>(["succeeded", "failed", "cancelled"]);

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export async function getAgentRun(
  runId: string,
  sessionToken?: string,
  signal?: AbortSignal,
): Promise<AgentRunView> {
  return apiRequest<AgentRunView>(
    wave2Runtime.operations.getAgentRun.path.replace(":runId", encodeURIComponent(runId)),
    { method: "GET", sessionToken, signal },
  );
}

/**
 * UX-9 track B 第 7 项修复 —— 契约面 `retryAgentRun`（#519）此前有实现、有服务端路由，
 * 唯独没有客户端调用、没有 UI 入口（见本文件旧头注「本文件目前没有实现重试的客户端
 * 调用」）。这里补上薄封装，原样交出服务端结果，不在客户端猜测重开是否成功。
 *
 * ⚠ 只对 `failed` + `CHAT_WRITEBACK_FAILED` 的 run 有效（服务端 `reopenForWritebackRetry`
 * 的既有约束，见 `apps/api/src/application/agent-run/retry-run.ts`）——`MODEL_CALL_FAILED`
 * 等其它终态错误码会撞 409 `AGENT_RUN_NOT_RETRYABLE`，调用方需要另一条路径（把原文本
 * 当一条新消息重新发出），不是本函数的职责。
 */
export async function retryAgentRun(
  runId: string,
  sessionToken?: string,
): Promise<AgentRunView> {
  return apiRequest<AgentRunView>(
    wave2Runtime.operations.retryAgentRun.path.replace(":runId", encodeURIComponent(runId)),
    { method: "POST", sessionToken },
  );
}

/**
 * DA-07c（rubric D6）：对等待人工批准（HITL 停在 Wave2 `agent_runs.status` 的对应
 * 枚举值——Phase 14 F06 起是 `awaiting_tool_permission`，见 `wave2-runtime.ts`）的
 * run 提交人裁决。Phase 14 streaming-transport 契约束
 * （`packages/contracts/src/streaming-transport.ts` 文件头）另起了新枚举名
 * `AgentKernelRunStatus`，避免与这条历史 Wave2 HITL 流程的状态名在同一文件里
 * 产生"同一符号两处声明不同值"的歧义（domain.md I-5）——这里描述的仍是本函数
 * 服务的旧流程本身，未改动行为。
 * 只把服务端结果原样交出去；409 会从 apiRequest 以错误抛出——调用方据此
 * 重读 run 展示真实状态，不在客户端假装决定生效（与 getAgentRun 同一条纪律）。
 *
 * UX-9 D4 前端接入（gap 清单第 3 条，PR #1848 的后端半边）：新增 "edit" 分支。
 * `editedArgs` 是改后的**完整**工具参数对象（不是 patch），与契约
 * （`wave2-runtime.ts` 的 `decideAgentRun.in` superRefine）同一条规则——
 * 仅 decision === "edit" 时必填，approve/reject 携带会被服务端 400。
 * 这里用参数重载把「不允许传」在类型层面表达出来，而不是让调用方自己记规则。
 */
export async function decideAgentRun(
  runId: string,
  decision: "approve" | "reject",
  sessionToken?: string,
): Promise<AgentRunView>;
export async function decideAgentRun(
  runId: string,
  decision: "edit",
  editedArgs: Readonly<Record<string, unknown>>,
  sessionToken?: string,
): Promise<AgentRunView>;
export async function decideAgentRun(
  runId: string,
  decision: "approve" | "edit" | "reject",
  editedArgsOrSessionToken?: Readonly<Record<string, unknown>> | string,
  maybeSessionToken?: string,
): Promise<AgentRunView> {
  const editedArgs = decision === "edit"
    ? (editedArgsOrSessionToken as Readonly<Record<string, unknown>>)
    : undefined;
  const sessionToken = decision === "edit"
    ? maybeSessionToken
    : (editedArgsOrSessionToken as string | undefined);
  return apiRequest<AgentRunView>(
    wave2Runtime.operations.decideAgentRun.path.replace(":runId", encodeURIComponent(runId)),
    {
      method: "POST",
      body: decision === "edit" ? { decision, editedArgs } : { decision },
      sessionToken,
    },
  );
}

export type AgentRunContextSnapshotView = z.infer<
  typeof wave2Runtime.operations.getAgentRunContextSnapshot.out
>;

/**
 * context-engine 可用性补口——`AgentRunContextSnapshotView` 可空：`null` = 这个 run
 * 你能看，只是还没有快照（早于 F157 上线，或组装从未走到写快照那一步）。同
 * `getAgentRun` 一条既有纪律：只把服务端原样交出去，读不到（403/404）就报错，
 * 不在客户端编一份假快照。
 */
export async function getAgentRunContextSnapshot(
  runId: string,
  sessionToken?: string,
): Promise<AgentRunContextSnapshotView> {
  return apiRequest<AgentRunContextSnapshotView>(
    wave2Runtime.operations.getAgentRunContextSnapshot.path.replace(":runId", encodeURIComponent(runId)),
    { method: "GET", sessionToken },
  );
}

/** Minimal shape `findPendingRunId` needs from a persisted `chat_messages` row. */
export interface PendingRunLookupMessage {
  readonly id: string;
  readonly authorKind: "human" | "agent";
  readonly agentRunId: string | null;
  readonly replyToMessageId: string | null;
}

/**
 * session-switch task-state-loss fix —— 一条会话切走再切回（组件重挂载、内存态
 * 全丢）之后，「上一轮 run 有没有跑完」这件事只有已落库的消息还留着痕迹：最新一条
 * 带 `agentRunId` 的人类消息，如果还没有任何消息的 `replyToMessageId` 指回它，说明
 * 这个 run 大概率还没写回终态（服务端权威状态仍需用返回的 runId 去
 * `getAgentRun` 核实——这里只找 id，不猜状态）。
 *
 * 与旧轨道 `chat-live-message-panel.tsx`（issue #1805，约 `loadPage` 内
 * `mode === "replace"` 分支）判定同一件事、同一条规则——那份实现更早、绑定在那个
 * 组件的内部状态机里不易独立复用，这里为新调用方（copilotkit-v2 轨道的挂载
 * hydration）单独抽出，逻辑不得与那份实现产生第二个版本（发现两者行为需要不一致
 * 时先改这里的规则，不要在调用方另写一份判断）。
 *
 * `messages` 必须按时间顺序（旧→新）传入——与 `listMessages` 分页读回的自然顺序
 * 一致，调用方不需要额外排序。
 */
export function findPendingRunId(messages: readonly PendingRunLookupMessage[]): string | null {
  const lastHuman = [...messages].reverse()
    .find((m) => m.authorKind === "human" && m.agentRunId !== null);
  if (lastHuman === undefined) return null;
  const alreadyReplied = messages.some((m) => m.replyToMessageId === lastHuman.id);
  return alreadyReplied ? null : lastHuman.agentRunId;
}
