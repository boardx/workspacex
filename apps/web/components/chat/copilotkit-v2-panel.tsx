"use client";

import * as React from "react";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";
import { useSession } from "@/components/session/session-provider";
import type { ListThreadAttachmentsOut } from "@/lib/live-chat";
import { useCopilotKitV2AgentOptions } from "@/lib/copilotkit-v2-agent-options";
import { useCopilotKitV2AgentSelection } from "@/lib/copilotkit-v2-agent-selection";
import { ChatPopoverCoordinatorProvider } from "@/components/chat/chat-popover-coordinator";
import { CopilotKitV2PanelBody } from "@/components/chat/copilotkit-v2-panel-body";

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
 * `useHumanInTheLoop`（下方"DA-19d 人在环接线"一节）的 `render` 渲染件
 * `SendEmailApprovalDialog`、`APPROVAL_TOOL_NAME`/`approvalToolParameters` 两个
 * 工具标识、以及完整的设计取舍记录（HITL 语义为什么曾经卡在 DA-19g 修复前的后端
 * 缺口、`resumeAguiBridgeTurn` 如何把裁决路由回被打断的 run）现在都在
 * `copilotkit-v2-approval-dialog.tsx`（2026-08-30 文件规模拆分搬出，逐字节未改
 * 行为）——该组件只消费 props、不闭包依赖本文件的状态，是天然可独立的一块。
 * 本文件只保留接线（下方 `useHumanInTheLoop({ name: APPROVAL_TOOL_NAME, ... })`）。
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
 * issue #2023 —— agent 候选列表的数据源。`useCopilotKitV2AgentOptions`/
 * `copilotkitV2ToAgentOption`/`CopilotKitV2AgentOptionsState` 现在都在
 * `lib/copilotkit-v2-agent-options.ts`（2026-08-30 文件规模拆分搬出，逐字节未改
 * 行为）——它是一个纯粹的"读组织 agent 目录"数据源 hook，不闭包依赖
 * `CopilotKitV2PanelBody` 的任何内部状态，天然可独立成文件。
 */

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
 * `SCROLL_BOTTOM_THRESHOLD_PX`/`isScrolledNearBottom` 现在都在
 * `lib/copilotkit-v2-scroll.ts`（2026-08-30 文件规模拆分搬出，逐字节未改行为）——
 * 这里重导出，保持既有测试 `from "@/components/chat/copilotkit-v2-panel"` 的
 * import 路径不变。
 */
export { SCROLL_BOTTOM_THRESHOLD_PX, isScrolledNearBottom } from "@/lib/copilotkit-v2-scroll";

