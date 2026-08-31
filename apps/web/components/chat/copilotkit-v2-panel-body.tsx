"use client";

import * as React from "react";
import { isScrolledNearBottom } from "@/lib/copilotkit-v2-scroll";
import { applyTaskModePrefix } from "@/lib/copilotkit-v2-task-mode";
import {
  useAgent,
  useCopilotKit,
  useHumanInTheLoop,
  UseAgentUpdate,
  CopilotChatMessageView,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { Loader2, AlertTriangle, ArrowDown, ArrowUp, ListChecks, Sparkles } from "lucide-react";
// issue #2052（CK-P7）—— 「落地为产物」状态机，与旧轨道共用同一份（展示件在
// `copilotkit-v2-message-actions.tsx`，与 CK-P3 的复制/评分/反馈同一条操作条）。
import { useMessageLanding } from "@/components/chat/message-landing";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";
import { useChatMessageIdentity } from "@/lib/copilotkit-v2-message-identity";
import { useCopilotKitV2RunProgress, LONG_RUN_HINT } from "@/lib/copilotkit-v2-run-progress";
import { useCopilotKitV2RunRestore, RUN_RESTORE_PHASE_LABEL, type RunRestoreOutcome } from "@/lib/copilotkit-v2-run-restore";
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
import {
  ArtifactLandingCtx,
  V2AssistantMessage,
  FollowUpSuggestions,
  type LocalSuggestionChip,
} from "@/components/chat/copilotkit-v2-assistant-message";
import {
  CopilotKitV2MessageActionsProvider,
  type AssistantMessageLandingValue,
} from "@/components/chat/copilotkit-v2-message-actions";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { CopilotKitV2AgentInterrupts } from "@/components/chat/copilotkit-v2-agent-interrupts";
import { CopilotKitV2PlanControl } from "@/components/chat/copilotkit-v2-plan-control";
import { ChatLiveAnnouncer, announceToChat } from "@/components/chat/chat-live-announcer";
import { ActiveFilePanel } from "@/components/chat/active-file-panel";
import { useAguiFileEvents } from "@/lib/agui-file-events";
import { ProducedFilesCtx } from "@/components/chat/copilotkit-v2-assistant-message";
import { useAguiPlanTodos, currentPlanStep } from "@/lib/agui-plan-todos";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import { ComposerMicControl, ComposerMicRecordingBar } from "@/components/chat/chat-composer-mic-control";
import { CapabilityPicker } from "@/components/chat/chat-task-workbench-capability-picker";
import { TaskWorkbenchEmptyState } from "@/components/chat/chat-task-workbench-empty-state";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import {
  createPersonalThread, listThreadAttachments, summarizePersonaFromThread,
  type ListThreadAttachmentsOut,
} from "@/lib/live-chat";
import { useCopilotKitV2AgentOptions, type CopilotKitV2AgentOptionsState } from "@/lib/copilotkit-v2-agent-options";
import { detectComposerMention, type ComposerMention } from "@/lib/composer-mention-detection";
import { useCopilotKitV2AgentSelection } from "@/lib/copilotkit-v2-agent-selection";
import {
  useChatAttachments, ChatAttachmentButton, ChatAttachmentList, ChatAttachmentBanner,
  ChatFullSurfaceDropOverlay,
} from "@/components/chat/chat-composer-attachments";
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
import { listThreadMounts } from "@/lib/live-skill-mount";
import { Button } from "@/components/ui/button";
import {
  SendEmailApprovalDialog,
  APPROVAL_TOOL_NAME,
  approvalToolParameters,
} from "@/components/chat/copilotkit-v2-approval-dialog";
export function CopilotKitV2PanelBody({
  chatThreadId: initialChatThreadId = null,
  onThreadResolved,
  onMessageSent,
  onArtifactLanded,
  onPlanTodosChange,
  onRunStateChange,
  onPendingMaterialsChange,
  threadAttachments = null,
  archived = false,
  canGeneratePersona = false,
  orgId = null,
  actingAgentId = null,
  actingAgentLabel = null,
  agentOptions,
  selectedAgentId = null,
  onSelectAgent,
}: {
  chatThreadId?: string | null;
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
  onSelectAgent: (agentId: string) => void;
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
    /** `RUN_STARTED` 到达的时刻（epoch ms）；**每轮只变一次**。
     *  ⚠ 刻意不上报 `elapsedSeconds`：那个每秒变一次，上抛给外壳等于每秒
     *  `setState` 一次外壳 → 外壳重渲染 → 整棵消息树（含画布）跟着重渲染一次。
     *  issue #2096 刚为同一类重渲染风暴做过一轮修复，不能在这里重新引入。
     *  秒数由右栏 Inspector 自己从这个时间戳派生，重渲染只落在它那一小棵子树上。 */
    readonly startedAt: number | null;
  }) => void;
  onPendingMaterialsChange?: (count: number) => void;
  /** issue #2046（CK-P2）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  threadAttachments?: ListThreadAttachmentsOut["items"] | null;
  /** issue #2053（CK-P8）—— 见外层 `CopilotKitV2Panel` 同名 prop。 */
  archived?: boolean;
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
}): JSX.Element {
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
   * issue #2130（TW-P0-5①），回指 #2068 —— composer 的 `<textarea>` ref，
   * `/技能`/`@Agent` 两个快捷入口用它读光标位置 + 插入后把焦点还给输入框。
   */
  const composerInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  /**
   * issue #2130（TW-P0-5②）—— 「任务模式」开关，真实影响发出的正文（见下方
   * `send()` 的 `taskMode` 分支），不是一个点了没有观察差异的假开关。
   * ⚠ 默认**关闭**——不是判据要求默认关，是工程纪律：本仓一大批既有 e2e
   * （`chat-read.spec.ts` 等，走同一个 loopback 回显上游）断言的是"发出的正文
   * 逐字等于用户输入"，默认打开会让**所有**这些既有用例静默改变行为。新增的
   * 是一个用户需要主动选择的能力，不是悄悄改变已验证过的默认路径。
   */
  const [taskMode, setTaskMode] = React.useState(false);
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
   * issue #2130（TW-4，Skills 交互重设计）—— `ChatSkillMountPanel`（`variant="pill"`）
   * 现在直接渲染在本组件里（见下方 composer 图标行），`mentionQuery` 不再需要
   * 经外层 Panel 转发一圈——本地就检测得到 `skillMention`，直接当 prop 传下去。
   * 挂载成功后要做的唯一一件事（把 `/query` 从正文删掉）也改成一个本地回调，
   * 不再靠"外层 nonce +1 → 本组件 useEffect 侦测变化"这一整套跨组件间接机制。
   */
  const onSkillMentionMounted = React.useCallback(() => {
    if (skillMention === null) return;
    setInputDraft((current) => current.slice(0, skillMention.start) + current.slice(skillMention.start + 1 + skillMention.query.length));
    setMention(null);
  }, [skillMention]);

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
      initialChatThreadId === null || !isReady || hydratedRef.current
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
          if (assistantMessageIds.size > 0) {
            const attachments = await listThreadAttachments(initialChatThreadId, null, bearer);
            if (!cancelled) {
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
        setHistoryError(e instanceof Error ? e.message : "历史消息读取失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, isReady, initialChatThreadId, registerHydrated, hydrateActiveFiles]);

  /**
   * session-switch task-state-loss fix —— 上面 hydration 找到的 `pendingRunId`
   * 在这里核实真实服务端状态（轮询 `GET /agent-runs/:runId`，与旧轨道同一个端点/
   * 同一条只读纪律，见 `useCopilotKitV2RunRestore` 文件头）。核实到终态后重读一遍
   * 持久化消息，把服务端已经写回的助手回复（用户切走期间真实生成完的那条）合并进
   * `agent.messages`——合并按 id 去重、只追加，不整体覆盖，与上面 hydration 效果
   * 同一条纪律（覆盖会杀掉这期间用户可能发出的新消息）。
   *
   * 2026-08-30（devapp 真实用户复现：切回会话后"正在恢复上次未完成的任务…"卡住不动，
   * 看不出任何结果——见 `useCopilotKitV2RunRestore` 文件头对 `RunRestoreOutcome`
   * 的完整取证）—— 第一版这里不管 `onSettled` 是因为什么结束，一律安静清空
   * `pendingRunId`：run 真的以 `failed` 收场、或轮询自己撑不住放弃（20 分钟预算耗尽/
   * bearer 过期）时，用户看到的是"生成中"指示消失、自己发的消息没有任何回应、
   * 也没有任何错误提示——比根本不做恢复还让人困惑。现在按 `outcome.kind` 分流：
   * `settled` 且 `view.status === "failed"` 时把服务端错误码经既有
   * `describeCopilotkitV2RunError` 译成人话显示（与 `send()` 失败路径同一条错误展示
   * 通道，不新开一条）；`gave-up` 时如实说"没能确认"，不冒充成功也不冒充失败——
   * budget 耗尽时 run 在服务端可能还在跑，冒充失败是撒谎。
   */
  const handleRunRestored = React.useCallback((outcome: RunRestoreOutcome) => {
    if (outcome.kind === "gave-up") {
      setError(
        outcome.reason === "auth-expired"
          ? "登录状态可能已过期，无法核实上一条任务的执行状态，请重新登录后刷新页面。"
          : "长时间未能确认上一条任务是否已经完成，它可能仍在后台运行，请稍后刷新页面查看。",
      );
      setPendingRunId(null);
      return;
    }
    if (outcome.view.status === "failed") {
      setError(describeCopilotkitV2RunError(outcome.view.error));
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
        const framed = after
          .filter((m) => !liveIds.has(m.id))
          .map((m) => ({ id: m.id, role: m.role, content: m.content }));
        if (framed.length > 0) agent.setMessages([...agent.messages, ...framed]);
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
  }, [agent, onMessageSent]);
  const runRestore = useCopilotKitV2RunRestore(
    pendingRunId,
    getStoredSessionToken() ?? undefined,
    handleRunRestored,
  );

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
  const runIsRunning = agent.isRunning || runRestore.isRestoring;
  const runPhaseLabel = runProgress.phaseLabel ?? (runRestore.isRestoring ? RUN_RESTORE_PHASE_LABEL : null);
  const runStartedAt = runProgress.startedAt;
  React.useEffect(() => {
    onRunStateChange?.({
      isRunning: runIsRunning,
      phaseLabel: runPhaseLabel,
      startedAt: runStartedAt,
    });
  }, [runIsRunning, runPhaseLabel, runStartedAt, onRunStateChange]);
  const planStep = React.useMemo(() => currentPlanStep(planTodos), [planTodos]);
  const pendingMaterialsCount = attach.uploadedIds.length;
  React.useEffect(() => {
    onPendingMaterialsChange?.(pendingMaterialsCount);
  }, [pendingMaterialsCount, onPendingMaterialsChange]);

  /**
   * issue #2130（TW-P0-1③，回指 #2068）—— 空状态「技能 N」上下文标签的真实计数。
   * `initialChatThreadId === null`（还没有任何线程）时如实为 0——这不是占位，是
   * 事实：没有线程就没有真实的挂载对象可数。有线程时读一次真实的 `listThreadMounts`
   * （与 `ChatSkillMountPanel` 同一条端点，`out.temporary` 是该线程当前临时挂载的
   * skill 列表——`listThreadDeviations` 契约本体的字段名，不是 `mounts`），不写死数字。
   */
  const [mountedSkillsCount, setMountedSkillsCount] = React.useState(0);
  React.useEffect(() => {
    if (initialChatThreadId === null || sessionToken === null) {
      setMountedSkillsCount(0);
      return;
    }
    let cancelled = false;
    void listThreadMounts(initialChatThreadId, undefined, sessionToken)
      .then((out) => { if (!cancelled) setMountedSkillsCount(out.temporary.length); })
      .catch(() => { if (!cancelled) setMountedSkillsCount(0); });
    return () => { cancelled = true; };
  }, [initialChatThreadId, sessionToken]);

  /**
   * issue #2068（第二件，人类 2026-08-26 实测原话）—— 「正在思考…」与「正在生成
   * 回复……」两处 loading 同屏，两处都不要，换成**在 AI 回复应该出现的位置**的一个。
   *
   * ## 这个 loading 主要覆盖的不是「正文在生成」，是**工具阶段**
   *
   * 另一条线用真引擎原始 SSE 逐帧回放，拿到 14.44s 一轮的分项时间线：
   * `+0.00~5.84s` 模型第 1 轮 53 个空 content chunk（在流工具调用参数，无正文）→
   * `+5.86s` / `+9.97s` 两批工具落地 → `+12.30s` **第一个正文 token** →
   * `+14.41s` 最后一个正文 token。**工具阶段占前 85%，正文只占最后 2.1 秒。**
   *
   * 所以这里显示的不是一个转圈：那 12.3 秒里 agent 在做具体的事（写计划、列技能），
   * 是**有内容可展示**的。合并后的这一条同时承载：
   *   ① 阶段文案（`onToolCallStartEvent` 翻译出的"正在…"，真实工具事件驱动）；
   *   ② 已用秒数（`RUN_STARTED` 起算——"会动"本身就是"没卡死"的证据，
   *      #2064 那条裁决**没有被取消**，只是搬了位置、并进了这一条）；
   *   ③ 45s longrun 提示；
   *   ④ **当前在计划的第几步**（`STATE_SNAPSHOT{todos}`）——这是工具阶段真正
   *      回答"它在干嘛"的那一维，右栏「进度」页签是它的完整版。
   *
   * ## 与右栏计划面板的关系（不是两个各转各的）
   *
   * 同一份 `planTodos`，两处**不同粒度**：气泡里是**一行**「第 2/4 步 · 对比竞品」，
   * 眼睛不用离开正在读的位置；右栏是**全量**步骤清单，要看全貌时才看。不是复制——
   * 复制的话两处会在同一帧显示不同的步数（本仓"同一事实两处"翻过五次车）。
   * 数据只有一份、派生规则只有 `currentPlanStep` 这一个纯函数。
   */

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

  /** CK-P4 —— 最近一次真的发出去的用户消息，供错误横幅上的「重试」重发。
   *
   * issue #2321 round 2 -- 现在还存那一轮的 `clientMessageId`，不只是文本/附件：
   * 「重试」要复用同一个 id（见下面 `send` 的 `opts.clientMessageId`），不是重新
   * 生成一个。真实证据见 `copilotkit-agui.controller.ts` 的
   * `parseForwardedClientMessageId` 头注——不复用会让后端把重试当成一次全新的
   * 人类消息 + 全新的 agent run，而原来那个 run（真实 skill 调用，例如 PDF 生成）
   * 可能仍在服务端跑，两边互不知情，各自写回一条回复、各自真的生成一次文件。 */
  const lastSentRef = React.useRef<
    { text: string; attachmentIds: readonly string[]; clientMessageId: string } | null
  >(null);

  const send = React.useCallback(
    async (override?: string, opts?: { readonly clientMessageId?: string }) => {
      const rawText = (override ?? inputDraft).trim();
      if (rawText === "" || agent.isRunning) return;
      // issue #2130（TW-P0-5②）—— 任务模式开启时真的改变发出的正文（见 `taskMode`
      // state 声明处的头注：默认关闭，不影响任何既有 e2e）。issue #2417——拼接必须
      // 幂等，`rawText` 已经以这句前缀开头时不能再拼一遍（`applyTaskModePrefix`
      // 头注有真实复现场景）。
      const text = applyTaskModePrefix(rawText, taskMode);
      // chat-parity-attachments (issue #2022) -- 上传未完成时不发送，与 composer 里
      // 附件行的 spinner/进度条同一份诚实约束（旧轨道 `ChatAttachMaterialModal`
      // 「加入这一轮」按钮同一条禁用逻辑）。
      if (attach.hasUploading) return;
      setError(null);
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
      lastSentRef.current = { text, attachmentIds: attach.uploadedIds, clientMessageId };
      agent.addMessage({ id: clientMessageId, role: "user", content: text });
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
        // issue #2321 round 2 -- `clientMessageId` always forwarded now (see this
        // callback's own `opts` doc + `lastSentRef`'s head comment for why).
        const forwardedProps: {
          chatThreadId?: string; attachmentIds?: readonly string[]; clientMessageId: string;
        } = { clientMessageId };
        if (chatThreadId !== null) forwardedProps.chatThreadId = chatThreadId;
        if (attachmentIds.length > 0) forwardedProps.attachmentIds = attachmentIds;
        await copilotkit.runAgent({ agent, forwardedProps });
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
    [agent, copilotkit, inputDraft, attach, attachmentThreadId, onMessageSent, taskMode],
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
  /**
   * 2026-08-30 重设计：「生成用户画像」从恒定不变的独立按钮，改成建议行里按上下文
   * 出现/消失的一条（人类原话「他应该是动态的建议的行为，不能是固定的」）。
   * `personaGeneratedOnce` 是「本次会话是否已经成功生成过一次」的本地信号——
   * 见下方 `showPersonaSuggestion` 的完整判据与已知局限说明。
   */
  const [personaGeneratedOnce, setPersonaGeneratedOnce] = React.useState(false);
  const runPersonaSummary = React.useCallback(async () => {
    if (initialChatThreadId === null || personaRunning) return;
    setPersonaRunning(true);
    setPersonaFailure(null);
    try {
      const bearer = getStoredSessionToken() ?? undefined;
      const { messages: persisted } = await readAllPersistedMessages(initialChatThreadId, bearer);
      const anchor = persisted[persisted.length - 1];
      if (anchor === undefined) {
        setPersonaFailure("这条对话还没有已落库的消息，无法生成画像。");
        return;
      }
      const out = await summarizePersonaFromThread(initialChatThreadId, anchor.id, bearer);
      const { messages: after } = await readAllPersistedMessages(initialChatThreadId, bearer);
      const result = after.find((m) => m.id === out.resultMessageId);
      if (result === undefined) {
        // 服务端说写了、读回却没有——不假装成功，也不假装失败：如实说清楚现状与出路。
        setPersonaFailure("画像已生成，但没能立刻读回那条消息。刷新页面即可看到。");
        return;
      }
      if (!agent.messages.some((m) => m.id === result.id)) {
        agent.setMessages([...agent.messages, result]);
      }
      // 成功之后这条建议就该从建议行里消失——不然用户会看到同一条"生成用户画像"
      // 一直挂在已经生成过的对话下面，重新点一次除了多花一次模型调用什么也不会
      // 变（`buildPersonaLanding` 是幂等的全量重扫，不是增量）。
      setPersonaGeneratedOnce(true);
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
    () => ({ threadId: chatThreadIdRef.current ?? undefined, bearer: sessionToken ?? undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatThreadIdRef.current, sessionToken],
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
  const sendDisabledReason: string | null = archived
    ? "该对话已归档，不能再发送消息"
    : agent.isRunning
      ? "Agent 正在处理上一条消息，请稍候…"
      : attach.hasUploading
        ? "附件正在上传，请等待上传完成后再发送"
        : inputDraft.trim() === ""
          ? "请先输入任务目标"
          : null;
  const sendDisabled = sendDisabledReason !== null;

  /**
   * issue #2053（CK-P6，重设计 2026-08-30）—— 「生成用户画像」建议 chip 的出现
   * 条件。全部读已经存在的真实状态，不新开一条判定：
   *   · `canGeneratePersona`——服务端 `artifact.land` 能力位，硬门槛：没有它
   *     点了必 403，属于本仓明令禁止的"假按钮"，任何时候都不能省。
   *   · `!archived`——归档线程只读，建议行本身在归档时整体不渲染
   *     （见下方 `{archived ? null : &lt;FollowUpSuggestions .../&gt;}`），这里
   *     单独列出只是让判据读起来完整，不是重复的第二道门。
   *   · `initialChatThreadId !== null`——线程已经真实建立（至少发过一条消息），
   *     与旧版按钮的禁用判据完全同一条，只是现在不满足就不渲染，不是渲染成灰色。
   *   · `!personaGeneratedOnce`——本次会话还没成功生成过一次；生成中时仍然渲染
   *     （`disabled: personaRunning`），只是文案换成"生成画像中…"，与旧版按钮的
   *     loading 态视觉一致，不会让用户觉得点击后什么都没发生。
   *
   * ⚠ 已知局限（前端规则判断的选定范围内，如实记录）：`personaGeneratedOnce` 只是
   *   会话内的本地状态，不查后台这条线程是否已经落过 persona 产物——重新打开一条
   *   早就生成过画像的线程，这条建议还会再出现一次。要精确识别需要额外查一次
   *   `listThreadArtifacts` 并识别哪条是 persona 产物（目前产物没有专门的 kind
   *   标记可用），超出本次改动范围，留给下一轮迭代。
   */
  const showPersonaSuggestion =
    canGeneratePersona && !archived && initialChatThreadId !== null && !personaGeneratedOnce;
  const personaSuggestions: readonly LocalSuggestionChip[] = showPersonaSuggestion
    ? [{
        // `id` 逐字就是渲染出来的 `data-testid`——沿用「生成用户画像」作为独立按钮
        // 时代就有的既有锚点，见 `LocalSuggestionChip.id` 的文件头注。
        id: "chat-persona-summary-trigger",
        label: personaRunning ? "生成画像中…" : "生成用户画像",
        disabled: personaRunning,
        onSelect: () => void runPersonaSummary(),
      }]
    : [];

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
        {/* issue #2179 —— F212/F213 三张 HITL 中断卡接入真实聊天渲染树。挂载位置/
            理由见该文件头注：与 `CopilotKitV2ToolRenderers` 同一条"渲染 null、
            仅用于登记 hook"纪律，不需要跟下面的 `useHumanInTheLoop`（send_email）
            挤进同一个组件。 */}
        <CopilotKitV2AgentInterrupts />
        {/* 2026-08-25 人类 devapp 实测指令：不给用户看调试字样——原来这里有一行
            「CopilotKit v2（DA-19 —— CopilotRuntime 适配器，…）」开发者标题，
            与 #1830「用户可见文案去掉开发者词汇」同一条裁决，整行移除。 */}
        {/* issue #2132（2026-08-27 续，人类反馈 bug #6 “对话框有 border 看起来奇怪”）——
            此前这层套了一圈 `rounded-lg border border-border-subtle bg-card`，把整条
            消息流框成一张独立卡片，对照 Claude Design 原型：消息区是直接铺在页面底色
            上的纯滚动区，不该有第二层"卡片边框"把它和composer/工具栏再框一次
            （气泡本身已经是各自的卡片/气泡，这一层外框纯属多余的视觉噪音）。去掉
            border/圆角/卡片底色，改用页面本底色，只留 `p-3` 内边距不动。 */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="relative flex-1 overflow-y-auto bg-background p-3"
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
            /* issue #2130（TW-P0-1，回指 #2068）—— 任务型空状态取代此前的会话隐喻
               两行静态文字，见 `chat-task-workbench-empty-state.tsx` 文件头注。 */
            <TaskWorkbenchEmptyState
              onUseTemplate={(goal) => setInputDraft(goal)}
              materialsCount={pendingMaterialsCount}
              skillsCount={mountedSkillsCount}
            />
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
                      <CopilotChatMessageView
                        messages={agent.messages}
                        isRunning={agent.isRunning}
                        assistantMessage={V2AssistantMessage}
                      />
                    </ProducedFilesCtx.Provider>
                  </ArtifactLandingCtx.Provider>
                </CopilotKitV2MessageActionsProvider>
              </CopilotChatConfigurationProvider>
            </div>
          )}
          {/* issue #2068（第二件）—— 合并后的**唯一** loading，落在「AI 回复应该出现的
              位置」：消息列表末尾、用户那句话下面，不是 composer 上方两条各说各的。
              设计推理（含真引擎 14.44s 一轮的分项时间线、以及它与右栏计划面板的分工）
              见上面 `runProgress` 那一段长注释，这里不复述。

              ⚠ testid 沿用 `copilotkit-v2-running-indicator`（容器）与
                `copilotkit-v2-thinking*`（内部各段）：这两组锚点被
                `chat-task-workbench-fixture.ts` 的 `sendAndSettle`、
                `chat-task-workbench-inspector.spec.ts`、
                `copilotkit-v2-message-actions.spec.ts` 当成"这一轮跑完了没有"的信号
                在用。语义一个字没变（在跑=在，跑完=不在），变的只有位置与形态；
                改名会把三处既有断言变成"元素不存在 ⇒ 立即通过"的静默假绿。 */}
          {/* session-switch task-state-loss fix —— `runRestore.isRestoring` 补的是
              `agent.isRunning` 覆盖不到的那段窗口：挂载 hydration 发现上一轮 run
              可能还没写回，正在核实真实状态。两者 or 起来才是"这条线程现在该不该显示
              生成中"的完整判据，见 `runIsRunning` 声明处头注（`runProgress.phaseLabel`
              取不到时已经回落到 `RUN_RESTORE_PHASE_LABEL`，这里不用再判断一次）。 */}
          {!historyLoading && (agent.isRunning || runRestore.isRestoring) ? (
            <div
              data-testid="copilotkit-v2-running-indicator"
              role="status"
              aria-live="polite"
              className="mt-3 flex w-fit max-w-full flex-col gap-1 rounded-lg border border-border-subtle bg-muted/60 px-3 py-2"
            >
              <span
                className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground"
                data-testid="copilotkit-v2-thinking"
              >
                <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin" />
                <span data-testid="copilotkit-v2-thinking-phase">
                  {runProgress.phaseLabel ?? (runRestore.isRestoring ? RUN_RESTORE_PHASE_LABEL : "正在思考…")}
                </span>
                {runProgress.elapsedSeconds !== null ? (
                  <span data-testid="copilotkit-v2-thinking-elapsed">
                    · 已用 {runProgress.elapsedSeconds} 秒
                  </span>
                ) : null}
                {runProgress.isLongRun ? (
                  <span data-testid="copilotkit-v2-thinking-longrun-hint">· {LONG_RUN_HINT}</span>
                ) : null}
              </span>
              {/* 工具阶段（真引擎实测占一轮的前 85%）里真正回答"它在干嘛"的那一行。
                  没有计划时不渲染——编一句"正在处理第 1 步"就是假进度。 */}
              {planStep !== null ? (
                <span
                  className="flex min-w-0 items-center gap-1.5 text-11 text-card-foreground"
                  data-testid="copilotkit-v2-thinking-plan-step"
                >
                  <ListChecks aria-hidden className="h-3 w-3 shrink-0 text-primary" />
                  <span className="min-w-0 truncate">
                    第 {planStep.index}/{planStep.total} 步 · {planStep.content}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}
          {/* issue #2096（真实 devapp 实测：悬浮按钮与右侧发送区重叠）—— 此前挂在
              最外层 `relative` 包装 div 里（那个 div 从消息区一路延伸到 composer/
              发送按钮），`absolute bottom-3 right-3` 因此贴着整个左栏的右下角，与
              发送区的图标重叠，不是贴着消息可视区的右下角。现在这个消息容器 div
              自己是 `relative`，按钮是它的子节点：`bottom-3` 相对消息可视区自身，
              不再随 composer 高度漂移；水平方向按人类实测反馈从贴右改成贴底居中
              （`left-1/2 -translate-x-1/2`，Slack/ChatGPT 同款"回到最新"位置），
              不会被右侧材料/产物栏或任何一侧内容遮挡。只在离开底部且确实有消息可看
              时出现，不在历史回读骨架屏/空态上叠加一个没有意义的按钮。 */}
          {!isAtBottom && !historyLoading && agent.messages.length > 0 ? (
            <button
              type="button"
              data-testid="copilotkit-v2-scroll-to-bottom"
              title="回到最新消息（Ctrl/Cmd+End）"
              aria-label="回到最新消息"
              onClick={() => scrollMessagesToBottom(prefersReducedMotion() ? "auto" : "smooth")}
              className="absolute bottom-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border-subtle bg-card text-foreground shadow-md transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            不占位——与 `resolvedChatThreadId` state 的既有语义一致（issue #2052）。 */}
        <CopilotKitV2PlanControl threadId={resolvedChatThreadId} />
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
                  本身，会发起一次新的 `runAgent` 调用（新 client-side run id）——但
                  issue #2321 round 2 起，复用同一个 `clientMessageId`：一次真正
                  「失败」的 run（`RUN_ERROR`）在后端 `acceptHumanMessage` 里本来就
                  会走到"同一 key、直接返回已存在的那条"分支且行为等价于新建，
                  而一次「超时」（中继放弃轮询，run 其实还活着，见 `poll-budget.ts`）
                  会命中同一条幂等分支返回同一个 run，重试因此只是对它重新开一轮
                  轮询，不会在后端并行再跑一次同样的 skill 调用（例如再生成一次
                  PDF）。样式跟随 issue #2039 这张 alert 卡（本轮只加入口，不动展示层）。 */}
            {lastSentRef.current !== null && !agent.isRunning ? (
              <button
                type="button"
                data-testid="copilotkit-v2-retry"
                onClick={() => {
                  const last = lastSentRef.current;
                  if (last === null) return;
                  void send(last.text, { clientMessageId: last.clientMessageId });
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
            发送（或本地建议里的 persona 生成动作），摆在只读线程上就是一排假按钮。
            这条门也覆盖下面 `personaSuggestions`——`showPersonaSuggestion` 已经
            单独判过 `!archived`，这里不是重复的第二道门，只是两处共用同一次
            渲染判断。 */}
        {archived ? null : (
          <FollowUpSuggestions
            agentId={threadId}
            disabled={agent.isRunning}
            onSelect={(text) => void send(text)}
            localSuggestions={personaSuggestions}
          />
        )}
        {personaFailure !== null ? (
          <span className="text-11 text-destructive" data-testid="chat-persona-summary-error">
            {personaFailure}
          </span>
        ) : null}
        {/* chat-parity-attachments (issue #2022) -- composer 附件区：就地报错横幅 + 预览条，
            复用旧轨道 `chat-composer-attachments.tsx` 展示件，不重写一份视觉。 */}
        {archived ? null : <ChatAttachmentBanner banner={attach.banner} />}
        {archived ? null : <ChatAttachmentList ctl={attach} disabled={agent.isRunning} />}
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
          2026-08-29 Claude Design 重设计稿——composer 在设计稿里是一整张有边框、
          有投影的悬浮卡片（输入区与操作行视觉上属于同一个容器），不是"一个裸
          textarea + 下面松散一行按钮"。这里只加壳（边框/圆角/投影/焦点态），
          内部结构、每个控件的 testid 与行为一个字不动——`focus-within` 而不是
          设计稿里那种恒定黑边：与本文件其余控件的 `focus-visible:ring-ring`
          语言保持同一套"默认低调、聚焦才强调"的规则，不是抄错了颜色。
        */}
        <div
          className={[
            "flex min-w-0 flex-col gap-2 rounded-lg border p-2.5 shadow-sm transition-colors duration-fast",
            archived ? "border-border-subtle bg-disabled" : "border-border-subtle bg-panel focus-within:border-primary/60",
          ].join(" ")}
          data-testid="chat-task-workbench-composer"
        >
          {/* issue #2132（2026-08-27 续，bug #5）—— 顶部 `copilotkit-v2-agent-toolbar`
              的错误/空态提示随 `CapabilityPicker` 一起挪到 composer 第二行左侧（见下面
              「@Agent」按钮旁），这里只是它们紧贴输入框上方的落点，功能一行未删。 */}
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
          <textarea
            ref={composerInputRef}
            data-testid="copilotkit-v2-input"
            rows={2}
            /* 边框/圆角挪到外层卡片壳（见上面那条注释），焦点环仍然留在 textarea
               自己身上（`lint-design.sh` U7b 门控要求原生 outline 必须配一圈
               focus-visible:ring-*，见下面 className）：卡片壳的 focus-within
               边框只是氛围强调，不能替代真正的可见焦点环，两者都要有。 */
            className="min-w-0 flex-1 resize-none rounded-md bg-transparent px-0.5 py-0.5 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground"
            /* issue #2053（CK-P8）—— 归档 ⇒ 输入框本身禁用。`archived` 首帧在服务端与
               客户端都是 `false`（外壳的 `getThread` 是客户端 effect），不存在麦克风按钮
               那条 `sessionToken` 式的 SSR/CSR 首帧分叉，可以直接接到 `disabled`。 */
            disabled={archived}
            placeholder={archived ? "该对话已归档，不能再发送消息" : "输入任务目标，Shift+Enter 换行，Enter 发送"}
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
              // issue #2130（TW-P0-5①）—— 换成 textarea 后 Enter 语义必须分岔：
              // 纯 Enter 发送（沿用旧行为），Shift+Enter 换行（textarea 原生行为，
              // 这里只需要在纯 Enter 时拦截默认换行并改发送）。
              // bug：中文/日文等输入法拼字过程中按 Enter 是在确认候选词，
              // 不是要发送消息——用 `e.nativeEvent.isComposing` 拦掉这一下。
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex min-w-0 items-center justify-between gap-2">
            {/* 第二行左：附件/材料、@Agent、/技能、任务模式。 */}
            <div className="flex min-w-0 items-center gap-1.5">
              <div data-testid="chat-task-workbench-composer-attach">
                <ChatAttachmentButton ctl={attach} disabled={archived || agent.isRunning || attachmentThreadId === null} showLabel />
              </div>
              {/* issue #2132（2026-08-27 续，bug #5）—— 此前这里只是一个打开
                  `chat-capability-picker` 共享槽的小按钮，真正的 `CapabilityPicker`
                  （六项披露卡片，issue #2130 TW-P0-2）仍然渲染在页面最上面那个
                  `copilotkit-v2-agent-toolbar` 里——点开的卡片自然出现在页面顶部，
                  跟 composer 视觉脱节，这正是 bug #5 截图里"选择卡片飘在页面中间"
                  的根因。现在把 `CapabilityPicker` 本体真正搬到这里（`side="up"`，
                  向上弹向输入框方向），`chat-task-workbench-composer-mention-agent`/
                  `copilotkit-v2-agent-toolbar` 两个 testid 都原样保留在这个容器上——
                  前者是 TW-P0-5②判据锚点，后者是 TW-P0-2③"主界面不泄漏技术信息"
                  判据读取 innerText 的目标，都只断言"可见 + 内容"，不断言页面位置，
                  搬家不影响任何既有 e2e。不再需要单独的快捷按钮：`CapabilityPicker`
                  自己就是"选 agent"的入口，两个按钮做同一件事只会读作重复。 */}
              <div
                className="shrink-0"
                data-testid="copilotkit-v2-agent-toolbar"
              >
                <div data-testid="chat-task-workbench-composer-mention-agent">
                  <CapabilityPicker
                    listings={agentOptions.status === "ready" ? agentOptions.listings : null}
                    status={agentOptions.status === "ready" ? "ready" : agentOptions.status}
                    selectedAgentId={selectedAgentId}
                    disabled={agentOptions.status !== "ready" || archived}
                    onSelect={(agentId) => onSelectAgent(agentId)}
                    side="up"
                  />
                </div>
              </div>
              {/*
                issue #2130（TW-P0-5②「/技能」入口 + TW-4 Skills 交互重设计）——
                这两件是同一个真实控件：`ChatSkillMountPanel`（`variant="pill"`）
                本身就是「/技能」的真正落点，不是先摆一个只插字符的假按钮、再摆
                一个真正管理挂载的面板——那会是同一功能的两份实现。真实
                e2e（`copilotkit-v2-skill-mount.spec.ts`/`chat-agent-skill-context.spec.ts`）
                依赖的 `chat-skill-mount`/`chat-skill-mount-panel`/
                `copilotkit-v2-skill-mount-placeholder` 等锚点原样保留在
                `ChatSkillMountPanel` 内部，这里只加一层 workbench 锚点容器
                （同 `chat-task-workbench-composer-attach` 的包法）。

                `mentionQuery`/`onMentionMounted` 现在是本地状态直接下发
                （见上方 `skillMention`/`onSkillMentionMounted`），不再经外层
                Panel 转发一圈——搬进 Body 之后不再需要那一层间接。
              */}
              <div data-testid="chat-task-workbench-composer-mention-skill">
                {initialChatThreadId !== null && orgId !== null && sessionToken !== null ? (
                  <ChatSkillMountPanel
                    variant="pill"
                    /* issue #2321 追加 —— composer 贴着视口底部，浮层往下开
                       （默认值）会开到视口外/被裁掉，用户看不见。同一行的
                       `CapabilityPicker` 上面就传了 `side="up"` 解决同一个问题，
                       这里补上对称的口子。 */
                    pickerSide="up"
                    threadId={initialChatThreadId}
                    orgId={orgId}
                    bearer={sessionToken}
                    mentionQuery={skillMention?.query ?? null}
                    /* issue #2046（CK-P2）——v2 轨道触发符改 `/`（对齐 Claude Code），
                       旧轨道 `/chat/legacy` 缺省仍是 `#`。 */
                    mentionTriggerChar="/"
                    onMentionMounted={onSkillMentionMounted}
                  />
                ) : (
                  /* 新对话（还没有线程）时如实显示占位，不渲染一个「看起来能挂、
                     提交必然 404」的假入口——逐字同此前外层的既有纪律，只是搬了地方。 */
                  <p className="text-9 text-muted-foreground" data-testid="copilotkit-v2-skill-mount-placeholder">
                    {sessionToken === null
                      ? "登录后才能给对话挂载 skill。"
                      : "发出第一条消息、对话建立后，就可以在这里给本对话挂载 skill（也可以在输入框里敲 / 快速挂载）。"}
                  </p>
                )}
              </div>
              {/* issue #2130（TW-P0-5②）—— 任务模式：真实影响发出的正文（不是纯装饰）。
                  开启时发出的正文前面会加一句面向 Agent 的显式指令，要求先给计划再等
                  确认；关闭（默认，见 `taskMode` state 声明处的既有 e2e 兼容理由）时
                  逐字节按用户原文发送——与本组件此前的既有行为完全相同。 */}
              <button
                type="button"
                data-testid="chat-task-workbench-composer-task-mode"
                aria-pressed={taskMode}
                aria-label={taskMode ? "任务模式（先计划后执行）：已开启" : "任务模式（先计划后执行）：已关闭"}
                title={taskMode ? "任务模式：Agent 会先给出计划，确认后再执行" : "问答模式：直接回答，不先出计划"}
                disabled={archived}
                onClick={() => setTaskMode((v) => !v)}
                className={[
                  "flex items-center gap-1 rounded-pill border px-2 py-1 text-9 transition-colors duration-fast disabled:bg-disabled disabled:text-disabled-foreground",
                  taskMode ? "border-primary/50 bg-primary/10 text-primary" : "border-border-subtle text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                <Sparkles aria-hidden className="h-3 w-3" />
                任务模式
              </button>
            </div>
            {/* 第二行右：麦克风（唯一入口，设备选择降为二级菜单）+ 发送/停止。 */}
            <div className="flex shrink-0 items-center gap-2">
              <ComposerMicControl
                status={speech.status}
                listening={speech.listening}
                connecting={speech.connecting}
                stopping={speech.stopping}
                start={speech.start}
                stop={speech.stop}
                disabled={archived}
                idleLabel="语音"
                devices={micDevices.devices}
                selectedDeviceId={micDevices.selectedDeviceId}
                onSelectDevice={micDevices.select}
                onRequireSession={() => {
                  if (sessionToken === null) {
                    setError("未登录，无法使用语音输入。");
                    return false;
                  }
                  return true;
                }}
              />
              {/* 2026-08-29 Claude Design 重设计稿——发送是一个纯图标的圆角方形按钮
                  （↑），不是文字按钮。testid/disabled/title 逐字不动，只换视觉与
                  可访问性标签（图标按钮必须有 `aria-label`，之前的可见文字"发送"
                  本身兼职当了这个角色，现在要显式补上）。 */}
              <Button
                data-testid="copilotkit-v2-send"
                type="button"
                size="icon"
                variant="primary"
                className="shrink-0 rounded-md"
                disabled={sendDisabled}
                title={sendDisabledReason ?? (agent.isRunning ? "正在运行…" : "发送")}
                aria-label={agent.isRunning ? "正在运行…" : "发送"}
                onClick={() => void send()}
              >
                {agent.isRunning ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUp aria-hidden className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
          {/*
            2026-08-30——录音状态「内嵌」在 composer 卡片里（这一行本身就是卡片内的
            正常一行，随内容自然撑高卡片），不再是盖在输入区上方的浮层
            （旧实现见 `chat-composer-mic-control.tsx` 头注）。转录文字本身已经实时
            写进上面的 textarea，这一行只是"元信息"：在录/多久了/多大声/录给哪支麦克风/
            要不要留下这段。
          */}
          {speech.connecting || speech.listening || speech.stopping ? (
            <ComposerMicRecordingBar
              listening={speech.listening}
              connecting={speech.connecting}
              stopping={speech.stopping}
              elapsedSeconds={speech.elapsedSeconds}
              level={speech.level}
              stop={speech.stop}
              cancel={speech.cancel}
            />
          ) : null}
          {/* issue #2130（TW-P0-5④）—— 发送被禁用时必须**说明原因**，不能只是灰掉。 */}
          {sendDisabledReason !== null ? (
            <p className="text-9 text-muted-foreground" data-testid="chat-task-workbench-composer-send-disabled-reason">
              {sendDisabledReason}
            </p>
          ) : null}
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

/**
 * `PersistedMessage`/`readAllPersistedMessages` 现在都在
 * `lib/copilotkit-v2-persisted-messages.ts`（2026-08-30 文件规模拆分搬出，逐字节
 * 未改行为）——`readAllPersistedMessages` 是一个纯模块函数，不闭包依赖
 * `CopilotKitV2PanelBody` 的任何内部状态，天然可独立成文件。
 */

/**
 * V2MarkdownRenderer / ArtifactLandingCtx / V2AssistantMessageImpl / V2AssistantMessage /
 * FollowUpSuggestions 现在都在 copilotkit-v2-assistant-message.tsx（2026-08-30 文件
 * 规模拆分搬出，逐字节未改行为）——它们只消费 props 与自己的 context，不闭包依赖
 * CopilotKitV2PanelBody 的任何内部状态，天然可独立成文件。ArtifactLandingCtx.Provider
 * 仍在下方 JSX 里（那部分状态在这一层），只是 Context 对象本身与消费它的组件搬走了。
 */
