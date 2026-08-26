"use client";

import * as React from "react";
import { deepAgentHitl } from "@repo/contracts";
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
import { Pencil, Mic, Loader2, AlertTriangle, ArrowDown } from "lucide-react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
// issue #2052（CK-P7）—— 「落地为产物」状态机，与旧轨道共用同一份（展示件在
// `copilotkit-v2-message-actions.tsx`，与 CK-P3 的复制/评分/反馈同一条操作条）。
import { useMessageLanding } from "@/components/chat/message-landing";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";
import { useChatMessageIdentity } from "@/lib/copilotkit-v2-message-identity";
import { useCopilotKitV2RunProgress, LONG_RUN_HINT } from "@/lib/copilotkit-v2-run-progress";
import {
  CopilotKitV2MessageActionsProvider,
  CopilotKitV2CopyButton,
  CopilotKitV2MessageExtraActions,
  useCopilotKitV2MessageActions,
  CopilotKitV2MessageLanding,
  type AssistantMessageLandingValue,
} from "@/components/chat/copilotkit-v2-message-actions";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { ChatLiveAnnouncer, announceToChat } from "@/components/chat/chat-live-announcer";
import { ActiveFilePanel } from "@/components/chat/active-file-panel";
import { useAguiFileEvents } from "@/lib/agui-file-events";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import { AgentPicker, MicDevicePicker } from "@/components/chat/chat-composer-pickers";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { useSession } from "@/components/session/session-provider";
import { listCapabilities, type CapabilityListing } from "@/lib/live-capabilities";
import {
  createPersonalThread, listMessages, summarizePersonaFromThread,
  type GetAgentPanelOut, type ListThreadAttachmentsOut,
} from "@/lib/live-chat";
import { detectComposerMention, type ComposerMention } from "@/lib/composer-mention-detection";
import { useCopilotKitV2AgentSelection } from "@/lib/copilotkit-v2-agent-selection";
import {
  useChatAttachments, ChatAttachmentButton, ChatAttachmentList, ChatAttachmentBanner,
  ChatFullSurfaceDropOverlay,
} from "@/components/chat/chat-composer-attachments";
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
import { ChatPopoverCoordinatorProvider } from "@/components/chat/chat-popover-coordinator";
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
 * `runtimeAgentId` 传给 `useAgent` 的值恒为 `"default"`——CopilotRuntime 的 `agents`
 * 记录只注册了这一个 key，这是 CopilotKit 协议本身的路由粒度（"这个前端 agent 实例
 * 打哪一条已注册的 remote endpoint"），跟"浏览器侧选的是哪个真实已发布 agent"是两回事
 * （见下面「DA-19/issue #2023 agent 选择」一节，以及 `route.ts` 文件头的完整说明）。
 * 传 `threadId` 时 `useAgent` 强制要求同时传 `runtimeAgentId`（本地 `agentId` 与它
 * 分离，见该 hook 自己的运行时校验信息：一个 proxied per-thread 实例需要知道路由到
 * 哪个已注册 runtime agent）。
 *
 * `threadId` 每次挂载生成一个新的随机值（`useState` 惰性初始化），不是写死常量——
 * 实测踩到：写死同一个 `threadId` 时，第二次打开这个面板（比如 e2e 重试整页刷新）
 * 会被 `runAguiBridgeTurn` 当成"续接同一条线程"而不是新对话，命中的历史/续聊分支
 * 与全新对话的分支不是同一条代码路径，行为不可预测（本轮实测：第二次开始 wire 上的
 * `TEXT_MESSAGE_CONTENT` 变成空）。每次挂载给一个新 id 才是"用户打开这个面板发起
 * 一段新对话"该有的语义，与真实使用场景一致，不是单纯为了让测试重试变得干净。
 *
 * ── issue #2023（差距清单第 4 项）Agent 选择/切换 ─────────────────────────────
 *
 * 旧手写轨道有 `AgentPicker`（选发送 agent）+ 外壳 `RosterPanel`（把 agent 加进
 * 当前会话的编制，多 agent 协作）。#2025 当时只做了前者，理由记在下面两条。
 *
 * ⚠ **这两条理由已于 issue #2052（CK-P7）失效，勿再据此认为编制没做**：#2028 落地了
 *   持久化线程，外壳 `copilotkit-v2-shell.tsx` 现在持有真实 `chat_threads.id`，编制
 *   面板已经挂上去了（共用组件 `chat-roster-panel.tsx`，与旧轨道同一份）。本节保留
 *   原文是为了记住"当时为什么拆成两轮"，不是描述今天的状态。
 *
 *   1. 本面板此前压根没有"这条会话可以有多个 agent"的概念，`useAgent` 是单实例；
 *      `RosterPanel`（`updateAgentRoster`/乐观锁 `rosterVersion`）挂在
 *      `chat_threads`/`chat_thread_agents` 这套持久化线程模型上——而
 *      `chat-feature-parity-gap-2026-08-25.md` 差距 #1 已经如实记录：本面板的
 *      `threadId` 是每次挂载的临时随机值，从不落库，没有一条真实的
 *      `chat_thread_agents` 编制可以增删。要做"编制"必须先有差距 #1 的持久化线程，
 *      两件事天然地按依赖顺序分成两轮，不是本轮工作量判断上的取巧。
 *   2. 任务说明本身允许这个收窄（"如果这部分工作量明显超出本任务合理范围…可以只做
 *      单会话选一个 agent"）。
 *
 * 做的这一半——`AgentPicker` 接进来，选中后**发起新对话**（`CopilotKitV2PanelBody`
 * 用 `key={selectedAgentId}` 强制整个子树随选择重新挂载：新 `threadId`、新
 * `useAgent` 实例、空消息列表——"切换 agent" 与"这个面板打开时已经会做的事"是
 * 同一个语义单元，不是发明一套"迁移历史到新 agent"的机制）。
 *
 * 候选列表复用 `personal-chat-screen.tsx` 已验证过的 `listCapabilities(orgId,
 * "agent")` 读端口，不新建列表接口（任务说明明确要求）——同样继承那个组件文件头
 * 记录过的已知边界：候选来自 `capability_listings`（组织 agent 目录），与实际执行
 * 读的 `agents`/`agent_versions`（`resolvePublished`）不是同一张表（issue #787，
 * `chat-read-screen.tsx` 里 `RosterPanel` 的 `chat-roster-add-hint` 文案是同一个
 * 事实的另一处如实提示）——选中一个只在目录里、从未真正发布过的 agent 会在这里
 * 得到诚实的 `AGENT_NOT_FOUND` 错误横幅，不是本任务能力范围内要修的东西。
 *
 * `selectedAgentId` 经 `CopilotKitV2AgentSelectionProvider`（`layout.tsx` 挂在
 * `CopilotKitV2Providers` 外层）向上传给 `<CopilotKit headers>`，`route.ts` 的
 * `AgentsFactory` 据此构造这一轮请求真正打到的 `HttpAgent` URL——完整机制见
 * `lib/copilotkit-v2-agent-header.ts`/`route.ts` 里 `resolveAgentId` 的注释，本节
 * 不重复。
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
 * 「落地为产物」当时是 TODO，理由是 `markdownRenderer` 这个 slot 的类型签名只暴露
 * `content: string`、不携带 `messageId`。
 *
 * ⚠ **issue #2052（CK-P7）已落地，这条 TODO 不再有效**：入口不在 `markdownRenderer`
 *   这一层，而是随 CK-P3 的操作条挂在 `assistantMessage` **整组件** slot 上（那一层
 *   才携带 `message`），见 `copilotkit-v2-message-actions.tsx`。上面关于
 *   `markdownRenderer` 拿不到 id 的判断依然成立（那条路确实走不通），变的是绕过它的
 *   通道已经有了。"三者俱全才开放"这条纪律没有放松，只是三件都齐了：`threadId`
 *   （持久化线程）、`message.id`（CK-P3 的 `useChatMessageIdentity` 解析出的真实
 *   落库主键）、`bearer`（`sessionToken`）。
 *
 * `MarkdownMessage`/`ChatDiagramFabric` 在缺失这三者时仍如实退回"本地演示"（可读可
 * 最大化，不可持久化保存），那是既有产品行为，不是本次新引入的降级。
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
 * ── chat-parity-attachments（issue #2022，差距清单第 2 项，阻断级）────────────────
 *
 * 新轨道此前**零上传入口**——本节接入 📎 按钮 + 全 surface 拖拽落区，复用旧轨道
 * `chat-composer-attachments.tsx` 的 `useChatAttachments` 状态机（上传/进度/重试/
 * 移除三态，`POST /chat/threads/:threadId/attachments`）——不是重写一份。
 *
 * ## 附件内容如何真正到达 agent（不是"上传成功但看不到"的假功能）
 *
 * 排查确认（见 issue #2022 评论的完整调查记录）：`acceptHumanMessage`
 * （`apps/api/src/application/chat/message-roundtrip.ts`）——REST 与 AG-UI 两条
 * track 唯一共享的"消息落库"入口——早就支持一个可选的 `attachmentIds` 参数；一旦
 * 附件 id 到达这里，`execute-run.ts` 的 `withAttachmentNotice`/抽取子系统（新老
 * track 完全共用同一套）就会自动把抽取摘录拼进模型看到的 `content` 字符串。
 * 唯一断掉的一环是：AG-UI 桥（`agui-bridge.ts`/`copilotkit-agui.controller.ts`）
 * 此前从未把 `attachmentIds` 从请求体带到这一句调用——本任务在
 * `AguiRunInput.forwardedProps` 新增 `attachmentIds` 这个 key（与已有的
 * `chatThreadId` 同一套"透传字段"模式），控制器解析、限幅（复用
 * `ATTACHMENT_LIMITS.maxAttachmentsPerMessage`，不是新造一个数）后原样传给
 * `runAguiBridgeTurn` → `acceptHumanMessage`。之后完全是既有机制在工作，本文件
 * 不需要、也没有另建一条"读取附件内容"的通道。
 *
 * ## 上传要有一个真实的 `chat_threads` 行——不是本面板原来那个"每次挂载生成的
 * 本地随机 threadId"
 *
 * `POST /chat/threads/:threadId/attachments` 的 `threadId` 必须指向 DB 里真实
 * 存在的一行（`chat_message_attachments.thread_id` 外键）；本面板原来的
 * `threadId` state 只是本地 `useAgent` 用的关联 id，直到用户发出第一条消息、
 * AG-UI 桥内部 `resolveThreadId` 才会（可能）建一条真的 `chat_threads` 行，
 * 且事后才经 `chat_thread_id` CUSTOM 事件回显给前端（DA-19g，见上文"真实缺陷
 * 修复"一节）——这条回显在"发第一条消息之前"永远不存在，附件却恰恰需要在那之前
 * 就有地方可传。解法：`ensureAttachmentThread()` 在用户第一次点 📎 时，走与旧轨道
 * 「新建个人对话」完全同一个端点（`createPersonalThread`，`lib/live-chat.ts`）
 * 真建一条线程，只用于承载这一轮的附件上传；`send()` 时把它并入
 * `forwardedProps.chatThreadId`（**只在这一轮真的带了附件时**才这样做——没有附件
 * 的发送路径逐字节维持 DA-19g 已验证过的行为：turn 1 不传，continuation 靠
 * `chatThreadIdRef` 回显），因为 `acceptHumanMessage` 校验 `attachmentIds` 必须
 * 属于**这条 run 实际写入的**线程，附件所在线程与消息所在线程必须是同一个。
 * 这条线程建成后自然而然也成为 `chatThreadIdRef` 的种子（后续轮次的回显值与它
 * 一致），不产生第二条并行的续接机制。
 *
 * ## VFS（`vfs://attachment/<id>`）本轮不接——如实说明，不是漏做
 *
 * `active-file-panel.tsx`/`agui-file-events.ts` 头注已经登记"DA-15 事件目前没有
 * 真实生产者"，并明确把"`FilesystemMiddleware` 写入 → 落地为
 * `chat_message_attachments` → 真实 VFS id"列为需要另开任务评估的候选（不是本任务
 * 范围内可以顺手做完的事——附件走的是完全独立的 REST 上传端点，从未经过
 * `FilesystemMiddleware`/`file_created` 事件，两者本来就不是同一个产生源；把
 * 上传的附件伪装成"agent 打开的文件"塞进 `file_created` 事件会是本仓一贯反对的
 * 那种假映射）。本任务交付的"附件能被 agent 看到内容"这一核心功能与 VFS 集成
 * 相互独立，不因为没做后者就打折扣。
 *
 * 真实浏览器 e2e 证据（上传→引用→agent 回复体现出真看到了内容）见
 * `e2e/copilotkit-v2-attachments.spec.ts`。
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
/**
 * ⚠ **这两个值不在本文件声明** —— 唯一事实源是 `@repo/contracts` 的 `deep-agent-hitl.ts`
 * （issue #2017）。这里只是把它取出来用。
 *
 * 曾经这里写死 `"send_email"` 加 `{to, subject, body}`。那个名字在
 * `apps/deep-agent-service` 全树 grep **零命中**——它只是 e2e 确定性替身
 * （`loopback-deep-agent-provider.ts`）自己的剧本。真实引擎中断在
 * `call_skill` 上，桥原样转发引擎的真实工具名（`copilotkit-agui.controller.ts`
 * 的 `writeToolCallStep`，`toolCallName: step.toolName`，不改名不过滤），于是
 * 名字对不上 ⇒ `useHumanInTheLoop` 不认领这次调用 ⇒ 渲染成普通工具卡、
 * `respond` 恒 `undefined` ⇒ 三个决策按钮永远不出现 ⇒ run 停在
 * `awaiting_approval` 无人能裁决。这就是 `DEEP_AGENT_HITL_TOOLS` 此前不敢打开的原因。
 *
 * 修法**不是**把写死的错名字换成写死的对名字（那是下一次漂移的种子），而是让前端、
 * e2e 替身、部署开关三处全部从契约派生。改名字请改契约文件，不要改这里。
 */
