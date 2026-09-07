"use client";
import * as React from "react";
import { ApiError } from "./api-client";
import { getAgentRun, isTerminalRunStatus as isTerminalWave2RunStatus, type AgentRunView } from "./agent-run";
import {
  useAgentKernelRunStream, isTerminalRunStatus,
  type AgentKernelRunStatus, type KernelStreamEvent, type ReconnectState,
} from "./agent-kernel-stream";

/**
 * session-switch task-state-loss fix —— copilotkit-v2 轨道的 run 状态是纯内存态，
 * 绑定在挂载时随机生成的 `threadId` 上（`copilotkit-v2-panel.tsx` 里
 * `useAgent({ threadId: crypto.randomUUID() 生成的临时 id })`）。用户提交任务后切到
 * 另一个会话再切回来，这条路由级重挂载会把内存里的 `agent.isRunning`/流式内容
 * 连同订阅一起丢掉，挂载时的 hydration 又只回读已落库消息、不知道"上一轮有没有
 * 一个还没写回的 run"——参见 `copilotkit-v2-panel.tsx` 挂载 hydration effect 头注。
 *
 * 这个 hook 补上缺失的一环：调用方（挂载 hydration）用
 * `findPendingRunId`（`lib/agent-run.ts`）从已落库消息里找出"可能还没写回"的
 * runId，交给这里核实服务端真实状态。
 *
 * Phase 14 F04（R6 后置条件）—— 核实机制不再是"20 分钟轮询预算 + gave-up 兜底"：
 * 本文件订阅 `agent-kernel-stream.ts` 的真实 WebSocket 事件流
 * （`streaming-transport.ts` UC-1 `subscribeRunEvents`），收到该 run 的终态
 * `status_change` 事件后，做**一次**确认性的 `getAgentRun` 读（把服务端已经写回的
 * `resultMessageId`/`error` 捞出来——推流本身只带状态，不带这些字段，见 R7"落库与
 * 推流解耦"）。事件发布是 fire-and-forget、不等落库事务提交完成（I-3），所以这次确认
 * 读允许对"仍读到非终态"做几次很短的重试（有界次数，毫秒级退避），这不是旧机制的
 * "时间预算"——旧机制的问题是允许无限期地假装还有希望；这里的重试只是在弥合"事件先到、
 * 落库随后完成"这一条已知的时序缝隙，几次之内必然收敛。
 *
 * 连接层面的失败（断线重连次数耗尽、鉴权过期）都不再"安静地卡住"：见下方
 * `RunRestoreOutcome`。
 *
 * ## issue #2825（2026-09-06 devapp 真实用户复现）—— 事件流不是"这个 run 现在是什么
 * 状态"的完整来源，只是"从现在起还会发生什么"
 *
 * 复现：提交任务 → 切到别的会话 → 过一会儿切回来。这一路"正在恢复上次未完成的任务…"
 * 一直转，最后落到 `gave-up` 的"长时间未能确认…请稍后刷新页面查看"，而实际上那条
 * 助手回复早就写回落库了——刷新一下就能看见。
 *
 * 根因：上面那套机制**只**在收到一条终态 `status_change` 时才结束核实。而用户切走的
 * 那段时间里 run 已经跑完了：订阅建立时它已是终态，**未来不会再有任何事件**。事件流
 * 的重放缓冲区（`InMemoryRunEventBus`）只在同一个 API 进程活着、且这个 run 还没被
 * `MAX_TRACKED_RUNS` 挤出去时才补得上那条历史事件——进程重启过、跑了别的两千个 run、
 * 或将来换成多进程部署，重放就是空的，于是这里永远等不到那条事件。这不是连接问题，
 * 重连再多次也没用。
 *
 * 修法：**订阅之前先向服务端问一次"它现在是什么状态"**（`getAgentRun`，与确认性读
 * 同一个端点、同一条只读纪律）。已经是终态 ⇒ 立刻 `settled` 收尾，事件流根本不需要
 * 参与；仍是非终态 ⇒ 才交给事件流等后续变化。同理，连接层面撑不住准备放弃时，也先
 * 补一次这样的读——run 在这期间跑完是常态，"没能确认"应当是真的没能确认，而不是
 * "我只肯听事件流"。这**不是**把旧轮询搬回来：读的次数是有界且与时间无关的
 * （开始一次、放弃前一次、终态事件后的确认读若干次），没有任何"时间预算"。
 */

export interface RunRestoreState {
  /** 正在向服务端核实这个 run 是否已经跑完；`true` 时调用方应显示"生成中"一类指示。 */
  readonly isRestoring: boolean;
  /** 断线重连提示状态（R4 E2）。`null` = 至今未曾断线，不需要展示任何提示。 */
  readonly reconnectState: ReconnectState | null;
  /**
   * issue #2756 —— 正在核实的那个 run 的真实 `agent_runs.id`（核实结束后为 `null`），
   * 以及这条订阅上最近一次 `status_change` 带来的状态（还没收到任何状态事件时为
   * `null`，不编一个默认值）。`/chat` 宿主的插话入口（`chat-host-interjection-run.ts`）
   * 用它们在「切回来的在途 run」上开放插话——同一条 socket、同一份事件，不为插话
   * 再开第二条订阅。
   */
  readonly runId: string | null;
  readonly status: AgentKernelRunStatus | null;
}

