"use client";

import * as React from "react";
import { HttpAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import { apiBaseUrl, getStoredSessionToken } from "../../lib/api-client";
import { useAguiPlanTodos } from "../../lib/agui-plan-todos";
import { AgentPlanPanel } from "./agent-plan-panel";

/**
 * #654 阶段 1b —— 直连 AG-UI SSE 桥接端点的 CopilotKit 预览面板。
 *
 * ## 为什么不是阶段 1a 的 `<CopilotKit runtimeUrl>` + `<CopilotChat>`
 *
 * 人类在 #654 的裁决第 1 条明确要求"直连 AG-UI SSE（`@ag-ui/client` 的 `HttpAgent`
 * 形状），不用经典 CopilotKit GraphQL runtime"。`@copilotkit/react-core@1.66.4` 的
 * `<CopilotKit runtimeUrl>` provider 内部固定走 `@copilotkit/runtime-client-gql`
 * 的 GraphQL 协议（`node_modules/@copilotkit/react-core/dist` 实测确认，
 * `CopilotKitProps` 没有暴露"直接注入一个 `AbstractAgent`"的顶层入口）——那正是
 * 被裁决排除的路径。于是这个面板改成直接用 `@ag-ui/client` 的 `HttpAgent`（阶段
 * 1a 已装好的 CopilotKit 依赖树的传递依赖，`0.0.57`，与后端 `apps/api` 新增的
 * 显式依赖版本一致）驱动一个最小聊天 UI，不经过 `@copilotkit/react-ui` 的
 * `CopilotChat` 组件（那个组件同样假设自己活在 GraphQL runtime 的 React context 里）。
 *
 * ## 这个面板做什么，不做什么
 *
 * 做：把一条用户消息交给 `HttpAgent.runAgent()`，把收到的 AG-UI 事件
 * （`TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` / `RUN_ERROR`）
 * 应用到本地消息列表——这就是"AG-UI 事件能在 UI 里显示出来"这句验收条件字面上
 * 要求的机制：一个真实的 `@ag-ui/client` agent 消费真实的 SSE 流，不是拿字符串
 * 硬拼出来的假聊天气泡。真实鉴权：`Authorization: Bearer <token>` 用的是
 * `getStoredSessionToken()`——全仓唯一的会话 token 读口（`POST /auth/login` 写入，
 * 见 `api-client.ts` 文件头），不是这里现造的简化值；未登录（token 为 null）时直接
 * 阻止发送并给出提示，不把一个注定 401 的请求打出去。
 *
 * 不做：`agentId` 手填（本仓没有挂载任何"列出组织 agent 目录"的路由——见
 * `personal-chat-screen.tsx` 文件头，同一个已如实暴露的缺口，这里不重新发明）；
 * token 级真流式（后端一次性吐出整段回复，不是逐 token，阶段 2 才做）。
 *
 * ## DA-19a —— 真实跨会话续聊，靠 AG-UI 协议自带的 `forwardedProps` 透传
 *
 * 阶段 1b/2b 曾经「每次调用都开一条新的个人线程」——`runAguiBridgeTurn` 本身早就支持
 * 复用既有 `threadId`（见 `agui-bridge.ts` 文件头），缺的只是这个面板没有把它接上。
 * 现在：后端 `onThreadResolved` 一解出真实 Chat threadId，就通过 AG-UI 协议原生的
 * `CUSTOM {name:"chat_thread_id"}` 事件（`EventType.CUSTOM` 的第二个真实生产者，第一个
 * 是 DA-17 的 `STATE_SNAPSHOT`）下发；本面板订阅 `onCustomEvent`，把它存进
 * `chatThreadId` state，下一轮发送时通过 `agent.runAgent({ forwardedProps: { chatThreadId } })`
 * 带回去——`forwardedProps` 是 `@ag-ui/core` `RunAgentInput` 协议本就定义的「应用自定义
 * 数据透传」字段，不是自造的 header 或者第二份 id 映射表（同一份 Chat threadId，见
 * 控制器文件头）。同一个 Chat threadId 会让 `deep-agent-model-provider.ts` 的
 * `deriveRemoteThreadId` 决定性推出同一个远端 deep-agent 线程——底层 agent 真的记得
 * 上一轮说了什么，不只是本仓自己的 `chat_messages` 表多存了一行。「开始新会话」按钮
 * 清空 `chatThreadId`（连同本地消息与计划条），下一条消息会让后端新建一条 Chat 线程。
 *
 * ## 多 agent 切换
 *
 * `agentId` 是纯文本输入，`send()` 每次都用当前 `agentIdDraft` 现造一个新的
 * `HttpAgent`（`url` 里带 `agentId` 查询参数）——切换目标 agent 只需要改这个输入框，
 * 不需要额外接线。后端 `acceptHumanMessage` 按「每条消息自带 agentId」的粒度接受选择
 * （`message-roundtrip.ts` 的 `selectedAgentId`，与生产聊天页的 agent 选择器同一套语义），
 * 所以延续同一个 `chatThreadId` 换 agent 继续发消息是后端本就支持的真实行为，不是本面板
 * 编出来的新规则。
 *
 * ## DA-17（UX-9 Line D3）—— 这个面板也是 `STATE_SNAPSHOT` 目前唯一的真实消费点
 *
 * `agent.runAgent` 的 subscriber 除了已有的 `onRunErrorEvent`/`onMessagesChanged`，
 * 现在还接了 `useAguiPlanTodos` 的 `onStateSnapshotEvent`——`write_todos` 步骤成功后
 * 后端下发的 `STATE_SNAPSHOT` 落到这里，校验通过就更新 `AgentPlanPanel`
 * 的 `stateSnapshotTodos`（比该组件另一条从 `toolArgsSummary` 反解字符串的路径更权威，
 * 见 `agent-plan-panel.tsx` 该 prop 的文档）。
 */
export function CopilotKitPreviewPanel(): JSX.Element {
  const [agentIdDraft, setAgentIdDraft] = React.useState("");
  const [inputDraft, setInputDraft] = React.useState("");
  const [messages, setMessages] = React.useState<readonly Message[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // DA-19a -- the persisted Chat thread id, learned from the backend's `CUSTOM
  // chat_thread_id` event (see file head). `null` = no turn has resolved one yet, or the
  // user hit "开始新会话" -- the next send starts a fresh backend Chat thread.
  const [chatThreadId, setChatThreadId] = React.useState<string | null>(null);
  const { todos: planTodos, onStateSnapshotEvent, reset: resetPlanTodos } = useAguiPlanTodos();

  // `getStoredSessionToken()` reads `window.localStorage` -- only safe once mounted on the
  // client (SSR always sees `null`, see that function's own guard). Read it in an effect,
  // not at render time, so the server-rendered markup and the first client render agree
  // (no hydration mismatch on the disabled/banner state below).
  const [loggedIn, setLoggedIn] = React.useState(false);
  React.useEffect(() => {
    setLoggedIn(getStoredSessionToken() !== null);
  }, []);

  const startNewConversation = React.useCallback(() => {
    setChatThreadId(null);
    setMessages([]);
    setError(null);
    resetPlanTodos();
  }, [resetPlanTodos]);

  const send = React.useCallback(async () => {
    const agentId = agentIdDraft.trim();
    const text = inputDraft.trim();
    if (agentId === "" || text === "" || busy) return;

    // DA-19a -- fail closed on the client, not just on the wire: a request we already know
    // will 401 shouldn't leave the user staring at a spinner with no explanation.
    const token = getStoredSessionToken();
    if (token === null) {
      setError("AUTH_REQUIRED：未登录或会话已过期，请先登录后再发送。");
      return;
    }

    setError(null);
    setBusy(true);
    setInputDraft("");
    resetPlanTodos();

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const nextMessages: Message[] = [...messages, userMessage];
    setMessages(nextMessages);

    const agent = new HttpAgent({
      url: `${apiBaseUrl()}/copilotkit/agui?agentId=${encodeURIComponent(agentId)}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    agent.messages = nextMessages;

    try {
      await agent.runAgent(
        { forwardedProps: chatThreadId !== null ? { chatThreadId } : {} },
        {
          onRunErrorEvent: ({ event }) => {
            setError(event.message);
          },
          onMessagesChanged: ({ messages: updated }) => {
            setMessages([...updated]);
          },
          onStateSnapshotEvent,
          onCustomEvent: ({ event }) => {
            if (event.name === "chat_thread_id" && typeof event.value === "string" && event.value !== "") {
              setChatThreadId(event.value);
            }
          },
        },
      );
    } catch (e) {
      // A connection/auth failure before any SSE bytes arrive (e.g. an expired token
      // rejected before the stream opens) surfaces here as a rejected promise, not a
      // RUN_ERROR event -- see `@ag-ui/client`'s `AbstractAgent.onError`, which re-throws
      // unless a subscriber sets `stopPropagation`. Either path lands in the same visible
      // `error` state below; neither leaves a blank screen.
      const message = e instanceof Error ? e.message : "AGUI_RUN_FAILED";
      setError(/fetch|network|failed to fetch/i.test(message)
        ? `CONNECTION_FAILED：无法连接到后端（${message}）`
        : message);
    } finally {
      setBusy(false);
    }
  }, [agentIdDraft, inputDraft, messages, busy, chatThreadId, onStateSnapshotEvent, resetPlanTodos]);

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          CopilotKit 预览（直连 AG-UI SSE，`@ag-ui/client` `HttpAgent`）
        </div>
        <button
          data-testid="copilotkit-preview-new-conversation"
          type="button"
          className="rounded border px-2 py-1 text-xs"
          disabled={busy}
          onClick={startNewConversation}
        >
          开始新会话
        </button>
      </div>
      {!loggedIn ? (
        <div data-testid="copilotkit-preview-auth-required" className="text-xs text-destructive">
          未登录或会话已过期，请先登录后再使用本预览面板。
        </div>
      ) : null}
      {/* DA-19a -- 会话延续的可见证据：非 null 时说明后端已经回过 CUSTOM chat_thread_id，
          下一条消息会带着它继续同一条 Chat 线程（同一远端 deep-agent 线程）。 */}
      <div data-testid="copilotkit-preview-thread-id" className="text-xs text-muted-foreground">
        {chatThreadId !== null ? `会话线程：${chatThreadId}` : "会话线程：（尚未建立，发送第一条消息后建立）"}
      </div>
      <input
        data-testid="copilotkit-preview-agent-id"
        className="rounded border px-2 py-1 text-sm"
        placeholder="agent id（本仓暂无目录路由，需已知已发布的 agent id；可随时切换以变更本轮对话的 agent）"
        value={agentIdDraft}
        onChange={(e) => setAgentIdDraft(e.target.value)}
      />
      {/* DA-17／Line D3 -- STATE_SNAPSHOT 驱动，steps=[] 因为这个面板没有
          `AgentRunView.steps`（那是 `/agent-runs` 轮询通道的形状，见文件头）；
          `stateSnapshotTodos` 是这里唯一可能非空的数据源。 */}
      <AgentPlanPanel steps={[]} stateSnapshotTodos={planTodos} />
      <div className="flex-1 overflow-y-auto rounded border p-2" data-testid="copilotkit-preview-messages">
        {messages.map((m) => (
          <div key={m.id} data-testid={`copilotkit-preview-message-${m.role}`} className="mb-2 text-sm">
            <span className="font-semibold">{m.role}: </span>
            <span>{"content" in m ? (m.content as string) : ""}</span>
          </div>
        ))}
      </div>
      {error !== null ? (
        <div data-testid="copilotkit-preview-error" className="text-sm text-destructive">{error}</div>
      ) : null}
      <div className="flex gap-2">
        <input
          data-testid="copilotkit-preview-input"
          className="flex-1 rounded border border-input px-2 py-1 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="随便输入点什么"
          value={inputDraft}
          onChange={(e) => setInputDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button
          data-testid="copilotkit-preview-send"
          type="button"
          className="rounded border border-border px-3 py-1 text-sm text-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}
