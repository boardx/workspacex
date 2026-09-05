"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { readAllPersistedMessages } from "./copilotkit-v2-persisted-messages";
import {
  useAgentKernelRunStream, isTerminalRunStatus,
  type AgentKernelRunStatus, type KernelStreamEvent,
} from "./agent-kernel-stream";

/**
 * issue #2756（Phase 14 后续 B）—— `/chat` 宿主（`CopilotKitV2PanelBody`）把中途插话
 * 入口接到**真实** run 上所需的两样东西：这一轮在途 run 的真实 `agent_runs.id`，和它
 * 此刻的内核状态（`AgentKernelRunStatus`）。F12 做出来的 `InterjectionComposer` 只认
 * 这两个 props；宿主此前一样都拿不到，所以真实用户在 /chat 里从没见过插话框。
 *
 * ## 为什么 runId 要去读落库消息，而不是 AG-UI 的 `RUN_STARTED.runId`
 *
 * AG-UI wire 上的 `threadId`/`runId` 是**客户端**的 correlation id（`HttpAgent` 自己造的，
 * 服务端逐字回显——`copilotkit-agui.controller.ts` 文件头「threadId / runId」一节），
 * 不是 `agent_runs.id`；`CUSTOM` 事件今天只回显 `chat_thread_id` / `chat_message_id` /
 * `run_phase`，没有一条带真实 runId。宿主已经在用的唯一真实来源是落库消息：最新一条
 * 带 `agentRunId` 且尚未被回复的人类消息（`findPendingRunId`，`readAllPersistedMessages`
 * 顺手投影出来的 `pendingRunId`）。桥接层在 `onStarted`（发 `RUN_STARTED`）之前已经
 * `acceptHumanMessage`（`agui-bridge.ts`，`accepted.agentRunId` 先于 `onStarted`），所以
 * `RUN_STARTED` + `chat_thread_id` 到达时这一行已经在库里。读不到（时序缝隙）就短暂
 * 重试有限次；仍读不到就如实不渲染入口，不拿 correlation id 顶上。
 *
 * 更干净的做法是桥接层多发一条 `CUSTOM {name:"agent_run_id"}`——那要改 `agui-bridge.ts`
 * 的 `onStarted` 签名（跨束已签核文件），不在本 issue「纯 apps/web」范围内。
 *
 * ## 为什么 status 要订阅 WS 事件流，而不是 `GET /agent-runs/:runId`
 *
 * `getAgentRun` 返回的是 wave2 `AgentRunStatus`（含 `writeback_pending`），与
 * `AgentKernelRunStatus` 是两份独立声明，硬转是第二份映射。`agent-kernel-stream.ts`
 * 的 `status_change` 事件本身就是 `AgentKernelRunStatus`，且网关对新订阅从头回放
 * （`serve(..., lastKnownSeq ?? -1)`），连上即可拿到当前状态；之后 `running` ↔
 * `awaiting_tool_permission`/`paused` 的每次变化都实时到达——契约只对 `running` 开放
 * 插话，入口随之开合，不靠客户端猜。
 *
 * ## 两条路径、一条 socket
 *
 * - **在途路径**（本次挂载里用户刚发的一轮）：`RUN_STARTED` → 读落库消息取 runId →
 *   本 hook 自己订阅事件流取 status。
 * - **恢复路径**（切走再切回，`useCopilotKitV2RunRestore` 正在核实上一轮 run）：那个
 *   hook 已经订阅了同一个 run 的事件流，本 hook 直接用它带出来的 `runId`/`status`，
 *   不为同一个 run 开第二条 socket。
 */

export interface ChatHostInterjectionRun {
  /** 当前可插话的 run 的真实 `agent_runs.id`；没有在途 run、或还没解析出来时为 `null`。 */
  readonly runId: string | null;
  /** 该 run 最近一次 `status_change` 的状态；还没收到任何状态事件时为 `null`。 */
  readonly status: AgentKernelRunStatus | null;
}

/** 落库行与 `RUN_STARTED` 之间的时序缝隙（I-3 同类）允许的重试：次数有界、毫秒级退避。 */
const RESOLVE_RUN_ID_MAX_ATTEMPTS = 3;
const RESOLVE_RUN_ID_RETRY_DELAY_MS = 400;

export function useChatHostInterjectionRun(input: {
  readonly agent: AbstractAgent;
  /** `agent.isRunning`——AG-UI 这次挂载上是否有一轮在途 run。 */
  readonly isRunning: boolean;
  /** 已解析的真实 Chat 线程 id（`resolvedChatThreadId`）；`null` = 还没有。 */
  readonly threadId: string | null;
  readonly sessionToken: string | null;
  /** `useCopilotKitV2RunRestore` 带出来的恢复路径 run（同一条订阅，不再开第二条）。 */
  readonly restore: { readonly runId: string | null; readonly status: AgentKernelRunStatus | null };
}): ChatHostInterjectionRun {
  const { agent, isRunning, threadId, sessionToken, restore } = input;
  const [liveRunId, setLiveRunId] = React.useState<string | null>(null);
  const [liveStatus, setLiveStatus] = React.useState<AgentKernelRunStatus | null>(null);
  /** 每次 `RUN_STARTED` 自增，驱动下面的解析 effect 重跑（同一 threadId 上的第二轮）。 */
  const [runStartedNonce, setRunStartedNonce] = React.useState(0);

  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => {
        setLiveRunId(null);
        setLiveStatus(null);
        setRunStartedNonce((n) => n + 1);
      },
      // 终态：入口随之收起——上一轮的 runId 留着只会做出一个点了必 409 的输入框。
      onRunFinishedEvent: () => {
        setLiveRunId(null);
        setLiveStatus(null);
      },
      onRunErrorEvent: () => {
        setLiveRunId(null);
        setLiveStatus(null);
      },
    });
    return unsubscribe;
  }, [agent]);

  React.useEffect(() => {
    if (runStartedNonce === 0 || !isRunning || threadId === null || liveRunId !== null) return;
    let cancelled = false;
    (async () => {
      for (let attempt = 1; attempt <= RESOLVE_RUN_ID_MAX_ATTEMPTS; attempt += 1) {
        let resolved: string | null = null;
        try {
          resolved = (await readAllPersistedMessages(threadId, sessionToken ?? undefined)).pendingRunId;
        } catch {
          // 读失败与读到 null 同样处理：有限次重试，耗尽就如实不渲染入口。
        }
        if (cancelled) return;
        if (resolved !== null) {
          setLiveRunId(resolved);
          return;
        }
        if (attempt < RESOLVE_RUN_ID_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RESOLVE_RUN_ID_RETRY_DELAY_MS));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [runStartedNonce, isRunning, threadId, sessionToken, liveRunId]);

  // AG-UI 侧已经不在跑（`isRunning` 回落）时不再持有 runId——与上面终态事件是同一
  // 件事的两个真实来源，任一先到都收起入口。
  React.useEffect(() => {
    if (!isRunning) {
      setLiveRunId(null);
      setLiveStatus(null);
    }
  }, [isRunning]);

  const handleEvent = React.useCallback((event: KernelStreamEvent) => {
    if (event.type !== "status_change") return;
    setLiveStatus(isTerminalRunStatus(event.status) ? null : event.status);
  }, []);

  useAgentKernelRunStream(liveRunId, sessionToken ?? undefined, handleEvent);

  if (liveRunId !== null) return { runId: liveRunId, status: liveStatus };
  return { runId: restore.runId, status: restore.status };
}