const APPROVAL_TOOL_NAME = deepAgentHitl.DEEP_AGENT_HITL_TOOL_NAME;
const approvalToolParameters = deepAgentHitl.DeepAgentHitlToolArgs;

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
   * the HITL tool-call message that hosts this component is never
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

  /**
   * issue #2075（TW-A11Y-4）—— 「需要你批准」必须被播报。这是整条链路上最需要
   * 播报的一刻：不播报，屏幕阅读器用户根本不知道系统正在等他做决定，主观上就是卡死。
   */
  React.useEffect(() => {
    if (awaitingDecision) announceToChat("需要你的批准：发送邮件。请在审批对话框中选择批准、编辑或拒绝。");
  }, [awaitingDecision]);

  /**
   * issue #2075（TW-A11Y-5「关闭后焦点归位」）—— 真栈实测：关掉审批弹窗后
   * `document.activeElement` 是 **`BODY`**，键盘用户被扔回文档开头，丢掉全部上下文。
   *
   * 根因不是 Radix 没做焦点恢复，而是**它记下的那个"原焦点"本身已经失效**：
   * 用户点「发送」→ `agent.isRunning` 变真 → 发送按钮 `disabled` → 浏览器把焦点
   * 从这个被禁用的按钮收回给 `body`；弹窗随后才异步出现，Radix 记下的就是 `body`。
   * 于是"忠实地恢复原焦点"= 恢复到 body。**静态地读这段代码看不出问题**，
   * 只有活体跑才会暴露——这条正是 #2068 基线里点名的那个真实可达性缺陷。
   *
   * 修法：`onCloseAutoFocus` 里接管，把焦点还给 composer 输入框——那是用户在这条
   * 对话里"正在工作的地方"，比一个已经禁用的发送按钮更是他要回去的位置。
   */
  const focusComposer = React.useCallback((): void => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    composer?.focus();
  }, []);

  const returnFocusToComposer = React.useCallback((event: Event) => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    if (composer === null) return; // 找不到就让 Radix 走它的默认恢复，别把焦点弄丢
    event.preventDefault();
    composer.focus();
  }, []);

  /**
   * ⚠ 光有 `onCloseAutoFocus` **不够**——issue #2075 第四轮真栈实测：改完之后焦点
   * **仍然**落在 `BODY`。原因是这条链路上关闭不只有 Radix 那一条路径：Esc 触发
   * `respond("denied")` 之后框架会把整个 tool-render 子树摘掉，`DialogContent` 是被
   * **卸载**的，Radix 的关闭序列（连同 `onCloseAutoFocus`）根本没有机会跑完；
   * 而 Radix 的 FocusScope 在卸载时会把焦点恢复到它记下的那个元素——那个元素正是
   * 已经失效的 `body`。
   *
   * 所以再补一条与 Radix 无关的兜底：`close()` 时排两帧之后主动把焦点交回 composer。
   * 两帧（而不是一帧）是刻意的——要落在 Radix 自己那次恢复**之后**，否则我们先设、
   * 它后覆盖，结果和没改一样。两条路径设的是同一个目标元素，不冲突。
   */
  const closeAndReturnFocus = React.useCallback((): void => {
    close();
    requestAnimationFrame(() => requestAnimationFrame(focusComposer));
  }, [close, focusComposer]);

  if (!awaitingDecision || respond === undefined) {
    return (
      /* `open={!dismissed}` 而不是 `if (dismissed) return null` + `open`：
         直接 return null 会让 Radix 的关闭序列整个不发生，`onCloseAutoFocus` 也就
         永远不触发（焦点归位无从谈起）。受控 `open` 同样不残留遮罩——portal 内容
         在 `open=false` 时本来就不挂载，#1996 那条"永久点击拦截层"不会回来。 */
      <Dialog open={!dismissed} onOpenChange={(next) => { if (!next) closeAndReturnFocus(); }}>
        <DialogContent
          data-testid="copilotkit-v2-hitl-dialog"
          data-hitl-status={statusLabel}
          onCloseAutoFocus={returnFocusToComposer}
        >
          <DialogHeader>
            <DialogTitle>等待批准：发送邮件</DialogTitle>
            <DialogDescription>
              {statusLabel === "inProgress" ? "工具调用参数正在流式到达…" : "本轮已裁决，等待 run 收尾。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" data-testid="copilotkit-v2-hitl-dismiss" onClick={closeAndReturnFocus}>
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
      open={!dismissed}
      onOpenChange={(next) => {
        // 用户通过 Escape/点遮罩层/默认关闭图标退出时，等价于「拒绝」——不这样
        // 处理的话，Dialog 会正确卸载（不再残留遮罩），但框架合成的 respond
        // Promise 永远不会 resolve（human-in-the-loop.md "No respond call →
        // infinite hang"），run 会一直挂到后端自己的轮询超时才收场，属于
        // "看起来关掉了、实际状态没跟上"的另一种不一致，不是本次要放行的行为。
        if (!next) {
          closeAndReturnFocus();
          respond("denied");
        }
      }}
    >
      <DialogContent
        data-testid="copilotkit-v2-hitl-dialog"
        data-hitl-status={statusLabel}
        onCloseAutoFocus={returnFocusToComposer}
      >
        <DialogHeader>
          <DialogTitle>等待你的批准：发送邮件</DialogTitle>
          <DialogDescription>批准前可编辑收件人/主题/正文，裁决后由框架恢复这次 run。</DialogDescription>
        </DialogHeader>
        {!editing ? (
          <div className="flex flex-col gap-1">
            {/* issue #2039（第 3 轮 gap #5 的一半）——参数块加一个说明标签，
                不再是一坨无标题 JSON 直接怼在标题下面。 */}
            <p className="text-10 font-medium text-muted-foreground">工具参数（JSON）</p>
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border-subtle bg-muted px-2 py-1.5 text-11 text-muted-foreground"
              data-testid="copilotkit-v2-hitl-args"
            >
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
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
                  closeAndReturnFocus(); // 裁决完也要把焦点交回 composer（TW-A11Y-5）
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
              {/* issue #2039（第 3 轮 gap #5 的另一半）——「拒绝」带 destructive
                  语义色（outline 形态 + 红字），与「批准并继续」的 primary 拉开
                  层级；此前三个按钮两个长得一模一样。 */}
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive transition-colors duration-fast hover:bg-destructive/10 hover:text-destructive"
                data-testid="copilotkit-v2-hitl-reject"
                onClick={() => {
                  closeAndReturnFocus(); // 裁决完也要把焦点交回 composer（TW-A11Y-5）
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
                    closeAndReturnFocus(); // 裁决完也要把焦点交回 composer（TW-A11Y-5）
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

/**
 * issue #2023 —— agent 候选列表的数据源。逐字复用
 * `personal-chat-screen.tsx` 的 `useOrgAgentOptions`/`toAgentOption`（同一个
 * `listCapabilities(orgId, "agent")` 读端口、同一份"只取 `enabled` 条目"的过滤规则）
 * ——本文件不 import 那个组件内部的私有 hook（它没有导出，且那个文件是另一条并行
 * 任务同时在改的高冲突文件，见 issue #2023 描述的"文件冲突预期"），在这里独立写一份
 * 小的等价实现，不是重新设计一套不同的读法。
 */
type CopilotKitV2AgentOptionsState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string; readonly retry: () => void }
  | { readonly status: "ready"; readonly agents: GetAgentPanelOut["agents"] };

function copilotkitV2ToAgentOption(row: CapabilityListing): GetAgentPanelOut["agents"][number] {
  const trimmedName = row.name.trim();
  const abbrSource = trimmedName || row.id;
  return {
    id: row.id,
    abbr: abbrSource.slice(0, 2).toUpperCase(),
    name: trimmedName || row.id,
    duty: "组织已配置 Agent",
    roleLabel: "组织已配置 Agent",
    presence: "present",
  };
}

function useCopilotKitV2AgentOptions(orgId: string | null, bearer: string | null): CopilotKitV2AgentOptionsState {
  const sourceKey = orgId && bearer ? `${orgId} ${bearer}` : null;
  const [result, setResult] = React.useState<{ key: string; agents: GetAgentPanelOut["agents"] } | null>(null);
  const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!orgId || !bearer || !sourceKey) return;
    const key = sourceKey;
    const gen = ++generation.current;
    setFailure(null);
    try {
      const rows = await listCapabilities(orgId, "agent");
      if (gen !== generation.current) return;
      setResult({ key, agents: rows.filter((row) => row.enabled).map(copilotkitV2ToAgentOption) });
    } catch (err) {
      if (gen !== generation.current) return;
      setResult(null);
      setFailure({ key, message: err instanceof Error ? err.message : "读取组织 agent 目录失败" });
    }
  }, [orgId, bearer, sourceKey]);

  React.useEffect(() => {
    if (sourceKey) void load();
    return () => {
      generation.current += 1;
    };
  }, [load, sourceKey]);

  if (!sourceKey) return { status: "loading" };
  if (failure?.key === sourceKey) return { status: "error", message: failure.message, retry: () => void load() };
  if (result?.key === sourceKey) return { status: "ready", agents: result.agents };
  return { status: "loading" };
}

/**
 * issue #2023（差距清单第 4 项）—— 导出的外层组件。负责"选哪个 agent"这件事本身
 * （候选列表、选中状态、切换即开新对话），真正的对话状态机（`useAgent`/流式渲染/
 * HITL/语音输入……）全部留在下面 `CopilotKitV2PanelBody`（原来这个文件唯一的组件，
 * 改了个名字，内部逻辑一行未动）。
 *
 * `key={selectedAgentId}` 是这里唯一的"新机制"：换 agent = 卸载旧的 body、挂载全新
 * 一份（新的随机 `threadId`、新的 `useAgent` 实例、空 `agent.messages`）——与文件头注
 * "issue #2023 Agent 选择/切换"一节说的"切换 agent 就是发起新对话"是同一件事，不是
 * 另外发明一套"迁移历史到新 agent"的机制（那件事需要差距 #1 的持久化线程才谈得上）。
 */
/**
 * issue #2071 —— 消息区"贴底"判定的阈值，单一事实源：`handleMessagesScroll`（决定要
 * 不要显示"回到最新"悬浮按钮 + 要不要继续自动跟随新消息）与其测试共用同一个数字，
 * 不是各自维护一份容易漂移的 `80`。比"恰好贴底"（0px）宽松一点，避免子像素/字体
 * 度量误差导致贴底判定抖动（滚动到底后立刻因 1px 误差被判定为"离开了底部"）。
 */
export const SCROLL_BOTTOM_THRESHOLD_PX = 80;

/** 纯函数，供组件与单元测试共用——不依赖真实 DOM 布局，可以直接喂三个数字测。 */
export function isScrolledNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
}

export function CopilotKitV2Panel({
  chatThreadId: initialChatThreadId = null,
  onThreadResolved,
  onMessageSent,
  onArtifactLanded,
  threadAttachments = null,
  archived = false,
  canGeneratePersona = false,
}: {
  /**
   * issue #2021 —— 持久化的后端 `chat_threads.id`（不是 CopilotKit 本地
   * `threadId`，两者是本文件头注早已记录的两个独立命名空间）。由外壳
   * `copilotkit-v2-shell.tsx` 从 URL 路由参数传入；`null` = 一次全新对话（外壳的
   * `/chat/copilotkit-v2` 裸路由，或"新建对话"入口）。
   */
  chatThreadId?: string | null;
  /**
   * 首次发消息、后端真正创建出一条新线程（`resolveThreadId` 的 `null` 分支）时触发
   * 一次，交给外壳写回地址栏 + 刷新线程列表。`initialChatThreadId` 非空时（续聊一条
   * 已存在的线程）**不会**触发——`chatThreadIdRef` 已经等于外部传入的值。
   */
  onThreadResolved?: (threadId: string) => void;
  /**
   * issue #2046（CK-P1）—— 一条消息（可能带附件）的 run settle 后触发一次，
   * 外壳借此刷新右栏「材料」/「产物」计数（与旧轨道 `onMessageSent` 同名同义）。
   */
  onMessageSent?: () => void;
  /**
   * issue #2050 —— 一条消息被「落地为产物」之后触发，外壳据此重读右栏「产物」。
   * 与 `onMessageSent` 分开而不是复用它：那个是"发了一条消息"，这个是"多了一条产物"，
   * 合成一个回调会让外壳分不清自己在为什么重读（且未来两者刷新的东西可能不同）。
   */
  onArtifactLanded?: () => void;
  /**
   * issue #2046（CK-P2）—— `@` 引用候选：本线程已随消息发出的附件，数据与右栏
   * 「材料」面板是**同一份**（外壳 `listThreadAttachments` 读取后同时喂两处），
   * 不在本组件里发第二次请求。`null` = 外壳还没读到/没有线程。
   */
  threadAttachments?: ListThreadAttachmentsOut["items"] | null;
  /**
   * issue #2053（CK-P8，差距表 #11）—— 本线程是否已归档。事实来源是外壳的
   * `getThread(...).thread.archived`（`chat_threads.archived` 的真实投影），
   * 不是前端编出来的一个状态。`true` ⇒ composer 全禁 + 只读说明，语义与锚点
   * （`chat-composer-archived`）与旧轨道 `chat-live-message-panel.tsx` 逐字同套。
   */
  archived?: boolean;
  /**
   * issue #2053（CK-P6，差距表 #6）—— 「生成用户画像」的渲染门。事实来源是外壳
   * `getThread(...).capabilities` 是否含 `artifact.land`，与旧轨道
   * `canLandArtifacts` **同一个**服务端能力事实：persona-summary 内部走的正是
   * 同一条 landAsArtifact 写权门，没有这个能力摆按钮就是一枚必 403 的假按钮。
   */
  canGeneratePersona?: boolean;
} = {}): JSX.Element {
  const { session } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const bearer = session?.sessionToken ?? null;
  const agentOptions = useCopilotKitV2AgentOptions(orgId, bearer);
  const { selectedAgentId, setSelectedAgentId } = useCopilotKitV2AgentSelection();

  /**
   * issue #2020（差距清单第 3 项，阻断级）—— Skill 挂载入口。整个组件复用旧轨道的
   * `ChatSkillMountPanel`（`listThreadMounts`/`mountSkills`/`unmountSkill` 三条真实
   * 端点 + 乐观锁 version + `#` mention 联动），不重写一份挂载逻辑。
   *
   * ## 为什么挂在这一层（外层），不在 `CopilotKitV2PanelBody` 里
   *
   * `ChatSkillMountPanel` 需要的是**持久化的** `chat_threads.id`（挂载表
   * `thread_skill_mounts.thread_id` 的外键），即本组件的 `chatThreadId` prop——
   * 它由外壳从 URL 传入且在首轮消息 resolve 后经 `onThreadResolved` → shell →
   * 本 prop 反应式更新。Body 里的 `chatThreadIdRef` 是刻意**不触发渲染**的 ref
   * （见其头注），拿它当渲染依据要么读不到更新、要么得把它升级成 state 打破
   * 那条已验证的纪律。挂载生效机制完全在服务端（`acceptHumanMessage` 读
   * `threadMounts.activeMountedSkillVersionIds` 合进 run 快照，`agui-bridge.ts`
   * 走同一入口）——前端不需要把挂载结果传进任何一次 `runAgent` 调用，所以这
   * 两层之间除 mention 联动外没有数据流。
   *
   * ## 新对话（还没有线程）时如实显示占位，不伪造
   *
   * 挂载必须落在一条真实存在的 `chat_threads` 行上。`chatThreadId === null`
   * （裸 `/chat/copilotkit-v2` 且还没发过消息）时没有任何真实的挂载对象——
   * 显示一句诚实的说明，不渲染一个「看起来能挂、提交必然 404」的假面板。
   * 首轮消息发出、线程 resolve 后本 prop 变为真实 id，面板自动出现。
   */
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionResolvedNonce, setMentionResolvedNonce] = React.useState(0);
  const onMentionMounted = React.useCallback(() => setMentionResolvedNonce((v) => v + 1), []);

  // ⚠ 刻意**不**自动选中目录第一个候选（第一版这么做过，run5 对照实验实测抓到两个
  // 真问题才改掉）：① 目录序第一恰好可能是"只进目录、从未发布"的 agent（#787 已知
  // 裂痕），自动选中它 = 用户第一条消息就 AGENT_NOT_FOUND；② 未选择时本该走
  // `COPILOTKIT_V2_AGENT_ID`（服务端配置的可运行默认 agent）的既有路径被 header
  // 悄悄劫持——runtime-adapter 三条"不做选择"的既有 e2e 当场红给了看。与旧轨道
  // `pickDefaultAgentId` 的差异是结构性的：旧轨道 `createMessage` 的 `agentId` 是
  // 必填项、不选就发不了，只能替用户选；本轨道服务端本来就有默认 agent，"不选" 是
  // 一个真实存在且必须保持可用的状态，不需要也不应该在前端编造一个选择。

  return (
    <div className="flex h-full w-full flex-col gap-2 p-4">
      {/* issue #2020 —— Provider 包住 AgentPicker（Body 内）与 ChatSkillMountPanel 的
          共同父层：两者的浮层共享「同一时刻只开一个」互斥（`useChatPopoverSlot`），
          与旧轨道 `chat-read-screen.tsx` 同一挂法（issue #1803 gap #3）。 */}
      <ChatPopoverCoordinatorProvider>
      {/* issue #2039（第 3 轮 gap #4）——此前这一行只有一个裸的「选择 Agent ▾」
          幽灵按钮浮在页顶，与消息区没有任何层级关系。补一个 muted 说明标签 +
          行底分隔线，让它读作「这个屏的会话设置行」。 */}
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-2"
        data-testid="copilotkit-v2-agent-toolbar"
      >
        <span className="text-11 text-muted-foreground">发给</span>
        <AgentPicker
          agents={agentOptions.status === "ready" ? agentOptions.agents : null}
          selectedAgentId={selectedAgentId ?? ""}
          disabled={agentOptions.status !== "ready"}
          onSelect={(agentId) => setSelectedAgentId(agentId)}
          // 顶栏放置必须向下弹——2026-08-25 人类 devapp 实测：默认向上弹出屏不可见。
          side="down"
        />
        {agentOptions.status === "error" ? (
          <span className="text-11 text-destructive" data-testid="copilotkit-v2-agent-options-error">
            {agentOptions.message}
            <button
              type="button"
              className="ml-1 underline"
              data-testid="copilotkit-v2-agent-options-retry"
              onClick={agentOptions.retry}
            >
              重试
            </button>
          </span>
        ) : null}
        {agentOptions.status === "ready" && agentOptions.agents.length === 0 ? (
          <span className="text-11 text-muted-foreground" data-testid="copilotkit-v2-no-agents-hint">
            这个组织还没有可用的 Agent，先去
            <a href="/admin/agent" className="mx-1 text-primary underline">后台创建一个 Agent</a>
            才能发消息。
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {/* 未选择（`null`）也照常渲染——这时请求不带选择 header，服务端用
            `COPILOTKIT_V2_AGENT_ID` 默认 agent（与本任务之前逐字节相同的路径）。
            key 里的 `"__server_default__"` 只是 React 重挂载边界的占位段，不会出现在
            任何请求里（header 由 `selectedAgentId === null` 时不设置来保证）。 */}
        {/* ⚠ key 只含 agent 选择，刻意**不含** `initialChatThreadId`——首轮发消息后
            外壳经 `onThreadResolved` 拿到新线程 id 时，如果 key 跟着变，Body 会在
            run 仍在途时被整个重挂载：SSE 被杀、`agent.messages` 清空（2026-08-25
            合成 #2021×#2023 时实测 4 条 e2e 全红抓到的真回归）。#2021 用
            `history.replaceState` 而非 router 状态正是为了避开这次重渲染；线程
            切换走 `[threadId]` 路由级重挂载，天然新 mount，不需要 key 参与。 */}
        <CopilotKitV2PanelBody
          key={selectedAgentId ?? "__server_default__"}
          chatThreadId={initialChatThreadId}
          onThreadResolved={onThreadResolved}
          onMessageSent={onMessageSent}
          onArtifactLanded={onArtifactLanded}
          threadAttachments={threadAttachments}
          archived={archived}
          canGeneratePersona={canGeneratePersona}
          onMentionQueryChange={setMentionQuery}
          mentionResolvedNonce={mentionResolvedNonce}
          actingAgentId={selectedAgentId}
          actingAgentLabel={
            agentOptions.status === "ready"
              ? (agentOptions.agents.find((a) => a.id === selectedAgentId)?.name ?? null)
              : null
          }
        />
      </div>
      {/* issue #2020 —— 挂载栏放在 composer（Body 底部）之后，与旧轨道人类裁决的
          位置语义一致（「挂了什么」与「要发什么」同一处视野）。个人线程 projectId
          缺省（#1693 起服务端从线程反推授权）。 */}
      {initialChatThreadId !== null && bearer !== null && orgId !== null ? (
        <ChatSkillMountPanel
          threadId={initialChatThreadId}
          orgId={orgId}
          bearer={bearer}
          mentionQuery={mentionQuery}
          /* issue #2046（CK-P2）——v2 轨道触发符改 `/`（对齐 Claude Code），
             旧轨道 `/chat/legacy` 缺省仍是 `#`。 */
          mentionTriggerChar="/"
          onMentionMounted={onMentionMounted}
        />
      ) : (
        <p className="border-t border-border px-4 py-2 text-11 text-muted-foreground" data-testid="copilotkit-v2-skill-mount-placeholder">
          {bearer === null
            ? "登录后才能给对话挂载 skill。"
            : "发出第一条消息、对话建立后，就可以在这里给本对话挂载 skill（也可以在输入框里敲 / 快速挂载）。"}
        </p>
      )}
      </ChatPopoverCoordinatorProvider>
    </div>
  );
}

function CopilotKitV2PanelBody({
  chatThreadId: initialChatThreadId = null,
  onThreadResolved,
  onMessageSent,
  onArtifactLanded,
  threadAttachments = null,
  archived = false,
  canGeneratePersona = false,
  onMentionQueryChange,
  mentionResolvedNonce,
  actingAgentId = null,
  actingAgentLabel = null,
}: {
  chatThreadId?: string | null;
  /** CK-P3（#2054）—— 当前发送 agent 的真实 id，供逐条消息的「对 agent 提反馈」归因；
   *  用户未选择（走服务端配置的默认 agent）时为 `null`，此时不画反馈入口。 */
  actingAgentId?: string | null;
  actingAgentLabel?: string | null;
  onThreadResolved?: (threadId: string) => void;
  /** issue #2046（CK-P1）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  onMessageSent?: () => void;
  /**
   * issue #2050 —— 一条消息被「落地为产物」之后触发，外壳据此重读右栏「产物」。
   * 与 `onMessageSent` 分开而不是复用它：那个是"发了一条消息"，这个是"多了一条产物"，
   * 合成一个回调会让外壳分不清自己在为什么重读（且未来两者刷新的东西可能不同）。
   */
  onArtifactLanded?: () => void;
  /** issue #2046（CK-P2）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  threadAttachments?: ListThreadAttachmentsOut["items"] | null;
  /** issue #2053（CK-P8）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  archived?: boolean;
  /** issue #2053（CK-P6）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  canGeneratePersona?: boolean;
  /**
   * issue #2020 —— composer 里敲 `#` 的 mention 检测上报（`null` = 没有活跃 mention）。
   * 消费方是外层的 `ChatSkillMountPanel`：它把 query 当「+」按钮的另一个触发源，
   * 挂载逻辑仍只有它那一份（不在这里写第二份 `mount()`）。
   */
  onMentionQueryChange?: (query: string | null) => void;
  /** 挂载成功后外层 +1——本组件据此把 `#query` 字面量从输入框正文里删掉。 */
  mentionResolvedNonce?: number;
} = {}): JSX.Element {
  const { copilotkit } = useCopilotKit();
  const [threadId] = React.useState(() => `copilotkit-v2-${crypto.randomUUID()}`);
  const { agent, isReady } = useAgent({
    agentId: threadId,
    runtimeAgentId: "default",
    threadId,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const [inputDraft, setInputDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  /**
   * issue #2020 → #2046（CK-P2）—— composer mention 检测。#2020 首版只有 `#`
   * （skill）；2026-08-25 人类裁决后：skill 触发符改 `/`（对齐 Claude Code，仅行首
   * 或空白后生效，路径/URL 里的斜杠不误触），并新增 `@`（引用本线程已随消息发出的
   * 附件，平移旧 composer `recomputeMentions` 的语义）。检测规则本体抽在
   * `lib/composer-mention-detection.ts`（纯函数，正反例单测在
   * `tests/ui/composer-mention-detection.test.ts`），这里只持有状态。
   */
  const [mention, setMention] = React.useState<ComposerMention | null>(null);
  const recomputeMention = (value: string, caret: number | null): void => {
    setMention(detectComposerMention(value, caret));
  };
  const skillMention = mention?.kind === "skill" ? mention : null;
  const attachmentMention = mention?.kind === "attachment" ? mention : null;
  React.useEffect(() => {
    onMentionQueryChange?.(skillMention?.query ?? null);
    // `onMentionQueryChange` 是外层 setState（稳定引用），不进依赖——同旧 composer。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillMention?.query]);
  /** 挂载真的发生了之后，把 `/query` 从正文里删掉——留着字面量会让用户以为还要
   *  手动发送一条以 `/` 开头的消息（同旧 composer 的 `mentionResolvedNonce` 语义）。 */
  const previousMentionResolvedNonce = React.useRef(mentionResolvedNonce);
  React.useEffect(() => {
    if (mentionResolvedNonce === undefined) return;
    if (previousMentionResolvedNonce.current === mentionResolvedNonce) return;
    previousMentionResolvedNonce.current = mentionResolvedNonce;
    if (skillMention === null) return;
    setInputDraft((current) => current.slice(0, skillMention.start) + current.slice(skillMention.start + 1 + skillMention.query.length));
    setMention(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionResolvedNonce]);

  /**
   * issue #2046（CK-P2）—— `@` 候选与插入，语义平移旧 composer：候选是本线程
   * **已随消息发出**的附件（外壳下传的「材料」同一份数据），选中把 `@文件名 `
   * 当纯文本插进正文——靠 F155 file-retrieval 的 `search_tsv`（filename 已编进
   * 检索索引）自然召回，不碰 `attachmentIds`（那条路径的 `ATTACHMENT_NOT_PENDING`
   * 校验本就不允许一个附件被两条消息重复引用）。
   */
  const attachmentOptions = React.useMemo(() => {
    const byFilename = new Map<string, { id: string; filename: string }>();
    for (const item of threadAttachments ?? []) {
      if (!byFilename.has(item.filename)) byFilename.set(item.filename, { id: item.id, filename: item.filename });
    }
    return Array.from(byFilename.values());
  }, [threadAttachments]);
  const visibleAttachmentOptions = attachmentMention
    ? attachmentOptions.filter((a) => a.filename.toLowerCase().includes(attachmentMention.query.toLowerCase()))
    : [];
  const insertAttachmentMention = (filename: string): void => {
    if (attachmentMention === null) return;
    setInputDraft((current) =>
      current.slice(0, attachmentMention.start)
      + `@${filename} `
      + current.slice(attachmentMention.start + 1 + attachmentMention.query.length));
    setMention(null);
  };

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
  /**
   * issue #2021 —— 初始值不再恒为 `null`：外壳传入 `chatThreadId`（URL 里的持久化
   * id）时，第一轮 `send()` 就带上它当 `forwardedProps.chatThreadId`，而不是像此前
   * 那样只有第二轮起才续接。这正是"刷新页面后同一个 URL 能恢复到同一条对话"这条
   * 判据要求的：刷新后组件重新挂载，`chatThreadIdRef` 必须从 URL 里的值起步，不能
   * 靠"这次浏览器会话已经聊过一轮"这个此前隐含的前提。
   */
  const chatThreadIdRef = React.useRef<string | null>(initialChatThreadId);


  /**
   * issue #2052（CK-P7）—— `chatThreadIdRef` 刻意是 ref（它只影响"下一次 runAgent 带什么"，
   * 不该触发渲染），但「落地为产物」要往 `POST /chat/threads/:threadId/artifacts` 打，
   * 必须在**渲染期**知道这条线程的真实 id。所以这里另存一份 state：同一个事实的两种
   * 用法（一个给下一次请求、一个给这一帧渲染），两者在同一个事件处理器里一起写，
   * 不会漂移——不是两个独立维护的来源。
   */
  const [resolvedChatThreadId, setResolvedChatThreadId] = React.useState<string | null>(initialChatThreadId);
  React.useEffect(() => {
    if (initialChatThreadId !== null) setResolvedChatThreadId(initialChatThreadId);
  }, [initialChatThreadId]);

  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event?.name === "chat_thread_id" && typeof event.value === "string" && event.value !== "") {
          const isNewlyResolved = chatThreadIdRef.current === null;
          chatThreadIdRef.current = event.value;
          setResolvedChatThreadId(event.value); // issue #2052，见上面 state 的说明

          // issue #2021 —— 只有"这是后端第一次告诉我们它创建了一条新线程"才需要通知
          // 外壳写回地址栏；`initialChatThreadId` 非空时 `chatThreadIdRef.current` 从
          // 挂载起就已经是这个值，这个分支不会为一次续聊触发。
          if (isNewlyResolved) onThreadResolved?.(event.value);
        }
      },
    });
    return unsubscribe;
    // `onThreadResolved` 由外壳用 `useCallback` 提供稳定引用；把它加进依赖数组会在
    // 外壳每次 `reloadThreads` 状态更新时重新订阅/取消订阅，没有必要。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  /**
   * issue #2021 —— 消息持久化的另一半：`agent.messages` 是纯内存态
   * （`useAgent`/`@ag-ui/client` 本身不做任何持久化），组件挂载时必须从后端已经真实
   * 落库的 `chat_messages` 回读一遍，`agent.setMessages(...)` 灌回去——不这样做的话，
   * 即使地址栏带着正确的 `chatThreadId`、下一轮发消息也确实会续接同一条后端线程，
   * 用户在**这一次挂载**里仍然看不到刷新前的历史，等于只修了"续聊"没修"看得见"。
   *
   * 只在 `initialChatThreadId` 非空时跑（新对话没有历史可读）；用 `cursor` 分页跑到
   * `nextCursor` 为 `null`，不是"读一页就假装读完了"——`listMessages` 契约本身要求
   * 调用方分页（`R9`），单页上限 100。
   *
   * ## ⚠ 必须等 `isReady`，且依赖数组必须含 `agent`——第一版 `[]` 依赖是真 bug
   *
   * 第一版这个 effect 用 `[]` 空依赖"只在挂载时跑一次"，历史读回来了、
   * `setMessages` 也调了，但视图永远空白（coordinator 合并后真栈截图实测）。根因
   * 读 `@copilotkit/react-core/dist/v2/headless.mjs` 的 `useAgent` 源码确认：传
   * `runtimeAgentId` 时，首次渲染返回的是一个 **provisional**（临时占位）agent 实例
   * （`isReady: false`，存在 `provisionalAgentCache`）；`registerProxiedAgent` 的
   * effect 完成注册后，后续渲染返回的是**另一个**真实 proxy agent 实例
   * （`isReady: true`），provisional 那个被直接丢弃。空依赖的 effect 闭包捕获的正是
   * 首帧那个 provisional 实例——`setMessages` 写进了一个马上被扔掉的对象，真实
   * agent 的 `messages` 从头到尾是空的。`AbstractAgent.setMessages` 本身**会**通知
   * `onMessagesChanged` 订阅者（读 `@ag-ui/client` dist 源码确认），不是"通知机制
   * 不触发"——是写错了对象。
   *
   * 修法：依赖 `[agent, isReady, ...]`，`isReady === false` 时直接不跑（provisional
   * 帧被跳过），`hydratedRef` 保证同一个真实实例只灌一次。apply 时若 `agent.messages`
   * 已非空（用户在历史加载完成前就抢先发了消息——真实竞态，不是假设），把历史
   * **前插**并按 id 去重，不整体覆盖——覆盖会杀掉在途 run 已经流进来的内容。
   */
  /**
   * CK-P3（issue #2054）—— 逐条消息操作要用的「视图 id → 真实 `chat_messages.id`」索引。
   * 为什么不能直接用 `message.id`（流式那半是临时聚合 id，评分会 404）见
   * `lib/copilotkit-v2-message-identity.ts` 文件头的完整取证。
   */
  const { index: messageIdentity, registerHydrated } = useChatMessageIdentity(agent);

  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const hydratedRef = React.useRef(false);
  /**
   * issue #2039（UIUX 三轮迭代第 1 轮 gap #3 的一半，uiux-standards U1）——
   * 历史回读在途时消息区不能是一片空白：`historyLoading` 只是上面这个既有
   * hydration effect 的**渲染投影**（初值 = 有历史可读；effect 落定或失败时归
   * false），不改变 hydration 逻辑本身一行。
   */
  const [historyLoading, setHistoryLoading] = React.useState(initialChatThreadId !== null);
  React.useEffect(() => {
    if (initialChatThreadId === null || !isReady || hydratedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const bearer = getStoredSessionToken() ?? undefined;
        // 分页读取用 main 抽出的 `readAllPersistedMessages`（"怎么把一条线程读完"
        // 只有一份写法），不在这里复制第二遍循环。
        const collected = await readAllPersistedMessages(initialChatThreadId, bearer);
        // CK-P3（#2054）—— 「可评分」比「消息真实存在」多一道门：还要求它由 agent
        // 写回且带 `agentRunId`（服务端第三道归因门，见
        // `lib/copilotkit-v2-message-identity.ts`）。这两个判据由
        // `readAllPersistedMessages` 一并投影出来（`rateable`），不为它再读一遍库。
        const identities = collected.map((m) => ({ id: m.id, rateable: m.rateable }));
        if (cancelled) return;
        hydratedRef.current = true;
        registerHydrated(identities);
        // ⚠ 只把框架认识的三个字段喂进去：`rateable` 是本仓自己的投影，
        //   不该混进 AG-UI 消息对象。
        const framed = collected.map((m) => ({ id: m.id, role: m.role, content: m.content }));
        const live = agent.messages;
        if (live.length === 0) {
          agent.setMessages(framed);
        } else {
          const liveIds = new Set(live.map((m) => m.id));
          agent.setMessages([...framed.filter((m) => !liveIds.has(m.id)), ...live]);
        }
        setHistoryLoading(false);
      } catch (e) {
        if (cancelled) return;
        setHistoryLoading(false);
        setHistoryError(e instanceof Error ? e.message : "历史消息读取失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, isReady, initialChatThreadId, registerHydrated]);

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

  /**
   * chat-parity-attachments (issue #2022) —— 见本文件头注该节完整取舍。`ChatAttachmentButton`/
   * 拖拽落区是共享组件，点击/拖入会直接触发 `ctl.pickFiles`（真实网络上传），没有
   * "先准备好线程再允许操作"的钩子可插——所以这里在已登录时**挂载后立即**真建一条
   * 附件专用线程（`createPersonalThread`，与旧轨道「新建个人对话」同一端点），而不是
   * 等第一次点 📎 才建：这样 📎 按钮从第一次渲染起就可用，不需要"先点一下准备、
   * 再点一下才真的弹出上传面板"这种两段式交互。未登录时不建（上传本来就要鉴权），
   * 📎 按钮改为禁用态并说明原因。建失败时 `attachmentThreadId` 保持 `null`，📎 按钮
   * 保持禁用而不是让用户点进一个必然 404/403 的上传请求。
   */
  /**
   * issue #2046（CK-P1 连带修复）—— `initialChatThreadId` 非空（`[threadId]` 持久化
   * 线程页面）时**直接用它**承载上传，不再另建一条线程。#2032 落地时还没有 #2028
   * 的持久化线程页面；两者合成后，原来的「挂载即另建附件专用线程」在线程页上是
   * 一个真实 bug：附件上传进了新建的那条线程，`send()` 的 `chatThreadId` 却是
   * URL 线程——`acceptHumanMessage` 校验 attachmentIds 必须属本线程
   * （`message-roundtrip.ts`，不属 → 422），带附件的发送必然失败；右栏「材料」
   * （读 URL 线程的 `chat_message_attachments`）也永远看不到它们。
   * 只有全新对话（`initialChatThreadId === null`）才保留原来的挂载即建逻辑。
   */
  const [createdAttachmentThreadId, setCreatedAttachmentThreadId] = React.useState<string | null>(null);
  const attachmentThreadRequestedRef = React.useRef(false);
  React.useEffect(() => {
    if (initialChatThreadId !== null) return;
    if (sessionToken === null || attachmentThreadRequestedRef.current) return;
    attachmentThreadRequestedRef.current = true;
    void createPersonalThread(null)
      .then((created) => setCreatedAttachmentThreadId(created.threadId))
      .catch(() => {
        attachmentThreadRequestedRef.current = false; // 允许下次 sessionToken 变化时重试
      });
  }, [sessionToken, initialChatThreadId]);
  const attachmentThreadId = initialChatThreadId ?? createdAttachmentThreadId;
  const attach = useChatAttachments({ threadId: attachmentThreadId ?? "", bearer: sessionToken ?? undefined });

  /**
   * issue #2052（CK-P7）—— 「落地为产物」状态机（与旧轨道共用 `useMessageLanding`，
   * 不抄第二份）。传空串是 hook 的既有约定：调用方保证只在三者俱全时渲染入口，见下面
   * `landingContext` 的 `null` 分支——空串永远不会真的被拿去发请求。
   */
  const landing = useMessageLanding({
    threadId: resolvedChatThreadId ?? "",
    bearer: sessionToken ?? "",
    onArtifactLanded,
  });

  /**
   * ⛔ 三者俱全才开放：真实线程 id + bearer + 这条消息的**真实落库 id**。
   *
   * ⚠ 第三件**不再由本文件自己维护一张映射表**：CK-P3（#2054，PR #2064）已经落地了
   *   `useChatMessageIdentity` —— 它订阅同一个 `CUSTOM chat_message_id` 事件、并把
   *   hydration 回灌的历史消息一并登记，`resolve()` 拿不到就返回 `null`。评分与落地
   *   问的是**同一个问题**（"这条气泡在 `chat_messages` 里的主键是什么"），各存一份
   *   就是同一事实两处声明。所以这里直接复用那个索引，本轮删掉了自己那份重复实现。
   */
  const landingContext = React.useMemo<AssistantMessageLandingValue | null>(() => {
    if (resolvedChatThreadId === null || sessionToken === null) return null;
    return {
      stateFor: landing.stateFor,
      open: landing.open,
      updateTitle: landing.updateTitle,
      cancel: landing.cancel,
      submit: (message) => void landing.submit(message),
    };
  }, [resolvedChatThreadId, sessionToken, landing]);
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
    description: "在真正执行这个技能之前，请人确认参数",
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

  /**
   * CK-P4（issue #2054）—— run 进度：已耗时 / 阶段文案 / 45s longrun 提示。
   * 逐维「v2 侧真的拿得到什么」的核实结论写在 `lib/copilotkit-v2-run-progress.ts`
   * 文件头（拿不到的三维如实登记为不做，没有伪造）。
   */
  const runProgress = useCopilotKitV2RunProgress(agent, agent.isRunning);

  /**
   * issue #2075（TW-A11Y-4）—— agent 状态变化播报。视觉用户看得到运行状态条在动
   * （`copilotkit-v2-running-indicator` / `copilotkit-v2-thinking`），屏幕阅读器用户
   * 此前什么都听不到。这里只播**状态迁移**（开始/结束），不播每一帧耗时——
   * 每秒念一次"已耗时 7 秒"会把 live region 变成噪声源。
   */
  const wasRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (agent.isRunning && !wasRunningRef.current) announceToChat("正在处理你的请求……");
    if (!agent.isRunning && wasRunningRef.current) announceToChat("回复已生成。");
    wasRunningRef.current = agent.isRunning;
  }, [agent.isRunning]);

  /** CK-P4 —— 最近一次真的发出去的用户消息，供错误横幅上的「重试」重发。 */
  const lastSentRef = React.useRef<{ text: string; attachmentIds: readonly string[] } | null>(null);

  const send = React.useCallback(
    async (override?: string) => {
      const text = (override ?? inputDraft).trim();
      if (text === "" || agent.isRunning) return;
      // chat-parity-attachments (issue #2022) -- 上传未完成时不发送，与 composer 里
      // 附件行的 spinner/进度条同一份诚实约束（旧轨道 `ChatAttachMaterialModal`
      // 「加入这一轮」按钮同一条禁用逻辑）。
      if (attach.hasUploading) return;
      setError(null);
      setInputDraft("");
      // issue #2020 —— 正文已清空，活跃 mention 一并终结（不清的话外层的候选面板
      // 会带着一个已不存在于正文里的 query 继续开着）。
      setMention(null);
      // CK-P4（issue #2054）—— 记住这一轮的用户正文，供失败后的「重试」重发。
      // ⚠ 存的是**已发出**的那句，不是 composer 里的当前草稿：用户看到失败横幅时
      //   很可能已经在输入框里敲别的了，重试要重发失败的那一句。
      lastSentRef.current = { text, attachmentIds: attach.uploadedIds };
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      // chat-parity-attachments (issue #2022) -- 本轮已上传成功的附件 id；发送后清空
      // composer 的 pending 队列（同旧轨道语义：已发出的附件从 composer 移到"材料"）。
      const attachmentIds = attach.uploadedIds;
      // 附件必须挂在它们实际所在的那条真实线程上（`acceptHumanMessage` 校验
      // attachmentIds 归属），所以本轮一旦带了附件，chatThreadId 就必须是
      // `attachmentThreadId`——即便这是 turn 1（DA-19g 原本"turn 1 不传"的前提是
      // "还没有任何真实线程"，本轮已经因为附件而有了）。没有附件的路径完全不变。
      const chatThreadId = chatThreadIdRef.current ?? (attachmentIds.length > 0 ? attachmentThreadId : null);
      try {
        // DA-19g -- echo the resolved Chat thread id back on every turn AFTER the first
        // (see the `chatThreadIdRef` block above for why this is the fix, not a new
        // mechanism). Omitted entirely on turn 1 -- identical to pre-fix behaviour, UNLESS
        // this turn carries attachments (chat-parity-attachments, issue #2022 -- see above).
        const forwardedProps: { chatThreadId?: string; attachmentIds?: readonly string[] } = {};
        if (chatThreadId !== null) forwardedProps.chatThreadId = chatThreadId;
        if (attachmentIds.length > 0) forwardedProps.attachmentIds = attachmentIds;
        await copilotkit.runAgent(
          Object.keys(forwardedProps).length > 0 ? { agent, forwardedProps } : { agent },
        );
        if (attachmentIds.length > 0) attach.clear();
        // issue #2046（CK-P1）—— run settle 后通知外壳刷新右栏「材料」/「产物」
        // （消息与附件此时都已真实落库；与旧轨道 `onMessageSent` 同语义）。
        onMessageSent?.();
      } catch (e) {
        // DA-19g -- 与上面 `copilotkit.subscribe({ onError })` 走同一份文案映射
        // （`copilotkit-v2-error-copy.ts`），不在这条分支单独拼一句可能带原始异常
        // message（往往是英文技术细节，同样不是人话）。这条分支现在只兜"`runAgent()`
        // 自己抛出 JS 异常"这种更边缘的情况——常规的 `RUN_ERROR` 事件已经被上面的
        // `onError` 订阅接住，不会再走到这里。
        setError(describeCopilotkitV2RunError(e instanceof Error ? e.message : "COPILOTKIT_RUNTIME_RUN_FAILED"));
      }
    },
    [agent, copilotkit, inputDraft, attach, attachmentThreadId, onMessageSent],
  );

  /**
   * ── issue #2053 CK-P6「生成用户画像」（差距表 #6）────────────────────────────
   *
   * 平移旧轨道 `chat-live-message-panel.tsx` 的 `runPersonaSummary`：一次
   * `POST /chat/threads/:threadId/persona-summary`，扫全线程产出画像，产物以一条
   * assistant 消息（```mermaid mindmap 围栏）落回线程，走既有
   * `MarkdownMessage → ChatDiagramFabric` 通道渲染。
   *
   * ## 与旧轨道**唯一**的实现差异，以及为什么必须有这个差异
   *
   * 旧轨道的 `messages` 本身就是 `listMessages` 读回来的持久化消息，取
   * `messages[messages.length - 1].id` 当锚点天然就是 `chat_messages.id`。
   * 本轨道的 `agent.messages` 是 **AG-UI 流式消息**——它里面的 id 只有"挂载时从
   * 后端灌回的历史"那一段等于 `chat_messages.id`，本次会话里新流进来的那些是
   * CopilotKit/AG-UI 自己生成的、后端**不认识**的 id（本文件头注早就记录过这是两个
   * 独立命名空间）。直接拿 `agent.messages` 末条的 id 去调，在"刚发完一条消息就点
   * 生成画像"这条最常见的路径上必然拿到一个后端查不到的锚点——那正是本仓反复禁止的
   * 「点了才报错的假按钮」。所以这里点击时**现读一次**持久化消息
   * （`readAllPersistedMessages`），锚点取其最后一条。
   *
   * 结果回显同理：用契约回给的 `out.resultMessageId` 去那份持久化读回里定位那条
   * assistant 消息，**只追加这一条**到 `agent.messages`，不整体覆盖——覆盖会杀掉
   * 在途 run 已经流进来的内容（与上面历史灌回那段是同一条纪律）。
   *
   * 失败**原样回显 reasonCode**，不糊一句「生成失败」（旧轨道同款；契约 err 有三档：
   * NOT_VISIBLE / NO_WRITE_ROLE / STORAGE_UNAVAILABLE，用户对它们的处置完全不同）。
   */
  const [personaRunning, setPersonaRunning] = React.useState(false);
  const [personaFailure, setPersonaFailure] = React.useState<string | null>(null);
  const runPersonaSummary = React.useCallback(async () => {
    if (initialChatThreadId === null || personaRunning) return;
    setPersonaRunning(true);
    setPersonaFailure(null);
    try {
      const bearer = getStoredSessionToken() ?? undefined;
      const persisted = await readAllPersistedMessages(initialChatThreadId, bearer);
      const anchor = persisted[persisted.length - 1];
      if (anchor === undefined) {
        setPersonaFailure("这条对话还没有已落库的消息，无法生成画像。");
        return;
      }
      const out = await summarizePersonaFromThread(initialChatThreadId, anchor.id, bearer);
      const after = await readAllPersistedMessages(initialChatThreadId, bearer);
      const result = after.find((m) => m.id === out.resultMessageId);
      if (result === undefined) {
        // 服务端说写了、读回却没有——不假装成功，也不假装失败：如实说清楚现状与出路。
        setPersonaFailure("画像已生成，但没能立刻读回那条消息。刷新页面即可看到。");
        return;
      }
      if (!agent.messages.some((m) => m.id === result.id)) {
        agent.setMessages([...agent.messages, result]);
      }
      // 画像同时落了一件产物（`out.artifactId`）——通知外壳刷新右栏「产物」栏，
      // 与 `send()` 里 run settle 后那次是同一个通道、同一个理由。
      onMessageSent?.();
    } catch (failure) {
      setPersonaFailure(
        failure instanceof ApiError
          ? `生成用户画像失败：${failure.reasonCode ?? `HTTP ${failure.status}`}`
          : failure instanceof Error
            ? `生成用户画像失败：${failure.message}`
            : "生成用户画像失败。",
      );
    } finally {
      setPersonaRunning(false);
    }
  }, [agent, initialChatThreadId, onMessageSent, personaRunning]);

  /**
   * issue #2071 —— 消息区没有"跳到最新"手段：新消息到达时不自动贴底，长线程往上翻阅
   * 后也没有回到底部的入口，只能手动拖滚动条。做法对齐 Slack/Discord/ChatGPT 的常见
   * 约定（`CopilotChatView.ScrollView` 库内置的 `pin-to-bottom` 语义同款做法，本仓
   * 选自己写而不是接那个组件——见下方"为什么不用库自带 ScrollView"）：贴底时新消息
   * 自动跟随；一旦往上翻离开底部，自动跟随停止，改为在消息区右下角浮现"↓回到最新"
   * 按钮；键盘 `Cmd/Ctrl+End` 随时可跳回底部，与输入框里普通 `End`（移到行尾）不冲突
   * （只认组合键）。
   *
   * ## 为什么不直接接库自带的 `CopilotChatView.ScrollView`
   *
   * 它确实自带同款语义（`autoScroll="pin-to-bottom"` + `scrollToBottomButton` slot），
   * 但它的测量假设（`inputContainerHeight`/`feather`）是围绕"composer 本身也在
   * ScrollView 内"设计的，本面板 composer 在这个滚动容器**外面**自绘（下方错误横幅、
   * composer 区块都在 `overflow-y-auto` 容器之外）——接入前没有把握它的内部布局假设
   * 不会跟 #2039 三轮 UIUX 迭代过的布局打架。手写这套（滚动位置判定 + 条件贴底 +
   * 悬浮按钮）改动可预期，不依赖库的内部测量逻辑。
   */
  const messagesContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const scrollMessagesToBottom = React.useCallback((behavior: ScrollBehavior) => {
    const el = messagesContainerRef.current;
    // jsdom（组件测试环境）不实现 `Element.scrollTo`——与下面 `matchMedia` 同一类
    // "真实浏览器才有、测试环境没有"的能力守卫，不是本功能的正常路径分支。
    if (el === null || typeof el.scrollTo !== "function") return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setIsAtBottom(true);
  }, []);

  const prefersReducedMotion = React.useCallback((): boolean => {
    // 与 `use-section-navigation.ts` 同一处守卫——jsdom 测试环境不提供 `matchMedia`。
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const handleMessagesScroll = React.useCallback(() => {
    const el = messagesContainerRef.current;
    if (el === null) return;
    setIsAtBottom(isScrolledNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight));
  }, []);

  // 贴底时新消息/流式增量到达自动跟随；一旦用户往上翻（`isAtBottom` 变 false），
  // 这个 effect 直接不跑，不打断阅读——与 Slack/Discord 同一条纪律。
  React.useEffect(() => {
    if (!isAtBottom) return;
    const el = messagesContainerRef.current;
    if (el === null || typeof el.scrollTo !== "function") return;
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [agent.messages, isAtBottom, prefersReducedMotion]);

  // `Cmd/Ctrl+End` 跳到最新——只认组合键，不拦截输入框里普通 `End`（移到行尾）。
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "End" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      scrollMessagesToBottom(prefersReducedMotion() ? "auto" : "smooth");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scrollMessagesToBottom, prefersReducedMotion]);

  return (
    <div className="flex h-full w-full gap-3">
      {/* DA-13 -- 左栏：流式对话与决策过程，不变；右栏（下方，条件渲染）是新增的活动
          文件工作台，两栏各占一半宽度，右栏没有任何文件时不占位（见 ActiveFilePanel
          自己的"缺席"纪律），左栏独占全宽。
          chat-parity-attachments (issue #2022) -- `relative` + `dragHandlers`：全 surface
          拖拽落区覆盖整个左栏（消息列表 + composer），与旧轨道 `ChatFullSurfaceDropOverlay`
          同一套挂法（`chat-read-screen.tsx`）。 */}
      {/* issue #2053（CK-P8）—— 归档线程不接受拖拽上传：落区与提示都不挂，
          与旧轨道 `chat-live-message-panel.tsx` 的 `{...(archived ? {} : attach.dragHandlers)}`
          逐字同套。留着落区而在提交时报错，才是骗人的那一种。 */}
      {/* issue #2075（TW-P2-1）—— 阅读宽度约束提到**整条中央列**上。
          此前 `max-w-3xl` 只包着消息列表内部，composer / 追问 chips / 附件区 / 运行状态条
          仍然横贯全屏：1920px 视口下输入框实测 1006px（验收线 720–880）。行长过宽让
          回扫困难，也让工作台看起来像一个没有布局的容器。
          `max-w-3xl` = 48rem = 768px，落在 720–880 区间内，且用的是 Tailwind 既有刻度，
          不是为过门控现编的 `max-w-[880px]`（那正是 TW-P2-5 要拦的"页面自创值"）。
          窄屏无影响：`max-w` 只封上限。 */}
      <div className="relative mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-3" {...(archived ? {} : attach.dragHandlers)}>
        {archived ? null : <ChatFullSurfaceDropOverlay active={attach.dragActive} />}
        {/* issue #2075（TW-A11Y-4）—— 工作台唯一一块 live region，常驻挂载。
            常驻是必须的：`aria-live` 只播报「已存在」节点的内容变化，等到有话要说
            才把节点插进 DOM，读屏软件多半一句都不会念（这是 live region 最经典的坑）。 */}
        <ChatLiveAnnouncer />
        <CopilotKitV2ToolRenderers />
        {/* 2026-08-25 人类 devapp 实测指令：不给用户看调试字样——原来这里有一行
            「CopilotKit v2（DA-19 —— CopilotRuntime 适配器，…）」开发者标题，
            与 #1830「用户可见文案去掉开发者词汇」同一条裁决，整行移除。 */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 overflow-y-auto rounded-lg border border-border-subtle bg-card p-3"
          data-testid="copilotkit-v2-messages"
        >
          {/* issue #2039（第 1 轮 gap #3，uiux-standards U1/U2）——三态：
              历史回读中 = 骨架屏；无消息 = 引导空态（此前是一整片空白）；
              有消息 = 框架消息列表。空态只在真的没有任何消息时出现，不伪装历史。 */}
          {historyLoading ? (
            <div data-testid="loading" className="flex animate-pulse flex-col gap-3" aria-hidden>
              <div className="h-10 w-2/3 rounded-lg bg-muted" />
              <div className="ml-auto h-8 w-1/2 rounded-lg bg-muted" />
              <div className="h-14 w-3/4 rounded-lg bg-muted" />
            </div>
          ) : agent.messages.length === 0 && !agent.isRunning ? (
            <div
              data-testid="copilotkit-v2-empty"
              className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center"
            >
              <p className="text-14 font-medium text-foreground">开始新的对话</p>
              <p className="max-w-sm text-12 leading-relaxed text-muted-foreground">
                在下方输入消息，或点麦克风语音输入；也可以拖入文件作为这轮对话的附件。
              </p>
            </div>
          ) : (
            // issue #2039（第 2 轮 gap #5）的阅读宽度约束已由本文件中央列那一处
            // `max-w-3xl` 统一承担（issue #2075 / TW-P2-1）——在这里再写一次就是同一个
            // 事实声明在两处：以后调宽度会漏改一个，两处不一致且没人会发现。
            <div className="w-full">
              <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
                {/* CK-P3（issue #2054）—— 逐条消息操作（复制/评分/反馈）需要的两样东西
                    （真实落库 id 的解析索引、当前 agent 归因）经 context 下发：
                    `assistantMessage` slot 由框架实例化，本组件够不着它的 props。
                    ⚠ 这里换的是 slot 本身（`V2AssistantMessage` 内部仍然渲染框架的
                      `CopilotChatAssistantMessage`，`markdownRenderer` 照旧是
                      `V2MarkdownRenderer`）——DA-19b 的 markdown/mermaid 能力没有回退。

                    issue #2052（CK-P7）—— 「落地为产物」是同一个操作条上的第四件，
                    经同一份 context 下发（`landing`），不另包一层 provider / 不另换一次
                    slot：两层包装会渲染出两个气泡外壳。 */}
                <CopilotKitV2MessageActionsProvider
                  value={{
                    identity: messageIdentity,
                    agentId: actingAgentId,
                    agentLabel: actingAgentLabel,
                    landing: landingContext,
                  }}
                >
                  {/* issue #2070 —— threadId 读的是 `chatThreadIdRef.current`（真实
                      `chat_threads.id`，见 DA-19a 一节；ref 而非 state，读的是渲染那
                      一刻的值，与该 ref 自己"不需要触发重渲染"的既有纪律一致，
                      `agent.messages` 变化时本来就会重渲染这里）。 */}
                  <ArtifactLandingCtx.Provider
                    value={{ threadId: chatThreadIdRef.current ?? undefined, bearer: sessionToken ?? undefined }}
                  >
                    <CopilotChatMessageView
                      messages={agent.messages}
                      isRunning={agent.isRunning}
                      assistantMessage={V2AssistantMessage}
                    />
                  </ArtifactLandingCtx.Provider>
                </CopilotKitV2MessageActionsProvider>
              </CopilotChatConfigurationProvider>
            </div>
          )}
        </div>
        {/* issue #2071 —— 悬浮"回到最新"按钮：只在离开底部且确实有消息可看时出现，
            不在历史回读骨架屏/空态上叠加一个没有意义的按钮。挂在消息容器外层那个
            `relative` div 里，定位以那个 div 为参照系，不受消息容器自身
            `overflow-y-auto` 裁切影响。 */}
        {!isAtBottom && !historyLoading && agent.messages.length > 0 ? (
          <button
            type="button"
            data-testid="copilotkit-v2-scroll-to-bottom"
            title="回到最新消息（Ctrl/Cmd+End）"
            aria-label="回到最新消息"
            onClick={() => scrollMessagesToBottom(prefersReducedMotion() ? "auto" : "smooth")}
            className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-card text-foreground shadow-md transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {/* CK-P4（issue #2054）—— run 进度行。⚠ 它每秒在动，"会动"本身就是"没卡死"
            的证据；一句静止的「正在思考…」在第 10 秒和第 10 分钟长得一模一样
            （旧轨道 `chat-live-message-panel.tsx` 同一段裁决）。 */}
        {runProgress.elapsedSeconds !== null ? (
          <div
            className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground"
            data-testid="copilotkit-v2-thinking"
            role="status"
          >
            <span>正在思考…</span>
            <span data-testid="copilotkit-v2-thinking-elapsed">
              已用 {runProgress.elapsedSeconds} 秒
            </span>
            {runProgress.phaseLabel !== null ? (
              <span data-testid="copilotkit-v2-thinking-phase">· {runProgress.phaseLabel}</span>
            ) : null}
            {runProgress.isLongRun ? (
              <span data-testid="copilotkit-v2-thinking-longrun-hint">· {LONG_RUN_HINT}</span>
            ) : null}
          </div>
        ) : null}
        {/* issue #2039（第 2 轮 gap #3，uiux-standards U3/6c）——错误此前是一行裸红字
            浮在 composer 上方，无背景/图标/层级。改成结构化 alert 卡；文案与状态机
            一行未动，只动展示层。 */}
        {error !== null ? (
          <div
            role="alert"
            data-testid="copilotkit-v2-error"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-12 text-destructive"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            {/* CK-P4（issue #2054）—— 失败重试入口。旧轨道有（`retryFailedRun`），v2
                此前只有一条横幅，用户唯一的出路是自己把刚才那句话重新打一遍。
                ⚠ 重发的是「已发出的那一句」（`lastSentRef`），不是 composer 里的当前
                  草稿：看到失败横幅时用户很可能已经在输入别的了。走的就是 `send()`
                  本身，因此它是一次货真价实的新 run（新 `runAgent` 调用、新 run id），
                  不是把上一轮的失败状态擦掉假装成功。
                样式跟随 issue #2039 这张 alert 卡（本轮只加入口，不动展示层）。 */}
            {lastSentRef.current !== null && !agent.isRunning ? (
              <button
                type="button"
                data-testid="copilotkit-v2-retry"
                onClick={() => {
                  const last = lastSentRef.current;
                  if (last === null) return;
                  void send(last.text);
                }}
                className="shrink-0 rounded border border-destructive/30 px-2 py-0.5 text-11 transition-colors duration-fast hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {historyError !== null ? (
          <div
            role="alert"
            data-testid="copilotkit-v2-history-error"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-12 text-destructive"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">历史消息读取失败：{historyError}</span>
          </div>
        ) : null}
        {/* issue #2053（CK-P8）—— 归档线程不给追问建议：每一条 chip 点下去都是一次
            发送，摆在只读线程上就是一排假按钮。 */}
        {archived ? null : (
          <FollowUpSuggestions
            agentId={threadId}
            disabled={agent.isRunning}
            onSelect={(text) => void send(text)}
          />
        )}
        {/* chat-parity-attachments (issue #2022) -- composer 附件区：就地报错横幅 + 预览条，
            复用旧轨道 `chat-composer-attachments.tsx` 展示件，不重写一份视觉。 */}
        {archived ? null : <ChatAttachmentBanner banner={attach.banner} />}
        {archived ? null : <ChatAttachmentList ctl={attach} disabled={agent.isRunning} />}
        {/* issue #2039（第 3 轮 gap #1，chat-ux-acceptance-criteria 第 9 项「控制感」）
            ——run 在途时 composer 上方一条行内状态条（读真实 `agent.isRunning`，
            不是定时器动画）；此前唯一信号是发送按钮变「…」，太隐晦。 */}
        {agent.isRunning ? (
          <p
            data-testid="copilotkit-v2-running-indicator"
            className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-muted px-3 py-1.5 text-11 text-muted-foreground"
          >
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            正在生成回复……完成前发送按钮暂不可用。
          </p>
        ) : null}
        {/* issue #2039（第 1 轮 gap #5）——composer 收口：placeholder 从「随便输入点什么」
            换成明确的动作指引；发送按钮升为 primary（旧屏 composer 的发送就是主行动点）；
            `min-w-0` 防手机宽度下输入框把整行撑溢出。 */}
        {/* issue #2046（CK-P2）—— `@` 引用本线程已上传附件的候选下拉。纯前端插入，
            testid 与旧轨道同名（`chat-attachment-mention-*`），语义相同不另造锚点；
            没有匹配项时如实显示空态，不隐藏整个下拉——用户需要分得清「@ 打对了但
            没匹配到」与「@ 还没打完」。 */}
        {attachmentMention !== null ? (
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-2"
            data-testid="chat-attachment-mention-picker"
          >
            <span className="text-9 text-muted-foreground" data-testid="chat-attachment-mention-query">
              @ {attachmentMention.query}
            </span>
            {attachmentOptions.length === 0 ? (
              <span className="text-11 text-muted-foreground" data-testid="chat-attachment-mention-pool-empty">
                这条对话还没有可引用的附件。
              </span>
            ) : visibleAttachmentOptions.length === 0 ? (
              <span className="text-11 text-muted-foreground" data-testid="chat-attachment-mention-no-match">
                没有文件名含「{attachmentMention.query}」的附件。
              </span>
            ) : (
              visibleAttachmentOptions.map((att) => (
                <button
                  key={att.id}
                  type="button"
                  data-testid={`chat-attachment-mention-option-${att.id}`}
                  onClick={() => insertAttachmentMention(att.filename)}
                  className="rounded-full border border-border px-2 py-0.5 text-11 text-card-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {att.filename}
                </button>
              ))
            )}
          </div>
        ) : null}
        {/* issue #2053（CK-P8，差距表 #11）—— 归档线程只读说明。锚点与文案与旧轨道
            `chat-live-message-panel.tsx` 逐字同套（`chat-composer-archived`），不另造
            第二份措辞：同一件事在两个轨道上必须是同一句话。 */}
        {archived ? (
          <p className="text-12 text-muted-foreground" data-testid="chat-composer-archived">
            该对话已归档，只能读取，不能创建消息或运行。
          </p>
        ) : null}
        {/* issue #2053（CK-P6，差距表 #6）—— 「生成用户画像」。渲染门是服务端下发的
            `artifact.land` 能力（`canGeneratePersona`），不是前端自己判的；没有线程
            （全新对话还没发第一条消息）时禁用而不是隐藏——入口存在这件事本身要看得见，
            `title` 说清楚为什么现在点不了（同旧轨道对空线程的处理）。 */}
        {canGeneratePersona ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid="chat-persona-summary-trigger"
              disabled={archived || personaRunning || initialChatThreadId === null}
              title={
                archived ? "该对话已归档，不能再生成画像"
                  : initialChatThreadId === null ? "先发出第一条消息，这条对话建立后才能生成画像"
                    : "扫描整个对话，生成用户画像"
              }
              onClick={() => void runPersonaSummary()}
            >
              {personaRunning ? "生成画像中…" : "生成用户画像"}
            </Button>
            {personaFailure !== null ? (
              <span className="text-11 text-destructive" data-testid="chat-persona-summary-error">
                {personaFailure}
              </span>
            ) : null}
          </div>
        ) : null}
        {/* 并集解（issue #2039 × #2053）：布局/字级/placeholder 用 UIUX 迭代线的版本
            （min-w-0 防移动端溢出、rounded-md、明确动作指引），归档禁用语义用
            CK-P8 的版本——两者正交。 */}
        {/*
          issue #2075（TW-P2-1）—— composer 拆成两行。
          单行结构下输入框要和附件/麦克风/设备选择/发送四件挤同一行：中央列即使
          按验收线收到 768px，输入框自己实测只剩「506px」（真栈实测，issue #2075
          第四轮），远低于 720px 下限；而把中央列撑到 1040px 去凑输入框宽度，等于
          为了让数字好看把「中央内容不超过 880px」这条判据本身架空——那是本仓
          最不该做的一类修法。
          两行结构下输入框独占第一行 ⇒ 它的宽度就是中央列宽度（768px），
          「中央内容 ≤880」与「输入框 ≥720」同时成立，不需要互相牺牲。

          ⚠ 只改布局，「没有」把 `<input>` 换成 `<textarea>`：那是 TW-P0-5 的范围，
            且会改变 Enter 的语义（换行 vs 发送），需要单独确认，不在本次顺手做。
        */}
        <div className="flex min-w-0 flex-col gap-2">
          <input
            data-testid="copilotkit-v2-input"
            className="min-w-0 flex-1 rounded-md border border-input px-2.5 py-1.5 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
            /* issue #2053（CK-P8）—— 归档 ⇒ 输入框本身禁用。`archived` 首帧在服务端与
               客户端都是 `false`（外壳的 `getThread` 是客户端 effect），不存在麦克风按钮
               那条 `sessionToken` 式的 SSR/CSR 首帧分叉，可以直接接到 `disabled`。 */
            disabled={archived}
            placeholder={archived ? "该对话已归档，不能再发送消息" : "输入消息，Enter 发送"}
            value={inputDraft}
            onChange={(e) => {
              setInputDraft(e.target.value);
              // issue #2020 —— 与旧 composer 同一对挂点（onChange + onKeyUp）：
              // 光标移动（方向键/点击）不触发 onChange，只有 onKeyUp 能覆盖。
              recomputeMention(e.target.value, e.target.selectionStart);
            }}
            onKeyUp={(e) => recomputeMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onClick={(e) => recomputeMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
          />
          <div className="flex min-w-0 items-center gap-2">
          <ChatAttachmentButton ctl={attach} disabled={archived || agent.isRunning || attachmentThreadId === null} />
          {/* 把右侧一组（麦克风设备 / 麦克风 / 发送）推到行尾，附件留在行首。 */}
          <span aria-hidden className="flex-1" />
          {/*
            DA-19g —— composer 麦克风，接线见本文件头注。设备选择器紧挨麦克风按钮，
            录音中禁用（切设备要重起采音管线，同 `chat-live-message-panel.tsx` 的既有
            约束，contract.md §7.4）。
          */}
          <MicDevicePicker
            devices={micDevices.devices}
            selectedDeviceId={micDevices.selectedDeviceId}
            disabled={archived || speech.listening || speech.connecting || speech.stopping}
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
            /* `archived` 可以直接进 `disabled`——见输入框那处注释：它没有 sessionToken
               那条首帧分叉。语音输入在归档线程上没有任何合法去处（转录进的输入框已禁）。 */
            disabled={archived || speech.connecting || speech.stopping}
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
          <Button
            data-testid="copilotkit-v2-send"
            type="button"
            size="sm"
            variant="primary"
            className="shrink-0"
            disabled={archived || agent.isRunning || attach.hasUploading}
            onClick={() => void send()}
          >
            {agent.isRunning ? "…" : "发送"}
          </Button>
          </div>
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
 * 一条线程**已落库**消息的最小投影（`chat_messages` 行 → CopilotKit 消息形状）。
 *
 * ⚠ `id` 是 **`chat_messages.id`**，不是 `agent.messages` 里流式产生的 AG-UI 消息 id。
 *   两者是本文件头注早就记录过的两个独立命名空间；任何要把消息 id 交回后端的操作
 *   （issue #2053 CK-P6「生成用户画像」的锚点 `messageId` 就是一个）**只能**用这一份，
 *   拿流式 id 去调只会做出一个「点了才报错」的假按钮。
 */
type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * CK-P3（issue #2054）—— 这条消息能不能调 `rateMessage`。
   *
   * 「id 是真实主键」只是服务端三道门里的第一道；第三道
   * （`ratings.resolveForMessage`）要从 `agent_runs` 取归因，人自己说的话没有 agent
   * 可归因、早于 `chat_messages.agent_run_id` 的历史消息同样归不了因，两种都 404。
   * 判据只在这里（`listMessages` 的投影里）看得到——上面那三个字段进了
   * `agent.setMessages` 之后就没有 `agentRunId` 了——所以就地投影出来，
   * 而不是让调用方为了这一个布尔值再读一遍库。
   */
  rateable: boolean;
};

/**
 * 把一条线程的持久化消息**读完**（不是读一页就算数）。
 *
 * `listMessages` 契约（R9）要求调用方分页，单页上限 100；这里跑到 `nextCursor === null`
 * 为止。抽成模块级函数是因为它现在有两个调用方（挂载时的历史灌回、CK-P6 画像的
 * 锚点/结果消息读取），而"怎么把一条线程读完"必须只有一份写法。
 */
async function readAllPersistedMessages(
  threadId: string,
  bearer: string | undefined,
): Promise<PersistedMessage[]> {
  const collected: PersistedMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await listMessages(threadId, { cursor, limit: 100 }, bearer);
    for (const m of result.messages) {
      collected.push({
        id: m.id,
        role: m.authorKind === "human" ? "user" : "assistant",
        content: m.text,
        rateable: m.authorKind !== "human" && m.agentRunId !== null,
      });
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return collected;
}

/**
 * `CopilotChatAssistantMessage` 的 `markdownRenderer` slot 替换实现——见本文件头注
 * "DA-19b 消息渲染迁移"整段。类型直接取自框架自己导出的默认实现
 * （`CopilotChatAssistantMessage.MarkdownRenderer`），不是手抄一份容易漂移的签名；
 * 只用其中的 `content`，其余 Streamdown 专属渲染选项（`shikiTheme` 等）本组件不消费，
 * 因为渲染管线换成了 `MarkdownMessage`（react-markdown + mermaid fabric），不是
 * Streamdown 的产物，这些选项对它没有意义。
 *
 * issue #2070 —— `threadId`/`messageId`/`bearer` 现在是可选透传参数：这条通道此前只转
 * `content`，`MarkdownMessage → ChatCanvasFabric`/`ChatDiagramFabric` 因此拿不到落地
 * 产物所需的三要素，画布/mermaid 图编辑保存后退回"本地演示"（只更新内存 state，从不
 * 调 `landAsArtifact`），刷新必丢。三者由下面 `V2AssistantMessageImpl` 在 slot 边界之外
 * 另开的通道注入；这个组件本身仍然只认 `content` 是必需的，缺失三者时原样透传
 * `undefined` 给 `MarkdownMessage`——退回"本地演示"是它自己已有的诚实降级，这里不
 * 重复判断一次。
 */
function V2MarkdownRenderer({
  content,
  threadId,
  messageId,
  bearer,
}: React.ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer> & {
  threadId?: string;
  messageId?: string;
  bearer?: string;
}): JSX.Element {
  return <MarkdownMessage text={content} threadId={threadId} messageId={messageId} bearer={bearer} />;
}

/**
 * issue #2070 —— `threadId`/`bearer` 供 `V2AssistantMessageImpl` 里的落地产物接线用。
 * 单独开一个 context 而不是塞进旁边 `CopilotKitV2MessageActionsContextValue`
 * （`copilotkit-v2-message-actions.tsx`，CK-P3 owns 的文件）：那个 context 的职责是
 * "消息级操作"（复制/评分/反馈），落地产物是另一件事，混进去会让那个文件的读者以为
 * 评分/反馈也要关心 threadId——两件事只是恰好都要挂在 `assistantMessage` slot 上，
 * 不是同一份数据。
 */
const ArtifactLandingCtx = React.createContext<{ threadId: string | undefined; bearer: string | undefined }>({
  threadId: undefined,
  bearer: undefined,
});

/**
 * CK-P3（issue #2054）—— `assistantMessage` **整组件** slot 的替换实现。
 *
 * ## 为什么必须接在这一层（而不是继续用 `markdownRenderer`）
 *
 * `markdownRenderer` 子 slot 的 props 只有 `content`，**没有 `messageId`**——逐条操作
 * 在那一层接不上，#2046 已把这条路排除，别再从那里进。`CopilotChatAssistantMessageProps`
 * 在整组件这一层携带 `message`（读框架 `.d.mts` 类型确认，不是猜的）。
 *
 * ## 内部仍然渲染框架自己的 `CopilotChatAssistantMessage`
 *
 * 不另写一个气泡：那会让两条轨道的消息渲染各自漂移。这里只做四件加法——
 *   ① `markdownRenderer` 仍换成本仓 `MarkdownMessage`（DA-19b 的 markdown + mermaid
 *      fabric 能力不能因为多包了一层就回退）；
 *   ② `copyButton` 换成带本仓锚点的外观（**复用框架绑好的 `onClick`**，复制这件事
 *      本身没有第二份实现）；
 *   ③ `additionalToolbarItems` 挂上「对 agent 提反馈」+ 👍/👎 评分；
 *   ④（issue #2070）`markdownRenderer` 额外注入 `threadId`/`messageId`/`bearer`，
 *      画布/mermaid 图编辑保存才能真正落库而不是退回"本地演示"；
 *   ⑤（issue #2052，CK-P7）气泡下方再挂一个兄弟节点 `CopilotKitV2MessageLanding`，
 *      「落地为产物」的三态交互——块级 UI，进不了①③已占的行内 slot。
 *
 * ## （issue #2070）`messageId` 为什么要经 `identity.resolve`，不能直接用 `props.message.id`
 *
 * `props.message.id` 是 `agent.messages` 里的**视图** id——本轮流式到达的 assistant
 * 消息，这个 id 是 wire 上的临时聚合 id，`chat_messages` 里没有这一行（见
 * `lib/copilotkit-v2-message-identity.ts` 文件头的完整取证，CK-P3 评分入口踩过同一个
 * 坑）。直接拿它去调 `landAsArtifact`，在"AI 刚回复完、立刻点保存"这条最常见路径上
 * 会 404——那正是本仓反复禁止的「点了才报错的假按钮」。这里复用同一份已经接好的
 * `useCopilotKitV2MessageActions().identity`（CK-P3 已建的索引，不是重新做一份平行的
 * 解析逻辑），拿不到真实主键时 `resolve` 回答 `null`，`messageId` 就诚实地是
 * `undefined`——`MarkdownMessage` 自己的 `canPersist` 判定会据此退回"本地演示"，不是
 * 在这一层再判一次。
 *
 * ## ⚠ 框架自带的 👍/👎 刻意不启用
 *
 * `CopilotChatAssistantMessage` 有 `onThumbsUp`/`onThumbsDown` 回调，看起来正好。但它们
 * 是"点一下就完事"的形状，而本仓的 👎 允许（可选地）填一句理由——`MessageRating`
 * 的整个交互（待改进 → 理由输入 → 提交 → 「已记录」/「未计入 skill 满意度」）塞不进
 * 一个 onClick。接了框架回调就等于把 F176 采集侧砍成半个，所以走
 * `additionalToolbarItems` 用完整的 `MessageRating`；框架那两个按钮不传回调也不传
 * slot，于是（读框架实现：`(onThumbsUp || thumbsUpButton) && ...`）根本不渲染，
 * 不会出现两套 👍/👎 并排。
 */
function V2AssistantMessageImpl(
  props: React.ComponentProps<typeof CopilotChatAssistantMessage>,
): JSX.Element {
  const messageId = props.message.id;
  // issue #2070 —— 见上方"messageId 为什么要经 identity.resolve"一段。`actionsCtx` 在
  // 生产路径下恒非 null（渲染点始终包在 `CopilotKitV2MessageActionsProvider` 里）；
  // 组件测试直接渲染这个 slot、不包那层 provider 时 `useCopilotKitV2MessageActions()`
  // 按其自身既有约定返回 null，这里同样如实退回"落不了地"，不是另造一条兜底路径。
  const actionsCtx = useCopilotKitV2MessageActions();
  const realMessageId = actionsCtx?.identity.resolve(messageId) ?? undefined;
  const { threadId: artifactThreadId, bearer: artifactBearer } = React.useContext(ArtifactLandingCtx);
  // issue #2052（CK-P7）—— 正文取自框架给的这条消息本身，与气泡里渲染的是同一份，
  // 不另找一处读。
  const text = typeof props.message.content === "string" ? props.message.content : "";
  return (
    <div className="flex flex-col gap-1.5">
      <CopilotChatAssistantMessage
        {...props}
        markdownRenderer={(rendererProps) => (
          <V2MarkdownRenderer
            {...rendererProps}
            threadId={artifactThreadId}
            messageId={realMessageId}
            bearer={artifactBearer}
          />
        )}
        copyButton={(copyProps) => (
          <CopilotKitV2CopyButton onClick={copyProps.onClick} messageId={messageId} />
        )}
        additionalToolbarItems={<CopilotKitV2MessageExtraActions messageId={messageId} />}
      />
      {/* issue #2052（CK-P7）—— 「落地为产物」是块级三态交互，进不了行内工具栏，
          所以作为气泡的兄弟节点挂在下面。⚠ 这不是第二层 slot 包装：
          `assistantMessage` slot 全仓只在本组件换这一次。
          它的 `messageId` 传的是视图 id（不是上面 #2070 已解析出的 `realMessageId`）——
          `CopilotKitV2MessageLanding` 内部自己经 `identity.resolvePersisted` 二次解析
          （见 `copilotkit-v2-message-actions.tsx`），两处解析口径不同（`resolve` vs
          `resolvePersisted`），不能共用同一个已解析结果。 */}
      <CopilotKitV2MessageLanding messageId={messageId} text={text} />
    </div>
  );
}

/**
 * slot 的静态类型是 `SlotValue<typeof CopilotChatAssistantMessage>`——即它要的不只是
 * 一个组件函数，还包括挂在同名命名空间上的那些子组件（`MarkdownRenderer`/`Toolbar`/
 * `CopyButton`/…）。`Object.assign` 把框架那份**原样**搬到包装组件上，而不是用一个
 * `as` 断言糊过去：断言只是让编译器闭嘴，任何真的去读 `.CopyButton` 的调用点（框架
 * 内部就有）会在运行期拿到 `undefined`。
 */
const V2AssistantMessage = Object.assign(
  V2AssistantMessageImpl,
  CopilotChatAssistantMessage,
) as typeof CopilotChatAssistantMessage;

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
