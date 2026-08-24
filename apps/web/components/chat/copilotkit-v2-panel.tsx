"use client";

import * as React from "react";
import { z } from "zod";
import {
  useAgent,
  useConfigureSuggestions,
  useCopilotKit,
  useHumanInTheLoop,
  useSuggestions,
  UseAgentUpdate,
  CopilotChatMessageView,
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { Pencil } from "lucide-react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
 *
 * ── DA-19d 人在环（issue #1987，backlog DA-19d，框架版 Gap 3）─────────────────
 *
 * `useHumanInTheLoop`（`@copilotkit/react-core/v2` 自带 skill
 * `references/human-in-the-loop.md`，本节按其"Setup"范例照做，不凭记忆写 API）
 * 替换旧手写 `agent-approval-panel.tsx`（PR #1933，走 REST `/agent-runs/:runId/
 * decision`）——这里不是另建一套 approve/reject/edit 状态机：`respond` 由框架
 * 合成，本组件只在三种 `status`（`"inProgress" | "executing" | "complete"`，
 * camelCase，不是 `"in-progress"`）下渲染对应 UI，`respond()` 之外没有任何本地
 * 状态机分支去"预测"裁决结果——同一份纪律 `agent-approval-panel.tsx` 头注写过一次
 * （409 时如实展示服务端话术，不本地假装生效），这里由框架的 Promise 语义自动保证：
 * 不调用 `respond` 就是"没有决定"，run 就应该一直停在 `executing`，不存在本组件
 * 自己乐观更新出一个"已批准"的中间态。
 *
 * `parameters` 的 zod schema（`{to, subject, body}`）与 `name`（`"send_email"`）
 * 逐字对齐 `loopback-deep-agent-provider.ts` 的 `APPROVAL_TOOL_NAME`/`originalArgs`
 * 形状（该脚本头注"UX-9 D4 前端接入取证"一段）——沿用既有确定性替身的工具名，
 * 不是本次新发明一个后端不认识的工具。UI-kit 检测规则（human-in-the-loop.md 明写）：
 * 本仓已有 shadcn `Dialog`（`@/components/ui/dialog`，无 `AlertDialog` 分量），
 * 复用它而不是手写一个 `position:fixed` 遮罩层。
 *
 * ⚠ **本轮实测发现的真实后端缺口**（如实记录，不跳过验证——完整机制与真实 wire
 * 字节见 `e2e/copilotkit-v2-hitl.spec.ts` 头注，这里只摘要结论）：`send_email` 的
 * `TOOL_CALL_START`/`_ARGS`/`_END` 确实会到达前端，但 `copilotkit-agui.controller.ts`
 * 的 `writeToolCallStep` 对一个**还没被裁决**的步骤（`RunStepPublic.status ===
 * "in_progress"`）与一个**已经成功**的步骤走同一个 `else` 分支，立刻补发一个内容
 * 为空字符串的 `TOOL_CALL_RESULT`——`useHumanInTheLoop` 借以判定"这个工具调用还在
 * 等人"的信号（`TOOL_CALL_END` 之后一段时间内没有配对结果）因此从未成立，客户端把
 * 它当已完成处理，`status` 直接落 `"complete"`，从未经过 `"executing"`：`respond`
 * 全程 `undefined`，本文件 `SendEmailApprovalDialog` 的 approve/编辑/reject 三个
 * 按钮永远不会渲染（只会挂载成只读的"本轮已裁决，等待 run 收尾"分支）。与此同时，
 * run 自己的**整体**状态仍卡在 `awaiting_approval`（那个步骤被提前"结清"不影响
 * `readAgentRun` 的整体投影）——`runAguiBridgeTurn`（`apps/api/src/application/
 * agent-run/agui-bridge.ts`）的轮询循环只认 `"succeeded"`/`"failed"` 两个终态分支，
 * 最终耗尽 `maxPolls`（~30s）以 `RUN_ERROR`/`AGENT_RUN_TIMEOUT` 收场。也没有任何
 * 入口能把 `respond()` 之后框架发起的 follow-up `runAgent` 请求（携带编辑后的工具
 * 结果）路由回同一个被打断的 run 去恢复它——`bridge()` 每次 `POST` 都是"新开一个
 * 人类消息、新开一次 run"的单轮语义（controller 文件头"single-round scope"、
 * `resolveThreadId`/`runAguiBridgeTurn` 内 `threadId: null`）。
 *
 * 这与 DA-07b/PR #1960 修的 bug 不是同一层：那次修的是旧 REST 审批路径
 * （`/agent-runs/:runId/decision`）在**已经支持**审批的前提下、resume 时撞了账本
 * 序号唯一约束；这里是 AG-UI/CopilotRuntime 这条**新**桥接层从未实现过审批语义
 * （`writeToolCallStep` 设计时假设收到的步骤"一定已经执行完"，`agui-bridge.ts`
 * 自己的文档原话是"a REAL, ALREADY-EXECUTED tool_call step"——`"in_progress"` 这个
 * 中间态变体是 #742 Gap 1 为"已完成步骤"争取一次宣布帧引入的，从未设计过覆盖"还没
 * 执行、正在等人裁决"这种语义），不存在"撞同一个 bug"这回事——是一个未开始建的
 * 能力，登记在案，不在本任务（仅前端 hook 接线）范围内新增后端实现。
 */
const APPROVAL_TOOL_NAME = "send_email";
const approvalToolParameters = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.string(),
});

/**
 * 编辑态的 JSON 文本域校验纪律与 `agent-approval-panel.tsx` 的 `parsedDraft` 逐条
 * 一致（必须是合法 JSON **对象**，不是数组/原始值）——同一份产品纪律换一层框架
 * 实现，不因为换了 hook 就放松校验。
 */
function parseEditDraft(draft: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const value: unknown = JSON.parse(draft);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, message: "编辑后的参数必须是 JSON 对象（不能是数组或原始值）" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, message: "不是合法 JSON，请修正后再提交" };
  }
}

/**
 * `useHumanInTheLoop` 的 `render` —— 三态齐全（`inProgress`/`executing`/
 * `complete`），`respond` 只在 `"executing"` 下非 `undefined`（human-in-the-loop.md
 * "Common Mistakes" 明确警告：把它 widen 成 `any` 会静默 no-op，按钮点了但 Promise
 * 永不 resolve）——本组件在其余两态直接 return 一段只读文案，从不把 `respond` 从
 * 闭包外传出去，物理上排除了"在错误状态下调用它"的可能。
 */
function SendEmailApprovalDialog({
  statusLabel,
  awaitingDecision,
  args,
  respond,
}: {
  /** 只读文案 + `data-hitl-status` 探针用的原始状态字符串（`"inProgress"` /
   *  `"executing"` / `"complete"`，直接取自 `ToolCallStatus` 枚举的字符串值，
   *  不重新声明一份易漂移的联合类型）。 */
  statusLabel: string;
  /** `respond !== undefined` 的等价布尔值——在这一层拆开是为了不用把
   *  `ToolCallStatus`（`@copilotkit/core` 的枚举类型）也吃进这个纯展示组件的
   *  类型签名，`render` 回调里已经用真实枚举值判过一次，这里只消费判完的结果。 */
  awaitingDecision: boolean;
  args: Record<string, unknown>;
  respond?: (result: unknown) => void;
}): JSX.Element {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const startEditing = (): void => {
    setDraft(JSON.stringify(args, null, 2));
    setEditing(true);
  };

  if (!awaitingDecision || respond === undefined) {
    return (
      <Dialog open>
        <DialogContent data-testid="copilotkit-v2-hitl-dialog" data-hitl-status={statusLabel}>
          <DialogHeader>
            <DialogTitle>等待批准：发送邮件</DialogTitle>
            <DialogDescription>
              {statusLabel === "inProgress" ? "工具调用参数正在流式到达…" : "本轮已裁决，等待 run 收尾。"}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const parsedDraft = parseEditDraft(draft);

  return (
    <Dialog open>
      <DialogContent data-testid="copilotkit-v2-hitl-dialog" data-hitl-status={statusLabel}>
        <DialogHeader>
          <DialogTitle>等待你的批准：发送邮件</DialogTitle>
          <DialogDescription>批准前可编辑收件人/主题/正文，裁决后由框架恢复这次 run。</DialogDescription>
        </DialogHeader>
        {!editing ? (
          <pre
            className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-11 text-muted-foreground"
            data-testid="copilotkit-v2-hitl-args"
          >
            {JSON.stringify(args, null, 2)}
          </pre>
        ) : (
          <div>
            <textarea
              className="h-40 w-full resize-y rounded border border-input bg-muted px-2 py-1 font-mono text-11 text-foreground"
              data-testid="copilotkit-v2-hitl-edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            {!parsedDraft.ok ? (
              <p className="mt-1 text-11 text-destructive" data-testid="copilotkit-v2-hitl-edit-json-error">
                {parsedDraft.message}
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter className="gap-2">
          {!editing ? (
            <>
              <Button size="sm" data-testid="copilotkit-v2-hitl-approve" onClick={() => respond("approved")}>
                批准并继续
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="copilotkit-v2-hitl-start-edit"
                onClick={startEditing}
              >
                <Pencil aria-hidden className="h-3 w-3" />
                编辑参数
              </Button>
              <Button size="sm" variant="outline" data-testid="copilotkit-v2-hitl-reject" onClick={() => respond("denied")}>
                拒绝
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!parsedDraft.ok}
                data-testid="copilotkit-v2-hitl-edit-submit"
                onClick={() => {
                  if (parsedDraft.ok) respond(parsedDraft.value);
                }}
              >
                编辑并批准
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="copilotkit-v2-hitl-edit-cancel"
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

  // DA-19d —— human-in-the-loop.md "Setup" 范例的直接应用：`render` 收到
  // `{status, args, respond}`，本组件只负责把它交给 `SendEmailApprovalDialog`。
  // 不传 `agentId` 时 hook 默认绑定 provider 唯一的 `"default"` agent
  // （agent-access.md "Duplicate tool name across hooks" 一节：多 agent 场景才需要
  // 显式 `agentId` 隔离，本面板只有一个 agent）。
  useHumanInTheLoop({
    name: APPROVAL_TOOL_NAME,
    description: "Confirm sending an email before it is dispatched",
    parameters: approvalToolParameters,
    render: ({ status, args, respond }) => (
      <SendEmailApprovalDialog
        statusLabel={status}
        awaitingDecision={respond !== undefined}
        args={args}
        respond={respond}
      />
    ),
  });

  const send = React.useCallback(
    async (override?: string) => {
      const text = (override ?? inputDraft).trim();
      if (text === "" || agent.isRunning) return;
      setError(null);
      setInputDraft("");
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      try {
        await copilotkit.runAgent({ agent });
      } catch (e) {
        setError(e instanceof Error ? e.message : "COPILOTKIT_RUNTIME_RUN_FAILED");
      }
    },
    [agent, copilotkit, inputDraft],
  );

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
      <FollowUpSuggestions
        agentId={threadId}
        disabled={agent.isRunning}
        onSelect={(text) => void send(text)}
      />
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

/**
 * ── DA-19e 追问建议（框架版 Gap 2，backlog issue #1962/#1967 系列）─────────────
 *
 * 旧手写面板（`chat-live-message-panel.tsx`）的追问建议手工实现过两次
 * （PR #1938 首次实现、PR #1957 修 deep-agent 线程走不通真实模型的 bug——根因是
 * 手写适配层里"建议生成"另起一条调用路径，没有复用聊天本身已经验证过的连接，
 * 导致 deep-agent 类线程命中一条没人验证过的分支）。这里用官方
 * `useConfigureSuggestions`/`useSuggestions`（`@copilotkit/react-core/v2`，见
 * `node_modules/.../react-core/skills/react-core/references/suggestions.md`）
 * 走框架自己的建议引擎——不是本仓再手写一次生成逻辑。
 *
 * **验证过、不是想当然的一点**：读 `@copilotkit/core` 源码
 * （`dist/index.mjs` `SuggestionEngine.generateSuggestions`）确认了框架内部机制——
 * `consumerAgentId`（这里传 `threadId`，即页面这个 `useAgent` 实例的本地 id）用来
 * 取到消费者的消息历史做种子；`providerAgentId`（默认 `"default"`，与
 * `runtimeAgentId="default"` 对齐）取到的是 `CopilotKitCore` 在 runtime `/info`
 * 发现阶段自动注册的远程代理——**它和本文件里 `useAgent` 走的是同一个
 * `runtimeUrl`/`CopilotRuntime` 路由**（不是另起一条连接），要么用 stateless
 * `/agent/:id/suggest` 端点、要么 clone 这个远程代理后 `runAgent`，两条路径最终
 * 都落到 DA-19a 已加固的同一个 AG-UI 桥接层。这正是"框架版相对手写版的优势"
 * 应该验证的地方：本组件没有像旧实现那样为 deep-agent 线程写任何额外适配代码，
 * 因为框架的建议引擎本身就走 agent 自己已经用于正常对话的那条连接，不存在
 * "建议生成用另一套调用形状"的分支。
 *
 * `reloadSuggestions` 不需要本组件手动触发——`CopilotKitCore.runAgent` 每次
 * agent 运行结束（含工具调用的 follow-up 循环走完之后）会自动对该 agent 的
 * `agentId` 调一次 `suggestionEngine.reloadSuggestions(agentId)`（见
 * `dist/index.mjs` 里 `this._internal.suggestionEngine.reloadSuggestions(agentId)`
 * 紧跟在 follow-up 循环之后那一处）——本组件的 `send()` 已经在调
 * `copilotkit.runAgent({ agent })`，建议是这次调用的副作用之一，不是额外接线。
 */
function FollowUpSuggestions({
  agentId,
  disabled,
  onSelect,
}: {
  agentId: string;
  disabled: boolean;
  onSelect: (text: string) => void;
}): JSX.Element | null {
  useConfigureSuggestions(
    {
      instructions:
        "结合当前对话内容，给用户 2-4 条真实相关的追问建议，贴合刚才讨论的具体主题，不要写成泛泛而谈的通用模板。",
      minSuggestions: 2,
      maxSuggestions: 4,
      available: "after-first-message",
      providerAgentId: "default",
      consumerAgentId: agentId,
    },
    [agentId],
  );
  const { suggestions, isLoading } = useSuggestions({ agentId });

  if (suggestions.length === 0 && !isLoading) return null;

  return (
    <div
      data-testid="copilotkit-v2-suggestions"
      className="flex flex-wrap gap-2"
      aria-busy={isLoading}
    >
      {suggestions.map((s, i) => (
        <button
          key={`${s.title}-${i}`}
          type="button"
          data-testid={`copilotkit-v2-suggestion-${i}`}
          disabled={disabled || s.isLoading}
          className="rounded-full border border-border px-3 py-1 text-xs text-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground"
          onClick={() => onSelect(s.message)}
        >
          {s.title || s.message}
        </button>
      ))}
    </div>
  );
}
