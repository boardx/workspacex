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
import { Pencil, Mic, Loader2 } from "lucide-react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { ActiveFilePanel } from "@/components/chat/active-file-panel";
import { useAguiFileEvents } from "@/lib/agui-file-events";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import { MicDevicePicker } from "@/components/chat/chat-composer-pickers";
import { getStoredSessionToken } from "@/lib/api-client";
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
 * ⚠ **DA-19g HITL 审批语义任务修复前的真实后端缺口**（历史记录，如实保留——完整
 * 机制与真实 wire 字节曾见 `e2e/copilotkit-v2-hitl.spec.ts` 头注旧版）：`send_email`
 * 的 `TOOL_CALL_START`/`_ARGS`/`_END` 确实会到达前端，但 `copilotkit-agui.
 * controller.ts` 的 `writeToolCallStep` 曾经对一个**还没被裁决**的步骤
 * （`RunStepPublic.status === "in_progress"`）与一个**已经成功**的步骤走同一个
 * `else` 分支，立刻补发一个内容为空字符串的 `TOOL_CALL_RESULT`——`useHumanInTheLoop`
 * 借以判定"这个工具调用还在等人"的信号（`TOOL_CALL_END` 之后一段时间内没有配对结果）
 * 因此从未成立，客户端把它当已完成处理，`status` 直接落 `"complete"`，从未经过
 * `"executing"`：`respond` 全程 `undefined`，approve/编辑/reject 三个按钮永远不会
 * 渲染；run 自己的**整体**状态仍卡在 `awaiting_approval`，`runAguiBridgeTurn` 的
 * 轮询循环只认 `"succeeded"`/`"failed"` 两个终态分支，最终耗尽 `maxPolls`（~30s）以
 * `RUN_ERROR`/`AGENT_RUN_TIMEOUT` 收场——也没有任何入口能把 `respond()` 之后框架
 * 发起的 follow-up `runAgent` 请求路由回同一个被打断的 run 去恢复它。
 *
 * **已修复**（DA-19g HITL 审批语义任务）：`writeToolCallStep` 现在对 `"in_progress"`
 * 步骤只发 `STEP_STARTED`→`TOOL_CALL_START/ARGS/END`，不再提前发 `RESULT`/
 * `STEP_FINISHED`——`useHumanInTheLoop` 的"等待"信号成立，`respond` 真的落在
 * `"executing"`。`runAguiBridgeTurn`（`apps/api/src/application/agent-run/
 * agui-bridge.ts`）认识 `awaiting_approval` 这个中间态，以真实的 `RUN_FINISHED`
 * （不是超时/错误）结束这一轮，与一次真正的 AG-UI 前端工具调用同一个协议约定。新增
 * 的 `resumeAguiBridgeTurn` + `copilotkit-agui.controller.ts` 的
 * `isHitlResumeRequest`/`parseHitlDecision` 把 `respond()` 之后的 follow-up
 * `runAgent` 请求（`{role:"tool", toolCallId, content}` 消息 + `forwardedProps.
 * chatThreadId`）路由回同一个被打断的 run，复用 DA-07b 的 `decideAgentRun`（旧 REST
 * `/agent-runs/:runId/decision` 路径的同一套底层机制，不是重新发明一套）去 resume
 * 它。本文件（`useHumanInTheLoop` 接线）没有改一行——DA-19d 当时的接线已经跟旧面板
 * 逐条对齐，后端补上之后立刻工作。真实浏览器三条路径的证据见
 * `e2e/copilotkit-v2-hitl.spec.ts`（approve/edit/reject 各一条用例）。
 *
 * 这与 DA-07b/PR #1960 修的 bug 不是同一层：那次修的是旧 REST 审批路径
 * （`/agent-runs/:runId/decision`）在**已经支持**审批的前提下、resume 时撞了账本
 * 序号唯一约束；这里是 AG-UI/CopilotRuntime 这条**新**桥接层此前从未实现过审批语义
 * 的问题（`writeToolCallStep` 曾经设计时假设收到的步骤"一定已经执行完"，
 * `agui-bridge.ts` 自己的文档原话是"a REAL, ALREADY-EXECUTED tool_call step"——
 * `"in_progress"` 这个中间态变体是 #742 Gap 1 为"已完成步骤"争取一次宣布帧引入的，
 * 当时从未设计过覆盖"还没执行、正在等人裁决"这种语义）。
 *
 * ── DA-13 双栏联动：Chat + 活动文件工作台（backlog DA-13）─────────────────────
 *
 * 左栏保持不变（上面这些 slot 组成的流式对话与决策过程）；新增右栏
 * `ActiveFilePanel`——agent 通过 DA-15 定义的 `file_created`/`file_content_delta`
 * `CUSTOM {name,value}` 事件"打开/写入文件"时，这里实时展开一个 tab，长文档/代码
 * 不再塞进左栏的聊天气泡。
 *
 * `useAgent` 返回的 `agent` 是 `AbstractAgent`（`@ag-ui/client`）——其类型文档原话
 * "calling `agent.subscribe(...)` is always safe"，与 `copilotkit-preview-panel.tsx`
 * 消费 `onStateSnapshotEvent`/`onCustomEvent` 走的是同一套订阅接口，只是那个面板把
 * 订阅参数传给单次 `runAgent()` 调用，这里的 `agent` 是跨多轮对话复用的同一个实例，
 * 所以改成组件挂载时 `agent.subscribe(...)` 一次、整个组件生命周期内持续接收（不只
 * 是"这一轮 runAgent 期间"）——文件是可能在某一轮工具调用里创建、后续轮次里继续追加
 * 内容的，绑定到单次 `runAgent()` 调用会在两轮之间丢失订阅。
 *
 * ⚠ **没有真实生产者，如实登记**（完整原因见 `apps/web/lib/agui-file-events.ts`
 * 文件头）：`deepagents` 的 `FilesystemMiddleware`（`harness.py` 已挂载，`write_file`/
 * `edit_file` 是模型可以真实调用的工具）写入的是单次 run 状态内的临时虚拟文件系统，
 * 不落 DB；DA-12 的 VFS `vfs://<attachment|artifact>/<id>` 要求 `id` 是"该 domain
 * 自己权威表里的主键"，VFS 自己不发号、不落库。把 `FilesystemMiddleware` 的临时文件
 * 硬套进这两个既有 domain 会谎称它们已经落库为真实的 attachment/artifact 行——本次
 * 不做这个假映射，`copilotkit-agui.controller.ts` 因此本轮**不新增**任何
 * `file_created`/`file_content_delta` 的真实生产逻辑。本组件是完整的消费端实现，
 * 一旦后续任务（把 `FilesystemMiddleware` 的写入真正落地为 `chat_message_attachments`
 * 之后再映射成 VFS URI）接上真实生产者，不需要再改前端代码。e2e 证据走协议精确的
 * wire-level 测试夹具，见 `e2e/copilotkit-v2-active-file-panel.spec.ts` 文件头。
 *
 * ── DA-19g 语音输入（评分循环第 1 轮第 5 项缺口，`.harness/state/
 * copilotkit-v2-ux-acceptance-score.md` 第 5 项：`grep -rni "mic|voice|audio|asr"`
 * 在这个面板零命中，浏览器内探测 `[data-testid*="mic"]`/`[aria-label*="麦克风"]` 也是
 * 0 个元素）─────────────────────────────────────────────────────────────────
 *
 * **不是重新发明一套 ASR 客户端**——`chat-live-message-panel.tsx`（issue #726）已经把
 * "composer 麦克风 → 服务端代理的 `WS /chat/asr-draft`
 * （`apps/api/src/interface/ws/asr-draft.gateway.ts` → 阿里云百炼 `qwen3-asr-flash-
 * realtime`，API key 只在服务端）→ 转录文字实时进输入框、可编辑、发送前不自动提交"
 * 这一整套状态机做成了三份可直接复用的东西，本文件原样接线，不复制一份：
 *   1. `useAsrDraft`（`lib/use-asr-draft.ts`）—— 状态机本身（idle/connecting/
 *      listening/stopping/denied/unsupported/error），`onTranscript` 回调把拼接好的
 *      全文交给调用方，调用方只管把它塞进自己的输入框 state（这里是 `inputDraft`）。
 *   2. `useAudioInputDevices` + `MicDevicePicker`（`lib/use-audio-input-devices.ts` /
 *      `components/chat/chat-composer-pickers.tsx`）—— 输入设备选择，纯 UI 状态，
 *      不碰采音。
 *   3. 鉴权：`useAsrDraft` 要一个 `sessionToken`——本组件与
 *      `copilotkit-v2-providers.tsx` 读的是同一个 `getStoredSessionToken()`
 *      （`lib/api-client.ts`），未登录时（`token === null`）麦克风按钮直接禁用并说明
 *      原因，不发一个必然被服务端拒绝的假请求。
 *
 * 与旧面板的唯一差异是"基线文本从哪读、写回哪里"——旧面板用 `textRef`/`updateDraft`
 * （线程草稿持久化的一部分），这里就是这个组件自己的 `inputDraft`/`setInputDraft`；
 * `useAsrDraft` 的 `getBaseText`/`onTranscript` 本来就是为了让调用方在这一点上自由
 * 接线而设计的两个纯函数参数，不需要改 hook 本身一行代码，也不需要把 `chat-recording-
 * panel.tsx`（会话级录音归档，`chat-live-recording-*` 锚点，走 `/recording/sessions`
 * 完全不同的契约束）牵扯进来——那是另一条产品能力（整段会话录音存档），不是"麦克风
 * 按钮把语音实时转文字填进输入框"这条判据要的东西。
 *
 * ⚠ **两条"DA-19g" backlog 编号撞车**（如实记录，纯文档层面，不影响代码）：main 上
 * 已经存在另一条同名的 `copilotkit-v2-hitl-dialog-dismiss.spec.ts`（issue #1996，
 * HITL 终态 Dialog 遮罩泄漏修复）也自称 "DA-19g"。本节的语音输入（评分循环第 1 轮
 * 第 5 项）与那条修复是两件互不相关的事，只是 backlog 简写号意外撞了同一个字符串，
 * 不是同一次改动的两半。
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
}): JSX.Element | null {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  /**
   * DA-19g fix（issue #1996）—— `open` must be a REAL controlled boolean, never
   * a hardcoded literal `true`. The pre-fix version rendered `<Dialog open>`
   * with **no** `onOpenChange` in *both* branches below; Radix has no state to
   * flip when its default close icon / Escape / overlay-click fires, so the
   * portal-rendered overlay (`fixed inset-0 z-50 bg-inverse/40 backdrop-blur-sm
   * ...`, see `ui/dialog.tsx` `DialogOverlay`) stayed mounted forever. Because
   * the `send_email` tool-call message that hosts this component is never
   * pruned from `agent.messages`, that overlay became a permanent
   * click-blocker over the whole panel the moment any HITL flow reached its
   * terminal read-only branch (185-retry Playwright timeout; see
   * `.harness/state/copilotkit-v2-ux-acceptance-score.md` 判据 #10 / #7 / #9).
   *
   * `dismissed` is the single source of truth for "should this component still
   * render a blocking modal" — once set, the component returns `null` (no
   * `Dialog`, no portal, nothing to leak) regardless of `status`/`awaitingDecision`.
   * It is set from three independent close paths so there is no way to end up
   * stuck again: (1) Radix's own `onOpenChange(false)` (Escape / overlay click /
   * built-in close icon), (2) the explicit "关闭" button on the read-only
   * terminal branch (Radix's default icon alone is not enough — see
   * human-in-the-loop.md 提醒 "Common Mistakes"), (3) any of the interactive
   * approve/reject/edit-submit actions, which already resolve `respond(...)`.
   */
  const [dismissed, setDismissed] = React.useState(false);
  const close = React.useCallback(() => setDismissed(true), []);

  const startEditing = (): void => {
    setDraft(JSON.stringify(args, null, 2));
    setEditing(true);
  };

  if (dismissed) return null;

  if (!awaitingDecision || respond === undefined) {
    return (
      <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent data-testid="copilotkit-v2-hitl-dialog" data-hitl-status={statusLabel}>
          <DialogHeader>
            <DialogTitle>等待批准：发送邮件</DialogTitle>
            <DialogDescription>
              {statusLabel === "inProgress" ? "工具调用参数正在流式到达…" : "本轮已裁决，等待 run 收尾。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" data-testid="copilotkit-v2-hitl-dismiss" onClick={close}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const parsedDraft = parseEditDraft(draft);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // 用户通过 Escape/点遮罩层/默认关闭图标退出时，等价于「拒绝」——不这样
        // 处理的话，Dialog 会正确卸载（不再残留遮罩），但框架合成的 respond
        // Promise 永远不会 resolve（human-in-the-loop.md "No respond call →
        // infinite hang"），run 会一直挂到后端自己的轮询超时才收场，属于
        // "看起来关掉了、实际状态没跟上"的另一种不一致，不是本次要放行的行为。
        if (!next) {
          close();
          respond("denied");
        }
      }}
    >
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
              <Button
                size="sm"
                data-testid="copilotkit-v2-hitl-approve"
                onClick={() => {
                  close();
                  respond("approved");
                }}
              >
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
              <Button
                size="sm"
                variant="outline"
                data-testid="copilotkit-v2-hitl-reject"
                onClick={() => {
                  close();
                  respond("denied");
                }}
              >
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
                  if (parsedDraft.ok) {
                    close();
                    respond(parsedDraft.value);
                  }
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

  /**
   * DA-19g -- 真实缺陷修复（chat-ux-acceptance-criteria.md 第 7 项"错误处理透明度"，
   * `copilotkit-v2-error-banner.spec.ts` 实测抓到，见 `copilotkit-v2-error-copy.ts`
   * 文件头完整排查记录）。
   *
   * `send()` 下面那句 `try { await copilotkit.runAgent(...) } catch (e) { setError(...) }`
   * 只能捕获"这次调用本身抛出的 JS 异常"（网络层错误、`agent.detachActiveRun()` 失败等）
   * ——它**捕获不到**"run 正常收到了一条 AG-UI `RUN_ERROR` 事件"这种失败：
   * `@copilotkit/core` 的 `CopilotKitCore.runAgent()` 把这类失败完全在内部吸收，
   * 只经 `copilotkit.subscribe({ onError })` 这条独立总线广播，外层 `await` 正常
   * resolve、不 throw。`deepAgentFailureTrigger`（真实模型调用失败，`RUN_ERROR` 码为
   * `MODEL_CALL_FAILED`）走的正是这条从未被监听过的路径——横幅因此从未出现过，
   * 不是文案不够人话，是这条路径压根没接错误状态。
   */
  React.useEffect(() => {
    const { unsubscribe } = copilotkit.subscribe({
      onError: ({ code, error: runError, context: errorContext }) => {
        if (
          code !== "agent_run_error_event" &&
          code !== "agent_run_failed_event" &&
          code !== "agent_run_failed" &&
          code !== "agent_thread_locked"
        ) {
          return;
        }
        const agentIdInContext =
          typeof errorContext === "object" && errorContext !== null && "agentId" in errorContext
            ? (errorContext as { agentId?: unknown }).agentId
            : undefined;
        // 只处理这个面板自己这条 agent 的失败，不误报其它并存 agent（本面板目前只有
        // 一个，这里仍然显式收窄——防的是这份 hook 以后被复用到多 agent 场景时悄悄
        // 越权报错，`agent-access.md` 同一条纪律）。
        if (agentIdInContext !== undefined && agentIdInContext !== threadId) return;
        const runtimeCode =
          typeof errorContext === "object" && errorContext !== null && "runtimeErrorCode" in errorContext
            ? (errorContext as { runtimeErrorCode?: unknown }).runtimeErrorCode
            : undefined;
        const code_ = typeof runtimeCode === "string" ? runtimeCode : runError.message;
        setError(describeCopilotkitV2RunError(code_));
      },
    });
    return unsubscribe;
  }, [copilotkit, threadId]);

  // DA-13 -- subscribe to the agent instance directly (not scoped to a single
  // `runAgent()` call) so a file created in one turn keeps receiving content deltas in
  // later turns. See the file-head comment above for why `agent.subscribe` is safe here.
  const { files: activeFiles, onCustomEvent: onActiveFileCustomEvent } = useAguiFileEvents();
  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({ onCustomEvent: onActiveFileCustomEvent });
    return unsubscribe;
  }, [agent, onActiveFileCustomEvent]);

  /**
   * DA-19g —— 真实缺陷修复：接上 `copilotkit-agui.controller.ts` 早就实现好的续聊通道
   * （见该文件头 "DA-19a -- real cross-turn continuation" 一节），本面板此前从未消费过。
   *
   * ## 缺陷是什么（2026-08-24 排查确认，不是猜测）
   *
   * `runAguiBridgeTurn` 的 Chat 线程续接**唯一**依据是 `body.forwardedProps.chatThreadId`
   * （`copilotkit-agui.controller.ts` 里 `requestedChatThreadId`）——不传就是
   * `threadId: null`，`resolveThreadId` 每次都新建一条 Chat 线程。本面板此前的 `send()`
   * 只调用 `copilotkit.runAgent({ agent })`，从未传 `forwardedProps`，也从未监听服务端在
   * `RUN_STARTED` 之后立刻回写的 `CUSTOM {name:"chat_thread_id"}` 事件（同一个控制器文件
   * 头注 "DA-19a" 一节原话："a client that wants continuation reads the Chat thread id
   * back off the `CUSTOM` event... and echoes it forward... on the NEXT turn"）——这条线
   * 后端接好了，前端从没接上过。结果是：**每一轮**发送都在服务端开一条全新 Chat 线程，
   * `execute-run.ts` 的 `readThreadHistory` 因此永远读到空线程，`history` 永远是 `[]`，
   * `deep-agent-model-provider.ts` 的 `deriveRemoteThreadId` 也因此每轮派生出不同的远端
   * 线程——不管上游（真实 deepagents 服务或 loopback 替身）自己是否支持记忆，模型能看到的
   * 输入本身就是「这是全新对话」，与 chat-ux-acceptance-criteria.md 第 6 项"多轮上下文"
   * 判据（"重试一下"、"再详细一点"这类追问不需要用户重新提供背景）直接矛盾。
   *
   * ## 修法
   *
   * `agent.subscribe({onCustomEvent})` 再挂一路：见到 `chat_thread_id` 就存进
   * `chatThreadIdRef`（`useRef`，不进 state——这个值只影响"下一次 `runAgent` 调用带什么
   * `forwardedProps`"，不参与渲染，不需要触发重渲染）。`send()` 里，如果已经拿到过一个
   * Chat 线程 id，就把它原样带回 `forwardedProps.chatThreadId`——`CopilotKitCoreRunAgentParams`
   * 本来就支持这个字段（`@copilotkit/core` 的 `runAgent({agent, forwardedProps, ...})`），
   * 不是新发明一条通道。第一轮（`chatThreadIdRef.current === null`）不传，与此前行为
   * 逐字节相同（新建线程），只有第二轮起才会真的续接。
   */
  const chatThreadIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event?.name === "chat_thread_id" && typeof event.value === "string" && event.value !== "") {
          chatThreadIdRef.current = event.value;
        }
      },
    });
    return unsubscribe;
  }, [agent]);

  /**
   * DA-19g —— `useAsrDraft` 的 `start()` 是一个稳定回调（不随每次按键重建），基线读取
   * 必须走 ref 而不是闭包捕获的 `inputDraft`——否则会追加到"点击麦克风那一刻组件首次
   * 渲染时的 inputDraft"，与 `chat-live-message-panel.tsx` 头注记录的同一个坑同一个修法。
   */
  const inputDraftRef = React.useRef(inputDraft);
  inputDraftRef.current = inputDraft;
  /**
   * 与 `copilotkit-v2-providers.tsx` 读的是同一个 token（`getStoredSessionToken`）——
   * 未登录时（`null`）麦克风点击时守卫并说明原因，不发一个必然被服务端拒绝的假请求。
   *
   * ⚠ 不能只用一次性 `useState(() => getStoredSessionToken())` 就不再更新，也不能把
   * 它直接接到 `disabled`/`title`——本轮 e2e 实测（`copilotkit-v2-voice-input.spec.ts`）
   * 踩到：`sessionToken` 首帧在服务端渲染为 `null`（`typeof window === "undefined"`），
   * 客户端 hydrate 时才读到真实值（`window.localStorage` 里确有 token，`page.evaluate`
   * 直接读到过非空值），这条 SSR/CSR 分叉接到 `disabled`/`title` 会触发一次真实的
   * React hydration 属性不匹配（`Server: "未登录..." Client: "开始语音输入"`），而这个
   * 包/Next dev 版本组合下客户端没有如预期纠正回来——按钮永久停在服务端渲染出的
   * disabled 态，与 `copilotkit-v2-providers.tsx` 文件头注记录的"首帧空档"是同一类
   * 时序竞争。这里改用 `copilotkit-v2-providers.tsx` 自己那份已验证过的自愈模式
   * （`storage` 事件 + 轮询兜底）读 state，但只在 `onClick` 里守卫，不接到首帧属性
   * （见下方按钮）。
   */
  const [sessionToken, setSessionToken] = React.useState<string | null>(() => getStoredSessionToken());
  React.useEffect(() => {
    const sync = (): void => setSessionToken(getStoredSessionToken());
    sync();
    window.addEventListener("storage", sync);
    const interval = window.setInterval(sync, 2000);
    return () => {
      window.removeEventListener("storage", sync);
      window.clearInterval(interval);
    };
  }, []);
  const micDevices = useAudioInputDevices();
  const speech = useAsrDraft({
    getBaseText: () => inputDraftRef.current,
    onTranscript: (fullText) => setInputDraft(fullText),
    sessionToken: sessionToken ?? "",
    deviceId: micDevices.selectedDeviceId ?? undefined,
  });

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
        // DA-19g -- echo the resolved Chat thread id back on every turn AFTER the first
        // (see the `chatThreadIdRef` block above for why this is the fix, not a new
        // mechanism). Omitted entirely on turn 1 -- identical to pre-fix behaviour.
        await copilotkit.runAgent(
          chatThreadIdRef.current !== null
            ? { agent, forwardedProps: { chatThreadId: chatThreadIdRef.current } }
            : { agent },
        );
      } catch (e) {
        // DA-19g -- 与上面 `copilotkit.subscribe({ onError })` 走同一份文案映射
        // （`copilotkit-v2-error-copy.ts`），不在这条分支单独拼一句可能带原始异常
        // message（往往是英文技术细节，同样不是人话）。这条分支现在只兜"`runAgent()`
        // 自己抛出 JS 异常"这种更边缘的情况——常规的 `RUN_ERROR` 事件已经被上面的
        // `onError` 订阅接住，不会再走到这里。
        setError(describeCopilotkitV2RunError(e instanceof Error ? e.message : "COPILOTKIT_RUNTIME_RUN_FAILED"));
      }
    },
    [agent, copilotkit, inputDraft],
  );

  return (
    <div className="flex h-full w-full gap-3 p-4">
      {/* DA-13 -- 左栏：流式对话与决策过程，不变；右栏（下方，条件渲染）是新增的活动
          文件工作台，两栏各占一半宽度，右栏没有任何文件时不占位（见 ActiveFilePanel
          自己的"缺席"纪律），左栏独占全宽。 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
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
          {/*
            DA-19g —— composer 麦克风，接线见本文件头注。设备选择器紧挨麦克风按钮，
            录音中禁用（切设备要重起采音管线，同 `chat-live-message-panel.tsx` 的既有
            约束，contract.md §7.4）。
          */}
          <MicDevicePicker
            devices={micDevices.devices}
            selectedDeviceId={micDevices.selectedDeviceId}
            disabled={speech.listening || speech.connecting || speech.stopping}
            onSelect={micDevices.select}
          />
          <Button
            type="button"
            size="icon"
            variant={speech.listening ? "destructive" : "outline"}
            className="rounded-full"
            data-testid="chat-mic-button"
            data-mic-status={speech.status}
            aria-pressed={speech.listening}
            aria-busy={speech.connecting || speech.stopping}
            aria-label={
              speech.connecting ? "正在连接语音识别…"
                : speech.stopping ? "正在停止…"
                : speech.listening ? "停止语音输入" : "开始语音输入"
            }
            /*
             * DA-19g —— `disabled`/`title` 故意**不**读 `sessionToken`（见上面 state 声明
             * 处的完整实测记录）：只由 `speech.connecting`/`speech.stopping` 控制，两者
             * 服务端/客户端首帧恒为 `false`，没有 SSR/CSR 分叉。"未登录"这个真实场景改到
             * `onClick` 守卫里处理。
             */
            title={
              speech.connecting ? "正在连接语音识别…"
                : speech.stopping ? "正在停止…"
                : speech.listening ? "停止语音输入" : "开始语音输入"
            }
            disabled={speech.connecting || speech.stopping}
            onClick={() => {
              if (sessionToken === null) {
                setError("未登录，无法使用语音输入。");
                return;
              }
              if (speech.listening) speech.stop();
              else speech.start();
            }}
          >
            {speech.connecting || speech.stopping ? (
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mic aria-hidden className="h-3.5 w-3.5" />
            )}
          </Button>
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
        {speech.connecting ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="chat-mic-connecting">
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            正在连接语音识别……
          </p>
        ) : null}
        {speech.listening ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive" data-testid="chat-mic-listening">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
            正在听……实时转录中，说完点击麦克风按钮停止，确认无误后再手动发送。
          </p>
        ) : null}
        {speech.stopping ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="chat-mic-stopping">
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            正在停止……等待最后一段转录落定。
          </p>
        ) : null}
        {speech.error !== null ? (
          <p className="text-xs text-destructive" data-testid="chat-mic-error">{speech.error}</p>
        ) : null}
      </div>
      {activeFiles.length > 0 ? (
        <div className="min-w-0 flex-1">
          <ActiveFilePanel files={activeFiles} />
        </div>
      ) : null}
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
