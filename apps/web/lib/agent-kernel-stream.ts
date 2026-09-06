/**
 * Phase 14 F04 —— streaming-transport 契约束（UC-1 `subscribeRunEvents`）的前端消费端。
 *
 * 这是 R6 后置条件里"前端订阅改造"的核心机件：一条真实 WebSocket 连接，替代
 * `copilotkit-v2-run-restore.ts` 此前的 REST 轮询恢复机制。与 `lib/live-asr.ts`/
 * `lib/live-asr-draft.ts` 同一条既有纪律——bearer 走 Sec-WebSocket-Protocol 子协议
 * （前缀取自契约 `streaming-transport.ts` 的 `operations.subscribeRunEvents.
 * bearerSubprotocolPrefix`，不各写一份字面量），握手用 `waitForSocketOpen` 兜底
 * "既不 open 也不 error"的半开连接（见该函数头注 #753）。
 *
 * ## 状态机口径：直接复用契约，不重新声明
 *
 * `AgentKernelRunStatus`/`isTerminalRunStatus`/`AGENT_KERNEL_TERMINAL_STATUSES` 全部
 * 从 `@repo/contracts` 原样转发。这是它们唯一的事实源——本文件不重复定义"哪些状态是
 * 终态"这件事（domain.md I-1）。
 *
 * ## 断线重连（R4 E2）
 *
 * 连接在读到终态 `status_change` 之前意外关闭 ⇒ 有限次数内退避重连，携带已收到的
 * 最大 `seq` 作为 `lastKnownSeq`，网关据此只补发断点之后的事件（I-4，不丢不重复）。
 * `reconnectState`（`reconnecting`/`restored`/`failed`）供 `ReconnectToast` 渲染；
 * `restored` 展示一段时间后自动清空（`null`），不需要用户操作（R8）；重连次数耗尽 ⇒
 * `failed`，不再自动重试，界面提示"连接中断，请手动刷新"。
 *
 * 这里的重连预算是**次数**（`MAX_RECONNECT_ATTEMPTS`），不是像旧轮询那样的
 * **时间**（20 分钟）——旧机制的问题从来不是"轮询"本身，是"允许无限期地假装还有希望"；
 * 有限次数的重连没有这个问题：连接层面的失败通常在几次尝试内就能看出"能不能恢复"。
 *
 * ## `disconnects`：把"这条连接刚断了一次"如实告诉调用方（issue #2825 性能重设计）
 *
 * `reconnectState` 回答的是"要不要给用户看重连提示"，它在整个退避过程中一直停在
 * `"reconnecting"` 这一个值上——**同一个值不会再次触发调用方的 effect**，所以调用方
 * 无法用它区分"断了第 1 次"和"断了第 4 次"。`disconnects` 是一个单调递增的计数：
 * 每一次**非主动**关闭 +1。
 *
 * 它存在的唯一理由，是让调用方（`copilotkit-v2-run-restore.ts`）能在**每一次断开的
 * 那一刻**去做一次权威读，而不是干等整个重连预算跑完（实测：那样要 12 秒才能看到
 * 已经跑完的结果，见该文件 issue #2825 那节头注）。这不是把轮询搬回来——读的次数被
 * 重连**次数**上界（`MAX_RECONNECT_ATTEMPTS`）夹住，与时间无关。
 */
import * as React from "react";
import { z } from "zod";
import { streamingTransport as ST } from "@repo/contracts";
import { apiWebSocketUrl, waitForSocketOpen } from "./api-client";

export type AgentKernelRunStatus = z.infer<typeof ST.AgentKernelRunStatus>;
export type KernelStreamEvent = z.infer<typeof ST.KernelStreamEvent>;
export type ReconnectState = z.infer<typeof ST.ReconnectState>;

/** 单一事实源转发——不在本文件重新判断"哪些状态是终态"（domain.md I-1）。 */
export const isTerminalRunStatus = ST.isTerminalRunStatus;
export const AGENT_KERNEL_TERMINAL_STATUSES = ST.AGENT_KERNEL_TERMINAL_STATUSES;

const BEARER_PREFIX = ST.operations.subscribeRunEvents.bearerSubprotocolPrefix;

function eventsPath(runId: string, lastKnownSeq: number | null): string {
  const base = ST.operations.subscribeRunEvents.path.replace(":runId", encodeURIComponent(runId));
  return lastKnownSeq === null ? base : `${base}?lastKnownSeq=${lastKnownSeq}`;
}

/**
 * 打开一条到 `runId` 的事件订阅。原样转发解析成功的 `KernelStreamEvent`；解析失败的帧
 * 只调用 `onProtocolError`，不猜测语义（与 `live-asr.ts` 同一条纪律）。
 *
 * 返回的 `close()` 是"我方主动关闭"——调用方用它跟"连接意外断开"区分开，意外断开才
 * 需要走重连状态机。
 */
