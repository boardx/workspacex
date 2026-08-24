"use client";

import * as React from "react";
import {
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
  CopilotChatMessageView,
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";

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
 *
 * ── DA-19b 消息渲染迁移（issue #1967 backlog DA-19b）─────────────────────────
 *
 * 消息列表从「手写 `.map()` 输出纯文本 `<span>`」换成 CopilotKit v2 官方的消息列表
 * 组件 `CopilotChatMessageView`（`@copilotkit/react-core/v2` 导出，不是本仓另写一份）
 * ——它按 role 分派 `assistantMessage`/`userMessage`/`reasoningMessage` 三个 slot，
 * 内部渲染逻辑（气泡结构、工具调用视图、intelligence indicator）全部来自框架本身，
 * 不是本次改动重新发明。
 *
 * 唯一的定制点是 `assistantMessage.markdownRenderer` 这个 slot——CopilotKit 自己的
 * 默认实现基于 `Streamdown`（纯 markdown，不认 ```mermaid 围栏、不接「落地为产物」）。
 * 换成本仓生产面板（`chat-live-message-panel.tsx`）同一个 `MarkdownMessage` 组件
 * （见其头注 VZ-01/VZ-02）：同一套 markdown 解析 + mermaid 围栏抽取 + fabric 渲染，
 * 两条轨道渲染同一份产品能力，不是各写一份、行为漂移。`markdownRenderer` slot 的类型
 * 签名是 `Omit<ComponentProps<typeof Streamdown>, "children"> & {content: string}`——
 * 用 `React.ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>` 原样
 * 取这个类型，不是手抄一份容易漂移的签名。
 *
 * 「落地为产物」（`MessageLandingControls`/`landAsArtifact`，`chat-live-message-panel.tsx`
 * 内 `threadId`/`message.id`/`bearer` 三者俱全才开放）**本轮不接入，是 TODO**——不是
 * 图省事，是这个 slot 的类型签名本身只暴露 `content: string`（加一堆 Streamdown 自己的
 * 渲染选项），不携带 `messageId`：`CopilotChatAssistantMessageProps` 的 `message` 字段
 * 停在 `CopilotChatAssistantMessage` 这一层，没有再往下透传给 `markdownRenderer` slot。
 * 要接这个功能需要在 slot 边界之外另开一个通道把 `message.id` 传进来（比如包一层
 * closure、或等 CopilotKit 未来版本把 message 也传给这个 slot），属于下一步，不在本次
 * 「消息渲染迁移」范围内画一个连自己类型都不支持的假入口。`threadId`/`bearer` 本身也
 * 未传（同一个门槛：三者必须俱全，不做"看起来能保存、点了才 403"的半成品）——
 * `MarkdownMessage`/`ChatDiagramFabric` 在缺失这三者时如实退回"本地演示"（可读可最大化，
 * 不可持久化保存），这是既有产品行为，不是本次新引入的降级。
 *
 * 消息列表包在 `CopilotChatConfigurationProvider` 里——`CopilotChatMessageView` 是
 * "slot 原语"，文档（`chat-components.md` "Headless composition with slot primitives"）
 * 允许脱离 `<CopilotChat>`/`<CopilotChatView>` 单独使用，但它内部一些子组件
 * （工具栏按钮等）读 `useCopilotChatConfiguration()`；不包这层 provider 时那个 hook
 * 返回 `null`，本仓没有验证过那条路径在这个包版本下是否处处判空安全，包一层比赌一次
 * 更诚实。
 *
 * ── DA-19c 工具可见性（框架版 Gap 1/4，backlog `DA-19c`）─────────────────────
 *
 * `<CopilotKitV2ToolRenderers />` 挂在组件树里（渲染 `null`，只负责调用
 * `useRenderTool`/`useDefaultRenderTool` 注册渲染器），把 `write_todos`/`search_documents`
 * 两个工具的进行中/完成态换成贴合各自数据形状的定制卡片，其余工具走框架内置默认卡片。
 * 完整设计取舍（三态映射、协议本身不携带失败布尔信号的诚实记录）见该文件头注。
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
      <CopilotKitV2ToolRenderers />
      <div className="text-sm font-medium">
        CopilotKit v2（DA-19 —— CopilotRuntime 适配器，走 `/api/copilotkit`）
      </div>
      <div
        className="flex-1 overflow-y-auto rounded border p-2"
        data-testid="copilotkit-v2-messages"
      >
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <CopilotChatMessageView
            messages={agent.messages}
            isRunning={agent.isRunning}
            assistantMessage={{ markdownRenderer: V2MarkdownRenderer }}
          />
        </CopilotChatConfigurationProvider>
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

/**
 * `CopilotChatAssistantMessage` 的 `markdownRenderer` slot 替换实现——见本文件头注
 * "DA-19b 消息渲染迁移"整段。类型直接取自框架自己导出的默认实现
 * （`CopilotChatAssistantMessage.MarkdownRenderer`），不是手抄一份容易漂移的签名；
 * 只用其中的 `content`，其余 Streamdown 专属渲染选项（`shikiTheme` 等）本组件不消费，
 * 因为渲染管线换成了 `MarkdownMessage`（react-markdown + mermaid fabric），不是
 * Streamdown 的产物，这些选项对它没有意义。
 */
function V2MarkdownRenderer({
  content,
}: React.ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>): JSX.Element {
  return <MarkdownMessage text={content} />;
}
