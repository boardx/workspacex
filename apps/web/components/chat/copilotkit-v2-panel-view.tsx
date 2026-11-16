"use client";
import { NativeChatComposer } from "./native-chat-composer";
import { renderChatDisplayText, renderChatPhase } from "@/lib/chat-runtime-display";
import { useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { describeMessageFailure } from "@/lib/live-chat";

import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";


import { TaskTimeline } from "@/components/chat/workbench/task-timeline";
import { InterruptRenderContext } from "./workbench/interrupt-render-context";

import { LivePlanContext } from "@/lib/chat-workbench/live-plan-context";
import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2";
import { AlertTriangle, Info, ArrowDown } from "lucide-react";
import { shouldOfferBannerRetry } from "@/lib/copilotkit-v2-banner-retry";
import { cn } from "@/lib/utils";
import { queuedReplyCopy } from "@/lib/chat-composer-running-reply";
import { ArtifactLandingCtx, V2AssistantMessage, FollowUpSuggestions } from "@/components/chat/copilotkit-v2-assistant-message";
import { V2UserMessage, UserMessageAttachmentsCtx } from "@/components/chat/copilotkit-v2-user-message";
import { CopilotKitV2MessageActionsProvider } from "@/components/chat/copilotkit-v2-message-actions";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { CopilotKitV2AgentInterrupts } from "@/components/chat/copilotkit-v2-agent-interrupts";
import { CopilotKitV2PlanControl } from "@/components/chat/copilotkit-v2-plan-control";
import { ChatLiveAnnouncer } from "@/components/chat/chat-live-announcer";
import { ActiveFilePanel } from "@/components/chat/active-file-panel";
import { ProducedFilesCtx } from "@/components/chat/copilotkit-v2-assistant-message";




// Realtime conversation entry is temporarily hidden.
// import { ChatRealtimeVoiceEntry } from "@/components/chat/chat-realtime-voice-entry";

import { TaskWorkbenchEmptyState } from "@/components/chat/chat-task-workbench-empty-state";
import { SessionBriefing } from "@/components/chat/knowledge/session-briefing";
import { ChatAttachmentDock, ChatAttachmentBanner, ChatFullSurfaceDropOverlay } from "@/components/chat/chat-composer-attachments";

// issue #2767 -- 接入 F08 的 ToolPermissionCard，退役 `copilotkit-v2-approval-dialog.tsx`
// 的 `SendEmailApprovalDialog`（该组件的非交互分支曾经对"根本没停下来等人"的调用也弹
// 一个只读对话框，正是 devapp 实测报告的形态之一，见 `chat-host-tool-permission.tsx`
// 文件头的完整取证）。同 `CopilotKitV2AgentInterrupts` 的既有先例——独立文件、`return
// null`、直接挂进 JSX，不在这个已经很大的文件里再叠一段 `useHumanInTheLoop` 内联注册。
import { ChatHostToolPermission } from "@/components/chat/chat-host-tool-permission";
// Document generation approval defaults on server-side; toggle temporarily hidden.
// import { DocumentGenerationAutoApproveToggle } from "@/components/chat/document-generation-auto-approve-toggle";
import type { CopilotKitV2PanelViewProps } from "./copilotkit-v2-panel-body";

/** Presentation only. The stable controller owns every session, hook and callback. */
export function CopilotKitV2PanelView(props: CopilotKitV2PanelViewProps): JSX.Element {
  const {
    EMPTY_INPUT_REASON,
    RECORDING_SEND_REASON,
    agent,
    archived,
    artifactLandingContextValue,
    attach,
    attachDisabled,
    attachOpen,
    attachmentMention,
    attachmentOptions,
    bannerRunRef,
    canDecide,
    canWrite,
    chatThreadIdRef,
    composerFooterVisible,
    emptySendHint,
    error,
    handleMessagesScroll,
    handleUserScrollIntent,
    historyError,
    historyLoading,
    initialChatThreadId,
    insertAttachmentMention,
    interjectionRun,
    isAtBottom,
    isEmptyThread,
    isRegisteredAgentReady,
    isSettledMessageId,
    lastSentRef,
    livePlan,
    messageActionsContextValue,
    messageIdentity,
    messagesContainerRef,
    messagesContentRef,
    mountedSkillsCount,
    notice,
    orgId,
    panelActiveFiles,
    pendingMaterialsCount,
    pendingPermission,
    personaFailure,
    planLedgerRefetchTick,
    planStepRecoveryOffered,
    prefersReducedMotion,
    producedFilesContextValue,
    projectId,
    projectedMessages,
    queuedFailed,
    queuedReply,
    resendInterjection,
    resolvedChatThreadId,
    retryQueuedReply,
    runIsRunning,
    runPhaseLabel,
    runPhaseLabelOwned,
    runTrace,
    runningReplyAck,
    scrollMessagesToBottom,
    send,
    sendDisabledReason,
    sendIsBlocked,
    sessionToken,
    setAttachOpen,
    setInputDraft,
    setLivePlan,
    beginRunDispatch,
    setPlanStepRecoveryOffered,
    setQueuedReply,
    streamSlots,
    templateSuggestions,
    threadId,
    userMessageAttachmentsContextValue,
    visibleAttachmentOptions,
    voice
  } = props;
  const { t, locale } = useI18n();
  return (
    <div className="flex h-full min-h-0 w-full gap-3">
      {/* DA-13 -- 左栏：流式对话与决策过程，不变；右栏（下方，条件渲染）是新增的活动
          文件工作台，两栏各占一半宽度，右栏没有任何文件时不占位（见 ActiveFilePanel
          自己的"缺席"纪律），左栏独占全宽。
          chat-parity-attachments (issue #2022) -- `relative` + `dragHandlers`：全 surface
          拖拽落区覆盖整个左栏（消息列表 + composer），与旧轨道 `ChatFullSurfaceDropOverlay`
          同一套挂法（`chat-read-screen.tsx`）。 */}
      {/* issue #2053（CK-P8）—— 归档线程不接受拖拽上传：落区与提示都不挂，
          与旧轨道 `chat-live-message-panel.tsx` 的 `{...(!canWrite || archived ? {} : attach.dragHandlers)}`
          逐字同套。留着落区而在提交时报错，才是骗人的那一种。 */}
      {/* issue #2075（TW-P2-1）—— 阅读宽度约束提到**整条中央列**上。
          此前 `max-w-3xl` 只包着消息列表内部，composer / 追问 chips / 附件区 / 运行状态条
          仍然横贯全屏：1920px 视口下输入框实测 1006px（验收线 720–880）。行长过宽让
          回扫困难，也让工作台看起来像一个没有布局的容器。
          `max-w-3xl` = 48rem = 768px，落在 720–880 区间内，且用的是 Tailwind 既有刻度，
          不是为过门控现编的 `max-w-[880px]`（那正是 TW-P2-5 要拦的"页面自创值"）。
          窄屏无影响：`max-w` 只封上限。
          2026-09-06 人类反馈（真栈截图）「滚动条贴着消息文字，应该贴到窗口右边」——
          此前 `max-w-3xl` 直接扣在这一层最外层列上，而消息滚动容器
          （`copilotkit-v2-messages`，`overflow-y-auto`）就是这一层的直接子孙，宽度
          被同一个上限收窄，滚动条因此出现在 768px 列的右边缘、离窗口右边界还有一大截
          空白，看起来像贴在文字旁边。阅读宽度约束本身没有错（TW-P2-1 判据不变），
          错的是"扣在哪一层"：外层列现在改回满宽，`max-w-3xl` 挪到内部两处真正持有
          文字/控件的容器上（消息内容 `messagesContentRef` 与下方 composer 分组），
          滚动容器夹在满宽的外层列与被收窄的内容之间，滚动条自然贴到窗口边界，
          与 ChatGPT/Claude.ai 同款布局一致。 */}
      <div
        className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3"
        data-testid={initialChatThreadId === null ? "chat-task-workbench-preattach-dropzone" : undefined}
        {...(!canWrite || archived ? {} : attach.dragHandlers)}
      >
        {!canWrite || archived ? null : <ChatFullSurfaceDropOverlay active={attach.dragActive} />}
        {/* issue #2075（TW-A11Y-4）—— 工作台唯一一块 live region，常驻挂载。
            常驻是必须的：`aria-live` 只播报「已存在」节点的内容变化，等到有话要说
            才把节点插进 DOM，读屏软件多半一句都不会念（这是 live region 最经典的坑）。 */}
        <ChatLiveAnnouncer />
        <CopilotKitV2ToolRenderers />
        {/* issue #2179 —— F212/F213 三张 HITL 中断卡接入真实聊天渲染树。挂载位置/
            理由见该文件头注：与 `CopilotKitV2ToolRenderers` 同一条"渲染 null、
            仅用于登记 hook"纪律，不需要跟 `call_skill` 的审批卡挤进同一个组件。 */}
        <CopilotKitV2AgentInterrupts />
        {/* issue #2767 —— F08 ToolPermissionCard 接入，退役旧 `SendEmailApprovalDialog`
            （`copilotkit-v2-approval-dialog.tsx`）。同上一行同一条纪律：独立文件、
            渲染 null、仅用于登记 `useHumanInTheLoop(call_skill)` hook，见
            `chat-host-tool-permission.tsx` 文件头的完整取证。 */}
        <ChatHostToolPermission />
        {/* 2026-08-25 人类 devapp 实测指令：不给用户看调试字样——原来这里有一行
            「CopilotKit v2（DA-19 —— CopilotRuntime 适配器，…）」开发者标题，
            与 #1830「用户可见文案去掉开发者词汇」同一条裁决，整行移除。 */}
        {/* issue #2132（2026-08-27 续，人类反馈 bug #6 “对话框有 border 看起来奇怪”）——
            此前这层套了一圈 `rounded-lg border border-border-subtle bg-card`，把整条
            消息流框成一张独立卡片，对照 Claude Design 原型：消息区是直接铺在页面底色
            上的纯滚动区，不该有第二层"卡片边框"把它和composer/工具栏再框一次
            （气泡本身已经是各自的卡片/气泡，这一层外框纯属多余的视觉噪音）。去掉
            border/圆角/卡片底色，改用页面本底色，只留 `p-3` 内边距不动。 */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        {/*
          2026-09-03 人类反馈（真栈截图）「今天完成什么这部分的内容太上了」—— 空态 JSX
          （`chat-task-workbench-empty-state.tsx`）本来就带 `h-full` + `justify-center`
          想垂直居中，但 `h-full` 解析的是父容器 `messagesContentRef` 那个普通 `<div>`
          的高度：那层是块级元素，高度=内容自身高度（auto），`h-full` 等于"我自己的
          100%"，居中无从谈起——空态因此贴着滚动区顶部出现，下面一路空到 composer。
          `agent.messages.length === 0 && !agent.isRunning` 这条判断本来就要在下面的
          三态分支里算一次，这里单独存一份供 className 用同一个事实，不重复判断逻辑。

          ⚠ 2026-09-03 exact-SHA 复核抓到的真 bug（第一版这段注释的推理是错的，
          一并订正）：只给 `messagesContainerRef` 开 `flex flex-col` 不够——
          `flex-direction: column` 下主轴是纵向，`align-items: stretch`（默认值）
          拉伸的是「交叉轴」（横向宽度），不是主轴（高度）。`messagesContentRef`
          没有 `flex-1`，主轴尺寸仍然是 `flex-basis: auto` ⇒ 内容自身高度，跟
          没开 flex 列之前一模一样，`h-full`/`justify-center` 依旧无容器高度可
          居中。必须再让 `messagesContentRef` 参与主轴分配（`flex-1`）才真的
          拿到父容器让出来的高度——下面补上。
        */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          onWheel={handleUserScrollIntent}
          onTouchMove={handleUserScrollIntent}
          onKeyDown={handleUserScrollIntent}
          onPointerDown={handleUserScrollIntent}
          className={cn(
            // issue #2857（2026-09-06 devapp 人类实测「消息区能滚过底部进入整屏空白」）——
            // `relative` 是修法本身，不是装饰。真栈复现（`chat-task-workbench-scroll-
            // overshoot.spec.ts`）：落定态量不出空白；运行中，内容里出现的绝对定位后代
            // （抓到的是插话表单的 `sr-only` <Label>，`position:absolute`）以本容器
            // **外面**那层 `relative` 包装（FAB 的定位层，#2096）为包含块，被摆到内容
            // 底部的静态位置——在本容器可视区之下、又不算本容器的 scrollable overflow，
            // 于是撑大的是外层 `main`（AppShell 的 `overflow-y-auto`）：滚轮在消息区
            // 滚到头后接着推整列，composer 被推上去，露出整屏底色；线程越长空白越多屏。
            // 本容器自己成为定位上下文后，绝对定位后代被收进它自己的滚动内容里，外层
            // 再也量不到。FAB 是本容器的兄弟，不受影响（它仍以外层包装为定位层）。
            "relative flex-1 overflow-y-auto p-3",
            // 2026-09-03 人类反馈（真栈截图）「今天想完成什么这个 section 不需要
            // 灰色背景」—— 空态这一支不再画 `bg-background`（应用画布色，与外层
            // 白底的 composer 卡片并排时会显得像一块灰底方块），改为透明、直接
            // 露出外层真实背景。有消息时不受影响，仍然保留 `bg-background`
            // ——那是既有的消息区底色，判据/截图都没有点名要改它。
            isEmptyThread ? "flex flex-col" : "bg-background",
          )}
          data-testid="copilotkit-v2-messages"
        >
        <div
          ref={messagesContentRef}
          className={cn(
            // 2026-09-06 —— 阅读宽度约束（issue #2075 TW-P2-1）从外层列搬到这里：
            // 外层列（滚动容器的祖先）现在满宽，滚动条贴窗口边界；文字本身仍然
            // 不超过 768px，由这层 `mx-auto max-w-3xl` 单独承担，判据没有放宽。
            "mx-auto w-full max-w-3xl",
            isEmptyThread && "flex flex-1 flex-col",
          )}
        >
          {/* issue #2039（第 1 轮 gap #3，uiux-standards U1/U2）——三态：
              历史回读中 = 骨架屏；无消息 = 引导空态（此前是一整片空白）；
              有消息 = 框架消息列表。空态只在真的没有任何消息时出现，不伪装历史。 */}
          {historyLoading || !isRegisteredAgentReady ? (
            <div data-testid="loading" className="flex animate-pulse flex-col gap-3" aria-hidden>
              <div className="h-10 w-2/3 rounded-lg bg-muted" />
              <div className="ml-auto h-8 w-1/2 rounded-lg bg-muted" />
              <div className="h-14 w-3/4 rounded-lg bg-muted" />
            </div>
          ) : projectedMessages.length === 0 && !agent.isRunning && (streamSlots.lead || streamSlots.tail || streamSlots.emptyState) ? (
            /* UIUX r1 屏 4：外壳塞进消息流的块（转交来源卡等）已是线程上下文，不再显示通用空态。 */
            <div className="flex w-full flex-col gap-3">{streamSlots.lead}{streamSlots.tail}{streamSlots.emptyState?.(setInputDraft)}</div>
          ) : projectedMessages.length === 0 && !agent.isRunning ? (
            /* issue #2130（TW-P0-1，回指 #2068）—— 任务型空状态取代此前的会话隐喻
               两行静态文字，见 `chat-task-workbench-empty-state.tsx` 文件头注。 */
            <TaskWorkbenchEmptyState
              onUseTemplate={(goal) => setInputDraft(goal)}
              materialsCount={pendingMaterialsCount}
              skillsCount={mountedSkillsCount}
              briefing={projectId === null ? <SessionBriefing onResume={setInputDraft} /> : undefined}
              inProject={projectId !== null}
            />
          ) : (
            // issue #2039（第 2 轮 gap #5）的阅读宽度约束已由本文件中央列那一处
            // `max-w-3xl` 统一承担（issue #2075 / TW-P2-1）——在这里再写一次就是同一个
            // 事实声明在两处：以后调宽度会漏改一个，两处不一致且没人会发现。
            <div className="w-full">
              {streamSlots.lead}
              {/* issue #3619 —— `useAgent` 把服务端 `default` 注册为本面板独占的本地
                  proxy（本地 id 是上面的 `threadId`）。消息视图必须读取这个已注册
                  id；若仍读 `default`，runtime registry 在刷新同步窗口内没有该本地
                  key，会持续报 `Agent default not found`，历史虽已从 API 回读却无法
                  稳定渲染。服务端路由仍由 `useAgent.runtimeAgentId="default"` 决定。 */}
              <CopilotChatConfigurationProvider agentId={threadId} threadId={threadId}>
                {/* CK-P3（issue #2054）—— 逐条消息操作（复制/评分/反馈）需要的两样东西
                    （真实落库 id 的解析索引、当前 agent 归因）经 context 下发：
                    `assistantMessage` slot 由框架实例化，本组件够不着它的 props。
                    ⚠ 这里换的是 slot 本身（`V2AssistantMessage` 内部仍然渲染框架的
                      `CopilotChatAssistantMessage`，`markdownRenderer` 照旧是
                      `V2MarkdownRenderer`）——DA-19b 的 markdown/mermaid 能力没有回退。

                    issue #2052（CK-P7）—— 「落地为产物」是同一个操作条上的第四件，
                    经同一份 context 下发（`landing`），不另包一层 provider / 不另换一次
                    slot：两层包装会渲染出两个气泡外壳。

                    issue #2787 —— `userMessage` 同理换成 `V2UserMessage`（内部仍渲染
                    框架的 `CopilotChatUserMessage`，只换 `messageRenderer` 子 slot）：
                    此前一直是框架默认实现，正文字号依赖已被清空的框架自带 CSS，回落
                    到浏览器默认字号，见 `copilotkit-v2-user-message.tsx` 文件头注。 */}
                <CopilotKitV2MessageActionsProvider value={messageActionsContextValue}>
                  {/* issue #2070 —— threadId 读的是 `chatThreadIdRef.current`（真实
                      `chat_threads.id`，见 DA-19a 一节；ref 而非 state，读的是渲染那
                      一刻的值，与该 ref 自己"不需要触发重渲染"的既有纪律一致，
                      `agent.messages` 变化时本来就会重渲染这里）。
                      issue #2096 —— `value` 现在是上面 memo 过的对象，不是内联字面量：
                      两个 provider 的 value identity 只在真实值变化时才变，避免每次
                      打字/滚动都强制重渲染全部消息（含画布）。 */}
                  <ArtifactLandingCtx.Provider value={artifactLandingContextValue}>
                    <ProducedFilesCtx.Provider value={producedFilesContextValue}>
                      <InterruptRenderContext.Provider value={{ bearer: sessionToken ?? undefined, canWrite: canDecide,
                        pendingRunId: pendingPermission?.runId ?? null }}>
                      <UserMessageAttachmentsCtx.Provider value={userMessageAttachmentsContextValue}>
                      <LivePlanContext.Provider value={livePlan}>
                      <TaskTimeline
                        failureScope={orgId && resolvedChatThreadId ? JSON.stringify([orgId, resolvedChatThreadId]) : undefined}
                        retryFailureRunId={error && !sendIsBlocked && !planStepRecoveryOffered ? bannerRunRef.current : null}
                        onRetryFailure={lastSentRef.current ? () => {
                          const last = lastSentRef.current;
                          if (last && !sendIsBlocked) void send(last.text, { clientMessageId: last.clientMessageId, attachments: last.attachments, hostContext: last.hostContext });
                        } : undefined}
                        onResendInterjection={resendInterjection}
                        events={runTrace.events}
                        messageRuns={runTrace.messageRuns}
                        toolCallMessageIds={runTrace.toolCallMessageIds}
                        resolvePersistedMessageId={messageIdentity.resolvePersisted}
                        isSettledMessageId={isSettledMessageId}
                        messages={projectedMessages}
                        isRunning={agent.isRunning}
                        assistantMessage={V2AssistantMessage}
                        userMessage={V2UserMessage}
                      />
                      {/* uiux-r3 #4.1：待决卡片属于这条 run 的助手回合——画在消息流**之后**（触发它的
                          那条用户消息下面），不是钉在线程顶上、读起来先有决定请求后有提问。 */}
                      {pendingPermission ? <RestoredRunApproval canWrite={canDecide} key={pendingPermission.key} runId={pendingPermission.runId} bearer={sessionToken ?? undefined} /> : null}
                      </LivePlanContext.Provider>
                      </UserMessageAttachmentsCtx.Provider>
                      </InterruptRenderContext.Provider>
                    </ProducedFilesCtx.Provider>
                  </ArtifactLandingCtx.Provider>
                </CopilotKitV2MessageActionsProvider>
              </CopilotChatConfigurationProvider>
              {streamSlots.tail}
            </div>
          )}
          {/* Keep the lifecycle anchor and announcement without a second visual progress panel.
              The subscriptions above still supply run controls, restore and inspector state. */}
          {!historyLoading && runIsRunning ? (
            <span className="sr-only" role="status" data-testid="copilotkit-v2-running-indicator" data-run-id={interjectionRun.runId ?? undefined}>
              <span data-testid="copilotkit-v2-thinking-phase">{renderChatPhase(runPhaseLabel, runPhaseLabelOwned, locale) ?? t("chatComposer.running")}</span>
            </span>
          ) : null}
        </div>
        </div>
          {/* issue #2096 —— 此前按钮曾挂在从消息区一路延伸到 composer 的最外层包装里，
              与发送区重叠；后来搬进滚动容器当 `absolute` 子节点，又变成"跟着内容一起
              滚走"（2026-09-02 人类实测：箭头压在气泡正中，见上方 `programmaticScrollRef`
              头注 ①）。现在它与滚动容器并列在同一个 `relative` 包装层里：`bottom-3`
              相对消息可视区自身，既不随 composer 高度漂移，也不随内容滚动。水平方向
              贴底居中（`left-1/2 -translate-x-1/2`，Slack/ChatGPT 同款"回到最新"位置）。
              只在离开底部且确实有消息可看时出现，不在历史回读骨架屏/空态上叠加一个
              没有意义的按钮。 */}
          {!isAtBottom && !historyLoading && projectedMessages.length > 0 ? (
            <button
              type="button"
              data-testid="copilotkit-v2-scroll-to-bottom"
              title={t("chatComposer.latestTitle")}
              aria-label={t("chatComposer.latest")}
              onClick={() => scrollMessagesToBottom(prefersReducedMotion() ? "auto" : "smooth")}
              className="absolute bottom-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border-subtle bg-card text-background-foreground shadow-md transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {/* issue #2350（人类 2026-08-29 直接反馈）—— plan-control 面板从消息列表
            顶部搬到这里（消息容器外、composer 上方）：仍然不随消息滚走（同一条
            `ui.md` S1"计划态跨整条对话"的不变量没有变），但离用户当前正在看/打字
            的地方更近，不再固定占用可视区顶部。搬到独立折叠开关（默认展开、
            `gate.required`/`failed` 转入时自动展开）之后，"简化界面"这条反馈也在
            同一次改动里落地——细节见 `copilotkit-v2-plan-control.tsx` 文件头注。
            `threadId={null}` 时（新对话尚未发出第一条消息）组件自己返回 `null`，
            不占位——与 `resolvedChatThreadId` state 的既有语义一致（issue #2052）。
            `refetchSignal={planLedgerRefetchTick}`：issue #2451，见上面该 state 头注。 */}
        {/* 2026-09-06 —— 外层列已改回满宽（见上方头注），composer 及其上下的
            计划面板/错误横幅/追问 chips/附件区/页脚这一整段本来就靠外层列的
            `max-w-3xl` 收窄；外层列让出这条上限之后，这里用同一个 Tailwind
            刻度单独补上，不是新造一条阅读宽度判据，只是换了承担它的容器。 */}
        <div className="mx-auto flex w-full min-w-0 max-w-3xl shrink-0 flex-col gap-3">
        {/* issue #3416 —— 「确认并执行」/「恢复」/「重试」起的 run 走 queued/tick 通路，
            对 AG-UI 事件流完全不可见（见该组件 `onRunDispatched` 的头注）。把契约回的
            真实 runId 接到 `pendingRunId` 上，交给既有的权威读去判断它现在是什么状态
            ——这条 run 撞上工具权限门时，审批卡才有机会挂出来。 */}
        <CopilotKitV2PlanControl preferInlinePlan projectId={projectId} canWrite={canWrite} threadId={resolvedChatThreadId} refetchSignal={planLedgerRefetchTick} requestScope={JSON.stringify([orgId, resolvedChatThreadId])} onRunDispatchStart={beginRunDispatch} onStepRecoveryOfferedChange={setPlanStepRecoveryOffered} onLivePlanChange={setLivePlan} />
        {/* issue #2039（第 2 轮 gap #3，uiux-standards U3/6c）——错误此前是一行裸红字
            浮在 composer 上方，无背景/图标/层级。改成结构化 alert 卡；文案与状态机
            一行未动，只动展示层。 */}
        {/* issue #3387 ① —— 「已完成，但中途有步骤出错」这一态自己的表达。
            刻意与失败横幅不同：`role="status"`（不是 alert）、中性配色（不是
            destructive）、并且没有重试按钮。它与失败横幅互斥——`setNotice` 的每一处
            都同时 `setError(null)`，`send()` 开新一轮时两个一起清。 */}
        {notice !== null ? (
          <div
            role="status"
            data-testid="copilotkit-v2-notice"
            className="flex items-start gap-2 rounded-md border border-border-subtle bg-muted px-3 py-2 text-12 text-muted-foreground"
          >
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{renderChatDisplayText(notice, locale)}</span>
          </div>
        ) : null}
        {error !== null ? (
          <div
            role="alert"
            data-testid="copilotkit-v2-error"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-12 text-destructive"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{renderChatDisplayText(error, locale)}</span>
            {/* CK-P4（issue #2054）—— 失败重试入口。旧轨道有（`retryFailedRun`），v2
                此前只有一条横幅，用户唯一的出路是自己把刚才那句话重新打一遍。
                ⚠ 重发的是「已发出的那一句」（`lastSentRef`），不是 composer 里的当前
                  草稿：看到失败横幅时用户很可能已经在输入别的了。走的就是 `send()`
                  本身，会发起一次新的 `runAgent` 调用（新 client-side run id）——但
                  issue #2321 round 2 起，复用同一个 `clientMessageId`：一次真正
                  「失败」的 run（`RUN_ERROR`）在后端 `acceptHumanMessage` 里本来就
                  会走到"同一 key、直接返回已存在的那条"分支且行为等价于新建，
                  而一次「超时」（中继放弃轮询，run 其实还活着，见 `poll-budget.ts`）
                  会命中同一条幂等分支返回同一个 run，重试因此只是对它重新开一轮
                  轮询，不会在后端并行再跑一次同样的 skill 调用（例如再生成一次
                  PDF）。样式跟随 issue #2039 这张 alert 卡（本轮只加入口，不动展示层）。 */}
            {/* 人类 2026-09-16 截图复盘 —— 计划面板已经给出「重试该步」时，这里不再
                给第二个语义不同的重试（见 `planStepRecoveryOffered` 头注）。 */}
            {shouldOfferBannerRetry({
              hasResendableMessage: lastSentRef.current !== null,
              sendIsBlocked,
              planStepRecoveryOffered,
            }) ? (
              <button
                type="button"
                data-testid="copilotkit-v2-retry"
                onClick={() => {
                  const last = lastSentRef.current;
                  if (last === null) return;
                  void send(last.text, {
                    clientMessageId: last.clientMessageId, attachments: last.attachments, hostContext: last.hostContext,
                  });
                }}
                className="shrink-0 rounded border border-destructive/30 px-2 py-0.5 text-11 transition-colors duration-fast hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("ui.retry")}
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
            <span className="min-w-0 flex-1">{historyError.cause instanceof ApiError
              ? describeMessageFailure(historyError.cause, t("chatComposer.readHistory"), locale)
              : t("chatComposer.historyPrefix") + (historyError.cause instanceof Error
                ? historyError.cause.message : t("chatComposer.historyGeneric"))}</span>
          </div>
        ) : null}
        {/* issue #2053（CK-P8）—— 归档线程不给追问建议：每一条 chip 点下去都是一次
            发送（或本地建议里的 persona 生成动作），摆在只读线程上就是一排假按钮。
            这条门也覆盖下面 `templateSuggestions`——取推荐的那个 effect 已经
            单独判过 `!archived`（归档线程直接清空推荐列表），这里不是重复的第二道
            门，只是两处共用同一次渲染判断。 */}
        {archived ? null : (
          <FollowUpSuggestions
            agentId={threadId}
            disabled={agent.isRunning}
            onSelect={(text) => void send(text)}
            localSuggestions={templateSuggestions}
          />
        )}
        {personaFailure !== null ? (
          <span className="text-11 text-destructive" data-testid="chat-persona-summary-error">
            {renderChatDisplayText(personaFailure, locale)}
          </span>
        ) : null}
        {/* chat-parity-attachments (issue #2022) -- composer 附件区：就地报错横幅 + 预览条，
            复用旧轨道 `chat-composer-attachments.tsx` 展示件，不重写一份视觉。 */}
        {archived ? null : <ChatAttachmentBanner banner={attach.banner} />}
        {/* issue #2039（第 1 轮 gap #5）——composer 收口：placeholder 从「随便输入点什么」
            换成明确的动作指引；发送按钮升为 primary（旧屏 composer 的发送就是主行动点）；
            `min-w-0` 防手机宽度下输入框把整行撑溢出。 */}
        {/* issue #2046（CK-P2）—— `@` 引用本线程已上传附件的候选下拉。纯前端插入，
            testid 与旧轨道同名（`chat-attachment-mention-*`），语义相同不另造锚点；
            没有匹配项时如实显示空态，不隐藏整个下拉——用户需要分得清「@ 打对了但
            没匹配到」与「@ 还没打完」。 */}
        {attachmentMention !== null ? (
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-card border border-border-subtle bg-card p-2 shadow-md"
            data-testid="chat-attachment-mention-picker"
          >
            <span className="text-9 text-muted-foreground" data-testid="chat-attachment-mention-query">
              @ {attachmentMention.query}
            </span>
            {attachmentOptions.length === 0 ? (
              <span className="text-11 text-muted-foreground" data-testid="chat-attachment-mention-pool-empty">
                {t("chatComposer.noAttachments")}
              </span>
            ) : visibleAttachmentOptions.length === 0 ? (
              <span className="text-11 text-muted-foreground" data-testid="chat-attachment-mention-no-match">
                {t("chatComposer.noMatchingAttachments", { query: attachmentMention.query })}
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
            {t("chatComposer.archivedReadOnly")}
          </p>
        ) : null}
        {/* issue #2053（CK-P6）——「生成用户画像」不再在这里单独画一个恒定的按钮：
            2026-08-30 重设计后它是上面 `FollowUpSuggestions` 建议行里 `personaSuggestions`
            算出来的一条本地 chip，出现/消失的判据见 `showPersonaSuggestion` 那段注释。 */}
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
        {/*
          issue #2130（TW-P0-5①②，回指 #2068）—— composer 收敛成一个带单一锚点的
          容器：第一行多行任务输入（`textarea`，不再是单行 `input`），第二行左
          （附件/`@Agent`/`/技能`/任务模式）右（麦克风+发送）。
        */}
        {/*
          2026-09-02 composer 重设计（人类交付的状态预览稿，要求像素级）——
          结构：卡片上方右对齐「能力」触发器（移出输入区）→ 卡片（内边距 20：多行输入 +
          工具行）→ 卡片底部状态栏（按状态区分语气与操作）→ 卡片下方页脚
          （左：快捷键 / 禁用理由；右：当前麦克风）。
          工具行：左 = 三颗 32px 圆形图标按钮（材料 / 技能 / 任务模式，悬停显示名称）；
          右 = 分段语音胶囊（一个按钮承载全部语音状态）+ 32px 圆形发送（Agent 处理中变为停止）。
          既有锚点（`chat-attachment-input` / `chat-skill-mount` / `...-task-mode` /
          `chat-task-workbench-capability-picker` / `...-composer-mic` / `chat-mic-*` /
          `...-recording-*`）逐字保留，只是住进了新结构。
        */}
        <NativeChatComposer {...props} />
        <div className={cn("flex min-w-0 items-center justify-between gap-3 text-12 text-muted-foreground", composerFooterVisible ? "mt-2" : "hidden")}>
          {queuedReply !== null ? (
            <span data-testid="chat-task-workbench-composer-queued-reply" className="flex min-w-0 items-center gap-2">
              <span className="truncate">{queuedFailed ? t("chatComposer.queuedRetained") : queuedReplyCopy(queuedReply)}</span>
              {queuedFailed ? <button type="button" onClick={retryQueuedReply}>{t("ui.retry")}</button> : null}
              <button
                type="button"
                className="shrink-0 underline-offset-2 transition-colors duration-fast hover:text-card-foreground hover:underline"
                onClick={() => { setInputDraft(queuedReply); setQueuedReply(null); }}
              >
                {t("common.cancel")}
              </button>
            </span>
          ) : runningReplyAck !== null ? (
            <span data-testid="chat-task-workbench-composer-running-reply-ack">{runningReplyAck}</span>
          ) : sendDisabledReason !== null
            && sendDisabledReason !== RECORDING_SEND_REASON
            && (sendDisabledReason !== EMPTY_INPUT_REASON || emptySendHint)
            && !attach.hasUploading ? (
            <span data-testid="chat-task-workbench-composer-send-disabled-reason">{t(sendDisabledReason)}</span>
          ) : voice.phase === "listening" || voice.phase === "connecting" ? (
            <span>{t("chatComposer.escapeRecording")}</span>
          ) : null}
          {/* 2026-09-08 人类直接指令：去掉常驻的「Enter 发送 · Shift+Enter 换行」和
              「麦克风：xxx」这一行——太占空间。这一行现在只在真有话要说时出现
              （待发内容 / 发送被禁用的原因 / 录音中），否则整行不渲染。
              快捷键说明留在发送按钮的 title 里；麦克风设备仍在录音按钮旁的下拉里选。 */}
        </div>
        <ChatAttachmentDock ctl={attach} open={attachOpen} disabled={attachDisabled} onClose={() => setAttachOpen(false)} />
        </div>
      </div>
      {panelActiveFiles.length > 0 ? (
        <div className="min-w-0 flex-1">
          {/* 2026-08-30 -- 只剩 `source !== "agent_run_output"` 的文件走这一列
              （`chat_upload`/`artifact_pin`，目前生产环境没有真实生产者，见
              `ProducedFilesCtx` 头注）。`agent_run_output` 已经改挂到产出它的消息下面
              （`ProducedFileInlineCard`，`V2AssistantMessageImpl` 消费 `ProducedFilesCtx`）。
              `chatThreadIdRef.current` 是渲染时刻的值（ref 不触发重渲染，见该 ref
              自己的头注），与上面 `artifactLandingContextValue` 同一条读法。 */}
          <ActiveFilePanel files={panelActiveFiles} threadId={chatThreadIdRef.current} />
        </div>
      ) : null}
    </div>
  );
}
