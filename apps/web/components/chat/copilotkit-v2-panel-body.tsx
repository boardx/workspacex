"use client";
import { ownedRunError, restoredRunPhaseLabel, renderChatDisplayText, type ChatDisplayText, type ChatOwnedMessage } from "@/lib/chat-runtime-display";
import { useI18n } from "@/lib/i18n/provider";
import { CopilotKitV2PanelView } from "./copilotkit-v2-panel-view";
import type { MessageKey } from "@/lib/i18n/messages";
import { notifyCreditFailure } from "@/lib/credit-guidance";
import { useChatStreamSlots } from "@/components/chat/chat-stream-slots";
import { useChatHistoryPreview } from "@/lib/use-chat-history-preview";
import { useComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import { useSession } from "@/components/session/session-provider";

import * as React from "react";
import { createWorkbenchThread } from "@/lib/chat-workbench/project-scope";
import { restoreFinalMessages } from "@/lib/chat-workbench/restore-final-messages";


import { useThreadMessageQueue } from "@/lib/chat-workbench/use-thread-message-queue";
import { useDispatchedQueueMessages } from "@/lib/chat-workbench/use-dispatched-queue-messages";



import { useRunningReply } from "@/lib/chat-workbench/use-running-reply";
import { latestCancelledRun } from "@/components/chat/workbench/child-cancellation-notice";
import { useRunCancellation } from "@/lib/chat-workbench/use-run-cancellation";
import { useRunTraceTail } from "@/lib/chat-workbench/use-run-trace-tail";
import { useRunTrace } from "@/lib/chat-workbench/use-run-trace";

import { NO_LIVE_PLAN, type LivePlan } from "@/lib/chat-workbench/live-plan-context";
import { useTemplateRecommendations, readTemplateSuggestionDismissed } from "@/lib/chat-workbench/use-template-recommendations";
import { useTimelineScroll } from "@/lib/chat-workbench/use-timeline-scroll";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/react-core/v2";

// issue #2052（CK-P7）—— 「落地为产物」状态机，与旧轨道共用同一份（展示件在
// `copilotkit-v2-message-actions.tsx`，与 CK-P3 的复制/评分/反馈同一条操作条）。
// issue #2052（CK-P7）—— 「落地为产物」状态机，与旧轨道共用同一份（展示件在
// `copilotkit-v2-message-actions.tsx`，与 CK-P3 的复制/评分/反馈同一条操作条）。
import { useMessageLanding } from "@/components/chat/message-landing";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";
import { describeFailedRunBanner, resolveLiveRunErrorOutcome } from "@/lib/copilotkit-v2-failure-banner";

import { reportClientError } from "@/lib/report-client-error";
import { useChatMessageIdentity } from "@/lib/copilotkit-v2-message-identity";
import { useCopilotKitV2RunProgress, type RunStage } from "@/lib/copilotkit-v2-run-progress";
import { onRememberStatement } from "@/lib/knowledge-graph-events";

import { useCopilotKitV2RunRestore, type RunRestoreOutcome } from "@/lib/copilotkit-v2-run-restore";
import { useChatHostInterjectionRun } from "@/lib/chat-host-interjection-run";

import { lastRespondingAgentId, readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
import { type LocalSuggestionChip } from "@/components/chat/copilotkit-v2-assistant-message";

import { type AssistantMessageLandingValue } from "@/components/chat/copilotkit-v2-message-actions";



import { announceToChat } from "@/components/chat/chat-live-announcer";

import { useAguiFileEvents } from "@/lib/agui-file-events";
import { useAguiPlanTodos } from "@/lib/agui-plan-todos";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";



import { useComposerVoiceSession } from "@/lib/use-composer-voice-session";

import { createVoiceThreadLifecycle, mergePersistedVoiceTurns } from "@/components/chat/chat-realtime-voice-entry";



import { getStoredSessionToken } from "@/lib/api-client";
import { listThreadAttachments, type ChatAttachment, type ListThreadAttachmentsOut } from "@/lib/live-chat";
// issue #2694 修复——`PERSONA_SUMMARY_AUTHOR_ID` 是后端/前端共认的单一事实源
// （见 `packages/contracts/src/chat.ts` 该常量的文件头注），不在这里另写一份字面量。
// issue #2694 修复——`PERSONA_SUMMARY_AUTHOR_ID` 是后端/前端共认的单一事实源
// （见 `packages/contracts/src/chat.ts` 该常量的文件头注），不在这里另写一份字面量。
import { chat as ChatContract } from "@repo/contracts";
import { type CopilotKitV2AgentOptionsState } from "@/lib/copilotkit-v2-agent-options";
import { detectComposerMention, type ComposerMention } from "@/lib/composer-mention-detection";

import { useChatAttachments, type ChatMaterialsUploadPort } from "@/components/chat/chat-composer-attachments";

// issue #2767 -- 接入 F08 的 ToolPermissionCard，退役 `copilotkit-v2-approval-dialog.tsx`
// 的 `SendEmailApprovalDialog`（该组件的非交互分支曾经对"根本没停下来等人"的调用也弹
// 一个只读对话框，正是 devapp 实测报告的形态之一，见 `chat-host-tool-permission.tsx`
// 文件头的完整取证）。同 `CopilotKitV2AgentInterrupts` 的既有先例——独立文件、`return
// null`、直接挂进 JSX，不在这个已经很大的文件里再叠一段 `useHumanInTheLoop` 内联注册。



/** TW-P0-5④ 的"空输入"禁用理由；只有它是"用户试图发送时才提示"，见 `emptySendHint`。 */
const EMPTY_INPUT_REASON = "chatComposer.empty";
const EMPTY_SEND_HINT_MS = 2_500;
/**
 * 2026-09-10 人类实测反馈：「chat 录音，必须要先停止，才可以发送，现在没有停止，发送按钮也可以用」——
 * 录音进行中（connecting / listening / stopping）输入框里的文字还在被 ASR 持续改写，
 * 这时候发出去的必然是一句被截断到"刚好点下去那一帧"的半截话，而且发送清空输入框之后
 * 后续到达的 `asr.final` 还会继续往空输入框里写——用户看到的是"发了一半 + 输入框又莫名
 * 冒字"。所以录音中一律不能发送，把它变成一条正式的禁用理由（发送按钮 disabled +
 * Enter 不发送），"停止/完成"之后（phase `done` / `paused` / `idle`）才放行。
 */
const RECORDING_SEND_REASON = "chatComposer.recording";
/** 2026-09-10 人类实测反馈：「下面的绿色提醒要过 5 秒自动消失，不要一直停留」。 */
const TRANSCRIBED_BAR_AUTO_DISMISS_MS = 5_000;
/** 2026-09-08 人类反馈「默认有一行就可以了」：composer 自动增高的封顶（约 8 行 text-16），超出后内部滚动。 */
const COMPOSER_MAX_HEIGHT_PX = 200;

function useCopilotKitV2PanelController({
  chatThreadId: initialChatThreadId = null,
  observedRunId = null,
  projectId = null,
  onThreadResolved,
  onMessageSent,
  onArtifactLanded,
  onPlanTodosChange,
  onRunStateChange,
  onPendingMaterialsChange,
  onUploadingMaterialsChange,
  onAttachUploadPortChange,
  threadAttachments = null,
  archived = false,
  canWrite = true,
  canDecide = true,
  canGeneratePersona = false,
  orgId = null,
  actingAgentId = null,
  actingAgentLabel = null,
  agentOptions,
  selectedAgentId = null,
  onSelectAgent,
  realtimeContext = null,
  onAssistantText,
  onVoiceStateChange,
}: {
  chatThreadId?: string | null;
  observedRunId?: string | null;
  projectId?: string | null;
  /** CK-P3（#2054）—— 当前发送 agent 的真实 id，供逐条消息的「对 agent 提反馈」归因；
   *  用户未选择（走服务端配置的默认 agent）时为 `null`，此时不画反馈入口。 */
  actingAgentId?: string | null;
  actingAgentLabel?: string | null;
  /**
   * issue #2132（2026-08-27 续）—— composer 里的 `AgentPicker` 需要的三样东西，
   * 唯一事实源仍是外层 `CopilotKitV2Panel` 的 `useCopilotKitV2AgentOptions`/
   * `useCopilotKitV2AgentSelection`（同一份数据同时决定这个组件的 remount key），
   * 这里只接收、不重新读取——两处各读一次会出现"顶层已经选中，composer 里还在
   * loading"这类不一致。
   */
  agentOptions: CopilotKitV2AgentOptionsState;
  selectedAgentId?: string | null;
  /** `null` = 回到自动匹配（服务端默认 agent）。 */
  onSelectAgent: (agentId: string | null) => void;
  realtimeContext?: { readonly boardId: string; readonly selectedObjectIds: readonly string[] } | null;
  onAssistantText?: (text: string) => void;
  onVoiceStateChange?: (state: "idle" | "listening") => void;
  onThreadResolved?: (threadId: string) => void;
  /** issue #2046（CK-P1）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  onMessageSent?: () => void;
  /**
   * issue #2050 —— 一条消息被「落地为产物」之后触发，外壳据此重读右栏「产物」。
   * 与 `onMessageSent` 分开而不是复用它：那个是"发了一条消息"，这个是"多了一条产物"，
   * 合成一个回调会让外壳分不清自己在为什么重读（且未来两者刷新的东西可能不同）。
   */
  onArtifactLanded?: () => void;
  /** issue #2068 —— 见外层 `CopilotKitV2Panel` 同名三个 prop。 */
  onPlanTodosChange?: (todos: readonly PlanTodo[] | null) => void;
  onRunStateChange?: (state: {
    readonly isRunning: boolean;
    readonly phaseLabel: string | null;
    readonly phaseLabelOwned?: boolean;
    /** `RUN_STARTED` 到达的时刻（epoch ms）；**每轮只变一次**。
     *  ⚠ 刻意不上报 `elapsedSeconds`：那个每秒变一次，上抛给外壳等于每秒
     *  `setState` 一次外壳 → 外壳重渲染 → 整棵消息树（含画布）跟着重渲染一次。
     *  issue #2096 刚为同一类重渲染风暴做过一轮修复，不能在这里重新引入。
     *  秒数由右栏 Inspector 自己从这个时间戳派生，重渲染只落在它那一小棵子树上。 */
    readonly startedAt: number | null; readonly recoveryDiagnostic?: string | null;
  }) => void;
  onPendingMaterialsChange?: (count: number) => void;
  /** 人类实测：右栏「材料」页签点「+」上传时，进度只出现在 composer 里，「材料」这边
   * 在上传完成前毫无反馈——用户在右栏动作，回应却出现在屏幕另一端。这个回调把
   * "正在传几个"实时递给外壳，转给「材料」面板显示。 */
  onUploadingMaterialsChange?: (count: number) => void;
  /** issue #3347 —— 见下方 `attachUploadPort` 的文档：右栏「材料」页签的上传能力面。 */
  onAttachUploadPortChange?: (port: ChatMaterialsUploadPort) => void;
  /** issue #2046（CK-P2）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  threadAttachments?: ListThreadAttachmentsOut["items"] | null;
  /** issue #2053（CK-P8）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  archived?: boolean;
  canWrite?: boolean;
  canDecide?: boolean;
  /** issue #2053（CK-P6）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  canGeneratePersona?: boolean;
  /**
   * issue #2130（TW-4）—— `ChatSkillMountPanel`（`variant="pill"`）现在直接在
   * 本组件里渲染，需要它读 `listSkills(orgId)`。`null` = 还没解析出组织（未登录/
   * 首帧），此时挂载入口如实禁用，不渲染一个必然 404 的假入口。
   */
  orgId?: string | null;
  onMentionQueryChange?: (query: string | null) => void;
  /** 挂载成功后外层 +1——本组件据此把 `#query` 字面量从输入框正文里删掉。 */
  mentionResolvedNonce?: number;
}) {
  const { copilotkit } = useCopilotKit();
  const [threadId] = React.useState(() => `copilotkit-v2-${crypto.randomUUID()}`);
  const { agent, isReady } = useAgent({
    agentId: threadId,
    runtimeAgentId: "default",
    threadId,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  /* issue #3619 —— `useAgent.isReady` can stay true for one render while a
     CopilotKit runtime resync has already unregistered that proxy and its
     effect has not registered the replacement yet. Treat the registry lookup
     as the authoritative readiness boundary so history is never hydrated into,
     nor rendered through, the detached instance. */
  // Read the registry snapshot directly. `getAgent()` logs "Agent … not found"
  // for this expected transition, which would recreate the production symptom
  // while merely checking readiness.
  const isRegisteredAgentReady = isReady && copilotkit.agents[threadId] === agent;
  const runTrace = useRunTrace(agent, initialChatThreadId);
  const wasRealtimeRunActive = React.useRef(false);
  React.useEffect(() => {
    if (agent.isRunning) {
      wasRealtimeRunActive.current = true;
      return;
    }
    if (!wasRealtimeRunActive.current || !onAssistantText) return;
    wasRealtimeRunActive.current = false;
    const latest = [...agent.messages].reverse().find((message) => message.role === "assistant");
    const content = latest && typeof latest.content === "string" ? latest.content.trim() : "";
    if (content) onAssistantText(content);
  }, [agent.isRunning, agent.messages, onAssistantText]);
  const hydrateRunTrace = runTrace.hydrate;
  const acceptedRunEpoch = runTrace.acceptedRunEpoch;
  const draftSession = useSession().session;
  const composerDraft = useComposerDraft({ orgId: draftSession?.currentOrgId ?? orgId, userId: draftSession?.userId ?? null, projectId, threadId: initialChatThreadId });
  const { text: inputDraft, setText: setInputDraft, clear: clearComposerDraft } = composerDraft;
  const sendFailedRef = React.useRef(false);
  const { locale: displayLocale } = useI18n();
  const displayLocaleRef = React.useRef(displayLocale);
  displayLocaleRef.current = displayLocale;
  const [error, setError] = React.useState<ChatDisplayText | null>(null);
  /**
   * issue #3387 ① —— 「部分步骤失败但整体成功」这一态自己的位置。
   *
   * 它**不是** `error` 的另一种取值：失败横幅是 destructive 配色 + 一个「重试」按钮，
   * 而这一态恰恰不该重试（run 已经成功、产出已落库，重试只会再烧一次真实模型调用，
   * 也正是人类那句「点了会不会把已有结果冲掉」）。文案的唯一来源是
   * `RUN_RECOVERED_NOTICE`，与判据同一个模块。
   */
  const [notice, setNotice] = React.useState<ChatDisplayText | null>(null);
  const [recoveryDiagnostic, setRecoveryDiagnostic] = React.useState<string | null>(null);
  /**
   * issue #3261 —— 当前横幅说的是**哪一轮 run** 的失败。失败当场那条路径要异步补一次
   * 权威读才知道成因，这个 ref 保证那句迟到的文案只会盖回它自己那一轮的横幅。
   */
  const bannerRunRef = React.useRef<string | null>(null);
  /**
   * issue #3367 第 ③ 类 —— 「这条 run 其实还在等人批」这一事实的落点。
   *
   * 审批卡此前只有两个挂载来源：本次挂载订阅上收到的 `awaiting_tool_permission` **推流
   * 事件**（`tracePendingPermission`），或切回/刷新时那次**恢复读**（`runRestore`）。
   * 中途被服务端以 `AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION` 拒掉的那一次裁决两者都不占：
   * 推流不会再来一条（run 状态一动没动），恢复路径这轮也不会重跑 ⇒ 卡片永不重挂，
   * 用户对着一句「出错了」再也回不到那个可以授权的地方。这是第三个来源。
   */
  const [reattachApproval, setReattachApproval] = React.useState<{ runId: string } | null>(null);
  // Keep the latest run context for stable framework error subscriptions.
  const runReportContextRef = React.useRef<{
    runId: string | null; threadId: string | null; phase: RunStage | null;
  }>({ runId: null, threadId: null, phase: null });
  /**
   * issue #2451 —— 计划面板（`CopilotKitV2PlanControl`）3 秒轮询 `getPlanLedger`，
   * 与下面 `onError` 订阅（"模型这次没能返回可用结果"横幅）是两条独立异步信号源：
   * `RUN_ERROR` 事件几乎瞬时触发，但计划面板要等 DB 里 `agent_runs.status` 真正写成
   * `failed` 且下一次轮询命中才会跟上，中间有个窗口两者互相矛盾（横幅已报错，
   * 计划面板还显示"执行中 + 可暂停"）。这个计数器每次 `onError` 命中就自增一次，
   * 传给 `CopilotKitV2PlanControl` 的 `refetchSignal`：让它立刻抢一次 refetch，
   * 缩短这个窗口，并在追上真实 phase 之前把"最近报错"这件事显式标出来。
   */
  const [planLedgerRefetchTick, setPlanLedgerRefetchTick] = React.useState(0);

  /**
   * 人类 2026-09-16 截图复盘 —— 一条**有计划**的 run 失败时，屏幕上曾同时存在两个
   * 「重试」：计划面板的「重试该步」（UC-10，保留已完成步骤续跑）与下面这条失败横幅的
   * 「重试」（重发上一条用户消息，整轮从零再来）。两者不是两种能力，是同一件事的两种
   * 做法，而横幅贴着输入框、红色、离视线最近——用户几乎必然点掉进展的那一个。
   *
   * 这个 state 由 `CopilotKitV2PlanControl` 如实回报（它是唯一在读账本的人，见该组件
   * `onStepRecoveryOfferedChange` 头注）。为真 ⇒ 横幅**不再给重试按钮**，把恢复入口
   * 留给能保住进展的那一个；横幅本身照常显示——「出了什么错」与「怎么恢复」是两件事，
   * 收起的是后者，不是前者。
   *
   * 账本还没追上、或这条失败根本没有计划可恢复时为 `false`，横幅行为与改动前逐字一致。
   */
  const [planStepRecoveryOffered, setPlanStepRecoveryOffered] = React.useState(false);
  const [livePlan, setLivePlan] = React.useState<LivePlan>(NO_LIVE_PLAN);
  /**
   * issue #2130（TW-P0-5①），回指 #2068 —— composer 的 `<textarea>` ref，
   * `/技能`/`@Agent` 两个快捷入口用它读光标位置 + 插入后把焦点还给输入框。
   */
  const composerInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  /* issue #2770 —— 这里曾有「任务模式」（issue #2130，开启时给正文拼一句"请先给出
     计划"前缀）与「每次都先计划」（issue #2667，透传 `disableTaskAutoClassify` 关掉
     自动判类）两个手动开关。Phase 14 F02（#2739）把内核的 `TaskClassifierMiddleware`
     改成无条件挂载：一句话是闲聊还是任务、任务要不要先出计划，由内核自己判，F07 的
     计划确认卡按既有流程出现。两个开关都是"人替内核决定要不要先规划"的灰度期残留，
     连同状态、发送时的正文前缀与 `forwardedProps` 透传一并删除；正文逐字等于用户输入。 */
  /* issue #2132（2026-08-27 续，bug #5）—— 此前这里持有一个 `chat-capability-picker`
     互斥槽的 setter，给 composer 里一个"只开、不渲染"的快捷按钮用（真正的
     `CapabilityPicker` 当时还渲染在页面最上面）。现在 `CapabilityPicker` 本体
     已经搬进 composer 自己订阅这个槽，不再需要composer 这一层单独持有 setter。 */

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
  /**
   * 2026-09-02 三层结构（人类最终裁决：技能恢复原样，只把入口搬进「+」菜单）——
   * `ChatSkillMountPanel variant="composer"` 留在第二行左侧那组 `relative` 容器里：
   * 已挂载 chip 是第 1 层状态 chip，候选浮层从「+」那个角落向上开；触发器是菜单项
   * `chat-skill-mount`（下方），点它就 `skillOpenRequest + 1`；`/` mention 照旧。
   * 挂载成功后把 `/query` 从正文删掉是本地回调。
   */
  const [skillOpenRequest, setSkillOpenRequest] = React.useState(0);
  const [skillTrigger, setSkillTrigger] = React.useState({ canOpen: false, mountedCount: 0, loading: true });
  const onSkillMentionMounted = React.useCallback(() => {
    if (skillMention === null) return;
    setInputDraft((current) => current.slice(0, skillMention.start) + current.slice(skillMention.start + 1 + skillMention.query.length));
    setMention(null);
  }, [skillMention, setInputDraft]);

  /**
   * issue #2046（CK-P2）—— `@` 候选与插入，语义平移旧 composer：候选是本线程
   * **已随消息发出**的附件（外壳下传的「材料」同一份数据），选中把 `@文件名 `
   * 当纯文本插进正文——靠 F155 file-retrieval 的 `search_tsv`（filename 已编进
   * 检索索引）自然召回，不碰 `attachmentIds`（那条路径的 `ATTACHMENT_NOT_PENDING`
   * 校验本就不允许一个附件被两条消息重复引用）。issue #3727 起，run 侧会把正文里的
   * `@<filename>` 翻译回附件本身（挂进沙箱 `/inputs/` + 视觉输入），所以插入的文件名
   * 必须与附件的 `filename` 逐字一致（`apps/api/src/domain/chat/attachment-mentions.ts`）。
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
        notifyCreditFailure({ code: code_ });
        // issue #2779 —— 这条横幅此前把原始 code/message 完全吞掉：一旦
        // `describeCopilotkitV2RunError` 落进未登记兜底文案（"这次执行没有成功，
        // 请重试或联系管理员"），排障的人连"到底是哪个 code"都无从查起——这正是
        // 反馈复现时唯一能确认的现象（HITL 确认卡片提交后卡在"已裁决，等待 run
        // 收尾"，随后出现这句通用兜底）。这里只补一条 `console.error`，不改用户
        // 可见文案（裸 code/message 仍然不是人话，不该印到界面上）——下次同样的
        // 兜底文案出现时，浏览器控制台能看到真实 code_，不用再靠截图猜。
        console.error("[copilotkit-v2] agent run failed", { code: code_, context: errorContext });
        sendFailedRef.current = true;
        setError(ownedRunError(describeCopilotkitV2RunError(code_)));
        /*
         * issue #3261 —— 上面这句只按 wire 上那个枚举码说话，说不出**为什么**失败：
         * `RUN_ERROR` 事件里没有成因的位置。成因的单一事实源是 `agent_runs.failure_reason`
         * （PR #3229），刷新后走的 `handleRunRestored` 一直在读它——此前活路径没读，
         * 于是同一个失败刷新前后是两句话。这里补上**同一次**权威读、走**同一个**
         * 文案函数（`describeFailedRunBanner`），把两条路径收敛到一个来源。
         *
         * ⚠ 先 `setError` 再补读：横幅立刻出现（不让用户对着一个安静的界面等网络），
         * 读回来只是把它换成更具体的一句。读不到就保持旧文案，不编成因。
         * ⚠ `bannerRunRef` 挡住迟到的覆盖：这次读返回时若面板已经在处理**另一轮**
         * run 的失败，这句迟到的文案不许盖上去。
         */
        const causeRunId = runReportContextRef.current.runId;
        bannerRunRef.current = causeRunId;
        void resolveLiveRunErrorOutcome({
          runId: causeRunId, code: code_, bearer: getStoredSessionToken() ?? undefined,
        }).then((outcome) => {
          if (bannerRunRef.current !== causeRunId) return;
          if (outcome.kind === "reattach_approval") {
            /*
             * issue #3367 第 ③ 类 —— 权威读确认这条 run **仍停在** `awaiting_tool_permission`
             * 且仍持有一条待批请求（`decideToolPermission` 的 `stale_permission_request` /
             * `form_decision_required` 两支就是这个形状：拿着上一张卡的 requestId 去裁决，
             * 服务端拒绝，run 一动没动）。用户此刻该看到的是**一张能点的审批卡**，而不是
             * 「最近一次调用出错，正在等待执行状态更新……」——后者让一次合法的人类审批
             * 变成了永久卡死。
             *
             * 所以这里把横幅撤掉（它是个误译，不是补充信息），并把这条 run 交给
             * `pendingPermission` 重挂 `RestoredRunApproval`；卡片自己还会再做一次权威读
             * 核对（`restored-run-approval.tsx`），run 若已不在待批态它自己返回 null。
             */
            setError(null);
            setReattachApproval({ runId: outcome.runId });
            return;
          }
          /*
           * issue #3387 ① —— 权威读说这一轮其实成功了、产出也已落库：把已经亮出来的
           * 失败横幅**撤掉**（它是误报，不是补充信息），换成中性的完成提示。
           */
          if (outcome.kind === "recovered") {
            setError(null);
            setNotice({ key: "chatComposer.runtime.recovered" });
            return;
          }
          setError(ownedRunError(outcome.text));
        });
        // issue #2797 -- 结构化上报到后端（`system-error-logs` 契约束),供巡检按
        // runId/时间范围查询,不必再等用户手动截图 DevTools。fire-and-forget,失败
        // 静默降级(见 `report-client-error.ts` 文件头),绝不在这条路径上新增一个
        // 用户可见的失败分支。
        reportClientError(runError, { errorType: code_, ...runReportContextRef.current });
        // issue #2451 —— 见上面这个 state 的头注：让计划面板立刻抢一次 refetch。
        setPlanLedgerRefetchTick((tick) => tick + 1);
      },
    });
    return unsubscribe;
  }, [copilotkit, threadId]);

  // DA-13 -- subscribe to the agent instance directly (not scoped to a single
  // `runAgent()` call) so a file created in one turn keeps receiving content deltas in
  // later turns. See the file-head comment above for why `agent.subscribe` is safe here.
  const { files: activeFiles, onCustomEvent: onActiveFileCustomEvent, hydrate: hydrateActiveFiles } = useAguiFileEvents();
  /**
   * issue #2068（第一件）—— `write_todos` 的结构化计划**早就在 wire 上**：
   * `copilotkit-agui.controller.ts` 的 `writeToolCallStep` 在 `write_todos` 成功后
   * 下发 `STATE_SNAPSHOT { snapshot: { todos } }`，消费 hook（`lib/agui-plan-todos.ts`）
   * 与渲染组件（`agent-plan-panel.tsx`）也都在 main 上——此前只接在**预览**面板
   * （`copilotkit-preview-panel.tsx`），活体面板从没订阅过它。这里补上。
   *
   * ⚠ 挂在与 DA-13 文件事件**同一个** `agent.subscribe` 上（跨轮持久订阅），不是挂在
   * 单次 `runAgent()` 的订阅参数上：预览面板那边是一次性 run，这里的 `agent` 跨多轮
   * 复用，绑到单次调用会在两轮之间丢订阅（同上面那段注释的推理）。
   *
   * ⚠ 不新增任何事件名：用的就是已有的 `STATE_SNAPSHOT{todos}`。
   * `agui-bridge-state-events.test.ts` 守着的封闭白名单一个字没动——这是纯前端接线。
   */
  const { todos: planTodos, onStateSnapshotEvent } = useAguiPlanTodos();
  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onCustomEvent: onActiveFileCustomEvent,
      onStateSnapshotEvent,
    });
    return unsubscribe;
  }, [agent, onActiveFileCustomEvent, onStateSnapshotEvent]);

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

  /**
   * issue #2101（真实 devapp 实测：新对话第一条消息瞬时出现两条重复气泡，AI 回复
   * 到达后又恢复正常）—— 见下面 hydration effect 的守卫。这里只负责在"本轮第一次
   * 把线程 id 从 `null` resolve 出来"那一刻置位，供那个 effect 判断"这条线程是不是
   * 我自己这一轮刚建的、内存态本来就是最新的，不需要回读"。
   */
  const resolvedDuringThisSessionRef = React.useRef(false);
  /**
   * 2026-08-30 review 反证（PR #2420 的下一轮）—— 「生成用户画像」建议 chip 需要
   * "这条线程后端已经落库过至少一条消息"这件事实，`resolvedDuringThisSessionRef`
   * 这个布尔量不够：它只标记"本次会话曾经发生过一次 resolve"，一旦置位就不会
   * 复位，如果同一个组件实例后续又经历第二次 resolve（目前代码路径下不会，但
   * 语义上是"曾经"不是"这一条线程"），会把这份"已确认落库"的信任错误地带到
   * 别的线程上。这里改用一个 Set，逐个线程 id 精确记录"后端确认这个 id 是它
   * 刚创建、已经落库了触发消息之后才回显给我们的"——见下方
   * `showPersonaSuggestion` 的完整论证。
   */
  const resolvedThreadIdsRef = React.useRef<Set<string>>(new Set());

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
          if (isNewlyResolved) {
            // issue #2101 —— 必须在 `onThreadResolved` 之前（同步）置位：那个回调会让
            // 外壳把 `selectedThreadId` 写回，进而让 `initialChatThreadId` prop 从 null
            // 变成真实 id、触发下面 hydration effect 重跑——这个 ref 得先于那次重渲染
            // 就是 true，effect 才能在第一次因依赖变化执行时就看到它。
            resolvedDuringThisSessionRef.current = true;
            // 同一时刻精确记下**这个** id——后端只在已经落库了触发这次 resolve 的
            // 那条消息之后才会发 `chat_thread_id` 事件（本文件其它地方已经在依赖
            // 同一条时序不变量，见下方 hydration effect 里"若 readAllPersistedMessages
            // 跑得比 acceptHumanMessage 落库快"那段的推理），所以这个 id 在事实上
            // 已经有 ≥1 条落库消息，不需要再读一次库确认。
            resolvedThreadIdsRef.current.add(event.value);
            onThreadResolved?.(event.value);
          }
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
  const onSelectAgentRef = React.useRef(onSelectAgent);
  onSelectAgentRef.current = onSelectAgent;
  const { index: messageIdentity, registerHydrated, projectMessages, isSettledMessageId } = useChatMessageIdentity(agent);
  const projectedMessages = projectMessages(agent.messages);
  /**
   * 2026-09-15 人类实测反馈 —— 「文件在 chat 提交完以后，应该要在 message 上，而不是
   * 在 chat composer 上」。这张表就是"在 message 上"的那一半：视图消息 id → 随它发出
   * 的附件行，由 `V2UserMessage` 按 id 查出来渲染（见
   * `copilotkit-v2-user-message.tsx` 的 `UserMessageAttachmentsCtx`）。
   *
   * 两处写入，都不是编出来的：
   *   · 发送那一刻 —— 键是 `clientMessageId`（乐观插入的那条用户气泡就是这个 id），
   *     值是 `attach.uploadedAttachments`（服务端上传接口回的原始实体行）。
   *   · 历史回读 —— 键是真实主键（以及它的 `clientMessageId` 别名，见下方回读处），
   *     值来自 `listThreadAttachments` 的 `messageId` 投影。
   */
  const [userMessageAttachments, setUserMessageAttachments] =
    React.useState<ReadonlyMap<string, readonly ChatAttachment[]>>(() => new Map());

  /**
   * issue #4180 —— 「这条消息刚被抽取出新知识」的反馈条只对**本会话本次发送**的用户消息轮询
   * （不对整段历史消息各自常驻轮询，同 `TurnMemoryLine` 头注「一屏历史消息各自常驻轮询会把
   * 接口打满」那条纪律）。键与 `userMessageAttachments` 同一个 `clientMessageId`——乐观插入
   * 那条用户气泡的 id，`send()` 里同一处写入（见下方）。历史回读的消息不在这张表里，天然
   * 不会挂这条反馈——即使它们当时也被抽取过，那件事早已经在知识面板里，不需要再提醒一次。
   */
  const [sentMessageIds, setSentMessageIds] = React.useState<ReadonlySet<string>>(() => new Set());

  const [historyError, setHistoryError] = React.useState<{ cause: unknown } | null>(null);
  const hydratedRef = React.useRef(false);
  const [historyLoading, setHistoryLoading] = React.useState(initialChatThreadId !== null);
  const historyScope = draftSession ? JSON.stringify([draftSession.sessionToken, draftSession.userId, draftSession.currentOrgId, projectId]) : null;
  const { remember: rememberHistory, discard: discardHistory } = useChatHistoryPreview(historyScope, initialChatThreadId, agent, isRegisteredAgentReady, setHistoryLoading);
  /**
   * 2026-08-30 review 反证（PR #2420 的下一轮）—— hydration effect（情形①，见下方）
   * 对**这一个** `threadId` 跑完 `readAllPersistedMessages` 之后的确切结果，供
   * `showPersonaSuggestion` 判断"这条线程是否已经有落库消息"。与 `resolvedThreadIdsRef`
   * （上面，覆盖情形②）合起来才是完整的证据——见 `showPersonaSuggestion` 的完整论证。
   * `threadId` 字段是防"残留上一次 hydration 结果"的关键：只有它与当前
   * `initialChatThreadId` 一致时，`hasMessages` 才可信。
   */
  const [hydratedEvidence, setHydratedEvidence] = React.useState<{
    readonly threadId: string;
    readonly hasMessages: boolean;
    /**
     * issue #2694 修复——这条线程已落库的消息里有没有一条是
     * `summarizePersonaFromThread` 产出的画像（`authorId ===
     * ChatContract.PERSONA_SUMMARY_AUTHOR_ID`）。与 `hasMessages` 同一次
     * hydration 读出来，不为它单独再读一遍库；见下方 `personaAlreadyGenerated`。
     */
    readonly hasPersonaArtifact: boolean;
  } | null>(null);
  /**
   * session-switch task-state-loss fix —— 挂载 hydration 只回读了"已经落库的东西"，
   * 从不检查"上一轮有没有一个还没写回的 run"。这条 effect 只覆盖情形①（真实既有
   * 线程重新挂载，见下方判断），正是用户切走再切回时会命中的路径；情形②（本轮乐观
   * 插入后端才 resolve 线程 id）不跑这段，本来内存里就有在途 run，不存在"丢失"。
   * 非 `null` 时交给下面 `useCopilotKitV2RunRestore` 轮询核实，核实完清空。
   */
  const [pendingRunId, setPendingRunId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (
      initialChatThreadId === null || !isRegisteredAgentReady || hydratedRef.current
      // issue #2101 —— `initialChatThreadId` 从 `null` 变成真实 id 有两种截然不同的
      // 原因：① 外壳传入一条**既有**线程（用户点开历史对话/刷新页面）——这时内存里
      // `agent.messages` 是空的，必须回读；② **本轮**（`send()` 里乐观插入用户消息之
      // 后）后端才把线程 id resolve 出来并经 `onCustomEvent` 回显——这时内存里已经有
      // 这条刚发的用户消息（乐观插入，客户端随机 id），若仍然回读，`readAllPersisted
      // Messages` 一旦跑得比 `acceptHumanMessage` 落库快，会读到同一句用户消息的
      // **另一个** id（真实主键），而下面的按 id 去重（`liveIds`）认不出这是同一条
      // ——两个 id 都进了 `agent.messages`，UI 上瞬间两条重复气泡（AI 回复到达后
      // "看起来正常"只是巧合：那次读取时机赶在落库之后，不是这条 race 被修好了）。
      // `resolvedDuringThisSessionRef` 精确标记情形②，只在情形②跳过——情形①从不
      // 触碰这个 ref，行为不变。
      || resolvedDuringThisSessionRef.current
    ) return;
    let cancelled = false;
    (async () => {
      try {
        const bearer = getStoredSessionToken() ?? undefined;
        // 分页读取用 main 抽出的 `readAllPersistedMessages`（"怎么把一条线程读完"
        // 只有一份写法），不在这里复制第二遍循环。
        const { messages: collected, pendingRunId: detectedPendingRunId } =
          await readAllPersistedMessages(initialChatThreadId, bearer);
        void hydrateRunTrace(collected, bearer).catch(() => { if (!cancelled) setError((current) => current ?? { key: "chatComposer.runtime.traceRestore" }); });
        // CK-P3（#2054）—— 「可评分」比「消息真实存在」多一道门：还要求它由 agent
        // 写回且带 `agentRunId`（服务端第三道归因门，见
        // `lib/copilotkit-v2-message-identity.ts`）。这两个判据由
        // `readAllPersistedMessages` 一并投影出来（`rateable`），不为它再读一遍库。
        const identities = collected.map((m) => ({ id: m.id, rateable: m.rateable }));
        if (cancelled) return;
        discardHistory();
        rememberHistory(collected);
        hydratedRef.current = true;
        registerHydrated(identities);
        // UIUX r4 —— 刷新后恢复该线程的已选数字人，芯片与消息身份行一致。
        const threadAgentId = lastRespondingAgentId(collected, [ChatContract.PERSONA_SUMMARY_AUTHOR_ID]);
        if (threadAgentId !== null) onSelectAgentRef.current(threadAgentId);
        // 见上方 `hydratedEvidence` 的文件头注——「生成用户画像」建议 chip 的证据源。
        setHydratedEvidence({
          threadId: initialChatThreadId,
          hasMessages: collected.length > 0,
          hasPersonaArtifact: collected.some((m) => m.authorId === ChatContract.PERSONA_SUMMARY_AUTHOR_ID),
        });
        // ⚠ 只把框架认识的三个字段喂进去：`rateable` 是本仓自己的投影，
        //   不该混进 AG-UI 消息对象。
        const framed = collected.map((m) => ({ id: m.id, role: m.role, content: m.content }));
        const live = agent.messages;
        if (live.length === 0) {
          agent.setMessages(framed);
        } else {
          const liveIds = new Set(live.map((m) => m.id));
          // 重复用户气泡修复——见 `PersistedMessage.clientMessageId` 头注：乐观插入
          // 的用户消息在 `live` 里的 id 是 `clientMessageId`，`collected` 读回来的
          // 同一条消息 id 是服务端真实主键，两者不相等。只按 `m.id` 去重认不出这是
          // 同一条消息，会把它当"新消息"插第二遍。
          const isAlreadyLive = (m: { id: string; clientMessageId: string | null }) =>
            liveIds.has(m.id) || (m.clientMessageId !== null && liveIds.has(m.clientMessageId));
          agent.setMessages([
            ...collected.filter((m) => !isAlreadyLive(m)).map((m) => ({ id: m.id, role: m.role, content: m.content })),
            ...live,
          ]);
        }
        setHistoryLoading(false);
        setPendingRunId(detectedPendingRunId);
        /*
         * 2026-08-30 人类实测反馈——"生成的下载链接不能下载"：真实现象是刷新页面/
         * 重新打开这条线程之后，之前 run 产出的 docx/pdf/xlsx 那张下载卡片
         * （`ActiveFilePanel`）整个不见了，只剩消息正文里的纯文字描述。根因见
         * `agui-file-events.ts` 新增的 `hydrate` 头注：那个 hook 只认这次浏览器
         * 会话亲眼收到的 `file_created` SSE 事件，历史打开没有任何回填路径。
         *
         * 这里用刚回读到的 `collected`（带 `role`）圈出"哪些消息是助手写的"，
         * 再读一次这条线程的附件列表——`chat_message_attachments.message_id` 落在
         * 助手消息上的，就是 `run-skill-script.ts` 沙箱产出（`agui-file-events.ts`
         * 文件头："一个人从不会把附件挂在助手自己写的消息上"，同一条推理，只是从
         * "刚发生的这次 run" 挪到"历史里任意一次 run"）——为它们在本地重建等价的
         * `ActiveFile`，喂给 `hydrateActiveFiles`。`content` 留空、`bytes`/`mime`
         * 照抄：这类文件是二进制产出，从未也不该被当文本流式过，与真实 SSE 事件到达
         * 时 `content: ""` 的初始形状完全一致，不是编出来的近似值。
         *
         * 失败（读不到附件列表）不影响消息本身的回读——这不是"回读历史"这件事的
         * 必要前提，读不到就是没有可回填的下载卡片，退回此前的行为，不该让整个
         * 历史回读因为这一步失败而报错。
         */
        try {
          const assistantMessageIds = new Set(
            collected.filter((m) => m.role === "assistant").map((m) => m.id),
          );
          /*
           * 2026-09-15 —— 同一次 `listThreadAttachments` 顺带回填**用户消息**那一半：
           * 挂在人类消息上的附件（`message_id` 落在 user 消息行上）就是"这条消息带了
           * 哪些文件"，刷新/重开线程后消息气泡上要照常看得见，否则它只在发出后的那一
           * 次浏览器会话里存在（与上面助手侧下载卡片同一类"没有回填路径"的缺口）。
           *
           * 一条消息登记两个键：真实主键，以及它的 `clientMessageId`——乐观插入的那条
           * 用户气泡在 `agent.messages` 里用的是后者（见上方去重那段的头注），两者是
           * 同一条消息的两个视图 id。
           */
          const userMessageKeys = new Map<string, readonly string[]>(
            collected.filter((m) => m.role === "user").map((m) => [
              m.id, m.clientMessageId !== null ? [m.id, m.clientMessageId] : [m.id],
            ] as const),
          );
          if (assistantMessageIds.size > 0 || userMessageKeys.size > 0) {
            const attachments = await listThreadAttachments(initialChatThreadId, projectId, bearer);
            if (!cancelled) {
              const byUserMessage = new Map<string, ChatAttachment[]>();
              for (const { messageId, ...row } of attachments.items) {
                for (const key of userMessageKeys.get(messageId) ?? []) {
                  const rows = byUserMessage.get(key);
                  if (rows === undefined) byUserMessage.set(key, [row]);
                  else rows.push(row);
                }
              }
              if (byUserMessage.size > 0) {
                setUserMessageAttachments((cur) => new Map([...cur, ...byUserMessage]));
              }
              const rehydrated = attachments.items
                .filter((item) => assistantMessageIds.has(item.messageId))
                .map((item) => ({
                  uri: `vfs://attachment/${item.id}`,
                  name: item.filename,
                  mime: item.mime,
                  source: "agent_run_output" as const,
                  bytes: item.bytes,
                  // 2026-08-30 —— `AguiFileCreatedValue`/`ActiveFile` 新增的
                  // `messageId` 字段在这里同样有真实数据可填：`item.messageId`
                  // 本来就是上面 `assistantMessageIds.has(...)` 过滤用的同一个值，
                  // 不是凭空编的。少了它，回读历史时重建的这些文件会被
                  // `ProducedFilesCtx` 的按消息过滤判定成"不属于任何消息"，下载卡片
                  // 又会在刷新后消失一次——那正是 #2384 刚修过的同一个症状，只是换了
                  // 触发路径。
                  messageId: item.messageId,
                  content: "",
                  nextSequence: 0,
                }));
              hydrateActiveFiles(rehydrated);
            }
          }
        } catch {
          // 如实忽略——见上面这段的最后一条理由，不让附件回填的失败冒泡成历史消息
          // 读取失败。
        }
      } catch (e) {
        if (cancelled) return;
        setHistoryLoading(false);
        discardHistory();
        setHistoryError({ cause: e });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, isRegisteredAgentReady, initialChatThreadId, registerHydrated, hydrateActiveFiles, hydrateRunTrace, projectId, rememberHistory, discardHistory]);

  // Restore final messages with their persisted identities; errors remain visible.
  const handleRunRestored = React.useCallback((outcome: RunRestoreOutcome) => {
    if (outcome.kind === "gave-up") {
      setError(
        outcome.reason === "auth-expired"
          ? { key: "chatComposer.runtime.restoreAuth" }
          : outcome.reason === "stalled"
            // issue #2860：服务端超过回收窗口仍非终态——如实说"没进展"，不冒充失败。
            ? { key: "chatComposer.runtime.restoreStalled" }
            : { key: "chatComposer.runtime.restoreUnconfirmed" },
      );
      setPendingRunId(null);
      return;
    }
    setRecoveryDiagnostic(outcome.view.recoveryDiagnostic ?? null);
    if (outcome.view.status === "failed") {
      // issue #3211 ①：run 视图带成因，横幅就说得出「为什么」，不只是「失败了」。
      // issue #3261：这句话的算法搬进 `describeFailedRunBanner`——失败当场那条路径
      // 补完权威读之后用的是**同一个**函数，两条路径不再各算一遍。
      bannerRunRef.current = outcome.view.runId ?? null;
      setError(ownedRunError(describeFailedRunBanner(outcome.view)));
    }
    let cancelled = false;
    (async () => {
      const bearer = getStoredSessionToken() ?? undefined;
      const threadId = chatThreadIdRef.current;
      if (threadId === null) return;
      try {
        const { messages: after } = await readAllPersistedMessages(threadId, bearer);
        if (cancelled) return;
        const liveIds = new Set(agent.messages.map((m) => m.id));
        // 重复用户气泡修复——同上（挂载 hydration 的同名注释）：这条 run-restore 路径
        // 在 HITL 确认（`confirm_task_intent` 等）裁决后、run 结束时都会跑一遍，
        // 恰好是"同一浏览器会话内、不刷新页面"就能复现重复气泡与残留确认卡的窗口——
        // 乐观插入的用户消息此时仍然挂着 `clientMessageId` 当 id，只按服务端真实 id
        // 去重认不出它，把它连同它所在的整条消息再插一遍。
        const isAlreadyLive = (m: { id: string; clientMessageId: string | null }) =>
          liveIds.has(m.id) || (m.clientMessageId !== null && liveIds.has(m.clientMessageId));
        const restored = after.filter((m) => !isAlreadyLive(m));
        // 2026-09-02（人类实测："放大→修改→保存成功→刷新后全丢"）—— 这条路径此前
        // 只把消息灌进 `agent.messages`，**没有**像挂载 hydration 那样 `registerHydrated`：
        // 这些消息的 id 已经是真实 `chat_messages.id`，但身份索引不认识它们，
        // `identity.resolve`/`resolvePersisted` 一律回答 `null` ⇒ `MarkdownMessage`
        // 拿到的 `messageId` 是 `undefined` ⇒ 图表 modal 的「保存」静默退回本地演示
        // （徽标照亮、什么都没落库），刷新后自然全丢。与挂载 hydration 同一份登记。
        registerHydrated(restored.map((m) => ({ id: m.id, rateable: m.rateable })));
        const framed = restored.map((m) => ({ id: m.id, role: m.role, content: m.content }));
        if (framed.length > 0) agent.setMessages([...agent.messages, ...framed]);
        // A HITL decision resumes in the background through the durable run worker. That
        // continuation has no live AG-UI response stream on which `file_created` can arrive,
        // so restoring only the assistant message leaves a truthful "file generated" reply
        // with no download card until the next full-page refresh. Re-read the same durable
        // attachment rows used by the mount-time hydration above and attach only files owned
        // by persisted assistants, including ones already inserted by journal recovery.
        const restoredMessageIds = new Set(after.filter((m) => m.role === "assistant").map((m) => m.id));
        if (restoredMessageIds.size > 0) {
          const attachments = await listThreadAttachments(threadId, projectId, bearer);
          hydrateActiveFiles(attachments.items
            .filter((item) => restoredMessageIds.has(item.messageId))
            .map((item) => ({
              uri: `vfs://attachment/${item.id}`,
              name: item.filename,
              mime: item.mime,
              source: "agent_run_output" as const,
              bytes: item.bytes,
              messageId: item.messageId,
              content: "",
              nextSequence: 0,
            })));
        }
        setPendingRunId(null);
        onMessageSent?.();
      } catch {
        // 重读失败不是新错误——run 状态本身已经在 `useCopilotKitV2RunRestore` 里
        // 如实核实过是终态；这里只是把已经写回的内容捞回来，捞不到就保持
        // `pendingRunId` 已清空、稍后用户可以手动刷新页面重新走一遍挂载 hydration。
        setPendingRunId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, hydrateActiveFiles, onMessageSent, projectId, registerHydrated]);
  const runRestore = useCopilotKitV2RunRestore(
    pendingRunId,
    getStoredSessionToken() ?? undefined,
    handleRunRestored,
  );

  const bindTraceMessages = runTrace.bindMessages;
  const restoreJournalResult = React.useCallback(async (runId: string): Promise<boolean> => {
    if (agent.isRunning) return false;
    const restoringThread = chatThreadIdRef.current;
    if (!restoringThread) return false;
    const { messages } = await readAllPersistedMessages(restoringThread, getStoredSessionToken() ?? undefined);
    if (chatThreadIdRef.current !== restoringThread) return true;
    const terminal = [...(runTrace.events[runId] ?? [])].reverse().find((event) => event.kind === "status");
    if (!messages.some((message) => message.role === "assistant" && message.agentRunId === runId))
      return terminal?.kind === "status" && (terminal.status === "failed" || terminal.status === "cancelled");
    const restored = messages.filter((message) => message.role === "assistant" && message.agentRunId === runId);
    registerHydrated(restored.map((message) => ({ id: message.id, rateable: message.rateable })));
    bindTraceMessages(messages);
    if (restored.length) {
      agent.setMessages(restoreFinalMessages(agent.messages, runTrace.events[runId] ?? [], restored, messageIdentity.resolvePersisted));
    }
    onMessageSent?.();
    return true;
  }, [agent, messageIdentity, registerHydrated, bindTraceMessages, onMessageSent, runTrace.events]);
  React.useEffect(() => { if (observedRunId) setPendingRunId(observedRunId); }, [observedRunId]);
  /**
   * issue #3416 —— 「后端在等你批，界面说它还在跑」。
   *
   * 服务端在权限门上并**不**报错：`copilotkit-agui.controller.ts` 的
   * `outcome.kind === "awaiting_tool_permission"` 分支逐字写着「NOT an error……ending the
   * run normally here」，wire 上只有一条 `RUN_FINISHED`。于是这次挂载只知道「这一轮流
   * 结束了」，**不知道它是停在一个门上**。
   *
   * 而审批卡的另外两个来源此刻都不命中：
   *
   * - `tracePendingPermission`（事件流投影里最后一条 `kind:"status"` 执行事件）在生产里
   *   是一条**死路**——`apps/api` 从不产生 `status: "awaiting_tool_permission"` 的执行
   *   事件（`appendExecutionEvent` 的调用点只有 tool_start / tool_end / text_delta /
   *   final_message / skill_activity；唯一的 `kind:"status"` 来自
   *   `legacy-execution-events.ts`，且只合成三个终态）。它至今只在替身里被喂过。
   * - `runRestore` 的权威读只有 `pendingRunId` 非空时才启动，而 `pendingRunId` 此前只在
   *   **挂载 hydration**（刷新 / 切走再切回）和 landing 交接时写入——本次挂载里发起的
   *   这一轮，两处都不写。
   *
   * 结果就是 #3416 的现象：数据在服务端（刷新一下同一张卡就正常出现、命令原文一致），
   * 缺的是「这次挂载怎么知道该去读它」。这也解释了报告方观察到却没有归因的那半句：
   * 刷新之后同一个 run 再遇到两个门都实时弹出——因为刷新那次 hydration 把
   * `pendingRunId` 设上了，`runRestore` 从此持有这条 run，后续每个门都由它接住。
   * 触发条件不是「第二个门」，是「这一轮 run 是不是在本次挂载里开始的」。
   *
   * 修法：run 一结束就**做一次刷新会做的那件事**——重读已落库消息，用同一个
   * `findPendingRunId` 判据（`readAllPersistedMessages` 顺手投影的 `pendingRunId`）问
   * 「有没有一轮还没写回的 run」。有 ⇒ 交给既有的 `useCopilotKitV2RunRestore` 做权威读，
   * 它自己会判断到底是 `awaiting_tool_permission` / `paused` 还是已经终态。
   *
   * ⚠ 这**不是**新增第四个"这条 run 是什么状态"的声明处：判据仍然只有
   * `findPendingRunId` 一份、权威仍然只有 `getAgentRun` 一处，这里只是补上一个触发时机。
   * 也**不是**轮询：每轮 run 结束恰好一次，与时间无关。正常答完的一轮里那条回复已经
   * 带着 `replyToMessageId` 落库 ⇒ `findPendingRunId` 返回 null ⇒ 一次权威读都不会发生
   * （`tests/ui/copilotkit-v2-live-tool-permission-gate.test.tsx` 第二条用例钉住这一点，
   * 否则每轮对话结束都会闪一下「正在恢复上次未完成的任务…」）。
   *
   * 只挂 `onRunFinishedEvent`，不挂 `onRunErrorEvent`：`failed` 走的是 `RUN_ERROR`，
   * 那条路径已经有自己的横幅与 #3367 的重挂逻辑，不在这里再插一手。
   */
  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunFinishedEvent: () => {
        const threadId = chatThreadIdRef.current;
        if (threadId === null) return;
        void (async () => {
          try {
            const { pendingRunId: stillPending } =
              await readAllPersistedMessages(threadId, getStoredSessionToken() ?? undefined);
            // 线程在这次异步读期间被切走了就什么都不做——那条 run 不属于现在这条线程。
            if (stillPending !== null && chatThreadIdRef.current === threadId) setPendingRunId(stillPending);
          } catch {
            // 读失败不是新错误，也不编一个状态：如实什么都不做，用户仍可刷新。
          }
        })();
      },
    });
    return unsubscribe;
  }, [agent]);
  const serverQueue = useThreadMessageQueue(resolvedChatThreadId, selectedAgentId, getStoredSessionToken());
  const queuedRunIds = useDispatchedQueueMessages(agent, serverQueue.items, resolvedChatThreadId, getStoredSessionToken(), registerHydrated, bindTraceMessages);
  useRunTraceTail({ observedRunId, observedRunIds: [...queuedRunIds, ...(runRestore.runId ? [runRestore.runId] : [])], threadId: resolvedChatThreadId, bearer: getStoredSessionToken() ?? undefined,
    events: runTrace.events, append: runTrace.append, onSettled: restoreJournalResult });

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
  // Create one scope-correct thread lazily for attachments or the first project message.
  const [createdAttachmentThreadId, setCreatedAttachmentThreadId] = React.useState<string | null>(null);
  const attachmentThreadPromiseRef = React.useRef<Promise<string> | null>(null);
  const resolveAttachmentThreadId = React.useCallback((): Promise<string> => {
    if (attachmentThreadPromiseRef.current === null) {
      attachmentThreadPromiseRef.current = createWorkbenchThread(projectId)
        .then((created) => {
          setCreatedAttachmentThreadId(created.threadId);
          return created.threadId;
        })
        .catch((failure: unknown) => {
          attachmentThreadPromiseRef.current = null; // 下一次上传重新尝试
          throw failure;
        });
    }
    return attachmentThreadPromiseRef.current;
  }, [projectId]);
  const attachmentThreadId = initialChatThreadId ?? createdAttachmentThreadId;
  // 「实时对话」（Chat 语音模式）：转写落进同一条线程；挂断后把新消息并进视图（新对话则回写地址栏触发 hydration）。
  const selectedVoiceAgent = agentOptions.status === "ready" ? agentOptions.agents.find((a) => a.id === selectedAgentId) ?? null : null;
  // 最新闭包放 ref：生命周期对象只建一次，通话中途重渲染不丢「本次自建线程」的记录。
  const voiceLatest = React.useRef({ agent, initialChatThreadId, createdAttachmentThreadId, onThreadResolved });
  voiceLatest.current = { agent, initialChatThreadId, createdAttachmentThreadId, onThreadResolved };
  const [voiceThread] = React.useState(() => createVoiceThreadLifecycle({
    existingThreadId: () => chatThreadIdRef.current ?? voiceLatest.current.initialChatThreadId ?? voiceLatest.current.createdAttachmentThreadId,
    projectId,
    onPersisted: ({ threadId: tid, createdByVoice, messageIds }) => {
      const { agent, onThreadResolved } = voiceLatest.current;
      if (createdByVoice && chatThreadIdRef.current === null) {
        chatThreadIdRef.current = tid;
        setResolvedChatThreadId(tid);
        onThreadResolved?.(tid);
        return;
      }
      void mergePersistedVoiceTurns(agent, tid, messageIds, getStoredSessionToken() ?? undefined).catch(() => setError({ key: "chatComposer.runtime.voiceSaved" }));
    },
    onNothingSaved: () => setNotice({ key: "chatComposer.runtime.voiceEmpty" }),
  }));
  const attach = useChatAttachments({
    threadId: attachmentThreadId ?? "",
    canWrite: canWrite && !archived,
    bearer: sessionToken ?? undefined,
    resolveThreadId: initialChatThreadId === null ? resolveAttachmentThreadId : undefined,
  });

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
  /*
    2026-09-02 composer 重设计——语音的 composer 级会话（暂停/继续/完成/丢弃/撤销 +
    静音提示 + 自动暂停），见 `lib/use-composer-voice-session.ts` 头注。
  */
  const voiceOpts = React.useMemo(() => ({
    setDraft: (text: string) => setInputDraft(text),
    getDraft: () => inputDraftRef.current,
  }), [setInputDraft]);
  const voice = useComposerVoiceSession(speech, voiceOpts);
  React.useEffect(() => {
    onVoiceStateChange?.(speech.listening || speech.connecting || speech.stopping ? "listening" : "idle");
  }, [onVoiceStateChange, speech.connecting, speech.listening, speech.stopping]);
  /*
    录音期文字滚动（人类反馈 2026-09-07：「composer 在录音的过程中文字多了以后无法上下
    滚动来查看文本，不能向下滚动看下面的文字」）——
    ① 录音期真正显示文字的是 `<textarea>` 底下那层镜像（`...-live-transcript`），
       它是 `absolute inset-0 overflow-hidden`，自己不滚也不跟随；`<textarea>` 虽然
       能滚（原生 `overflow: auto`），但它的文字是透明的，滚了也看不见任何变化——
       用户看到的就是"文字超过 3 行以后再也翻不到下面"。
    ② 修法：镜像的 `scrollTop` 跟着 `<textarea>` 走（`overflow-hidden` 的元素依旧
       可以被程序化滚动），于是滚轮/方向键在输入框上的滚动会真实地翻动可见文字。
    ③ 另外转录是持续追加的：只要用户没有主动往上翻（`voiceFollowRef`），新文字落地
       后自动滚到底，最新的一句始终可见；一旦用户往上翻，就停止自动跟随，直到他们
       自己滚回底部为止。
  */
  const composerMirrorRef = React.useRef<HTMLDivElement | null>(null);
  const voiceFollowRef = React.useRef(true);
  const syncComposerMirrorScroll = React.useCallback(() => {
    const ta = composerInputRef.current;
    const mirror = composerMirrorRef.current;
    if (!ta || !mirror) return;
    mirror.scrollTop = ta.scrollTop;
  }, []);
  const onComposerScroll = React.useCallback(() => {
    const ta = composerInputRef.current;
    if (ta) {
      // 2px 容差：行高取整/亚像素滚动位置会让"已经到底"差一点点。
      voiceFollowRef.current = ta.scrollHeight - ta.scrollTop - ta.clientHeight <= 2;
    }
    syncComposerMirrorScroll();
  }, [syncComposerMirrorScroll]);
  const voiceActive = speech.listening || speech.connecting;
  // 默认 1 行（`rows={1}`），内容变多时按 scrollHeight 长高、封顶后内部滚动。
  // 先把 height 归零再量 scrollHeight，删行时才会缩回去。
  React.useEffect(() => {
    const ta = composerInputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [inputDraft, voiceActive, speech.baseText, speech.committedText, speech.partialText]);
  // 每次开录都重新跟随（上一段录音里用户往上翻过，不该影响下一段）。
  React.useEffect(() => {
    if (voiceActive) voiceFollowRef.current = true;
  }, [voiceActive]);
  React.useEffect(() => {
    if (!voiceActive) return;
    const ta = composerInputRef.current;
    if (!ta) return;
    if (voiceFollowRef.current) ta.scrollTop = ta.scrollHeight;
    syncComposerMirrorScroll();
  }, [voiceActive, speech.baseText, speech.committedText, speech.partialText, syncComposerMirrorScroll]);
  // 按 Esc 停止录音（设计稿页脚："按 Esc 停止录音"）。
  React.useEffect(() => {
    if (voice.phase !== "listening" && voice.phase !== "connecting") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (voice.phase === "listening") voice.finish();
      else voice.discard();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [voice]);
  // 输入框被清空（发送成功 / 手动清空）⇒ 退出"转录后编辑"。
  React.useEffect(() => {
    if (voice.phase === "done" && inputDraft.trim() === "") voice.dismiss();
  }, [inputDraft, voice]);
  /*
   * 2026-09-10 人类实测反馈：「下面的绿色提醒要过 5 秒自动消失，不要一直停留」——
   * 「已转录 N 字」是一条**已完成动作的回执**，看过就没用了，却一直占着 composer 底部
   * 48px 直到用户发送或清空输入框。到点自动 `dismiss()`（与"输入框被清空"走同一条退出
   * 路径），转录出来的文字留在输入框里不动，只是这条回执不再常驻。
   * ⚠ 计时以进入 `done` 那一刻起算：依赖 `voice.phase`（不是 `voice` 整个对象）当
   * effect 依赖，否则 `voice` 每次渲染都是新引用，定时器会被反复重建、永远到不了 5 秒。
   */
  const voiceDismissRef = React.useRef(voice.dismiss);
  voiceDismissRef.current = voice.dismiss;
  React.useEffect(() => {
    if (voice.phase !== "done") return;
    const timer = setTimeout(() => voiceDismissRef.current(), TRANSCRIBED_BAR_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [voice.phase]);

  /** 卡片底部状态栏：语音各态 > Agent 处理中 > 附件上传中 > 无。文案与操作对齐设计稿。 */


  /**
   * CK-P4（issue #2054）—— run 进度：已耗时 / 阶段文案 / 45s longrun 提示。
   * 逐维「v2 侧真的拿得到什么」的核实结论写在 `lib/copilotkit-v2-run-progress.ts`
   * 文件头（拿不到的三维如实登记为不做，没有伪造）。
   */
  const runProgress = useCopilotKitV2RunProgress(agent, agent.isRunning);

  /**
   * issue #2068 —— 把上面三样真实状态上报给外壳的右栏 Inspector。
   *
   * ⚠ 三个各自一个 effect、依赖数组精确到值，不合成一个大 effect：合起来的话任意一维
   * 变化（比如每秒推进的 `elapsedSeconds`）都会把另外两个回调也重放一遍，外壳侧的
   * `setState` 每秒被叫三次。计时器本来就每秒 tick，这一点不能再放大。
   */
  React.useEffect(() => {
    onPlanTodosChange?.(planTodos);
  }, [planTodos, onPlanTodosChange]);
  // session-switch task-state-loss fix —— `agent.isRunning` 只在**这次挂载**的 AG-UI
  // 连接上有一轮 run 时为真；`runRestore.isRestoring` 覆盖"挂载时发现上一轮 run 可能
  // 还没写回，正在核实"这段窗口——两者是"这条线程当前是否该显示生成中"这同一件事的
  // 两个真实来源，or 起来才是完整答案，不是二选一。
  const activeTrace = Object.entries(runTrace.events).filter(([, events]) => {
    const status = [...events].reverse().find((event) => event.kind === "status");
    return status?.kind === "status" && ["running", "paused", "awaiting_tool_permission"].includes(status.status);
  }).sort((a, b) => (b[1].at(-1)?.emittedAt ?? "").localeCompare(a[1].at(-1)?.emittedAt ?? ""))[0];
  const runIsRunning = agent.isRunning || runRestore.isRestoring || runRestore.status === "running" || runRestore.status === "queued" || runRestore.status === "awaiting_plan_confirmation" || runRestore.status === "writeback_pending" || runRestore.status === "paused" || runRestore.status === "awaiting_tool_permission" || Boolean(activeTrace) || serverQueue.items.some((item) => item.status === "pending" || (item.status === "dispatched" && item.runId && !runTrace.events[item.runId]));
  // issue #2756 —— 在途 run 的真实 runId + 实时 status，供下方插话入口用（逻辑全在该 hook 文件头）。
  const connectedInterjectionRun = useChatHostInterjectionRun({
    agent, isRunning: agent.isRunning, threadId: resolvedChatThreadId, sessionToken,
    restore: { runId: runRestore.runId, status: runRestore.status },
  });
  const traceStatus = activeTrace?.[1].slice().reverse().find((event) => event.kind === "status");
  /*
   * issue #3207 —— 「左上角出现了任务提醒，但确认弹窗没有在窗口里弹出来」。
   *
   * 「这条线程现在有没有一个等人裁决的工具审批」是**一个**事实，此前被声明在两处：
   * 左上角提醒读 `runRestore.status`（#2825 之后是切回来先做的**权威读**），审批弹窗
   * 的挂载条件只读 `activeTrace`（事件流投影 `runTrace.events`）。中断发生在这次挂载
   * 建立订阅之前（刷新 / 切走再切回 / 订阅晚于中断）时，那条 `awaiting_tool_permission`
   * 的 status 事件在这次挂载上**永远不会再来**——提醒显示了，弹窗永不挂载，用户知道
   * 「有事要我确认」却没有可确认的界面。
   *
   * 收敛成这一个派生值：事件流优先，事件流沉默时回落到权威读。
   *
   * key 只按 runId（issue #3212）——此前带上 `traceStatus.seq`，于是同一个 run 里的**第二次**
   * 中断会把审批组件整个重挂，它刚记下的「本 run 内已经问过几次、上次选了哪档」随之清零，
   * 第二次弹窗因此与第一次逐像素相同。同一条 run 的审批是**一段连续会话**，不是每条 status
   * 事件一个新组件；组件内部本来就按 `permissionRequestId` 分辨新请求
   * （`restored-run-approval.tsx` 的 `consumedRequestId`），不需要靠换 key 来刷新。
   *
   * ⚠ 这里**只放宽"从哪知道该渲染"，不放宽任何授权判断**——是否需要裁决
   * 仍然由服务端 `tool-permission-gate.ts` 决定，弹窗自己还会用 `getAgentRun` 的
   * `pendingApproval` 做一次权威核对（`restored-run-approval.tsx`），run 若已不在
   * `awaiting_tool_permission` 它自己就返回 null。
   */
  const tracePendingPermission = activeTrace && traceStatus?.kind === "status"
    && traceStatus.status === "awaiting_tool_permission"
    ? { runId: activeTrace[0], key: activeTrace[0] }
    : null;
  const pendingPermission = tracePendingPermission
    ?? (runRestore.status === "awaiting_tool_permission" && runRestore.runId
      ? { runId: runRestore.runId, key: runRestore.runId }
      : null)
    /* issue #3367 第 ③ 类：见 `reattachApproval` 声明处头注。排在最后——推流与恢复读
       都是更实时的来源，有它们时不需要这一条。 */
    ?? (reattachApproval ? { runId: reattachApproval.runId, key: reattachApproval.runId } : null);
  const interjectionRun = activeTrace && traceStatus?.kind === "status"
    ? { runId: activeTrace[0], status: traceStatus.status }
    : connectedInterjectionRun;
  // issue #2797 -- 见 `runReportContextRef` 声明处头注：每次渲染后刷新,供上面
  // `onError` 订阅 / `send()` 的 `catch` 读到的是当前这一轮真实的 runId/threadId/
  // phase,不是订阅建立那一刻闭包住的旧值。不带依赖数组——就是要在每次渲染后跑。
  React.useEffect(() => {
    runReportContextRef.current = {
      runId: interjectionRun.runId,
      threadId: resolvedChatThreadId ?? chatThreadIdRef.current,
      phase: runProgress.stage,
    };
  });
  const cancellation = useRunCancellation(interjectionRun.runId ?? activeTrace?.[0] ?? latestCancelledRun(runTrace.events), sessionToken);
  React.useEffect(() => { if (cancellation.failure) setError(cancellation.failure); }, [cancellation.failure]);
  const restoredPhaseLabel = restoredRunPhaseLabel(runRestore.status, runRestore.isRestoring);
  const runPhaseLabel = runProgress.phaseLabel ?? restoredPhaseLabel;
  const runStartedAt = runProgress.startedAt;
  React.useEffect(() => {
    onRunStateChange?.({
      isRunning: runIsRunning,
      phaseLabel: runPhaseLabel,
      phaseLabelOwned: true,
      startedAt: runStartedAt, recoveryDiagnostic,
    });
  }, [runIsRunning, runPhaseLabel, runStartedAt, onRunStateChange, recoveryDiagnostic]);
  const pendingMaterialsCount = attach.uploadedIds.length;
  React.useEffect(() => {
    onPendingMaterialsChange?.(pendingMaterialsCount);
  }, [pendingMaterialsCount, onPendingMaterialsChange]);
  /** 见 `chat-composer-attachments.tsx` 的 `uploadingCount` 头注——右栏「材料」页签
   * 从这里知道"正在传几个"，不是只在传完之后才有反馈。 */
  const uploadingMaterialsCount = attach.uploadingCount;
  React.useEffect(() => {
    onUploadingMaterialsChange?.(uploadingMaterialsCount);
  }, [uploadingMaterialsCount, onUploadingMaterialsChange]);

  /**
   * issue #3347 —— 把 composer 这**同一个**附件控制器的最小上传能力面交给外壳，
   * 外壳转给右栏「材料」页签（`ChatTaskInspector`），那里的「+」与拖拽落区因此走
   * 的是同一条 pending 队列、同一次 `POST /chat/threads/:id/attachments`、同一批
   * `attachmentIds` 随下一条消息发出。
   *
   * ⚠ 为什么是"上报一个窄面"而不是把控制器整个抬到外壳：控制器活在这里是因为
   * composer 的发送路径要读它（`attach.uploadedIds`）；抬上去要动的是本文件在途
   * 冲突最密的那一段。而窄面只有三样、身份都稳（`pickFiles` 是 `useCallback`，
   * `banner` 只在被拒时变）——**刻意不搬 `attachments`**，它随上传进度高频变，搬上去
   * 等于让整个外壳跟着进度条重渲染。
   *
   * 也**刻意不搬"能不能上传"**：外壳自己就握着权威的 `canWriteThread`/`archived`/
   * `selectedThreadId`，让它算一遍理由，比这里再上报一份、两处各判一次要少一份事实。
   */
  const attachUploadPort = React.useMemo(
    () => ({ pickFiles: attach.pickFiles, banner: attach.banner }),
    [attach.pickFiles, attach.banner],
  );
  React.useEffect(() => {
    onAttachUploadPortChange?.(attachUploadPort);
  }, [attachUploadPort, onAttachUploadPortChange]);

  // The skill panel supplies the role-scoped selected count from its authoritative read.
  const [mountedSkillsCount, setMountedSkillsCount] = React.useState(0);


  // Execution details now live in TaskTimeline; the status announcer only announces transitions.
  /**
   * issue #2075（TW-A11Y-4）—— agent 状态变化播报。视觉用户看得到运行状态条在动
   * （`copilotkit-v2-running-indicator` / `copilotkit-v2-thinking`），屏幕阅读器用户
   * 此前什么都听不到。这里只播**状态迁移**（开始/结束），不播每一帧耗时——
   * 每秒念一次"已耗时 7 秒"会把 live region 变成噪声源。
   */
  const wasRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (agent.isRunning && !wasRunningRef.current) announceToChat(renderChatDisplayText({ key: "chatComposer.runtime.announceStart" }, displayLocaleRef.current));
    if (!agent.isRunning && wasRunningRef.current) announceToChat(renderChatDisplayText({ key: error ? "chatComposer.runtime.announceFailure" : "chatComposer.runtime.announceDone" }, displayLocaleRef.current));
    wasRunningRef.current = agent.isRunning;
  }, [agent.isRunning, error]);

  /** CK-P4 —— 最近一次真的发出去的用户消息，供错误横幅上的「重试」重发。
   *
   * issue #2321 round 2 -- 现在还存那一轮的 `clientMessageId`，不只是文本/附件：
   * 「重试」要复用同一个 id（见下面 `send` 的 `opts.clientMessageId`），不是重新
   * 生成一个。真实证据见 `copilotkit-agui.controller.ts` 的
   * `parseForwardedClientMessageId` 头注——不复用会让后端把重试当成一次全新的
   * 人类消息 + 全新的 agent run，而原来那个 run（真实 skill 调用，例如 PDF 生成）
   * 可能仍在服务端跑，两边互不知情，各自写回一条回复、各自真的生成一次文件。 */
  const lastSentRef = React.useRef<
    { text: string; attachments: readonly ChatAttachment[]; clientMessageId: string } | null
  >(null);

  // Use the same empty-branch decision for layout and automatic following.
  // Loading, running and supplied stream blocks retain timeline behavior.
  const streamSlots = useChatStreamSlots();
  const isEmptyThread = !historyLoading && projectedMessages.length === 0 && !agent.isRunning && !streamSlots.lead && !streamSlots.tail && !streamSlots.emptyState;
  const { messagesContainerRef, messagesContentRef, isAtBottom, handleMessagesScroll,
    handleUserScrollIntent, scrollMessagesToBottom, prefersReducedMotion } = useTimelineScroll(projectedMessages, !isEmptyThread);

  const sendIsBlocked = !canWrite || archived || runIsRunning || attach.hasUploading;

  const send = React.useCallback(
    async (
      override?: string,
      opts?: {
        readonly clientMessageId?: string;
        /**
         * 「重试」专用：重发失败的那一轮时，composer 的 pending 队列早已在上一次发送
         * 那一刻清空（见下方 `attach.clear()` 的位置），这里把那一轮真实带过的附件行
         * 原样传回来，不从已经空了的队列里再读一次。
         */
        readonly attachments?: readonly ChatAttachment[];
      },
    ) => {
      const text = (override ?? inputDraft).trim();
      if (sendIsBlocked || text === "") return false;
      // chat-parity-attachments (issue #2022) -- 上传未完成时不发送，与 composer 里
      // 附件行的 spinner/进度条同一份诚实约束（旧轨道 `ChatAttachMaterialModal`
      // 「加入这一轮」按钮同一条禁用逻辑）。

      const acceptedBefore = acceptedRunEpoch.current;
      sendFailedRef.current = false; setRecoveryDiagnostic(null);
      setError(null);
      setNotice(null);
      /* issue #3367 —— 新的一轮开始，上一轮「其实还在等人批」的重挂请求作废。 */
      setReattachApproval(null);
      setInputDraft("");
      // issue #2020 —— 正文已清空，活跃 mention 一并终结（不清的话外层的候选面板
      // 会带着一个已不存在于正文里的 query 继续开着）。
      setMention(null);
      // issue #2321 round 2 -- 有 `opts.clientMessageId` 时（重试）复用它；否则
      // （正常发送/追问/建议候选）现铸一个新的，语义与升级前一致。
      const clientMessageId = opts?.clientMessageId ?? crypto.randomUUID();
      // CK-P4（issue #2054）—— 记住这一轮的用户正文，供失败后的「重试」重发。
      // ⚠ 存的是**已发出**的那句，不是 composer 里的当前草稿：用户看到失败横幅时
      //   很可能已经在输入框里敲别的了，重试要重发失败的那一句。
      // chat-parity-attachments (issue #2022) -- 本轮真实带出去的附件（服务端上传接口
      // 回的原始实体行）。`attachmentIds` 从同一份派生，不另数一遍。
      const sentAttachments = opts?.attachments ?? attach.uploadedAttachments;
      const attachmentIds = sentAttachments.map((a) => a.id);
      lastSentRef.current = { text, attachments: sentAttachments, clientMessageId };
      // issue #4180 —— 这一条是本会话真的发出去的（不是重试复用同一个 id 的第二次登记也无妨，
      // Set 天然去重）。
      setSentMessageIds((cur) => (cur.has(clientMessageId) ? cur : new Set(cur).add(clientMessageId)));
      if (!agent.messages.some((message) => message.id === clientMessageId)) agent.addMessage({ id: clientMessageId, role: "user", content: text });
      // Sending is an explicit request to see the new turn, including after reading history.
      scrollMessagesToBottom("auto");
      /*
       * 2026-09-15 人类实测反馈 —— 附件在**发送这一刻**就从 composer 移到那条用户消息
       * 上，不等这一轮 run 跑完。
       *
       * 此前 `attach.clear()` 挂在下面 `await copilotkit.runAgent(...)` 之后：一轮
       * agent run 动辄几十秒到几分钟，这整段时间里那张附件卡片仍然待在 composer 里，
       * 看起来像"文件没发出去"（人类截图：任务已在推进，文件还挂在输入框上）。而这条
       * 消息本身已经乐观插入、`attachmentIds` 也已经随请求发出——composer 里那张卡片
       * 从那一刻起就不再是"待发送的草稿"，它描述的是一件已经发生的事。
       *
       * ⚠ 失败路径不因此丢东西：`lastSentRef` 存的是这一批附件行本身，「重试」经
       *   `opts.attachments` 原样传回来（见本回调 `opts` 的文档），走的还是同一批
       *   服务端 id，不需要重新上传。
       */
      if (attachmentIds.length > 0) {
        setUserMessageAttachments((cur) => new Map(cur).set(clientMessageId, sentAttachments));
        attach.clear();
      }
      // 附件必须挂在它们实际所在的那条真实线程上（`acceptHumanMessage` 校验
      // attachmentIds 归属），所以本轮一旦带了附件，chatThreadId 就必须是
      // `attachmentThreadId`——即便这是 turn 1（DA-19g 原本"turn 1 不传"的前提是
      // "还没有任何真实线程"，本轮已经因为附件而有了）。没有附件的路径完全不变。
      let chatThreadId = chatThreadIdRef.current ?? (attachmentIds.length > 0 ? attachmentThreadId : null);
      try {
        if (!chatThreadId && projectId) chatThreadId = await resolveAttachmentThreadId();
        // DA-19g -- echo the resolved Chat thread id back on every turn AFTER the first
        // (see the `chatThreadIdRef` block above for why this is the fix, not a new
        // mechanism). Omitted entirely on turn 1 -- identical to pre-fix behaviour, UNLESS
        // this turn carries attachments (chat-parity-attachments, issue #2022 -- see above).
        // issue #2321 round 2 -- `clientMessageId` always forwarded now (see this
        // callback's own `opts` doc + `lastSentRef`'s head comment for why).
        const forwardedProps: {
          chatThreadId?: string; attachmentIds?: readonly string[]; clientMessageId: string;
          realtimeContext?: { readonly boardId: string; readonly selectedObjectIds: readonly string[] };
        } = { clientMessageId };
        if (chatThreadId !== null) forwardedProps.chatThreadId = chatThreadId;
        if (attachmentIds.length > 0) forwardedProps.attachmentIds = attachmentIds;
        if (realtimeContext) forwardedProps.realtimeContext = realtimeContext;
        await copilotkit.runAgent({ agent, forwardedProps });
        // issue #2046（CK-P1）—— run settle 后通知外壳刷新右栏「材料」/「产物」
        // （消息与附件此时都已真实落库；与旧轨道 `onMessageSent` 同语义）。
        onMessageSent?.();
        return acceptedRunEpoch.current > acceptedBefore || !sendFailedRef.current;
      } catch (e) {
        // DA-19g -- 与上面 `copilotkit.subscribe({ onError })` 走同一份文案映射
        // （`copilotkit-v2-error-copy.ts`），不在这条分支单独拼一句可能带原始异常
        // message（往往是英文技术细节，同样不是人话）。这条分支现在只兜"`runAgent()`
        // 自己抛出 JS 异常"这种更边缘的情况——常规的 `RUN_ERROR` 事件已经被上面的
        // `onError` 订阅接住，不会再走到这里。
        // issue #2779 —— 同上面 `onError` 订阅那条注释：只补诊断日志，不改用户可见
        // 文案。这条分支此前把 `e` 完全丢弃，落进通用兜底文案时排障者连原始异常
        // 是什么都看不到。
        console.error("[copilotkit-v2] runAgent() threw", e);
        const thrownCode = e instanceof Error ? e.message : "COPILOTKIT_RUNTIME_RUN_FAILED";
        setError(ownedRunError(describeCopilotkitV2RunError(thrownCode)));
        /*
         * issue #3387 ① —— 这条分支此前是**第二处**「要不要报失败」的判断：它只看
         * `runAgent()` 抛没抛异常，从不问 `agent_runs` 这一轮到底成没成。而
         * `runAgent()` 抛异常与「run 失败」并不等价——中继放弃轮询、传输层被中途
         * 切断（见 `poll-budget.ts` 文件头）时，后端那条 run 照样跑完、照样写回产出。
         * 现在它与上面 `onError` 那条走**同一个**派生点（`resolveLiveRunErrorOutcome`），
         * 不再各判一次。
         */
        const thrownRunId = runReportContextRef.current.runId;
        bannerRunRef.current = thrownRunId;
        void resolveLiveRunErrorOutcome({
          runId: thrownRunId, code: thrownCode, bearer: getStoredSessionToken() ?? undefined,
        }).then((outcome) => {
          if (bannerRunRef.current !== thrownRunId) return;
          if (outcome.kind === "recovered") { setError(null); setNotice({ key: "chatComposer.runtime.recovered" }); return; }
          if (outcome.kind === "reattach_approval") { setError(null); setReattachApproval({ runId: outcome.runId }); return; }
          setError(ownedRunError(outcome.text));
        });
        // issue #2797 -- 同上面 `onError` 订阅那条注释：结构化上报,fire-and-forget。
        reportClientError(e, { errorType: "runAgent_exception", ...runReportContextRef.current });
        return acceptedRunEpoch.current > acceptedBefore;
      }
    },
    [agent, copilotkit, inputDraft, setInputDraft, attach, attachmentThreadId, onMessageSent, acceptedRunEpoch, projectId, resolveAttachmentThreadId, realtimeContext, sendIsBlocked, scrollMessagesToBottom],

  );

  /**
   * issue #4179（F17 手动入口 ①②：消息 hover「记住这句」+ 记忆面板「+ 记一条」）——
   * 两个入口都只发 `requestRememberStatement`（`lib/knowledge-graph-events.ts`），真正执行在
   * 这里：把它当一条新的聊天消息发出去，加「记住：」前缀，复用 F17 已有的
   * `detectMemoryIntent` → `cards.open` 路径（`domain/knowledge-graph/memory-intent.ts`），
   * **不新增契约操作**。是否真的记住仍由随后出现在回答下方的确认卡决定——这里只是把它
   * 送进那条既有的检测通路，跟用户自己在输入框敲「记住：…」发出去完全是同一条路。
   * `send()` 自身已有 `canWrite`/`archived`/`runIsRunning` 等门（见上方定义），这里不重复判断。
   */
  React.useEffect(() => onRememberStatement((statement) => {
    void send(`记住：${statement}`);
  }), [send]);

  // Template recommendations retain the existing persisted-evidence and permission gates.
  /*
   * issue #3000 —— 这里读的必须是**当前生效的**线程 id，不是挂载时那个。
   *
   * `initialChatThreadId` 是挂载时 URL 里的值，裸 `/chat` 落地时是 `null`，而首轮发完
   * 消息后它**不会**变成新线程 id：#2021 刻意用 `history.replaceState` 而不是路由状态，
   * 正是为了不让 Body 在 run 在途时被重挂载（见 `copilotkit-v2-panel.tsx` 里 `key` 那段
   * 注释记录的真回归）。于是本 hook 的 `initialChatThreadId === null` 早退分支永远命中，
   * 同一次页面加载内**模板/画像建议一条都不会出现**——`copilotkit-v2-persona-archived.spec.ts:86`
   * 等 `chat-persona-summary-trigger` 30s 找不到，就是这条：不是权限（`capabilities` 含
   * `artifact.land`）没下发，是推荐根本没去取。
   *
   * `resolvedChatThreadId` 就是为这类"首轮之后才知道线程 id"的消费方准备的 state
   * （`serverQueue` / `useRunTraceTail` / landing 都已经读它），换过来不引入任何重挂载。
   */
  const effectiveChatThreadId = resolvedChatThreadId ?? initialChatThreadId;
  const personaThreadHasPersistedEvidence =
    effectiveChatThreadId !== null
    && ((hydratedEvidence !== null
      && hydratedEvidence.threadId === effectiveChatThreadId
      && hydratedEvidence.hasMessages)
      || resolvedThreadIdsRef.current.has(effectiveChatThreadId));
  const { templateRecommendations, personaGeneratedOnce, personaRunning, personaFailure,
    dismissedTemplateKeys, dismissTemplateSuggestion, runPersonaSummary } = useTemplateRecommendations({
      agent, initialChatThreadId: effectiveChatThreadId, projectId, archived, personaThreadHasPersistedEvidence, onMessageSent,
    });


  /**
   * issue #2096（真实 devapp 实测：打字/滚动时消息区画布内容闪烁）—— 根因：两个
   * context provider（`CopilotKitV2MessageActionsProvider`/`ArtifactLandingCtx.Provider`）
   * 的 `value` 此前都是内联对象字面量，每次这个组件重渲染（composer 打字触发的
   * `inputDraft` 更新、`handleMessagesScroll` 的 `setIsAtBottom`……几乎每个用户
   * 交互都会）都会创建一个**新**对象——即使里面每个字段的值都没变，React context
   * 按引用比较，identity 一变，**订阅这两个 context 的每一条消息**（`V2AssistantMessageImpl`）
   * 都被迫重渲染，包括其中的 `ChatDiagramFabric`/`ChatCanvasFabric`——那正是用户看到
   * 的"画布内容闪烁"。`landingContext`/`messageIdentity` 本身已经各自 memo 过
   * （见 `useChatMessageIdentity`/上面的 `landingContext`），问题出在**外面这层包装
   * 对象**没有跟着 memo。
   */
  const messageActionsContextValue = React.useMemo(
    () => ({ identity: messageIdentity, agentId: actingAgentId, agentLabel: actingAgentLabel, landing: landingContext }),
    [messageIdentity, actingAgentId, actingAgentLabel, landingContext],
  );
  // `chatThreadIdRef.current` 有意读取渲染时刻的值（ref 本身不触发渲染，见该 ref
  // 自己的既有纪律）：只有当它恰好在别的原因引发的渲染之间真的变了，下面这个 memo
  // 才应该重建对象；lint 规则不认识"读 ref 当依赖是有意为之"这个既有模式，下一行禁用。
  const artifactLandingContextValue = React.useMemo(
    () => ({ projectId, threadId: chatThreadIdRef.current ?? undefined, bearer: sessionToken ?? undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatThreadIdRef.current, sessionToken, projectId],
  );

  /**
   * 2026-09-15 —— 消息气泡上的附件（见上方 `userMessageAttachments` 的头注）。
   * `threadId` 是 `MessageAttachments` 的弹窗预览/下载要打的那条真实线程：优先读
   * 已 resolve 的 `chatThreadIdRef`，回落到附件本来就上传到的那条
   * （`attachmentThreadId`）——同一批附件的归属线程，不是另找一个 id。
   * 读 ref 当依赖的理由同上一个 memo，不重复一遍。
   */
  const userMessageAttachmentsContextValue = React.useMemo(
    () => ({
      threadId: chatThreadIdRef.current ?? attachmentThreadId ?? "",
      byMessageId: userMessageAttachments,
      // issue #4180 —— 见 `sentMessageIds` 头注。
      sentThisSession: sentMessageIds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatThreadIdRef.current, attachmentThreadId, userMessageAttachments, sentMessageIds],
  );

  /**
   * 2026-08-30 —— 见 `ProducedFilesCtx` 自己的文档：`source: "agent_run_output"`
   * 的文件挂到产出它的消息下面（`producedActiveFiles`），其余来源（目前生产环境
   * 没有真实生产者，但组件本身留着给将来的 `chat_upload`/`artifact_pin`）仍然走
   * 旁边那一列（`panelActiveFiles`）。`useMemo` 而不是每次渲染新建数组/对象，理由同
   * 上面 `artifactLandingContextValue` 那段注释——避免 context identity 抖动逼所有
   * 消息重渲染。
   */
  const producedActiveFiles = React.useMemo(
    () => activeFiles.filter((f) => f.source === "agent_run_output"),
    [activeFiles],
  );
  const panelActiveFiles = React.useMemo(
    () => activeFiles.filter((f) => f.source !== "agent_run_output"),
    [activeFiles],
  );
  const producedFilesContextValue = React.useMemo(
    () => ({ files: producedActiveFiles, threadId: chatThreadIdRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [producedActiveFiles, chatThreadIdRef.current],
  );

  /**
   * issue #2130（TW-P0-5④，回指 #2068）—— 发送被禁用时必须**说明原因**，不能只是
   * 灰掉。四条真实理由，按优先级判定；`null` = 未禁用。全部读的是已经存在的真实
   * 状态（`archived`/`isReady`/`agent.isRunning`/`attach.hasUploading`/输入是否为空），
   * 没有一条是为了凑判据现编的。
   */
  /*
   * ⚠ 刻意**不**把 `!isReady` 加进这条判据链：`isReady` 通常在挂载后极短时间内
   * 变真，但本仓一大批既有 e2e 在 `copilotkit-v2-input` 一可见就立刻填字发送，
   * 把它加进禁用条件有极小概率在慢机器上制造一条此前不存在的竞态红——判据
   * TW-P0-5④ 本身只要求"空输入必须禁用并说明原因"，不需要这一条也能满足。
   */
  // 2026-09-06 人类直接反馈：「agent 还在生成时也要能回复 A/B」——`agent.isRunning` 不再是
  // 禁用理由；运行中的正文走 `sendWhileRunning`（插话 / 排队，见
  // `lib/chat-composer-running-reply.ts` 文件头），发送键只在**输入框为空**时才是「停止」。
  const sendDisabledReason: MessageKey | null = !canWrite ? "chatComposer.permission" : archived
    ? "chatComposer.archived"
    : attach.hasUploading
      ? "chatComposer.uploadingSend"
      // 录音进行中不许发送（见 `RECORDING_SEND_REASON`）——排在"空输入"之前，因为录音
      // 刚开始、还没转出第一个字时输入框确实是空的，但那时该说的是"先停止"而不是"先输入"。
      : voice.phase === "connecting" || voice.phase === "listening" || voice.phase === "stopping"
        ? RECORDING_SEND_REASON
        : inputDraft.trim() === ""
          ? EMPTY_INPUT_REASON
          : null;
  const sendDisabled = sendDisabledReason !== null;

  // Running deliveries are serialized by useRunningReply.
  const clearRunningDraft = React.useCallback((revision?: number) => { clearComposerDraft(revision); setMention(null); }, [clearComposerDraft]);
  /**
   * issue #3399 ② —— 「本轮未被采纳」的插话有且只有一条去向：重新发出去。
   *
   * 发得出去就发（它会落在消息流**底部**，正是用户去找它的地方）；发不出去（比如
   * 又有一轮在跑）就把原话放回输入框，用户看得见、按得动。两条分支都**有事发生**，
   * 不留"显示了一句状态、然后什么都没发生"的路径。
   */
  const resendInterjection = React.useCallback((text: string) => {
    void (async () => { if (!(await send(text))) setInputDraft(text); })();
  }, [send, setInputDraft]);
  const { queuedReply, setQueuedReply, queuedFailed, retryQueuedReply, runningReplyAck, interjectPending, sendWhileRunning } = useRunningReply({
    agent, canWrite: canWrite && !archived, threadId: resolvedChatThreadId ?? initialChatThreadId ?? threadId, run: interjectionRun, inputDraft, inputDraftRevision: composerDraft.revision, sessionToken, enqueue: serverQueue.enqueue,
    draftScope: JSON.stringify([draftSession?.currentOrgId ?? orgId, draftSession?.userId ?? null, projectId]),
    clearDraft: clearRunningDraft, setError,
  });

  /*
    2026-09-02 composer 三层结构——三样新状态，全部只服务于第二行：
    · `attachOpen`：「加材料」面板的受控开关（触发器是「+」菜单项，面板本体见
      `ChatAttachmentDock`）。归档 / 运行中 / 没线程时强制关掉，同旧 `ChatAttachmentButton`
      内部那条 effect。
    · `capabilityOpen`：能力浮层的互斥槽（`chat-capability-picker`），菜单项点它。
    · `emptySendHint`：「请先输入任务目标」不再常驻——空输入时 placeholder 已经说了同一句
      话，常驻等于说两遍。改成用户「试图」发送（空输入按 Enter）时短暂出现一次；
      其余禁用理由（归档 / 运行中 / 上传中）仍然常驻，那些是用户猜不到的。
  */
  // issue #2520 —— 附件线程改为第一次上传时按需建（见上面 `resolveAttachmentThreadId`），
  // 📎 不再等预建完成，只看是否登录（未登录上传本来就要鉴权）。
  const attachDisabled = !canWrite || archived || agent.isRunning || sessionToken === null;
  const [attachOpen, setAttachOpen] = React.useState(false);
  React.useEffect(() => { if (attachDisabled) setAttachOpen(false); }, [attachDisabled]);
  const [emptySendHint, setEmptySendHint] = React.useState(false);
  /** 底部状态行只在有话要说时出现（2026-09-08 人类指令去掉常驻的快捷键/麦克风提示）。 */
  const composerFooterVisible =
    queuedReply !== null || runningReplyAck !== null
    || (sendDisabledReason !== null && sendDisabledReason !== RECORDING_SEND_REASON
      && (sendDisabledReason !== EMPTY_INPUT_REASON || emptySendHint) && !attach.hasUploading)
    || voice.phase === "listening" || voice.phase === "connecting";
  const emptySendHintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashEmptySendHint = React.useCallback(() => {
    setEmptySendHint(true);
    if (emptySendHintTimer.current !== null) clearTimeout(emptySendHintTimer.current);
    emptySendHintTimer.current = setTimeout(() => setEmptySendHint(false), EMPTY_SEND_HINT_MS);
  }, []);
  React.useEffect(() => () => {
    if (emptySendHintTimer.current !== null) clearTimeout(emptySendHintTimer.current);
  }, []);

  // Recommendations reuse persisted persona evidence and local dismissal preferences.
  const personaAlreadyGenerated =
    personaGeneratedOnce
    || (hydratedEvidence !== null
      && hydratedEvidence.threadId === effectiveChatThreadId
      && hydratedEvidence.hasPersonaArtifact);
  const templateSuggestions: readonly LocalSuggestionChip[] = templateRecommendations
    .filter((t) => !dismissedTemplateKeys.has(t.key))
    // 同上：忽略/已生成这两条本地偏好也按**当前生效**的线程 id 读，否则首轮之后
    // 读的是 `null`（等于对新线程一律不过滤），与推荐来源不是同一条线程。
    .filter((t) => effectiveChatThreadId === null
      || !readTemplateSuggestionDismissed(effectiveChatThreadId, t.key))
    .filter((t) => t.key !== "persona" || (canGeneratePersona && !personaAlreadyGenerated))
    .map((t) => {
      const isPersona = t.key === "persona";
      const running = isPersona && personaRunning;
      const labelMessage: ChatOwnedMessage = running
        ? { key: "chatComposer.runtime.personaRunning" }
        : { key: "chatComposer.runtime.generate", params: { name: t.displayName } };
      return {
        id: isPersona ? "chat-persona-summary-trigger" : `chat-template-suggestion-${t.key}`,
        label: renderChatDisplayText(labelMessage, "zh-CN"),
        labelMessage,
        disabled: running,
        onSelect: isPersona
          ? () => void runPersonaSummary()
          : () => void send(t.prompt),
        // issue #2694 修复——生成中不给关闭入口：点击已经在途的请求半路"关闭"不会
        // 取消它，反而会让用户误以为按钮消失=请求也没了，与上面 `disabled` 同一条
        // 纪律（不制造"看起来生效、其实没有"的交互）。
        onDismiss: running ? undefined : () => dismissTemplateSuggestion(t.key),
      };
    });

  const seededDraftKey = React.useRef<string | null>(null);
  const draftSeed = streamSlots.draftSeed ?? null;
  React.useEffect(() => {
    if (!draftSeed || seededDraftKey.current === draftSeed.key || historyLoading || projectedMessages.length > 0) return;
    seededDraftKey.current = draftSeed.key;
    if (inputDraftRef.current.trim() === "") setInputDraft(draftSeed.text);
  }, [draftSeed, historyLoading, projectedMessages.length, setInputDraft]);

  return {
    EMPTY_INPUT_REASON,
    RECORDING_SEND_REASON,
    actingAgentId,
    agent,
    agentOptions,
    archived,
    artifactLandingContextValue,
    attach,
    attachDisabled,
    attachOpen,
    attachmentMention,
    attachmentOptions,
    canDecide,
    canWrite,
    cancellation,
    chatThreadIdRef,
    composerFooterVisible,
    composerInputRef,
    composerMirrorRef,
    emptySendHint,
    error,
    flashEmptySendHint,
    handleMessagesScroll,
    handleUserScrollIntent,
    historyError,
    historyLoading,
    initialChatThreadId,
    inputDraft,
    insertAttachmentMention,
    interjectPending,
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
    micDevices,
    mountedSkillsCount,
    notice,
    onComposerScroll,
    onSelectAgent,
    onSkillMentionMounted,
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
    recomputeMention,
    resendInterjection,
    resolvedChatThreadId,
    retryQueuedReply,
    runIsRunning,
    runPhaseLabel,
    runPhaseLabelOwned: true,
    runTrace,
    runningReplyAck,
    scrollMessagesToBottom,
    selectedAgentId,
    selectedVoiceAgent,
    send,
    sendDisabled,
    sendDisabledReason,
    sendIsBlocked,
    sendWhileRunning,
    serverQueue,
    sessionToken,
    setAttachOpen,
    setEmptySendHint,
    setError,
    setInputDraft,
    setLivePlan,
    setMountedSkillsCount,
    setPendingRunId,
    setPlanStepRecoveryOffered,
    setQueuedReply,
    setSkillOpenRequest,
    setSkillTrigger,
    skillMention,
    skillOpenRequest,
    skillTrigger,
    speech,
    streamSlots,
    templateSuggestions,
    threadId,
    userMessageAttachmentsContextValue,
    visibleAttachmentOptions,
    voice,
    voiceThread,
  };
}

export type CopilotKitV2PanelViewProps = ReturnType<typeof useCopilotKitV2PanelController>;
export function CopilotKitV2PanelBody(props: Parameters<typeof useCopilotKitV2PanelController>[0]): JSX.Element {
  return <CopilotKitV2PanelView {...useCopilotKitV2PanelController(props)} />;
}
