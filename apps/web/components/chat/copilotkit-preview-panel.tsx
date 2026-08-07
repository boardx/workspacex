"use client";

import * as React from "react";
import { HttpAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import { apiBaseUrl, getStoredSessionToken } from "../../lib/api-client";

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
 * 硬拼出来的假聊天气泡。
 *
 * 不做：`agentId` 手填（本仓没有挂载任何"列出组织 agent 目录"的路由——见
 * `personal-chat-screen.tsx` 文件头，同一个已如实暴露的缺口，这里不重新发明）；
 * 多轮上下文持久化（后端桥接端点每次调用都开一条新的个人线程，单轮范围，
 * 见 `apps/api/src/interface/controllers/copilotkit-agui.controller.ts` 文件头）；
 * token 级真流式（后端一次性吐出整段回复，不是逐 token，阶段 2 才做）。
 */
export function CopilotKitPreviewPanel(): JSX.Element {
  const [agentIdDraft, setAgentIdDraft] = React.useState("");
  const [inputDraft, setInputDraft] = React.useState("");
  const [messages, setMessages] = React.useState<readonly Message[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = React.useCallback(async () => {
    const agentId = agentIdDraft.trim();
    const text = inputDraft.trim();
    if (agentId === "" || text === "" || busy) return;

    setError(null);
    setBusy(true);
    setInputDraft("");

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const nextMessages: Message[] = [...messages, userMessage];
    setMessages(nextMessages);

    const token = getStoredSessionToken();
    const agent = new HttpAgent({
      url: `${apiBaseUrl()}/copilotkit/agui?agentId=${encodeURIComponent(agentId)}`,
      headers: token !== null ? { Authorization: `Bearer ${token}` } : {},
    });
    agent.messages = nextMessages;

    try {
      await agent.runAgent(undefined, {
        onRunErrorEvent: ({ event }) => {
          setError(event.message);
        },
        onMessagesChanged: ({ messages: updated }) => {
          setMessages([...updated]);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "AGUI_RUN_FAILED");
    } finally {
      setBusy(false);
    }
  }, [agentIdDraft, inputDraft, messages, busy]);

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <div className="text-sm font-medium">
        CopilotKit 预览（阶段 1b —— 直连 AG-UI SSE，`@ag-ui/client` `HttpAgent`）
      </div>
      <input
        data-testid="copilotkit-preview-agent-id"
        className="rounded border px-2 py-1 text-sm"
        placeholder="agent id（本仓暂无目录路由，需已知已发布的 agent id）"
        value={agentIdDraft}
        onChange={(e) => setAgentIdDraft(e.target.value)}
      />
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
          className="flex-1 rounded border px-2 py-1 text-sm"
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
          className="rounded border px-3 py-1 text-sm"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}
