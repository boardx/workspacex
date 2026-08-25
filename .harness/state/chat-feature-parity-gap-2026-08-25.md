# /chat 旧手写轨道 → CopilotKit v2 新轨道 · 能力差距勘探

> 目的：在把 `/chat` 默认入口从 `chat-live-message-panel.tsx`（旧手写，2247 行，
> 嵌在 `chat-read-screen.tsx`/`personal-chat-screen.tsx` 全屏外壳里）直接替换成
> `/chat/copilotkit-v2`（`copilotkit-v2-panel.tsx`，857 行，裸组件）之前，逐项核实
> 旧轨道有、新轨道没有的真实能力。**只读代码勘探，不含实现方案。**
>
> ⚠ 单一事实源纪律：本文件只登记「差距现状」。已在
> `.harness/state/deepagent-copilotkit-backlog.md` 有对应 backlog 条目的，本文件
> **引用编号**，不重新定义任务（见每行「backlog 引用」列）。
>
> 勘探基准 SHA：main @ 71b60e30（2026-08-25）。读的是这四个文件的源码本身：
> `chat-live-message-panel.tsx` / `copilotkit-v2-panel.tsx` /
> `copilotkit-v2-tool-renderers.tsx` / `active-file-panel.tsx`，以及外壳
> `chat-read-screen.tsx`、路由 `app/chat/page.tsx`、`app/chat/copilotkit-v2/page.tsx`。

## 关键架构事实（读代码确认，不是文件名推断）

- **旧 `/chat` 是一整套外壳**：`app/chat/page.tsx` 按 `projectId` 分岔到
  `ChatReadScreen`（项目对话）或 `PersonalChatScreen`（个人对话）。外壳提供：
  左栏线程列表（创建/切换/编制）、右栏「产物 + 材料」双栏、skill 挂载面板、
  会话录音面板、agent 编制面板——`ChatLiveMessagePanel` 只是外壳中间那块消息区。
- **新 `/chat/copilotkit-v2` 是一个裸 `<div>` 套 `<CopilotKitV2Panel />`**
  （`app/chat/copilotkit-v2/page.tsx` 全文 13 行）。没有外壳，没有左右栏，
  没有线程列表。它自身用 `useState(() => 'copilotkit-v2-'+randomUUID())` 每次挂载
  生成一个**临时随机 threadId**，消息存在 `agent.messages`（内存，`useAgent`），
  刷新即丢。
