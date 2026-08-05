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

/**
 * run 的**终态**集合，唯一事实源取自契约的状态机
 * （`wave2-runtime.ts:110-112` 的枚举 + `20260805110000_wave2_agent_run_execution.sql:46-64`
 * 的转移触发器：`queued → running → writeback_pending → succeeded`，`failed` 可从
 * 任一非终态进入，终态不再离开）。
 *
 * ⚠ 轮询必须在这里停。把 `writeback_pending` 也当终态是错的：#413 的写回正是在
 * 那个状态下才发生，提前停轮询会让「恰好一条回复」在界面上永远不出现。
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set<AgentRunStatus>(["succeeded", "failed"]);

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export async function getAgentRun(
  runId: string,
  sessionToken?: string,
): Promise<AgentRunView> {
  return apiRequest<AgentRunView>(
    wave2Runtime.operations.getAgentRun.path.replace(":runId", encodeURIComponent(runId)),
    { method: "GET", sessionToken },
  );
}