/** `isRestoring` 为真时展示的阶段文案——单一事实源，调用方不要另写一份措辞。 */
export const RUN_RESTORE_PHASE_LABEL = "正在恢复上次未完成的任务…";

/**
 * 2026-08-30（devapp 真实用户复现修复的另一半）—— 这个 hook 的 `onSettled` 把"轮询是
 * 怎么结束的"如实带出去：`settled`（读到终态，`view.status` 可能是 `succeeded` 也可能是
 * `failed`，调用方据此决定要不要显示错误）或 `gave-up`（没能确认——连接层面撑不住，或
 * 鉴权已过期，如实说"没能确认"，不猜测结果是成功还是失败）。
 */
export type RunRestoreOutcome =
  | { readonly kind: "settled"; readonly view: AgentRunView }
  | { readonly kind: "gave-up"; readonly reason: "connection-lost" | "auth-expired" | "stalled" };

/**
 * issue #2860 —— 权威读读到"还在跑"之后不再只等事件流：每 RESTORE_POLL_INTERVAL_MS 再
 * 权威读一次，最多 RESTORE_POLL_MAX_MS。服务端幽灵 run 的收敛窗口是
 * `DEFAULT_STALE_RUNNING_THRESHOLD_MS`（2 分钟）+ 回收器周期（1 分钟），这里给 3.5 分钟：
 * 正常情况下回收先发生、这里读到 `failed(RUN_INTERRUPTED)` 走 settled；到点仍非终态才
 * 如实报 `stalled`（run 可能真的还在跑，不冒充失败）。
 */
const RESTORE_POLL_INTERVAL_MS = 5_000;
const RESTORE_POLL_MAX_MS = 210_000;

/** 确认性读的重试预算——有界次数、毫秒级退避，弥合"事件先到、落库随后完成"的时序缝隙
 *  （I-3），不是旧机制那种以分钟计的"轮询预算"。 */
const CONFIRM_TERMINAL_MAX_ATTEMPTS = 5;
const CONFIRM_TERMINAL_RETRY_DELAY_MS = 400;

/**
 * @param pendingRunId 待核实的 runId；`null` = 没有待恢复的 run，什么都不做。
 * @param sessionToken 与其它 run 相关调用同一个 bearer（`getStoredSessionToken()`）。
 * @param onSettled 核实结束（读到终态，或连接层面撑不住放弃）时调用一次——调用方据此
 *   重读持久化消息、把写回的内容合并进当前视图，或如实展示"没能确认"。用 `useRef`
 *   持有，不要求调用方 memoize。
 */