- **两条轨道确实共享的能力**（不是差距）：`MarkdownMessage`（markdown + ```mermaid
  围栏落 fabric 图）、语音输入到草稿（`useAsrDraft`+`MicDevicePicker`，两文件逐字
  同源）、追问建议、工具调用可视化、HITL 审批、错误横幅。

## 差距表

| # | 能力项 | 旧轨道状态 | 新轨道状态 | 严重程度 | 工作量 | backlog 引用 |
|---|--------|-----------|-----------|---------|-------|-------------|
| 1 | 消息持久化 + 多线程管理（线程列表、新建/切换、历史分页 `load-more`、刷新后消息还在、断线重连找回在途 run） | 全部有：`createMessage`/`listMessages` 落 `chat_messages`；外壳左栏 `ThreadList` 创建/切换；`catchUpCursorRef` 分页；`loadPage("replace")` 从持久消息找回 `activeRunId` | **全无**。`threadId` 每次挂载随机、`agent.messages` 纯内存、刷新清零、无线程列表、无历史、无分页 | 阻断 | 大 | 无（backlog 未立项） |
| 2 | 附件/文件上传（📎 按钮、全surface拖拽 `ChatFullSurfaceDropOverlay`、上传态/预览条、`@` 引用本线程附件、消息挂附件展示、右栏「材料」栏） | 全部有：`useChatattachments`+`ChatAttachmentButton`+`ChatAttachmentList`+`MessageAttachments`；`@` mention 选文件名；外壳 `ChatMaterialsPanel` | **全无**上传入口。右栏 `ActiveFilePanel` 是**只读消费端**（消费 agent 侧 `file_created` 事件），且头注自认「当前没有真实生产者」 | 阻断 | 中-大 | 无（DA-14 是上下文注入，非上传） |
| 3 | Skill 目录浏览/挂载（`#` mention 触发 + `ChatSkillMountPanel` 列 `GET /skills`、`mount`/`unmount` 落 `thread_skill_mounts`、per-thread 已挂载列表） | 全部有：面板检测 `#query` → 外壳转发 `ChatSkillMountPanel` 真调 `mountSkills` | **全无**。无 `#`、无 skill 面板、无挂载概念（用户点名的例子之一） | 阻断 | 中 | 无（backlog 未立项） |
| 4 | Agent 选择/切换/多 agent 编制（`AgentPicker` 选发送 agent、外壳 `RosterPanel` 加入/移除组织 agent、`rosterVersion` 乐观锁、身份行显示真实 agent 名/角色） | 全部有：`selectedAgentId`+`AgentPicker`；`updateAgentRoster` 增删编制 | **全无**。`runtimeAgentId` 写死 `"default"`，浏览器侧不可选；无编制面板（用户点名的例子之一） | 阻断 | 中-大 | 无（backlog 未立项） |
| 5 | 落地为产物（逐条消息「落地为产物(草稿)」`landAsArtifact` + 已落地卡片 + 右栏「产物」栏 `ChatArtifactsPanel`） | 全部有：`MessageLandingControls`/`submitLand`/`LandedArtifactCard`；外壳 `ChatArtifactsPanel` | **全无**。`copilotkit-v2-panel.tsx` 头注 DA-19b 明写「本轮不接入，是 TODO」（slot 类型只暴露 `content`，不透传 `messageId`） | 阻断 | 中 | DA-19b 头注已登记为 TODO |
| 6 | 生成用户画像（`summarizePersonaFromThread`，扫全线程产出画像+mindmap 围栏） | 有：`chat-persona-summary-trigger`+`runPersonaSummary` | **全无** | 明显降级 | 小-中 | 无 |
| 7 | 消息级操作：逐条复制、👍/👎 评分（`MessageRating`）、对 agent 提反馈（`FeedbackButton`） | 全部有：`chat-message-copy`/`MessageRating`/`chat-agent-feedback` | **全无**（`CopilotChatMessageView` 框架气泡未接这三个） | 明显降级 | 中 | 无 |
| 8 | 会话录音归档（`ChatRecordingPanel`，`chat-live-recording-*`，走 `/recording/sessions` 契约，整段会话录音存档） | 有（外壳挂在消息面板上方 `aboveComposer`） | **全无**。新轨道只有「麦克风→实时转录进输入框」，**没有**会话级录音存档（新面板头注自己划清了这条边界） | 明显降级 | 中 | 无 |
| 9 | Run 进度细节透明度：已耗时计时器（每秒 tick）、阶段文案（`deriveRunPhaseLabel`）、45s longrun 提示、失败重试入口（`retryFailedRun` 双路径）、`AgentRunStatus` 权威状态条、上下文快照 `MessageContextSnapshot`(L1-L3)、每条消息思考链 `MessageThinkingChain` | 全部有 | 大幅缩水：仅 `agent.isRunning`（发送按钮变「…」）+ 失败横幅（无重试按钮）。工具卡片有（DA-19c）但无耗时/阶段/longrun/重试/上下文快照 | 明显降级 | 中 | 部分：错误横幅=DA-19g(done)；工具可见=DA-19c(done)；耗时/阶段/重试/上下文快照无对应条目 |
| 10 | 消息区交互打磨：贴底自动跟随+`ResizeObserver` 兜底、「回到最新」悬浮按钮、首载骨架屏、空态文案、发送后软重读不闪烁 | 全部有（V1/V4/V5 + `#925` 软重读） | **全无**（框架 `CopilotChatMessageView` 默认行为，未定制） | 可接受降级 | 小-中 | 无 |
| 11 | 归档线程只读态（`archived` 禁用 composer + 只读提示） | 有 | 无（新轨道无线程概念，无归档态） | 可接受降级（依赖 #1） | 小 | 随 #1 | 

## 已达平价、无需补的能力（避免误列为差距）

- 语音输入到输入框（麦克风、设备选择器、connecting/listening/stopping/error 态）——
  两轨道逐字同源（`useAsrDraft`/`useAudioInputDevices`/`MicDevicePicker`）。
- 追问建议——旧轨道真实模型+规则兜底；新轨道走框架 `useConfigureSuggestions`/
  `useSuggestions`（DA-19e，✅）。功能等价，实现不同。
- 工具调用可视化（write_todos/search_documents 定制卡 + 默认卡）——DA-19c，✅。
- 人在环审批（approve/reject/edit）——DA-19d + DA-19g HITL 语义，✅。**但**新轨道
  审批工具名写死 `send_email`（`APPROVAL_TOOL_NAME`），旧轨道 `AgentApprovalPanel`
  吃服务端下发的任意工具——这是一个次要收窄，非阻断，未单列。
- Markdown + mermaid fabric 渲染——共享 `MarkdownMessage`（DA-19b，✅）。
- 错误横幅（真实 `RUN_ERROR` 事件经 `onError` 总线接住）——DA-19g，✅。
- 跨轮上下文续接（`chatThreadId` 回显）——DA-19g，✅（但这是「一次浏览器会话内」
  的续接，不等于 #1 的持久化历史）。

## 勘探到的边界性发现（不列入主表，供派工参考）

- 新轨道的「多轮上下文」靠 `chatThreadIdRef` 在**同一次页面挂载内**回显 chatThreadId
  实现；一旦刷新，threadId 重生成、`chatThreadIdRef` 归零，历史与续接同时丢——
  这与 #1（持久化）是同一个根：新轨道没有把线程 id 绑定到 URL/后端持久线程。
- 旧轨道的 `canLandArtifacts`/`projectId`/`onArtifactLanded`/`onMessageSent`/
  `onRunSettled` 等一整套「与外壳右栏联动」的 props，在新轨道无对应物——补 #2/#5
  时需要连带补外壳联动，不只是面板内部。