export function CopilotKitV2Panel({
  chatThreadId: initialChatThreadId = null,
  onThreadResolved,
  onMessageSent,
  onArtifactLanded,
  onPlanTodosChange,
  onRunStateChange,
  onPendingMaterialsChange,
  onTaskModeChange,
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
   * issue #2068（TW-P0-3 读半 / TW-P0-4）—— 面板向外壳上报右栏 Inspector 需要的
   * 真实状态。三个都只上报**已经存在于本组件里的事实**，没有一个是为了填页面编的：
   *   · `onPlanTodosChange` —— `STATE_SNAPSHOT{todos}` 解析后的计划快照（见上面
   *     `useAguiPlanTodos` 那段），null = 本轮还没有计划。
   *   · `onRunStateChange` —— `agent.isRunning` + `useCopilotKitV2RunProgress` 的
   *     阶段/耗时，即 composer 上方那条进度行读的同一份数据，不是第二个计时器。
   *   · `onPendingMaterialsChange` —— composer 里已上传但还没随消息发出的附件条数。
   *     外壳的 `listThreadAttachments` 只看得到**已随消息落库**的材料，看不到这一段；
   *     少了它，「上传材料 → 右栏自动开材料页」这条链在用户真实操作顺序上是断的。
   */
  onPlanTodosChange?: (todos: readonly PlanTodo[] | null) => void;
  onRunStateChange?: (state: {
    readonly isRunning: boolean;
    readonly phaseLabel: string | null;
    /** `RUN_STARTED` 到达的时刻（epoch ms）；**每轮只变一次**。
     *  ⚠ 刻意不上报 `elapsedSeconds`：那个每秒变一次，上抛给外壳等于每秒
     *  `setState` 一次外壳 → 外壳重渲染 → 整棵消息树（含画布）跟着重渲染一次。
     *  issue #2096 刚为同一类重渲染风暴做过一轮修复，不能在这里重新引入。
     *  秒数由右栏 Inspector 自己从这个时间戳派生，重渲染只落在它那一小棵子树上。 */
    readonly startedAt: number | null;
  }) => void;
  onPendingMaterialsChange?: (count: number) => void;
  /**
   * PROP-CHAT-UIUX-ITER-002 V3 —— 见 `CopilotKitV2PanelBody` 同名 prop 的注释：
   * composer「任务模式」开关的真实状态，透传给外壳供右栏「运行详情」展示。
   */
  onTaskModeChange?: (taskMode: boolean) => void;
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
   * 端点 + 乐观锁 version + `/` mention 联动），不重写一份挂载逻辑。
   *
   * issue #2130（TW-4，Skills 交互重设计）—— **不再挂在这一层**：此前放在外层是
   * 因为渲染依据（`initialChatThreadId`）只有外层持有；现在这个 prop 本来就
   * 原样透传给了 `CopilotKitV2PanelBody`（见下方 `orgId` 新增同一条理由），
   * 挂载入口随之整体搬进 Body 的 composer 图标行（`variant="pill"`，同级于
   * Agent/麦克风/附件），`mentionQuery`/`onMentionMounted` 这一整套跨组件转发
   * 不再需要——Body 本来就检测得到 `/` mention，直接在本地消费即可。
   * 详见 `CopilotKitV2PanelBody` 内 `ChatSkillMountPanel` 挂点的注释。
   */

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
      {/* issue #2132（2026-08-27，人类对照 Claude Design 原型反馈 bug #5 "Agent 选择器
          位置不对，应该贴着 composer"）—— 这里此前挂着 `copilotkit-v2-agent-toolbar`
          （`CapabilityPicker` + 错误/空态提示），独立一行浮在消息区上方，读作页面
          header、且视觉上与它下面的 composer 脱节。issue #2130（TW-P0-2）已经在同一
          位置把裸的 `AgentPicker` 换成更完整的 `CapabilityPicker`（六项披露卡片），
          但没有解决"位置在哪"——composer 那颗 `chat-task-workbench-composer-mention-agent`
          「@Agent」按钮实际打开的还是这个挂在最上面的实例（共享同一个
          `chat-capability-picker` 互斥槽），点开后弹出的卡片自然对不上composer，这正是
          bug #5 截图里"Agent/Skills 选择卡片飘在页面中间"的根因。
          现在把 `CapabilityPicker` 本体真正搬进 composer（见 `CopilotKitV2PanelBody`
          内 `chat-task-workbench-composer-mention-agent` 原来的位置），`copilotkit-v2-
          agent-toolbar` 这个 testid 容器与错误/空态提示原样跟过去（e2e
          `chat-task-workbench-capability-cards.spec.ts`/`copilotkit-v2-uiux-shots.spec.ts`
          只断言它「可见」+ 读 innerText，不断言它在页面里的位置，搬家不影响这两条）。 */}
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
          onPlanTodosChange={onPlanTodosChange}
          onRunStateChange={onRunStateChange}
          onPendingMaterialsChange={onPendingMaterialsChange}
          onTaskModeChange={onTaskModeChange}
          onArtifactLanded={onArtifactLanded}
          threadAttachments={threadAttachments}
          archived={archived}
          canGeneratePersona={canGeneratePersona}
          // issue #2130（TW-4）—— Skill 挂载入口搬进 Body 内部渲染，需要 `orgId`
          // 才能读 `listSkills(orgId)`；此前只有外层持有它。
          orgId={orgId}
          actingAgentId={selectedAgentId}
          actingAgentLabel={
            agentOptions.status === "ready"
              ? (agentOptions.agents.find((a) => a.id === selectedAgentId)?.name ?? null)
              : null
          }
          // issue #2132（2026-08-27 续）—— AgentPicker 从顶部独立行搬进 composer，
          // 数据源仍是这一层的 `agentOptions`/`selectedAgentId`（唯一事实源，见上方
          // `useCopilotKitV2AgentOptions` 头注），只是把渲染位置下移到 Body 内部。
          agentOptions={agentOptions}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
      </div>
      </ChatPopoverCoordinatorProvider>
    </div>
  );
}

