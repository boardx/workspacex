"use client";
import * as React from "react";
import { getAgentRun } from "./agent-run";
import type { AgentKernelRunStatus } from "./agent-kernel-stream";

/**
 * issue #2774 —— `/chat` 宿主要把四选一工具权限卡（`ToolPermissionCard`）接到真实数据，
 * 需要在 `status === "awaiting_tool_permission"` 时知道"待批的是哪个工具、参数摘要是
 * 什么"。`runId`/`status` 本身复用 `useChatHostInterjectionRun`（issue #2756）已经建好的
 * 同一条订阅——不再为工具权限开第二条 WS 连接，见该 hook 自己"两条路径、一条 socket"
 * 一节；本文件只负责 `status_change` 事件本身不携带的那一部分（工具名/参数摘要）。
 *
 * ## 为什么要另发一次 `getAgentRun`，而不是等 `status_change` 带出来
 *
 * `KernelStreamEvent` 的 `status_change`（`streaming-transport.ts`）形状是
 * `{type, runId, seq, status, pausedBy, emittedAt}`——没有工具名/参数字段。真正带着这份
 * 数据的是 `AgentRunView.pendingApproval`（wave2-runtime 契约，DA-07b 时代就有，供旧
 * 审批条使用），只能通过既有的 `GET /agent-runs/:runId`（`getAgentRun`）读到。两次都是
 * 只读轮询，不新起一条写路径。
 *
 * ⚠ 后端目前只落 `toolName` + 有上限的 `argsSummary`（`ports.ts` `pendingApproval` 字段
 * 自己的文档），没有逐次调用的具体 intent/rationale/toolCallId——`chat-host-tool-
 * permission.tsx` 对这一半如实用通用文案兜底，不是本文件能补全的缺口。
 */
export interface ChatHostPendingToolPermission {
  readonly toolName: string;
  readonly argsSummary: string | null;
}

/** 落库行与状态事件之间的时序缝隙允许的重试：次数有界、毫秒级退避（同
 *  `chat-host-interjection-run.ts` 的 `RESOLVE_RUN_ID_MAX_ATTEMPTS` 同一条纪律）。 */
const RESOLVE_MAX_ATTEMPTS = 3;
const RESOLVE_RETRY_DELAY_MS = 400;

export function useChatHostPendingToolPermission(input: {
  readonly runId: string | null;
  readonly status: AgentKernelRunStatus | null;
  readonly sessionToken: string | null;
}): ChatHostPendingToolPermission | null {
  const { runId, status, sessionToken } = input;
  const [pending, setPending] = React.useState<ChatHostPendingToolPermission | null>(null);

  React.useEffect(() => {
    if (status !== "awaiting_tool_permission" || runId === null) {
      setPending(null);
      return;
    }
    let cancelled = false;
    (async () => {
      for (let attempt = 1; attempt <= RESOLVE_MAX_ATTEMPTS; attempt += 1) {
        try {
          const view = await getAgentRun(runId, sessionToken ?? undefined);
          if (cancelled) return;
          if (view.pendingApproval) {
            setPending({
              toolName: view.pendingApproval.toolName,
              argsSummary: view.pendingApproval.argsSummary,
            });
            return;
          }
        } catch {
          // 读失败与读到空同样处理：有限次重试，耗尽就如实不渲染卡片——不拿假数据顶上。
        }
        if (cancelled) return;
        if (attempt < RESOLVE_MAX_ATTEMPTS) {
          await new Promise((resolve) => { setTimeout(resolve, RESOLVE_RETRY_DELAY_MS); });
        }
      }
      if (!cancelled) setPending(null);
    })();
    return () => { cancelled = true; };
  }, [runId, status, sessionToken]);

  return pending;
}
