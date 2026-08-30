"use client";
import * as React from "react";
import { ApiError } from "./api-client";
import { getAgentRun, isTerminalRunStatus } from "./agent-run";

/**
 * session-switch task-state-loss fix —— copilotkit-v2 轨道的 run 状态是纯内存态，
 * 绑定在挂载时随机生成的 `threadId` 上（`copilotkit-v2-panel.tsx` 里
 * `useAgent({ threadId: crypto.randomUUID() 生成的临时 id })`）。用户提交任务后切到
 * 另一个会话再切回来，这条路由级重挂载会把内存里的 `agent.isRunning`/流式内容
 * 连同 SSE 连接一起丢掉，挂载时的 hydration 又只回读已落库消息、不知道"上一轮有没有
 * 一个还没写回的 run"——参见 `copilotkit-v2-panel.tsx` 挂载 hydration effect 头注。
 *
 * 这个 hook 补上缺失的一环：调用方（挂载 hydration）用
 * `findPendingRunId`（`lib/agent-run.ts`）从已落库消息里找出"可能还没写回"的
 * runId，交给这里轮询服务端真实状态（`GET /agent-runs/:runId`，与旧轨道
 * `chat-live-message-panel.tsx` 同一个只读端点、同一条"只轮询不猜测终态"的纪律，
 * 见 `lib/agent-run.ts` 文件头）。轮询到终态后调用方重读一次持久化消息，把服务端
 * 已经写回的助手回复（或错误）捞回来——这个 hook 本身**不**合成任何回复内容，
 * 只负责把"这个 run 还没完事"这件事重新变得可见。
 *
 * 若这个 runId 其实早就是终态（用户切回来的时候后端已经写完了），第一次轮询就会
 * 发现并立即结束，只多打一次 GET，不会产生错误状态——与旧轨道同一条既有纪律
 * （`chat-live-message-panel.tsx:594` 头注）。
 */

/** 与 `chat-live-message-panel.tsx` 的 `RUN_POLL_*` 同一组取值——两条轨道各自独立
 *  轮询同一类端点，调参数不是"同一事实声明两处"，是两处各自的退避策略。 */
const RESTORE_POLL_FIRST_DELAY_MS = 400;
const RESTORE_POLL_BACKOFF = 1.5;
const RESTORE_POLL_MAX_DELAY_MS = 3_000;
const RESTORE_POLL_BUDGET_MS = 20 * 60_000;

export interface RunRestoreState {
  /** 正在向服务端核实这个 run 是否已经跑完；`true` 时调用方应显示"生成中"一类指示。 */
  readonly isRestoring: boolean;
}

/** `isRestoring` 为真时展示的阶段文案——单一事实源，调用方不要另写一份措辞。 */
export const RUN_RESTORE_PHASE_LABEL = "正在恢复上次未完成的任务…";

/**
 * @param pendingRunId 待核实的 runId；`null` = 没有待恢复的 run，什么都不做。
 * @param sessionToken 与其它 run 相关调用同一个 bearer（`getStoredSessionToken()`）。
 * @param onSettled 轮询到终态时调用一次——调用方据此重读持久化消息、把写回的内容
 *   合并进当前视图。用 `useRef` 持有，不要求调用方 memoize。
 */
export function useCopilotKitV2RunRestore(
  pendingRunId: string | null,
  sessionToken: string | undefined,
  onSettled: () => void,
): RunRestoreState {
  const onSettledRef = React.useRef(onSettled);
  onSettledRef.current = onSettled;
  const [isRestoring, setIsRestoring] = React.useState(pendingRunId !== null);

  React.useEffect(() => {
    if (pendingRunId === null) {
      setIsRestoring(false);
      return;
    }
    setIsRestoring(true);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + RESTORE_POLL_BUDGET_MS;

    const poll = async (delay: number): Promise<void> => {
      if (cancelled) return;
      try {
        const view = await getAgentRun(pendingRunId, sessionToken);
        if (cancelled) return;
        if (isTerminalRunStatus(view.status)) {
          setIsRestoring(false);
          onSettledRef.current();
          return;
        }
      } catch (failure) {
        if (cancelled) return;
        // 与旧轨道同一条纪律（`chat-live-message-panel.tsx:661-667`）：401 是不可恢复
        // 的（bearer 已过期），退避重试不会让它变好，立即停止；其它读失败（网络抖动/
        // 503）不终止轮询——run 在服务端可能还在跑，预算耗尽才停。
        if (failure instanceof ApiError && failure.status === 401) {
          setIsRestoring(false);
          return;
        }
      }
      if (Date.now() >= deadline) {
        setIsRestoring(false);
        return;
      }
      timer = setTimeout(
        () => void poll(Math.min(delay * RESTORE_POLL_BACKOFF, RESTORE_POLL_MAX_DELAY_MS)),
        delay,
      );
    };

    timer = setTimeout(() => void poll(RESTORE_POLL_FIRST_DELAY_MS), 0);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [pendingRunId, sessionToken]);

  return { isRestoring };
}