export function openAgentKernelRunEvents(
  runId: string,
  lastKnownSeq: number | null,
  token: string,
  handlers: {
    readonly onEvent: (event: KernelStreamEvent) => void;
    readonly onProtocolError?: (raw: unknown) => void;
    readonly onClose: (info: { readonly intentional: boolean }) => void;
  },
  deps: { readonly createSocket?: (url: string, protocols: string[]) => WebSocket } = {},
): { readonly close: () => void } {
  let intentional = false;
  const socket = (deps.createSocket ?? ((url, protocols) => new WebSocket(url, protocols)))(
    apiWebSocketUrl(eventsPath(runId, lastKnownSeq)),
    [`${BEARER_PREFIX}${token}`],
  );

  socket.addEventListener("message", (event) => {
    const parsed = ST.KernelStreamEvent.safeParse(safeJson(String(event.data)));
    if (!parsed.success) {
      handlers.onProtocolError?.(event.data);
      return;
    }
    handlers.onEvent(parsed.data);
  });
  socket.addEventListener("close", () => handlers.onClose({ intentional }));
  socket.addEventListener("error", () => {
    // `close` 总是紧随 `error` 触发（WebSocket 规范），把收尾逻辑留给 `close` 一处，
    // 不重复调用一次 `onClose`。
  });
  // #753 同款兜底——握手只等 open/error 不够，反代路由错时连接会安静地半开着，
  // 既不 open 也不 error。超时由 `waitForSocketOpen` 主动 `socket.close()`，上面已经
  // 注册的 "close" 监听器会照常触发 `onClose`，这里只需要吞掉这个 promise 的拒绝，
  // 不重复处理一次收尾。
  void waitForSocketOpen(socket, () => new Error("agent_kernel_stream_handshake_failed")).catch(() => {});

  return {
    close: () => {
      intentional = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** 重连预算：次数有界，不是时间有界——见文件头注。 */
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_FIRST_DELAY_MS = 500;
const RECONNECT_BACKOFF = 1.7;
const RECONNECT_MAX_DELAY_MS = 8_000;
/** `restored` 提示展示多久后自动消失（R8："自动消失，不需要用户操作"）。 */
const RESTORED_TOAST_MS = 3_000;

export interface AgentKernelRunStreamState {
  /** `null` = 至今未曾断线，不需要展示任何重连提示。 */
  readonly reconnectState: ReconnectState | null;
  /**
   * 这条订阅至今**非主动**断开过多少次（单调递增，见文件头注 `disconnects` 那节）。
   * 调用方据此在"刚断开的那一刻"做一次权威读，不必等整个重连预算跑完。
   */
  readonly disconnects: number;
}

/**
 * 订阅某个 run 的事件流，带断线自动重连（R4 E2）。`runId` 为 `null` 时整个 hook 是
 * no-op（不建立任何连接），供调用方按条件挂起/收起订阅。
 */
export function useAgentKernelRunStream(
  runId: string | null,
  sessionToken: string | undefined,
  onEvent: (event: KernelStreamEvent) => void,
  deps: { readonly createSocket?: (url: string, protocols: string[]) => WebSocket } = {},
): AgentKernelRunStreamState {
  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;
  const [reconnectState, setReconnectState] = React.useState<ReconnectState | null>(null);
  const [disconnects, setDisconnects] = React.useState(0);

  React.useEffect(() => {
    if (runId === null || !sessionToken) {
      setReconnectState(null);
      setDisconnects(0);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let lastSeq: number | null = null;
    let everConnected = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let restoredTimer: ReturnType<typeof setTimeout> | null = null;
    let handle: { readonly close: () => void } | null = null;

    const connect = () => {
      if (cancelled) return;
      handle = openAgentKernelRunEvents(runId, lastSeq, sessionToken, {
        onEvent: (event) => {
          if (cancelled) return;
          if (event.seq !== undefined) lastSeq = event.seq;
          if (!everConnected) {
            everConnected = true;
          } else if (attempts > 0) {
            // 这是一次重连成功后收到的第一帧——展示"已恢复"，随后自动消失。
            attempts = 0;
            setReconnectState("restored");
            if (restoredTimer !== null) clearTimeout(restoredTimer);
            restoredTimer = setTimeout(() => {
              if (!cancelled) setReconnectState(null);
            }, RESTORED_TOAST_MS);
          }
          onEventRef.current(event);
        },
        onClose: ({ intentional }) => {
          if (cancelled || intentional) return;
          // 先如实计数再决定要不要继续重连——预算耗尽的那一次断开同样是一次断开，
          // 调用方对它做的权威读正是"最后一次确认"（见文件头注）。
          setDisconnects((n) => n + 1);
          attempts += 1;
          if (attempts > MAX_RECONNECT_ATTEMPTS) {
            setReconnectState("failed");
            return;
          }
          setReconnectState("reconnecting");
          const delay = Math.min(
            RECONNECT_FIRST_DELAY_MS * RECONNECT_BACKOFF ** (attempts - 1),
            RECONNECT_MAX_DELAY_MS,
          );
          retryTimer = setTimeout(connect, delay);
        },
      }, deps);
    };
    connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (restoredTimer !== null) clearTimeout(restoredTimer);
      handle?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, sessionToken]);

  return { reconnectState, disconnects };
}