export function useCopilotKitV2RunRestore(
  pendingRunId: string | null,
  sessionToken: string | undefined,
  onSettled: (outcome: RunRestoreOutcome) => void,
): RunRestoreState {
  const onSettledRef = React.useRef(onSettled);
  onSettledRef.current = onSettled;
  const [isRestoring, setIsRestoring] = React.useState(pendingRunId !== null);
  const [status, setStatus] = React.useState<AgentKernelRunStatus | null>(null);
  const settledRef = React.useRef(false);
  const sessionTokenRef = React.useRef(sessionToken);
  sessionTokenRef.current = sessionToken;

  React.useEffect(() => {
    settledRef.current = false;
    setIsRestoring(pendingRunId !== null);
    setStatus(null);
  }, [pendingRunId]);

  const confirmTerminal = React.useCallback(async (runId: string) => {
    for (let attempt = 1; attempt <= CONFIRM_TERMINAL_MAX_ATTEMPTS; attempt += 1) {
      try {
        const view = await getAgentRun(runId, sessionTokenRef.current);
        if (isTerminalWave2RunStatus(view.status) || attempt === CONFIRM_TERMINAL_MAX_ATTEMPTS) {
          setIsRestoring(false);
          onSettledRef.current({ kind: "settled", view });
          return;
        }
        // 事件先于落库到达（I-3）：这次读还没看到终态，短暂等一下再确认一次。
      } catch (failure) {
        // 与旧机制同一条纪律：401 是不可恢复的（bearer 已过期），立即停止，不重试。
        if (failure instanceof ApiError && failure.status === 401) {
          setIsRestoring(false);
          onSettledRef.current({ kind: "gave-up", reason: "auth-expired" });
          return;
        }
        if (attempt === CONFIRM_TERMINAL_MAX_ATTEMPTS) {
          setIsRestoring(false);
          onSettledRef.current({ kind: "gave-up", reason: "connection-lost" });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_TERMINAL_RETRY_DELAY_MS));
    }
  }, []);

  /**
   * issue #2825 —— 放弃之前的最后一次权威读：读到终态就如实 `settled`（用户切走期间
   * run 跑完是常态），读不到才是真的"没能确认"。
   */
  const settleWithFinalRead = React.useCallback(async (runId: string) => {
    try {
      const view = await getAgentRun(runId, sessionTokenRef.current);
      if (view.status === "paused" || view.status === "awaiting_tool_permission") {
        settledRef.current = false;
        setStatus(view.status);
        setIsRestoring(false);
        return;
      }
      if (isTerminalWave2RunStatus(view.status)) {
        setIsRestoring(false);
        onSettledRef.current({ kind: "settled", view });
        return;
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setIsRestoring(false);
        onSettledRef.current({ kind: "gave-up", reason: "auth-expired" });
        return;
      }
    }
    setIsRestoring(false);
    onSettledRef.current({ kind: "gave-up", reason: "connection-lost" });
  }, []);

  /**
   * issue #2825 —— 订阅之前先问一次"它现在是什么状态"。见文件头注：run 在用户切走
   * 期间跑完时，事件流未来不会再有任何事件，只等事件就是等一个永远不来的东西。
   * 读到非终态（真的还在跑）或读失败，都交给事件流继续，不在这里编造结果。
   */
  React.useEffect(() => {
    if (pendingRunId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const view: AgentRunView = await getAgentRun(pendingRunId, sessionTokenRef.current);
        if (cancelled || settledRef.current) return;
        setStatus(isTerminalWave2RunStatus(view.status) ? null : (view.status as AgentKernelRunStatus));
        setIsRestoring(view.status !== "paused" && view.status !== "awaiting_tool_permission");
        if (isTerminalWave2RunStatus(view.status)) {
          settledRef.current = true;
          setIsRestoring(false);
          onSettledRef.current({ kind: "settled", view });
          return;
        }
      } catch {
        // 读不到就交给事件流 + 下面的有界复读继续，不在这里编造结果。
      }
      // issue #2860 —— 非终态：事件流可能永远不来（重启后回放缓冲为空），有界复读兜底。
      let startedAt = Date.now();
      while (!cancelled && !settledRef.current && Date.now() - startedAt < RESTORE_POLL_MAX_MS) {
        await new Promise((resolve) => setTimeout(resolve, RESTORE_POLL_INTERVAL_MS));
        if (cancelled || settledRef.current) return;
        try {
          const view: AgentRunView = await getAgentRun(pendingRunId, sessionTokenRef.current);
          if (cancelled || settledRef.current) return;
          setStatus(isTerminalWave2RunStatus(view.status) ? null : (view.status as AgentKernelRunStatus));
          const waitingForUser = view.status === "paused" || view.status === "awaiting_tool_permission";
          setIsRestoring(!waitingForUser);
          if (waitingForUser) startedAt = Date.now();
          if (!isTerminalWave2RunStatus(view.status)) continue;
          settledRef.current = true;
          setIsRestoring(false);
          onSettledRef.current({ kind: "settled", view });
          return;
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 401) {
            settledRef.current = true;
            setIsRestoring(false);
            onSettledRef.current({ kind: "gave-up", reason: "auth-expired" });
            return;
          }
        }
      }
      if (cancelled || settledRef.current) return;
      settledRef.current = true;
      setIsRestoring(false);
      onSettledRef.current({ kind: "gave-up", reason: "stalled" });
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingRunId]);

  const handleEvent = React.useCallback((event: KernelStreamEvent) => {
    if (settledRef.current) return;
    if (event.type !== "status_change") return;
    // issue #2756 —— 非终态的状态变化同样如实带出去（`running` ↔ `awaiting_*`/`paused`），
    // 插话入口只对 `running` 开放；终态一到即置 `null`，下面随即结束核实。
    setStatus(isTerminalRunStatus(event.status) ? null : event.status);
    setIsRestoring(event.status !== "paused" && event.status !== "awaiting_tool_permission");
    if (!isTerminalRunStatus(event.status)) return;
    settledRef.current = true;
    void confirmTerminal(event.runId);
  }, [confirmTerminal]);

  const stream = useAgentKernelRunStream(
    settledRef.current ? null : pendingRunId,
    sessionToken,
    handleEvent,
  );

  React.useEffect(() => {
    if (pendingRunId === null || settledRef.current) return;
    if (stream.reconnectState !== "failed") return;
    settledRef.current = true;
    void settleWithFinalRead(pendingRunId);
  }, [stream.reconnectState, pendingRunId, settleWithFinalRead]);

  const active = pendingRunId !== null && !settledRef.current;
  return {
    isRestoring,
    reconnectState: active ? stream.reconnectState : null,
    runId: active ? pendingRunId : null,
    status: active ? status : null,
  };
}
