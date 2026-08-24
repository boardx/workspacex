"use client";

import * as React from "react";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/react-core/v2";

/**
 * DA-19 CopilotRuntime 后端适配器 —— `useAgent` 驱动的最小面板，走
 * `app/api/copilotkit/[[...slug]]/route.ts`（GraphQL/CopilotRuntime 协议）
 * → DA-19a 已加固的 `POST /copilotkit/agui`，不是重新对接一次 AG-UI。
 *
 * 与 `copilotkit-preview-panel.tsx`（DA-19a，直连 `@ag-ui/client` 的 `HttpAgent`）
 * 的区别只在"谁发起连接"：那个面板自己 `new HttpAgent(...)` 打后端；这个面板
 * 用 `useAgent`/`copilotkit.runAgent` 走 `CopilotKit` provider 管理的连接——provider
 * 内部仍然是同一条 `HttpAgent`（在服务端的 `route.ts` 里构造），只是本仓自己的组件
 * 不再直接持有它。这正是本任务要证明的适配层：GraphQL 协议把消息转发到
 * 已验证过的 AG-UI 端点，不是又起一条新连接。
 *
 * `runtimeAgentId` 固定为 `"default"`——CopilotRuntime 的 `agents` 记录只注册了这一个
 * key（见 `route.ts` 文件头，真实后端 agent id 由 `COPILOTKIT_V2_AGENT_ID` 环境变量
 * 决定，不在浏览器侧选择）。传 `threadId` 时 `useAgent` 强制要求同时传
 * `runtimeAgentId`（本地 `agentId` 与它分离，见该 hook 自己的运行时校验信息：一个
 * proxied per-thread 实例需要知道路由到哪个已注册 runtime agent）。
 *
 * `threadId` 每次挂载生成一个新的随机值（`useState` 惰性初始化），不是写死常量——
 * 实测踩到：写死同一个 `threadId` 时，第二次打开这个面板（比如 e2e 重试整页刷新）
 * 会被 `runAguiBridgeTurn` 当成"续接同一条线程"而不是新对话，命中的历史/续聊分支
 * 与全新对话的分支不是同一条代码路径，行为不可预测（本轮实测：第二次开始 wire 上的
 * `TEXT_MESSAGE_CONTENT` 变成空）。每次挂载给一个新 id 才是"用户打开这个面板发起
 * 一段新对话"该有的语义，与真实使用场景一致，不是单纯为了让测试重试变得干净。
 */
export function CopilotKitV2Panel(): JSX.Element {
  const { copilotkit } = useCopilotKit();
  const [threadId] = React.useState(() => `copilotkit-v2-${crypto.randomUUID()}`);
  const { agent } = useAgent({
    agentId: threadId,
    runtimeAgentId: "default",
    threadId,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const [inputDraft, setInputDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const send = React.useCallback(async () => {
    const text = inputDraft.trim();
    if (text === "" || agent.isRunning) return;
    setError(null);
    setInputDraft("");
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    try {
      await copilotkit.runAgent({ agent });
    } catch (e) {
      setError(e instanceof Error ? e.message : "COPILOTKIT_RUNTIME_RUN_FAILED");
    }
  }, [agent, copilotkit, inputDraft]);

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <div className="text-sm font-medium">
        CopilotKit v2（DA-19 —— CopilotRuntime 适配器，走 `/api/copilotkit`）
      </div>
      <div
        className="flex-1 overflow-y-auto rounded border p-2"
        data-testid="copilotkit-v2-messages"
      >
        {agent.messages.map((m) => (
          <div key={m.id} data-testid={`copilotkit-v2-message-${m.role}`} className="mb-2 text-sm">
            <span className="font-semibold">{m.role}: </span>
            <span>{"content" in m ? String(m.content ?? "") : ""}</span>
          </div>
        ))}
      </div>
      {error !== null ? (
        <div data-testid="copilotkit-v2-error" className="text-sm text-destructive">{error}</div>
      ) : null}
      <div className="flex gap-2">
        <input
          data-testid="copilotkit-v2-input"
          className="flex-1 rounded border border-input px-2 py-1 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="随便输入点什么"
          value={inputDraft}
          onChange={(e) => setInputDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button
          data-testid="copilotkit-v2-send"
          type="button"
          className="rounded border border-border px-3 py-1 text-sm text-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground"
          disabled={agent.isRunning}
          onClick={() => void send()}
        >
          {agent.isRunning ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}
