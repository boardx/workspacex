"use client";

import * as React from "react";
import {
  ArrowDown, Bot, Check, Copy, Loader2, Mic, MoreHorizontal, Paperclip, RefreshCw, Send, UserRound, Wrench,
} from "lucide-react";
import { FeedbackButton } from "@/components/feedback/feedback-button";
// VZ-01 → live panel（coord 裁 ①+续刀）：活体 AI 消息渲染从 CopilotKit 的 Markdown
// 换成本仓 `MarkdownMessage`——同样渲 markdown，且识别 ```mermaid 围栏渲成图（白名单闸门 +
// 诚实错误态）。原型侧（ai-message.tsx）已随 #1020 落档，这里让它在**可达面**对用户生效。
import { MarkdownMessage } from "@/components/chat/markdown-message";
// issue #2050 —— 落地为产物的状态机与展示件，与 CopilotKit v2 轨道共用同一份。
import { MessageLandingControls, useMessageLanding } from "@/components/chat/message-landing";
import { AgentToolChain } from "@/components/chat/agent-tool-chain";
import { MessageThinkingChain } from "@/components/chat/message-thinking-chain";
import { MessageContextSnapshot } from "@/components/chat/message-context-snapshot";
import { MessageRating } from "@/components/chat/message-rating";
import { AgentPicker, MicDevicePicker } from "@/components/chat/chat-composer-pickers";
import {
  createMessage,
  describeMessageFailure,
  generateFollowUpSuggestions as fetchFollowUpSuggestions,
  lastUsedAgentId,
  listMessages,
  pickDefaultAgentId,
  summarizePersonaFromThread,
  type CreateMessageInput,
  type DurableMessage,
  type GetAgentPanelOut,
} from "@/lib/live-chat";
import {
  describeAgentRunError,
  getAgentRun,
  isTerminalRunStatus,
  retryAgentRun,
  type AgentRunStatus,
  type AgentRunView,
} from "@/lib/agent-run";
import { deriveRunPhaseLabel } from "@/lib/agent-run-phase";
import type { ThreadSkillMount } from "@/lib/live-skill-mount";
import { openAgentRunStream } from "@/lib/agent-run-stream";
import { chat as ChatContract } from "@repo/contracts";
import { AgentPlanPanel } from "@/components/chat/agent-plan-panel";
import { AgentApprovalPanel } from "@/components/chat/agent-approval-panel";
import { ApiError } from "@/lib/api-client";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChatAttachmentBanner,
  ChatAttachmentButton,
  ChatFullSurfaceDropOverlay,
  ChatAttachmentList,
  MessageAttachments,
  useChatAttachments,
  type ChatAttachmentsController,
} from "@/components/chat/chat-composer-attachments";

const MESSAGE_PAGE_SIZE = 50;

/**
 * #435 —— AgentRun 轮询的有界退避。
 *
 * 契约把 Wave 2 的 run 传输定为**轮询**并要求「有界退避 + 终态停止」
 * （`packages/contracts/src/wave2-runtime.ts:200-202`）。这三个常数就是那个「有界」：
 * 起步 400ms，每次 ×1.5，封顶 3s。
 *
 * ⚠ 超时**不等于**失败。超时只说明「本页面在这段时间内没等到终态」，
 * run 在服务端可能仍在跑。所以超时走 `timedOut` 分支显示「仍在进行」，
 * **不**伪造一个 `failed` —— 那会让界面对用户说谎。
 *
 * ## ⚠⚠ 预算为什么从 90s 提到 20min（2026-08-22 devapp 实测事故）
 *
 * 90s 这个数字是按「模型直接作答」定的。挂了 skill 之后这条链路完全不是那个量级：
 * 沙箱单次脚本上限 120s × 最多 3 次重试，加上每次重新生成脚本的模型调用，
 * 十几分钟是常态。
 *
 * 实测后果（devapp，pptx skill）：run 在 **14 分 18 秒**后以 MODEL_CALL_FAILED
 * 终态失败，而前端**第 90 秒就停止轮询**了 —— 界面永远停在「正在思考…」，
 * 用户在等一个早就死掉的任务。这不是"没做失败态"（`awaitingReply` 早就排除了终态），
 * 是**根本没等到那个终态**。
 *
 * ⚠ 这四个数字此前各自独立、互不知情：前端 90s / deep-agent 300s /
 *   沙箱单次 120s / 重试 3 次。凑在一起必然产生「界面撒谎」。预算现在必须
 *   **覆盖得住最慢的那条真实链路**，否则超时分支就不是"少数派兜底"而是常态。
 */
const RUN_POLL_FIRST_DELAY_MS = 400;
const RUN_POLL_BACKOFF = 1.5;
const RUN_POLL_MAX_DELAY_MS = 3_000;
const RUN_POLL_BUDGET_MS = 20 * 60_000;

interface SubmissionAttempt extends CreateMessageInput {
  readonly threadId: string;
}

/**
 * 轮询到的 run 观测值。`view` 为 null 表示「还没读到第一份服务端状态」。
 *
 * `authExpired`（issue #1819）—— 读 run 状态时收到 401（`ApiError.status === 401`）。
 * 这不是「这次没读到，下次再试」的可重试失败：bearer 已经过期，接下来每一次轮询
 * 都会撞同一个 401，继续按退避重试没有意义，唯一出路是用户重新登录。单独标出来，
 * 好让轮询 effect 立即停手、`awaitingReply`（「正在思考…」占位）让位给下面
 * `AgentRunStatus` 已经在展示的「登录已失效，请重新登录」文案——而不是让占位动画
 * 与这句文案同屏矛盾地并存到 20 分钟预算耗尽为止。
 */
interface RunObservation {
  readonly runId: string;
  readonly view: AgentRunView | null;
  readonly failure: string | null;
  readonly timedOut: boolean;
  readonly authExpired: boolean;
}

export function ChatLiveMessagePanel({
  threadId,
  bearer,
  knownEmpty = false,
  agents,
  archived,
  projectId,
  canLandArtifacts,
  onArtifactLanded,
  onRunSettled,
  onMessageSent,
  aboveComposer,
  onMentionQueryChange,
  mentionResolvedNonce,
  attach: attachProp,
  hasMountedSkills = false,
  skillMounts = EMPTY_SKILL_MOUNTS,
  skillNames = EMPTY_SKILL_NAMES,
}: {
  threadId: string;
  bearer: string;
  /** 调用方确知这是刚创建的空线程：首载跳过消息骨架（骨架会伪装成有历史，
   * UI 评分 2026-08-23 第 10 项点名的不一致），直接走空态提示。 */
  knownEmpty?: boolean;
  agents: GetAgentPanelOut["agents"] | null;
  archived: boolean;
  /**
   * G1 读回（design-delta chat-persona-roundtrip）：图表 modal 重开时查保存版要按
   * projectId 判权。个人线程恒不传（缺省 undefined，个人线程没有项目上下文这个
   * 概念）——但这**不**代表读回对个人线程关闭：`undefined` 会被
   * `ChatDiagramFabric`/`ChatCanvasFabric` 归一成 `null`，后端按 `null` 分派到
   * 个人线程判权分支（2026-08-21 人类裁决：个人对话也支持真实持久化 + 读回）。
   */
  projectId?: string;
  /**
   * #728 round 16 P10 —— 「落地为产物」按钮的渲染依据：服务端下发的
   * `artifact.land` 能力（`thread-visibility.ts` 的 `CHAT_WRITE_CAPABILITIES`）。
   * 个人线程恒无此能力（后端 `land-as-artifact.ts` 对 `projectRole` 为 null
   * 恒抛 `NoWriteRoleError`），此前无条件渲染 = 个人对话里一枚点了必报错的
   * 假按钮。刻意做成**必填** boolean：让每个调用方都被 typecheck 逼着从
   * 服务端能力集合里取值，而不是漏传时静默回落到某个默认值。
   * 规矩同 `thread.mutate`（#460）：不渲染，而不是渲染后禁用。
   */
  canLandArtifacts: boolean;
  /**
   * 十项 UX 缺口第 5 项（issue #708）—— 某条消息成功落地为产物后的通知。
   * 调用方（`chat-read-screen.tsx`）借此重读右栏「产物」列表——单一事实源仍是
   * `listThreadArtifacts` 的服务端响应，这里不在本组件内维护第二份产物计数。
   */
  onArtifactLanded?: () => void;
  /**
   * #728 第 9 轮 rev-uiux 抓到：agent 回复写回后，左栏会话卡的「N 个 agent」
   * （`ThreadMeta`，单一事实源见 `thread-badges.ts` 的 `threadAgentSummary`）
   * 没有跟着刷新——评分员截到过同一帧里「0 个 agent」和刚说完话的 agent 回复
   * 同屏出现，判定为「同屏自相矛盾」。跟 `onArtifactLanded` 是同一类问题、同一种
   * 解法：本组件不在本地维护第二份 agent 计数，只在 run 到终态时通知调用方
   * 去重读服务端权威列表。
   */
  onRunSettled?: () => void;
  /**
   * issue #728 D9（人类 2026-08-21 裁决）—— 一条消息**成功发出**后触发（无论是否带
   * 附件）。调用方借此重读右栏「材料」列表——附件挂到消息上发生在**发送这一刻**
   * （`createMessage` 的 `attachmentIds`），不是等到 agent run 落定（`onRunSettled`）
   * 才发生，所以材料刷新不能借用 `onRunSettled` 那个时机，需要单独的钩子。
   * 同 `onArtifactLanded`：单一事实源仍是服务端 `listThreadAttachments`，本组件
   * 不在本地维护第二份材料计数。
   */
  onMessageSent?: () => void;
  /**
   * #728 D10 —— 「进行中」状态卡（录音/agent 跑批）的挂载点，紧贴在输入框
   * **正上方**，不是消息面板上方或全局底栏。原型里这类卡片就长在这个位置。
   *
   * ⚠ 这是纯粹的**位置**改动，不是把 `ChatRecordingPanel` 重写成条件渲染：
   *   `core-loop.spec.ts:533`（发布门）直接点 `chat-live-recording-start`，
   *   说明录音面板必须**始终挂载、始终可点**——把它做成「只在录音中才出现」
   *   会让这个发布门的用例在页面刚加载时就点不到那个按钮。组件本身、
   *   它的全部 testid、它的可见性规则一个都没有变，只是换了个挂载位置。
   */
  aboveComposer?: React.ReactNode;
  /**
   * 在输入框里敲 `#` 用 skill——不在本组件里重新实现挂载（`ChatSkillMountPanel`
   * 已经有真实、经过测试的那一套 `version`/`mount()`），本组件只做**检测**：
   * 光标前最近一个 `#`（且之间没有空白）就是一次活跃的 mention，把它之后的文字
   * 当 query 报给上层（`ChatReadScreen`），由上层转给 `ChatSkillMountPanel`
   * 去开面板、按 query 过滤、真正调 `mountSkills`。`null` = 当前没有活跃 mention。
   */
  onMentionQueryChange?: (query: string | null) => void;
  /**
   * 上层告诉本组件「刚才那次 mention 已经挂载成功了」——每次成功都是一个新的
   * 递增值（nonce），本组件据此把 `#query` 那一段从输入框正文里删掉。
   * 用递增数字而不是布尔值：布尔值连续两次挂载可能"没变化"因而不触发 effect。
   */
  mentionResolvedNonce?: number;
  /**
   * issue #1758 —— composer 的附件控制器可以由调用方（`chat-read-screen.tsx`）传入，
   * 与右栏「材料」面板头部的上传入口共享**同一份** pending 队列（同一个 `ChatAttachmentsController`
   * 实例，不是两份分别维护的上传态）。省略时（如 `chat-composer-attachments.test.tsx`
   * 直接单独渲染本组件的既有单测）本组件退化回自己创建一份——行为与 #1758 之前完全一致，
   * 不是两条分叉的实现，只是「谁创建」这一件事可以被外部接管。
   */
  attach?: ChatAttachmentsController;
  /**
   * issue #1803 gap #4（devapp 实测）——「正在思考…」卡片下的 longrun hint
   * 此前固定文案「执行 skill 脚本时可能需要数分钟」，只看耗时不看这条线程
   * 是否真的挂了 skill（`ChatSkillMountPanel` 那侧「本对话的 skill」）。
   * 没挂 skill 的线程（纯问答/Deep Research 等）跑够 45 秒也会显示这句话，
   * 误导用户以为在等 skill 脚本。调用方（`chat-read-screen.tsx` /
   * `personal-chat-screen.tsx`）把 `ChatSkillMountPanel` 读到的挂载数
   * 转发进来，本组件只据此选文案，不在本地重读一份挂载列表
   * （单一事实源仍是 `listThreadMounts`）。省略时按「没挂 skill」处理，
   * 与此前只用一句通用文案相比更保守，不会新增误导。
   */
  hasMountedSkills?: boolean;
  /**
   * D5（chat-main-fidelity-rubric.md）—— 完整挂载时间窗（`mountedAt`/`removedAt`），
   * 供 `agentSkillLabel` 按消息 `createdAt` 回查「那一刻」处于挂载状态的 skill。
   * 单一事实源仍是 `ChatSkillMountPanel` 的 `listThreadMounts`，本组件不重读。
   */
  skillMounts?: readonly ThreadSkillMount[];
  /** skillId → 展示名，同样转发自 `ChatSkillMountPanel`（`listSkills` 已读到的池子）。 */
  skillNames?: ReadonlyMap<string, string>;
}) {
  const sourceKey = `${threadId}\u0000${bearer}`;
  const [messages, setMessages] = React.useState<DurableMessage[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  /**
   * `nextCursor`（state）驱动的是且**只是**「加载更早之后的消息」按钮的显隐——
   * `page.hasMore` 为假时服务端把它置空（`message-roundtrip.ts`），这里就该消失。
   * 下面「软重读」（发送后 / run 终态 / persona 摘要后）**不**用它作追新起点——
   * 见 `catchUpCursorRef` 的注释：那是 issue #728 round 2 独评发现的 H3 阻塞回归，
   * 用 `nextCursor` 当追新起点会在翻到底那一刻反复横跳。
   */
  /**
   * 根因修复（issue #728 D 组 round 2 独立评分发现的 H3 阻塞回归，2026-08-22）——
   * 「软重读」（发送后 / run 终态 / persona 摘要后）追新该从哪个位置继续拉，
   * **不能**用上面 `nextCursor`（服务端字段）：它的语义是
   * 「还有没有下一页可以翻」，`hasMore` 一旦变假就塌成 `null`——而"线程被追到底"
   * 恰恰是这三处软重读最常撞上的时刻（一条线程翻完仅剩的一页之后，发消息 / run
   * 终态 / 生成画像各触发一次软重读）。上一版修法（#1726）拿 `nextCursor`
   * 当追新起点，`null` 时会退化成 `cursor=undefined` ⇒ 服务端 `decodeCursor(undefined)`
   * 解出 `after: null` ⇒ **从第一页重新拉**，把已经归零的 `nextCursor` 重新弹回非空
   * ——三次软重读之间来回横跳（塌 → 弹回 → 塌 → …），「加载更早之后的消息」按钮
   * 因此反复挂载/卸载，真实浏览器里 Playwright 点它时撞上无限
   * `element was detached from the DOM, retrying`，直到测试预算耗尽
   * （round 2 独评实测复现：`chat-diagram-save-reopen-roundtrip.spec.ts:82`）。
   *
   * 修法：追新起点改用**本地已加载消息列表自己的尾部**现算——只要至少加载过一条
   * 消息，这个游标就永远存在、永远单调前进，不会像服务端 `nextCursor` 那样在
   * "翻到底"那一刻塌成 `null`。编码算法（`encodeMessageCursor`）与服务端
   * `message-roundtrip.ts` 的 `encodeCursor` 是**同一份实现**（`packages/contracts/
   * src/chat.ts` 单源，服务端 import 它，不再各自维护一份，见该函数头注）——对同一条
   * 消息 `{createdAt, id}` 算出来的游标逐字节相等，服务端 `decodeCursor` 才能解出
   * 正确的 `after` 位置，真的只追到这条消息之后新增的内容，不会因为起点算错而漏掉
   * 或重复。
   */
  const catchUpCursorRef = React.useRef<string | null>(null);
  catchUpCursorRef.current = messages.length > 0
    ? ChatContract.encodeMessageCursor(messages[messages.length - 1]!)
    : null;
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [listFailure, setListFailure] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  // #946 · V9-a F152：composer 附件（📎 / 拖拽 / 预览条 / 上传态 / 移除）。接真实上传端点。
  // #1758：`attachProp` 由调用方传入时（`chat-read-screen.tsx`）复用同一份，与右栏材料
  // 面板的上传入口共享；未传入时（既有的 `chat-composer-attachments.test.tsx` 单测）
  // 退化回本组件自己创建一份——两条路径共用同一个 hook 调用点，不重复维护逻辑。
  const internalAttach = useChatAttachments({ threadId, bearer });
  const attach = attachProp ?? internalAttach;
  const [submitting, setSubmitting] = React.useState(false);
  const [submitFailure, setSubmitFailure] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState<SubmissionAttempt | null>(null);
  const [queuedRun, setQueuedRun] = React.useState<{ id: string; messageId: string } | null>(null);
  /**
   * 轮询对象与上面那条 202 回显**刻意分成两个 state**。
   *
   * `queuedRun` 是草稿态的一部分：改一个字它就消失（`updateDraft`），
   * 这条语义有测试钉着（`tests/ui/chat-read-screen.test.tsx:279`）。
   * 但一次**已被接受**的 run 是服务端的持久事实，它不该因为用户开始敲下一句话就
   * 停止轮询、从界面上蒸发。两者共用一个 state 就必然二选一，所以拆开。
   */
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  /**
   * gap ②「没有进度感」（人类 2026-08-22）：14 分钟里界面只有一句「正在思考…」，
   * 用户无法判断是在跑还是已经死了。这里记录本轮开始时刻并每秒 tick 一次，
   * 让"已耗时"成为一个**会动的**信号——会动本身就是"没卡死"的证据。
   *
   * ⚠ 只在有在途 run 时计时；run 一结束就停，不留常驻定时器。
   */
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (activeRunId === null) { setRunStartedAt(null); return; }
    setRunStartedAt((prev) => prev ?? Date.now());
  }, [activeRunId]);
  React.useEffect(() => {
    if (activeRunId === null || runStartedAt === null) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeRunId, runStartedAt]);
  const [runObservation, setRunObservation] = React.useState<RunObservation | null>(null);
  /**
   * UX-9 track B 第 7 项修复——`retryAgentRun` 成功重开一个 `CHAT_WRITEBACK_FAILED`
   * 的 run 后，`activeRunId` 不变（还是同一个 runId），下面的轮询 effect 靠
   * `[activeRunId, bearer, loadPage]` 这组依赖不会自动重跑。这个计数器专门用来
   * 触发那次重跑——每次重试成功就 +1，effect 依赖它一起变化，不新起一条并行的
   * 轮询逻辑。
   */
  const [pollNonce, setPollNonce] = React.useState(0);
  const [retrying, setRetrying] = React.useState(false);
  const [retryFailure, setRetryFailure] = React.useState<string | null>(null);
  /**
   * #654 阶段2d —— 逐 token 累积的草稿文本，与上面 `runObservation` 刻意分开维护。
   *
   * `runObservation` 仍然是唯一的权威状态源（来自 `GET /agent-runs/:runId` 轮询，
   * 一个字节没改），驱动着已经有测试钉住的 `AgentRunStatus` 状态条。`streamingText`
   * 只是一层纯展示的叠加：`KERNEL_MODEL_STREAM_ENABLED` 关闭（当前默认）或所选
   * provider 不支持流式时，`GET /agent-runs/:runId/stream` 永远不会推来任何
   * `delta` 事件，这里就永远是空串——退化到今天这个界面本来的样子，一个字节不多。
   */
  const [streamingText, setStreamingText] = React.useState("");
  /**
   * 十项 UX 缺口第 5 项（issue #708）—— 「落地为产物（草稿）」的按消息状态。
   * ⚠ 只允许 `mode: "draft"`：`live`/`pinned` 要求消息挂有非空 citations（I-33），
   *   而 citations 的写入路径目前不存在（见 `land-as-artifact.ts` 与本组件顶部
   *   `landAsArtifact` 的引入注释），提供那两个选项会摆一个必炸的按钮。
   */
  const landing = useMessageLanding({ threadId, bearer, onArtifactLanded });
  const generation = React.useRef(0);
  /**
   * V1（PROP-CHAT-10ITER-001）—— 消息区自动跟随到底。
   * `scrollAreaRef` 挂在滚动容器上；`atBottomRef` 记录「用户此刻是否贴着底部」。
   * 只有贴底时新消息/流式 token 才把视口拽到底——用户上滚查看历史时，`atBottomRef`
   * 变 false，跟随立即停手，不把人强行拉回底部（这正是「自动跟随」和「锁死到底」的区别）。
   * 用 ref 不用 state：滚动位置每帧都在变，进 state 会引发无谓重渲染；跟随判定只在
   * effect 里读一次，ref 足够。
   */
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);
  const atBottomRef = React.useRef(true);
  const BOTTOM_FOLLOW_THRESHOLD_PX = 80;
  /**
   * issue #728 D 组 round 4 独评发现的 H3——「发送后强制滚到底」间歇性卡在半屏（源码
   * 推理，未经 trace 证实）。反证记录见 #1815：用 CPU 20x 降速 + soft 重读延迟 400ms
   * 复现评分员怀疑的「rAF 落在 commit 之前」窗口，本仓浏览器环境下没能复现——程序性
   * `scrollTop` 赋值触发的 `scroll` 事件在本环境里是同步的，不存在评分员假设的那种
   * 「变高之后才跑到」的延迟。
   *
   * 但顺着这条线读代码，找到一个**不需要那个未证实假设也成立**的真实缺口：`awaitingReply`
   * 的「正在思考…」占位行、以及每条 AI 消息自己挂的 `MessageThinkingChain` /
   * `MessageContextSnapshot`（惰性 `IntersectionObserver` 拉取，见两份组件自己的头注）
   * 都会在**跟随 `messages.length`/`streamingText` 的那次性 rAF 滚动之后**才把自己的
   * 高度插进消息区——这类增高没有对应的 `messages.length` 变化，旧代码里没有任何机制
   * 会在这之后重新贴底。用户贴着底部时，这类异步增高应该继续把视口按住在底部，而不是
   * 放任它把距离拉开又没人纠正。
   *
   * 修法：不再用「消息变化触发一次性 rAF」这种一次性修正，改成用 `ResizeObserver`
   * 盯着消息列表自身的盒子——只要它的高度变化（不管是持久消息新增、流式追加、还是上面
   * 这几个惰性子组件事后长高），且用户仍贴底（`atBottomRef.current` 为真），就重新贴底。
   * 这个机制对"具体是哪次渲染、哪一帧触发了增高"完全不敏感，天然覆盖了原本 rAF
   * 时序假设想解决的问题，也覆盖了这里新发现的惰性子组件增高问题。
   */
  const messageListRef = React.useRef<HTMLOListElement | null>(null);
  /**
   * 「程序性滚动生效期」——`pinToBottom()` 自己产生的 `scrollTop` 赋值也会触发一次
   * `scroll` 事件跑进 `handleScrollAreaScroll`。防御性地在生效期内不让它覆写
   * `atBottomRef`（只更新按钮显隐）：即使某个环境下这次 `scroll` 事件真的如评分员
   * 假设的那样在内容变高之后才到达、读到一个偏大的 `distanceFromBottom`，也不会把
   * 「用户其实还贴着底」误判成「用户离开了底部」。
   */
  const PROGRAMMATIC_SCROLL_GRACE_MS = 400;
  const programmaticScrollUntilRef = React.useRef(0);
  const markProgrammaticScroll = React.useCallback(() => {
    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_GRACE_MS;
  }, []);
  const pinToBottom = React.useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    markProgrammaticScroll();
    el.scrollTop = el.scrollHeight;
  }, [markProgrammaticScroll]);
  /**
   * V5（PROP-CHAT-10ITER-001）—— jump-to-latest 悬浮按钮的显隐。V1 的 `atBottomRef`
   * 是给「自动跟随判定」用的 ref（不触发渲染）；按钮显隐必须进 state 才能重渲染，
   * 所以这里单独用一个 state，在同一个 onScroll 里一起更新。用户不在底部附近 ⇒ 显示。
   */
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const handleScrollAreaScroll = React.useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= BOTTOM_FOLLOW_THRESHOLD_PX;
    setShowJumpToLatest((current) => (current === !atBottom ? current : !atBottom));
    if (Date.now() < programmaticScrollUntilRef.current) return;
    atBottomRef.current = atBottom;
  }, []);
  React.useEffect(() => {
    const target = messageListRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!atBottomRef.current) return;
      pinToBottom();
    });
    ro.observe(target);
    return () => ro.disconnect();
    // `messageListRef.current` 只在 loading/listFailure/空态 与「真的有消息」之间切换时
    // 才会从 null 变成真实节点（或反过来），这几个 state 就是「该不该重新挂 observer」
    // 的完整依赖——`messages.length` 本身的变化不需要重挂，容器元素没变，
    // ResizeObserver 自己会持续汇报后续的高度变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinToBottom, loading, listFailure, messages.length === 0]);
  const scrollToLatest = React.useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    markProgrammaticScroll();
    atBottomRef.current = true;
    setShowJumpToLatest(false);
  }, [markProgrammaticScroll]);
  /**
   * V7（PROP-CHAT-10ITER-001）—— 输入区随内容多行自动增高。每次 `text` 变化把高度
   * 先归零再设成 `scrollHeight`（这样删字也会缩回），封顶 `COMPOSER_MAX_HEIGHT_PX`
   * 之后转内部滚动。与 V2 的 ⌘↵ 多行发送配套：多行输入看得全。
   */
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const COMPOSER_MAX_HEIGHT_PX = 200;
  React.useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [text]);
  // 一键即建后（及打开任一线程时）把光标落在输入框——落进会话即可打字，不必再点一下。
  // 归档线程只读，不抢焦点（`disabled` 的 textarea 也无法聚焦，这里显式短路更清楚）。
  React.useEffect(() => {
    if (archived) return;
    composerRef.current?.focus();
  }, [threadId, archived]);
  /**
   * F05 —— 发送成功后把焦点带回输入框。
   *
   * ⚠ 这不能在 `submit()` 内部、`setSubmitting(false)` 之前直接调用 `.focus()`——
   *   composer 的 `disabled` 属性绑的是 `submitting`（本文件 `disabled={archived ||
   *   submitting}`），`setSubmitting` 触发的重渲染此刻还没提交，DOM 上的 `<textarea>`
   *   仍然是 `disabled`；对一个 `disabled` 元素调用 `.focus()` 是浏览器规范里的
   *   no-op，焦点会落空、退到 `<body>`。实测过一次：`submit()` 内 `loadPage`/
   *   `pinToBottom()` 之后直接调用仍然复现同一个失败，根因不是"调用时机太早"，
   *   是"disabled 还没摘下来"。
   *
   * 用 `submitting` 从 true 变回 false（且这次没有失败）这个**已经提交完成的**
   * 时刻做触发信号，与 `thread-list-shell.tsx` 的 `ThreadCardButton` 用
   * `pending` 下降沿判断"提交结算"是同一个手法，不是发明新模式。`resend`（重试失败
   * run）也共用这同一个 `submitting` 标志，一并收回焦点——焦点回到 composer 对任何
   * 提交路径都是合理的落点，不需要额外区分。
   */
  const prevSubmittingRef = React.useRef(submitting);
  React.useEffect(() => {
    const wasSubmitting = prevSubmittingRef.current;
    prevSubmittingRef.current = submitting;
    if (wasSubmitting && !submitting && !submitFailure && !archived) {
      composerRef.current?.focus();
    }
  }, [submitting, submitFailure, archived]);
  /**
   * V3（PROP-CHAT-10ITER-001）—— 逐条消息复制。`copiedMessageId` 记住「刚复制的是哪条」，
   * 2 秒后自动清空，让图标从对勾切回复制图标（短暂反馈，不常驻）。复制的是消息**纯文本**
   * （`message.text`），不是渲染后的 HTML——用户要的是原文（含代码/markdown 源）。
   */
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(null);
  const copyResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
  }, []);
  const handleCopyMessage = React.useCallback(async (message: DurableMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopiedMessageId(null), 2_000);
    } catch {
      // 剪贴板不可用（无 https / 权限被拒）时静默——不弹错、不伪造成功态，
      // 用户会发现没复制上而已，不给一个骗人的「已复制」。
    }
  }, []);
  /**
   * #726 —— 麦克风开始录音那一刻要读到"此刻输入框里的文字"作为追加基线，而
   * `useSpeechTranscription` 的 `start()` 是一个稳定回调（不随每次按键重建），所以基线读取
   * 必须走 ref 而不是闭包捕获的 `text`——否则会追加到"点击麦克风那一刻组件首次渲染时的
   * text"，用户点麦克风前刚手打的内容就会被追加逻辑错误地忽略或覆盖。
   */
  const textRef = React.useRef(text);
  textRef.current = text;
  // realtime-asr 增补 A（contract.md §7）：输入设备（麦克风）选择。选中的 deviceId
  // 交给 useAsrDraft，由采音层在开始录音那一刻使用；空闲换设备下次点开始即生效。
  const micDevices = useAudioInputDevices();
  const speech = useAsrDraft({
    getBaseText: () => textRef.current,
    onTranscript: (fullText) => updateDraft({ text: fullText }),
    sessionToken: bearer,
    deviceId: micDevices.selectedDeviceId ?? undefined,
  });
  const speechStopRef = React.useRef(speech.stop);
  speechStopRef.current = speech.stop;
  // run 到终态时通知调用方重读线程列表；用 ref 是因为轮询 effect 的依赖数组里
  // 不该因为父组件每次渲染传入新的箭头函数就重启轮询（同 `loadPage` 那条 effect
  // 已有的顾虑，见下面 `[activeRunId, bearer, loadPage]`）。
  const onRunSettledRef = React.useRef(onRunSettled);
  onRunSettledRef.current = onRunSettled;
  // 2026-08-14 实测根因 + 修法见 `pickDefaultAgentId` 文档注释。
  // #1806：换线程时 `agentId` 会被清空（见下面 `setAgentId("")`），此时优先级降到
  // 「线程历史里最近实际用过的 agent」（`lastUsedAgentId`，见其文档注释），而不是
  // 直接落到「通用助手」；用户在这条线程手动选过时仍原样尊重那次选择。
  const selectedAgentId = pickDefaultAgentId(agents, agentId || lastUsedAgentId(messages));

  // V1 —— 新消息列表变化或流式 token 追加时，若用户还贴着底部就跟到底。
  // 原来是一次性 `requestAnimationFrame`，只对 `messages.length`/`streamingText`
  // 这两个信号敏感；issue #728 D 组 round 4 独评 + 本文件上方 `messageListRef`
  // 头注记录的排查：`MessageThinkingChain`/`MessageContextSnapshot` 惰性拉取后
  // 才追加高度，不产生这两个信号中的任何一个，一次性 rAF 追不上。已改成
  // `messageListRef` 那个 `ResizeObserver`——盯的是容器盒子本身的高度变化，不管
  // 增高来自哪个信号，只要用户还贴底就重新贴底，这条 effect 因此不再需要。

  /**
   * `mode`（#925 ② 修复整界面闪烁）：
   * - `"replace"`：清空 + 骨架屏 + 重载。用于**换线程 / 错误重试**——那时确实没有可显示的
   *   旧消息，先清空再显骨架是对的。
   * - `"soft"`：**不清空、不显骨架**，后台重载完再原地替换。用于**发送后 / run 终态重读**——
   *   人类实测「发送后整界面闪烁」的真因就是这两处以前也走 `"replace"`：每次发消息、每次收
   *   回复，消息区都被 `setMessages([])` 清空 + `setLoading(true)` 弹骨架屏（V4 把它从灰字
   *   变成了更显眼的脉动骨架，叠加刚开的流式，视觉上就是整块闪一下）。软重载保持旧消息
   *   在场、拉到新的再无缝换上，不再闪。
   * - `"append"`：加载更早的分页，追加去重。
   */
  const loadPage = React.useCallback(async (
    cursor: string | null,
    mode: "replace" | "soft" | "append",
  ) => {
    const requestGeneration = ++generation.current;
    if (mode === "replace") {
      setMessages([]);
      setNextCursor(null);
      setLoading(true);
    } else if (mode === "append") {
      setLoadingMore(true);
    }
    // "soft"：什么都不清、不显骨架——旧消息继续显示，拉到结果再原地替换。
    setListFailure(null);
    try {
      const result = await listMessages(
        threadId,
        { cursor: cursor ?? undefined, limit: MESSAGE_PAGE_SIZE },
        bearer,
      );
      if (generation.current !== requestGeneration) return;
      // "append"（用户点「加载更早之后的消息」）与 "soft"（软重读，见上面 `catchUpCursorRef`
      // 的注释）都是「把这一页新增内容接到已有列表后面」，用 appendUnique 合并去重；
      // 只有 "replace"（换线程 / 错误重试）才是真的整批替换。
      setMessages((current) => mode === "replace" ? result.messages : appendUnique(current, result.messages));
      setNextCursor(result.nextCursor);
      // #1805 —— 换线程/mount（"replace"）时，`activeRunId` 已在调用方被清空（见下面那条
      // effect），轮询完全靠内存。如果发消息后标签页真的丢了（刷新/关闭重开/断网重连），
      // 内存没了，界面上就再也没人去问「这条消息触发的 run 跑到哪了」——用户看到的是消息
      // 卡住不动、没有任何提示。这里从刚读回的持久消息里找回它：最新一条人类消息如果带了
      // `agentRunId` 且还没有任何消息 `replyToMessageId` 指回它，说明写回大概率还没完成，
      // 重新挂上 `activeRunId` 让下面已有的轮询 effect（487 行起）接管——若那个 run 其实
      // 已经是终态，poll 一次就会发现并停止，不会产生错误状态，只多打一次 GET。
      if (mode === "replace" && !archived) {
        const lastHuman = [...result.messages].reverse()
          .find((m) => m.authorKind === "human" && m.agentRunId !== null);
        if (lastHuman) {
          const alreadyReplied = result.messages.some((m) => m.replyToMessageId === lastHuman.id);
          if (!alreadyReplied) setActiveRunId(lastHuman.agentRunId);
        }
      }
    } catch (failure) {
      if (generation.current !== requestGeneration) return;
      // 软重载失败不该把已经在显示的消息换成错误态（那更像倒退）——软模式静默保留旧消息，
      // 只有 replace（本就没有旧消息可保）才把失败显给用户。
      if (mode === "replace") setListFailure(describeMessageFailure(failure, "读取消息"));
    } finally {
      if (generation.current === requestGeneration) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [bearer, threadId, archived]);

  React.useEffect(() => {
    setText("");
    setAgentId("");
    setAttempt(null);
    setSubmitFailure(null);
    setQueuedRun(null);
    setActiveRunId(null);
    setRunObservation(null);
    void loadPage(null, "replace"); // 换线程：没有旧消息可保，清空+骨架是对的
    return () => {
      generation.current += 1;
      // #726 —— 切换线程（sourceKey 变化）或组件卸载时，正在进行的语音录音必须停止，
      // 否则用户切到另一个对话后，麦克风还在把语音写进已经不属于这个 draft 的地方。
      speechStopRef.current();
    };
  }, [loadPage, sourceKey]);

  /**
   * #435 —— 把 AgentRun 的**真实执行状态**读出来，让「agent 真的跑了」对用户可见。
   *
   * 在这条 effect 之前，界面上关于一次 run 的全部信息只有 `chat-message-queued`——
   * 那只是 202 响应体的回显（`chat.controller.ts:377-387`），它在 run 还没开始执行、
   * 甚至在 run 失败之后，都长得一模一样。换句话说：**旧界面无法区分「跑成功了」
   * 与「压根没跑」**，闭环第 8 步在界面上交付不了。
   *
   * 这里唯一的事实源是 `GET /agent-runs/:runId`（`agent-run.controller.ts:35`）。
   * 轮询到终态就停，然后**重读消息页**——助手回复是 #413 写回提交的持久行，
   * 不是本地合成的（`pg-agent-run-repository.ts:216-266`）。
   */
  React.useEffect(() => {
    const runId = activeRunId;
    if (runId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + RUN_POLL_BUDGET_MS;
    setRunObservation({ runId, view: null, failure: null, timedOut: false, authExpired: false });

    const poll = async (delay: number): Promise<void> => {
      if (cancelled) return;
      let view: AgentRunView;
      try {
        view = await getAgentRun(runId, bearer);
      } catch (failure) {
        if (cancelled) return;
        // issue #1819 —— 401 是不可恢复的：bearer 已过期，这条端点接下来**每一次**
        // 都会撞同一个 401，退避重试不会让它变好，唯一出路是用户重新登录。
        // 单独识别出来、立即停止轮询（不受 `deadline` 支配），并把
        // `authExpired` 标出去——下面 `awaitingReply` 靠它让「正在思考…」占位
        // 让位给这里已经生成好的「登录已失效，请重新登录」文案，而不是让两者
        // 同屏矛盾地并存到 20 分钟预算耗尽。
        const authExpired = failure instanceof ApiError && failure.status === 401;
        setRunObservation({
          runId,
          view: null,
          failure: describeMessageFailure(failure, "读取 AgentRun 状态"),
          timedOut: false,
          authExpired,
        });
        if (authExpired) return;
        // ⚠ 读失败（非 401）**不终止轮询**（预算耗尽才停）。一次 503 或网络抖动就把
        //   状态永久冻在「读取失败」上是错的：run 在服务端还跑着，界面却再也不会
        //   更新了。实测见过这个形态 —— 缺了 `/agent-runs` 的 rewrite 时，首次轮询
        //   就失败并就此停住，62 次断言重试读到的都是同一个冻住的 DOM。持续失败
        //   仍然会一直显示失败文案，所以「如实报错」没有被削弱。
        if (Date.now() >= deadline) return;
        timer = setTimeout(
          () => void poll(Math.min(delay * RUN_POLL_BACKOFF, RUN_POLL_MAX_DELAY_MS)),
          delay,
        );
        return;
      }
      if (cancelled) return;
      setRunObservation({ runId, view, failure: null, timedOut: false, authExpired: false });
      if (isTerminalRunStatus(view.status)) {
        // 终态才重读消息页：写回是在 `writeback_pending` 之后才提交的，
        // 早读会读到一个还没有助手回复的列表，并且再也不会自己刷新。
        // 终态重读：从本地已加载列表尾部追新，不清空不弹骨架
        // （#925 ② 消灭闪烁 + `catchUpCursorRef` 头注——H3 根因修复）
        await loadPage(catchUpCursorRef.current, "soft");
        // UX-9 Line A 修1 的另一半：持久消息已落位，草稿完成使命，此刻清空无缝。
        // ⚠ 首版把这行写在了 `nextCursorRef`（不存在的名字）的 replace 里，静默
        // 没命中——单测 15s 超时抓回来的。凭记忆写标识符 = DA-07b 函数体事故的
        // 迷你重演，教训同一条。
        setStreamingText("");
        // #728 第 10 轮 P10 —— `queuedRun` 是「已提交、等待轮询」那段过渡态的回执，
        // 到了终态（成功/失败）它就该让位给下面 `AgentRunStatus` 的权威状态文案。
        // 之前没清，评分员截到过「消息已持久化，AgentRun 已排队。」和「执行完成，
        // 回复已写入对话」两行绿字同屏——界面同时声称这个 run 既在排队又已完成，
        // 是自相矛盾，不是两条独立信息。
        setQueuedRun(null);
        onRunSettledRef.current?.();
        return;
      }
      if (Date.now() >= deadline) {
        setRunObservation({ runId, view, failure: null, timedOut: true, authExpired: false });
        return;
      }
      timer = setTimeout(() => void poll(Math.min(delay * RUN_POLL_BACKOFF, RUN_POLL_MAX_DELAY_MS)), delay);
    };

    timer = setTimeout(() => void poll(RUN_POLL_FIRST_DELAY_MS), 0);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
    // `pollNonce` 是本 effect 唯一不参与判断、只用来强制重跑的依赖——见其声明处头注：
    // `retryAgentRun` 重开的是同一个 runId，`activeRunId` 不会变，靠这个计数器重新挂起轮询。
  }, [activeRunId, bearer, loadPage, pollNonce]);

  /**
   * #654 阶段2d —— 逐 token 追加。与上面的状态轮询是两个独立的 effect，各自
   * `useEffect([activeRunId, ...])`，互不依赖：这条流断了（网络问题、服务端还没打开
   * `KERNEL_MODEL_STREAM_ENABLED`）不影响上面状态条的权威轮询继续工作；上面的轮询
   * 到终态后照旧 `loadPage(null, true)` 重读持久消息——那才是最终渲染的真源，
   * 这里的 `streamingText` 只是等待持久化期间的观感，终态一到就清空（下面的
   * `onEvent` 分支）。
   */
  React.useEffect(() => {
    const runId = activeRunId;
    setStreamingText("");
    if (runId === null) return;
    const controller = new AbortController();
    let cancelled = false;

    void openAgentRunStream(runId, (event) => {
      if (cancelled) return;
      if (event.type === "delta") {
        setStreamingText((current) => current + event.text);
      }
      // UI 复评 2026-08-23 抓到的真实缺陷（第 1 项判 0 的直接依据）：final 事件
      // 立即清空草稿，但持久消息的 loadPage 还没返回——用户眼看着已渲染的正文
      // 整段消失、退回打字气泡、再换一段终稿贴上。「即将成为唯一事实源」不等于
      // 「已经是」。清空移到轮询终态分支的 loadPage **完成之后**（那里持久消息
      // 已在列表里，草稿到终稿是无缝接力）。timeout 同理；流打开失败的 catch
      // 分支保留立即清空——那时没有值得保的草稿。
    }, { sessionToken: bearer, signal: controller.signal }).catch(() => {
      // Streaming is a progressive enhancement, not a requirement: `runObservation`'s own
      // poll (above) is the authoritative status/result source regardless of whether this
      // connection ever opens at all. A failure here is silently absorbed on purpose --
      // surfacing it as a user-facing error would be reporting a problem with a purely
      // cosmetic feature as if it were the send itself failing.
      if (!cancelled) setStreamingText("");
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeRunId, bearer]);

  /**
   * UIUX 对标 CopilotKit gap #2（issue #712 调查结论：原实现是纯前端确定性规则，
   * 不是真实 AI 推荐）—— 真实模型推理优先，`computeFollowUpSuggestions`（规则驱动）
   * 退化为兜底，不是被替换掉。
   *
   * `followUpTurnKey` 只在「已归档=false ∧ 最新一条来自 agent」时非 null——与
   * `computeFollowUpSuggestions` 判断「该不该建议」的条件逐字同源（不是第二套判据），
   * 只是这里还要多识别「这是同一轮对话，不必重新请求」：key 含最新消息 id +
   * 当前选中的 agent，agent 一换或来了新一轮回复，key 变了就重新拉一次。
   */
  const latestMessage = messages.length > 0 ? messages[messages.length - 1]! : null;
  const followUpTurnKey = !archived && latestMessage !== null && latestMessage.authorKind === "agent" && selectedAgentId !== ""
    ? `${latestMessage.id} ${selectedAgentId}`
    : null;
  const [realFollowUp, setRealFollowUp] = React.useState<{
    readonly key: string;
    readonly suggestions: readonly FollowUpSuggestion[];
  } | null>(null);
  const [followUpLoading, setFollowUpLoading] = React.useState(false);

  React.useEffect(() => {
    if (followUpTurnKey === null) {
      setFollowUpLoading(false);
      return;
    }
    if (realFollowUp?.key === followUpTurnKey) return;
    let cancelled = false;
    setFollowUpLoading(true);
    // 8s——比消息发送本身的轮询预算短得多：这只是 composer 下方的一排建议 chip，
    // 兜底规则已经能立刻给出可点的内容，真实建议慢就不必让用户等它。
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("followup_suggestions_timeout")), 8_000);
    });
    Promise.race([fetchFollowUpSuggestions(threadId, selectedAgentId, bearer), timeout])
      .then((out) => {
        if (cancelled) return;
        setRealFollowUp({
          key: followUpTurnKey,
          suggestions: out.suggestions.map((text, index) => ({ id: `real-${index}`, text })),
        });
      })
      .catch(() => {
        // 端点未配置 / 模型调用失败 / 超时——优雅降级：不重试、不报错给用户，`realFollowUp`
        // 保持不变（未写入这个 key），下面 `followUpSuggestions` 的渲染分支这一轮就退回
        // `computeFollowUpSuggestions` 的确定性规则，用户看到的仍是一排能点的 chip，
        // 只是不是真实推理出来的那批。
      })
      .finally(() => {
        if (!cancelled) setFollowUpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [followUpTurnKey, selectedAgentId, threadId, bearer, realFollowUp?.key]);

  const followUpSuggestions = followUpTurnKey !== null && realFollowUp?.key === followUpTurnKey
    ? realFollowUp.suggestions
    : computeFollowUpSuggestions(messages, archived);
  /** 真实建议还没回来/已降级，但兜底规则这一轮确实有话可说——给个不打断兜底 chip 的加载提示。 */
  const followUpSuggestionsPending = followUpTurnKey !== null
    && realFollowUp?.key !== followUpTurnKey
    && followUpLoading;
  /**
   * #728 P10 —— 与 `AgentPicker`/提交按钮判「没有可选 Agent」用同一个事实
   * （`agents` 已加载完成且为空数组），不是另起一条判断。追问建议 chip 与麦克风
   * 按钮据此收起/禁用——「点了却送不出去」的假按钮就是从这里长出来的。
   */
  const noAgentToRunWith = agents !== null && agents.length === 0;

  const updateDraft = (next: { text?: string; agentId?: string }) => {
    const nextText = next.text ?? text;
    const nextAgentId = next.agentId ?? selectedAgentId;
    setText(nextText);
    setAgentId(nextAgentId);
    if (attempt && (attempt.text !== nextText || attempt.agentId !== nextAgentId)) setAttempt(null);
    setSubmitFailure(null);
    setQueuedRun(null);
  };

  /**
   * `#` mention 的检测状态。`start` 是 `#` 在 `text` 里的下标（切掉时要用），
   * `query` 是 `#` 到光标之间的文字。两者都在 `onSelect`（每次光标或选区变化，
   * 覆盖打字、点击、方向键）里重算——原生 `<textarea>` 没有富文本节点，
   * 唯一可靠的「光标在哪」信号就是 `selectionStart`。
   */
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null);

  /**
   * `@` mention（引用本线程已上传过的文件）的检测状态，形状与 `#` 那套完全对称，
   * 但**不需要任何后端调用**——不像 `#` 要真的调 `mountSkills`，`@` 选中后只是把
   * 文件名当纯文本插进正文。之所以这样就够：F155 file-retrieval 的
   * `search_tsv`（`chat_message_attachments` 表，见
   * `20260814120000_f155_file_retrieval_fts.sql:36-38`）本来就是
   * `to_tsvector(filename || ' ' || extracted_excerpt)`——文件名已经是被检索的
   * 一部分。正文里出现文件名，run 时的 L3 检索自然会把这份文件的内容召回进
   * 上下文，不需要新的 `attachmentIds` 语义或新契约面（`attachmentIds` 现有的
   * `ATTACHMENT_NOT_PENDING` 校验本就不允许一个附件被两条消息共享/重复引用，
   * 见 `packages/contracts/src/chat.ts:224-226`——`@` 刻意不碰这条路径）。
   *
   * 候选列表来自**当前已加载**的历史消息（`messages` state 里每条的
   * `attachments`），按文件名去重；不是全线程的权威清单——足够早的附件如果
   * 还没翻页加载到，暂时搜不到，这是已知的第一版边界，不是 bug。
   */
  const [attachmentMention, setAttachmentMention] = React.useState<{ start: number; query: string } | null>(null);

  const threadAttachmentOptions = React.useMemo(() => {
    const byFilename = new Map<string, { id: string; filename: string }>();
    for (const m of messages) {
      for (const att of m.attachments ?? []) {
        if (!byFilename.has(att.filename)) byFilename.set(att.filename, { id: att.id, filename: att.filename });
      }
    }
    return Array.from(byFilename.values());
  }, [messages]);

  const visibleAttachmentOptions = attachmentMention
    ? threadAttachmentOptions.filter((a) => a.filename.toLowerCase().includes(attachmentMention.query.toLowerCase()))
    : [];

  /**
   * `#` 与 `@` 共用同一段正文、同一个光标，一次只能有一个处于「活跃」——
   * 取光标前**更靠近**的那个触发字符（下标更大的那个）。互不冲突：正文里
   * 同时存在 `#foo` 和 `@bar` 时，只有离光标更近的那一个会被认成当前 mention。
   */
  const recomputeMentions = (value: string, caret: number | null) => {
    if (caret === null) {
      setMention(null);
      setAttachmentMention(null);
      return;
    }
    const upToCaret = value.slice(0, caret);
    const hashIndex = upToCaret.lastIndexOf("#");
    const atIndex = upToCaret.lastIndexOf("@");
    if (hashIndex === -1 && atIndex === -1) {
      setMention(null);
      setAttachmentMention(null);
      return;
    }
    if (hashIndex > atIndex) {
      const between = upToCaret.slice(hashIndex + 1);
      // 触发字符后面一旦出现空白/换行，这次 mention 就结束了（比如打完 `#foo 然后` 那句话）。
      setMention(/\s/.test(between) ? null : { start: hashIndex, query: between });
      setAttachmentMention(null);
    } else {
      const between = upToCaret.slice(atIndex + 1);
      setAttachmentMention(/\s/.test(between) ? null : { start: atIndex, query: between });
      setMention(null);
    }
  };

  const insertAttachmentMention = (filename: string) => {
    if (!attachmentMention) return;
    const nextText =
      text.slice(0, attachmentMention.start) +
      `@${filename} ` +
      text.slice(attachmentMention.start + 1 + attachmentMention.query.length);
    setAttachmentMention(null);
    updateDraft({ text: nextText });
  };

  React.useEffect(() => {
    onMentionQueryChange?.(mention?.query ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention]);

  const previousMentionResolvedNonce = React.useRef(mentionResolvedNonce);
  React.useEffect(() => {
    if (mentionResolvedNonce === undefined) return;
    if (previousMentionResolvedNonce.current === mentionResolvedNonce) return;
    previousMentionResolvedNonce.current = mentionResolvedNonce;
    if (mention === null) return;
    // 把 `#query` 从正文里删掉——挂载已经真的发生了，留着字面量只会让使用者
    // 以为还要手动发送一条以 `#` 开头的消息。
    const nextText = text.slice(0, mention.start) + text.slice(mention.start + 1 + mention.query.length);
    setMention(null);
    updateDraft({ text: nextText });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionResolvedNonce]);

  /**
   * #925 ③（人类裁决，覆盖 V2 的 ⌘↵）—— **Enter 发送、Shift+Enter 换行**（Claude/ChatGPT 惯例）。
   * ⚠ **必须挡输入法组字（IME composition）中的 Enter**：本仓是中文应用，用户打中文时按 Enter
   * 是"确认候选词"，不是"发送"——`event.nativeEvent.isComposing` 为真时直接放行给输入法，
   * 绝不能发送，否则每选一个词就误发一条。`submit` 自身已守空文本/无 agent/归档/发送中四门。
   */
  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  /**
   * `resend` 参数（UX-9 track B 第 7 项修复）——重试一个 `MODEL_CALL_FAILED`（或任何
   * 不支持 `retryAgentRun` 重开的）失败 run 时用：契约的 `UNIQUE (org_id,
   * input_message_id)` 约束（#415）不允许对同一条人类消息开第二个 run，唯一诚实的
   * 「重试」是把原文本当**一条新消息**重新发出，产生一个全新的 run —— 不是复用当前
   * composer 草稿（`text`/`selectedAgentId`），所以单独传参数，不依赖组件 state 的
   * 下一次渲染。传了 `resend` 时也不带上当前 composer 里可能正挂着的附件：那些附件
   * 属于用户正在写的下一条消息，与被重试的这条历史失败消息无关。
   */
  const submit = async (resend?: { text: string; agentId: string }) => {
    const normalizedText = (resend?.text ?? text).trim();
    const agentIdToUse = resend?.agentId ?? selectedAgentId;
    if (normalizedText === "" || agentIdToUse === "" || archived || submitting) return;
    // #946 · V9-a F152：有附件还在上传时不发送——等它们各自到 uploaded/error 再发，
    // 否则会把还没拿到 serverId 的附件漏发。错误态的附件不阻塞发送（用户可先移除或重试）。
    if (!resend && attach.hasUploading) return;
    const currentAttempt = !resend && attempt && attempt.threadId === threadId &&
      attempt.text === normalizedText && attempt.agentId === agentIdToUse
      ? attempt
      : {
        threadId,
        clientMessageId: newClientMessageId(),
        text: normalizedText,
        agentId: agentIdToUse,
      };
    if (!resend) setAttempt(currentAttempt);
    setSubmitting(true);
    setSubmitFailure(null);
    setQueuedRun(null);
    setActiveRunId(null);
    setRunObservation(null);
    try {
      const attachmentIds = resend ? [] : attach.uploadedIds;
      const accepted = await createMessage(threadId, {
        clientMessageId: currentAttempt.clientMessageId,
        text: currentAttempt.text,
        agentId: currentAttempt.agentId,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      }, bearer);
      setQueuedRun({ id: accepted.agentRunId, messageId: accepted.message.id });
      setActiveRunId(accepted.agentRunId);
      if (!resend) {
        setText("");
        setAttempt(null);
        attach.clear(); // 发送成功：附件已挂到该消息，清空 composer 的本地附件态
      }
      onMessageSent?.(); // #728 D9：材料随消息一起产出，此刻通知上层重读右栏「材料」

      // 发送后重读：从本地已加载列表尾部追新，不清空不弹骨架
      // （#925 ② 消灭闪烁 + `catchUpCursorRef` 头注——H3 根因修复）
      await loadPage(catchUpCursorRef.current, "soft");
      // #925 ③（人类裁决）—— 发送是显式意图，无条件滚到最新一条，**覆盖 V1「尊重上滚」**
      // （用户之前上滚看历史，发送后也要拽回底部；对齐 Claude/ChatGPT）。置
      // atBottomRef=true 让后续流式/回复/惰性子组件增高继续跟随；`pinToBottom()`
      // 立即尽力滚一次，随后 `messageListRef` 的 `ResizeObserver`（见其头注，H3
      // round 4 根因修复）接手兜底——不管这次立即滚动是抢在 commit 之前还是之后，
      // 内容盒子一旦再变化都会被追上，不再是「滚一次赌中就中」。
      atBottomRef.current = true;
      setShowJumpToLatest(false);
      pinToBottom();
    } catch (failure) {
      setSubmitFailure(describeMessageFailure(failure, "发送消息"));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * UX-9 track B 第 7 项修复——失败 run 的重试入口，两条真实路径，不是同一件事伪装成一件事：
   *
   * ① `error === "CHAT_WRITEBACK_FAILED"`（写回预算耗尽，模型答案其实已经生成好）——
   *    调契约既有的 `retryAgentRun`，服务端**重开同一个 run**（同一条输入消息，不产生
   *    第二条），重开后继续走既有轮询到终态。这是 `retryAgentRun` 唯一支持的场景
   *    （见 `apps/api/src/application/agent-run/retry-run.ts` 的 `reopenForWritebackRetry`）。
   * ② 其它终态错误码（如 `MODEL_CALL_FAILED`）——服务端对这些码不允许重开同一个
   *    run（撞 409 `AGENT_RUN_NOT_RETRYABLE`，`UNIQUE (org_id, input_message_id)`
   *    结构上也不允许），唯一诚实的重试是把原文本当一条新消息重新发出（`submit`
   *    的 `resend` 分支），产生一个全新的 run。
   *
   * 两条路径都失败（网络错误、无权限等）时如实展示失败原因，不静默吞掉。
   */
  const retryFailedRun = async () => {
    const view = runObservation?.view;
    if (!view || view.status !== "failed" || retrying) return;
    setRetrying(true);
    setRetryFailure(null);
    try {
      const reopened = await retryAgentRun(view.runId, bearer);
      setRunObservation({ runId: reopened.runId, view: reopened, failure: null, timedOut: false, authExpired: false });
      setPollNonce((n) => n + 1); // 同一个 runId，effect 靠这个计数器重新挂起轮询
    } catch (failure) {
      const notRetryable = failure instanceof ApiError && failure.reasonCode === "AGENT_RUN_NOT_RETRYABLE";
      if (notRetryable) {
        // 这一类失败码在契约里就不支持"重开同一个 run"——见上方函数头注②。
        // 原文本只在**当前已加载**的消息窗口里找得到时才能重发；找不到（早于翻页
        // 窗口）就如实说做不到，不假装重试成功。
        const original = messages.find((m) => m.id === view.inputMessageId);
        if (!original) {
          setRetryFailure("这类失败不支持重开原 run，且原始消息已不在当前加载窗口内，无法自动重发——请手动重新输入并发送。");
        } else {
          await submit({ text: original.text, agentId: view.agentId });
        }
      } else {
        setRetryFailure(describeMessageFailure(failure, "重试执行"));
      }
    } finally {
      setRetrying(false);
    }
  };

  /**
   * G2「生成用户画像」（design-delta chat-persona-roundtrip，签核选 A：composer 状态条）。
   * 锚点消息 = 当前线程最新一条（契约 `in.messageId` 是出处回链的锚，画像扫的是全线程）。
   * 成功后软刷新消息流——新 assistant 消息里的 mindmap 围栏走既有
   * `MarkdownMessage → ChatDiagramFabric` 通道自动渲染。失败原样回显 reasonCode，
   * 不糊一句「生成失败」。
   */
  const [personaRunning, setPersonaRunning] = React.useState(false);
  const [personaFailure, setPersonaFailure] = React.useState<string | null>(null);
  const runPersonaSummary = async () => {
    const anchor = messages[messages.length - 1];
    if (!anchor || personaRunning) return;
    setPersonaRunning(true);
    setPersonaFailure(null);
    try {
      await summarizePersonaFromThread(threadId, anchor.id, bearer);
      await loadPage(catchUpCursorRef.current, "soft"); // H3 根因修复见上（`catchUpCursorRef` 注释）
      atBottomRef.current = true;
      setShowJumpToLatest(false);
      pinToBottom(); // 立即尽力 + `messageListRef` 的 ResizeObserver 兜底，见其头注
    } catch (failure) {
      setPersonaFailure(
        failure instanceof ApiError
          ? `生成用户画像失败：${failure.reasonCode ?? `HTTP ${failure.status}`}`
          : describeMessageFailure(failure, "生成用户画像"),
      );
    } finally {
      setPersonaRunning(false);
    }
  };

  /**
   * 发送后等待动画（人类 devapp 实测：发完消息像卡死，要对标 Claude Code 的 thinking 动画）。
   * `awaitingReply` = 有一个在途 run 且还没有任何逐 token 文本可显示时——此时消息区什么都
   * 不动，正是"卡死感"的来源。deep-agent 走轮询+整段写回，`streamingText` 全程为空，所以
   * 这个态在 devapp 的默认 agent 上尤其常见。
   * - `activeRunId !== null`：确实有一个 run 在跑（提交后即置）。
   * - `streamingText === ""`：还没有逐字草稿（有草稿就走上面的流式气泡，二者互斥）。
   * - run 未到终态：`runObservation.view` 为 null（首次轮询还没回）或状态非终态都算在途；
   *   到终态后真实回复由 `loadPage` 接管，动画让位。
   * - `!runObservation?.authExpired`（issue #1819）：读 run 状态撞 401 时不是「还在跑，
   *   等着」——是不可恢复的登录过期，继续显示「正在思考…」是对用户撒谎。这种情况
   *   让位给 `AgentRunStatus` 已经展示的「登录已失效，请重新登录」文案。
   */
  const awaitingReply = activeRunId !== null
    && streamingText === ""
    && !(runObservation?.authExpired ?? false)
    && !(runObservation?.view != null && isTerminalRunStatus(runObservation.view.status));

  /**
   * gap #8（人类 2026-08-22 devapp 实测）——「正在思考…」卡片旁边挂一句阶段文案，
   * 与已耗时计时器并列，而不是取代它（计时器答"卡没卡死"，阶段文案答"卡在哪一步"，
   * 两者不是同一件事）。`null`（run 还没有任何 step，或压根没有在途 run）时不渲染，
   * 不留一个空 `·` 分隔符。见 `lib/agent-run-phase.ts` 的映射表与「为什么读最新一条
   * 已完成 step」的说明。
   */
  const runPhaseLabel = runObservation?.view != null ? deriveRunPhaseLabel(runObservation.view.steps) : null;

  /**
   * UI 评分 2026-08-23 第 10 项不一致①——身份漂移：过程区头像写死「AI」、流式草稿
   * 与思考占位两处都写死「Agent」，等消息真正落库才换成 `agentLabel` 查出来的真实
   * 名字（如「Deep Research Agent」）。三个占位行与终态各喊各的名字，读的人看到的
   * 是同一次回复中途换了三次身份。
   *
   * `runObservation.view.agentId` 是服务端权威值（一旦轮询到第一次响应就有），
   * 在它到达前的短窗口退回 `selectedAgentId`（提交这次消息时选中的 agent）——
   * 两者在同一次提交里指向同一个 agent，不是两个不同的事实源，只是可用的时机不同。
   */
  const activeAgentId = runObservation?.view?.agentId ?? (selectedAgentId || null);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="chat-live-message-panel"
      {...(archived ? {} : attach.dragHandlers)}
    >
      {/*
        #1492 —— 拖文件到 chat 主界面任意处（消息列表 + composer 整个可视区）都触发，
        对标 Codex；「文件上传按钮」的简化/加速版本，不新增上传机制——松手仍走
        `pickFiles`，文件仍落在下方 composer 的附件列表。归档线程不接（沿用既有门控）。
      */}
      {archived ? null : <ChatFullSurfaceDropOverlay active={attach.dragActive} />}
      <div
        ref={scrollAreaRef}
        onScroll={handleScrollAreaScroll}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="chat-message-scroll"
      >
        {loading && !knownEmpty ? (
          // V4（PROP-CHAT-10ITER-001）—— 消息首载骨架屏，替换原来的灰字「正在读取持久消息…」。
          // 沿用全站 StateShell 的骨架样式（animate-pulse + bg-muted），但做成消息形状
          // （头像圆 + 气泡条，交替左右）而不是通用矩形块，让加载态就预示了内容的排布。
          <div
            data-testid="chat-message-loading-skeleton"
            className="flex animate-pulse flex-col gap-4"
          >
            {[0, 1, 2].map((i) => {
              const isAgent = i % 2 === 0;
              return (
                <div key={i} className={`flex items-start gap-2.5 ${isAgent ? "" : "flex-row-reverse"}`}>
                  <div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
                  <div className={`flex max-w-[80%] flex-col gap-1.5 ${isAgent ? "items-start" : "items-end"}`}>
                    <div className="h-2.5 w-24 rounded bg-muted" />
                    <div className="h-12 w-56 rounded-2xl bg-muted" />
                  </div>
                </div>
              );
            })}
            <span className="sr-only">正在读取持久消息</span>
          </div>
        ) : null}
        {listFailure ? (
          <FailureState
            testId="chat-message-list-error"
            message={listFailure}
            onRetry={() => void loadPage(null, "replace")}
          />
        ) : null}
        {/*
          UI 评分 2026-08-23 第 10 项不一致②——原判据只看 `messages.length === 0`：
          刚发出第一条消息、run 还没落库那 1~2 秒里，持久消息数确实是 0，于是这句
          空态文案与「我刚发的消息去哪了」的用户直觉正面冲突（评分员截到了这一帧）。
          `activeRunId !== null` 就是「有一个 run 正在飞」的唯一事实源（`submit()` 拿到
          202 就置它），这里加这一个条件，不新起判据：有在途 run 时让位给下面
          `messages.length > 0 || activeRunId !== null` 那个分支渲染的思考/流式行，
          不再同时喊「没有消息」。
        */}
        {!loading && !listFailure && messages.length === 0 && activeRunId === null ? (
          <div className="grid min-h-40 place-items-center text-12 text-muted-foreground" data-testid="chat-message-list-empty">
            这条线程还没有持久消息。
          </div>
        ) : null}
        {messages.length > 0 || activeRunId !== null ? (
          <ol ref={messageListRef} className="flex flex-col gap-4" data-testid="chat-message-list">
            {messages.map((message) => {
              const isAgent = message.authorKind === "agent";
              return (
                <li
                  key={message.id}
                  className={`group flex items-start gap-2.5 ${isAgent ? "" : "flex-row-reverse"}`}
                  data-testid="chat-message-row"
                  data-message-id={message.id}
                >
                  <div
                    aria-hidden
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                      isAgent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isAgent ? <Bot className="h-3.5 w-3.5" aria-hidden /> : <UserRound className="h-3.5 w-3.5" aria-hidden />}
                  </div>
                  <div className={`flex max-w-[80%] flex-col gap-1 ${isAgent ? "items-start" : "items-end"}`}>
                    {/*
                      #728 D5 —— 身份行照原型：名字 + 角色 chip + 时间。

                      ⚠ 这里此前印的是 `message.agentId` 的原值（截图上就是
                      `agent-chat-read-e2e`），而同一份 `agents` 里就有 `name` ——
                      左栏编制早就正确显示「Controlled Read Agent」了。同一个 agent
                      在一屏之内一处是人名、一处是裸 id，读的人无法确认它们是同一个。
                      查不到就回落到 id 而不是糊成「Agent」：查不到通常意味着这个 agent
                      已被移出编制，糊掉会让这件事不可见。

                      ⚠ `run <id>` 不再常驻可视区（原型里没有这一档，且它是 40 位裸 id）。
                      改挂 `data-run-id`，机器仍可断言，人眼不再被它占满一行。
                    */}
                    <div
                      className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground"
                      data-run-id={message.agentRunId ?? undefined}
                    >
                      <span className="font-medium text-card-foreground">
                        {isAgent ? agentLabel(message.agentId, agents) : "我"}
                      </span>
                      {isAgent ? agentRoleLabel(message.agentId, agents) : null}
                      {isAgent ? agentSkillLabel(message.createdAt, skillMounts, skillNames) : null}
                      <span>{messageTime(message.createdAt)}</span>
                    </div>
                    {/*
                      2026-08-14 人类实测反馈重做：思考/工具调用链挂在这条消息自己身上
                      （紧跟身份行、在正文气泡之前），不是只在 composer 下方为"当前正在提交
                      的 run"临时显示——翻页、切线程再切回来，历史消息的思考链依然可见。
                      只对 AI 消息、且有 `agentRunId` 时渲染；`MessageThinkingChain` 内部
                      挂载才惰性拉取，失败静默降级，不影响消息正文本身。
                    */}
                    {isAgent ? <MessageThinkingChain agentRunId={message.agentRunId} bearer={bearer} /> : null}
                    {/*
                      context-engine 可用性补口——L1/L2/L3/F190 四层组装出的上下文此前对
                      用户完全不可见（本文件其它地方的既有注释："citations 的写入路径目前
                      不存在"）。与上面 `MessageThinkingChain` 同一套挂法：跟着消息本身走，
                      不是跟着"当前是否有一个 run 在跑"这个瞬时状态走。
                    */}
                    {isAgent ? <MessageContextSnapshot agentRunId={message.agentRunId} bearer={bearer} /> : null}
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-12 leading-relaxed ${
                        isAgent
                          ? "rounded-tl-sm bg-panel text-card-foreground"
                          // #728 D5：原型里人的气泡是**中性底**，不是实心品牌色。
                          // 实心 primary 让用户自己说的每一句话都在抢视觉重量。
                          : "rounded-tr-sm bg-muted text-card-foreground"
                      }`}
                    >
                      {isAgent ? (
                        // VZ-01 MarkdownMessage：markdown（代码块/列表/加粗/表格）+ ```mermaid
                        // 围栏渲成图（越界图类型/语法错误落诚实错误态，不崩整条消息）。
                        // 只对 agent 消息用：用户自己打的文字没有 markdown 语义可渲染。
                        //
                        // 只在 canLandArtifacts 为真时传 threadId/message.id/bearer——跟
                        // 下面 `MessageLandingControls` 同一道门。此前这里无条件传全三者，
                        // 于是图「最大化→编辑→保存」在个人线程（当时 canLandArtifacts 恒
                        // false）里会调 landAsArtifact 撞上后端角色门，403「保存失败：当前
                        // 身份没有写入权限」——那不是权限模型错了，是这个入口没接上已有的
                        // 能力开关，让一枚本该退回「本地演示」的按钮伪装成了可保存。
                        // **2026-08-21 人类裁决**：个人线程的 `artifact.land` 能力已开放
                        // （`PERSONAL_THREAD_CAPABILITIES` 含它），`canLandArtifacts` 对
                        // 个人线程恒 true——这三者现在会真的传给个人线程，走真实持久化。
                        // `projectId` 是唯一例外：个人线程没有项目上下文，这里恒传
                        // `undefined`，`ChatDiagramFabric`/`ChatCanvasFabric` 把它归一成
                        // `null` 传给后端（`resolveVisibility` 按 `null` 分派到个人线程
                        // 判权分支，不是"没有 projectId 就不发请求"）。
                        <MarkdownMessage
                          text={message.text}
                          threadId={canLandArtifacts ? threadId : undefined}
                          messageId={canLandArtifacts ? message.id : undefined}
                          bearer={canLandArtifacts ? bearer : undefined}
                          projectId={canLandArtifacts ? projectId : undefined}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      )}
                    </div>
                    {/*
                      2026-08-16 人类实测反馈：动作条从身份行（气泡上方）挪到气泡下方，
                      对标 Claude Code——回复读完才看到"复制/反馈/评分"，不与身份行的
                      名字/角色/时间抢视觉重量。逐条复制对人类消息也一直可用（V3 原意
                      不分 isAgent），挪位时不能把它一并锁进「只对 AI 消息渲染」——
                      只有反馈按钮和评分这两个 AI 专属动作才挂在 isAgent 判断下面。
                      hover/键盘聚焦显形规则不变，`group` 仍挂在最外层 `<li>` 上。
                    */}
                    <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                      {/*
                        FB-2 —— 对「这个 agent 本身」提反馈（与同一行上的 👍/👎 不是一件事）。

                        ⚠ 消息级 👍/👎（F176）答的是「这一条回答好不好」；这个按钮答的是
                          「这个 agent 老是漏掉附件」这类跨很多条消息、需要正文的话。
                          两者都留，是因为它们在下游走两条不同的路：前者聚合成满意度与改进建议，
                          后者直接进分诊队列（`components/feedback/feedback-button.tsx` 头注）。

                        ⚠ 只在 `message.agentId` 非空时渲染，且传的是「真实 agent id」，
                          不是显示名。显示名会改，反馈要能一直对上同一个 agent。
                      */}
                      {isAgent && message.agentId !== null && (
                        <FeedbackButton
                          target={{ kind: "agent", agentId: message.agentId }}
                          targetLabel={agentLabel(message.agentId, agents)}
                          testid="chat-agent-feedback"
                          className="invisible transition-opacity focus-visible:visible group-hover:visible"
                        />
                      )}
                      {/*
                        V3 —— 逐条复制。hover 出现（`opacity-0 group-hover`），键盘聚焦时也
                        显形（`focus-visible:opacity-100`）保证键盘可达；复制后 2 秒内显对勾。
                        对人类消息也画（此前一直如此，挪位不改这条）。
                      */}
                      <button
                        type="button"
                        data-testid="chat-message-copy"
                        data-message-id={message.id}
                        aria-label="复制消息"
                        title="复制消息"
                        onClick={() => void handleCopyMessage(message)}
                        className="ml-0.5 inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors duration-fast invisible hover:bg-muted hover:text-card-foreground focus-visible:visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:visible"
                      >
                        {copiedMessageId === message.id ? (
                          <Check aria-hidden className="h-3 w-3 text-primary" />
                        ) : (
                          <Copy aria-hidden className="h-3 w-3" />
                        )}
                      </button>
                      {/*
                        F176 —— 👍/👎 只画在 AI 消息上，且只画在「已经写回、有 agent_run」的消息上。

                        ⚠ 两个条件缺一不可：
                        · `isAgent`——人自己说的话没有 agent 可归因，服务端会 404；
                        · `agentRunId`——早于 `chat_messages.agent_run_id` 的历史消息
                          同样归不了因。给它画一个点了必然失败的按钮，比不画更糟。
                      */}
                      {isAgent && message.agentRunId ? <MessageRating messageId={message.id} /> : null}
                    </div>
                    {/* #946 · V9-a F152：消息挂的附件（listMessages 投影）。#1584 起点击可预览/下载。 */}
                    {message.attachments && message.attachments.length > 0 ? (
                      <MessageAttachments attachments={message.attachments} threadId={threadId} />
                    ) : null}
                    {/* UI 评分 2026-08-23 第 10 项不一致②：这个入口曾同时挂在用户
                        气泡下（右对齐悬浮），语义错位——落地为产物的对象是 agent 的
                        产出，不是用户自己的话。只挂 agent 消息。 */}
                    {canLandArtifacts && isAgent ? (
                      <MessageLandingControls
                        message={message}
                        state={landing.stateFor(message.id)}
                        onOpen={() => landing.open(message)}
                        onTitleChange={(title) => landing.updateTitle(message.id, title)}
                        onCancel={() => landing.cancel(message.id)}
                        onSubmit={() => void landing.submit(message)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
            {/* UI 复评 2026-08-23：run 过程区（计划/审批/工具链）从瞬态气泡里独立
                出来——此前挂在流式草稿 li 与等待动画 li 内，streamingText 一清/等待
                一结束就整块蒸发：规划条在终态消失、计划永远看不到 3/3（第 2 项判 0
                的第三条依据）。现在只要本轮 run 的观测还在（含终态），过程区就在。
                换线程/新提交时 runObservation 置 null，自然收场。 */}
            {/*
              issue #1907（用户 devapp 截图报告「通用助手出现了两次」）——run 还没
              有任何 `tool_call` step、也不在 awaiting_approval/failed 时，
              `AgentPlanPanel`/`AgentApprovalPanel` 都返回 null，这条过程区唯一的
              内容就是 `AgentToolChain` 在 running=true 时给出的兜底摘要「…正在
              执行…」（steps 非空但没有工具调用时）或者干脆是空的头像行（steps 为
              空，`AgentToolChain` 自己 `steps.length===0` 直接返回 null）。这两种
              情况下，同一个 in-flight run 已经由下面 `awaitingReply` 的「正在
              思考…已用 N 秒」占位行说清楚了「在跑，没卡死」——过程区在这个窗口
              不提供任何过程区独有的信息，只是同一件事被渲染成第二个 `<li>`，读
              起来像两个独立的助手响应块。这里加一道「有实质过程内容才渲染」的
              门槛：至少一次 `tool_call` step（覆盖 AgentToolChain 有话可说、以及
              AgentPlanPanel 依赖的 write_todos 调用本身就是一次 tool_call）、
              或者 awaiting_approval（承载审批卡片）、或者 failed（承载失败详情+
              重试入口）——这三种情况过程区都有「正在思考」占位给不出的独有信息，
              照常渲染；没有的时候只留一个进度块。
            */}
            {runObservation?.view
              && (runObservation.view.steps.some((s) => s.kind === "tool_call")
                  || runObservation.view.status === "awaiting_approval"
                  || runObservation.view.status === "failed")
              // 让位纪律：持久 agent 消息（resultMessageId）已渲染进列表后，过程区
              // 退场——计划/工具链由消息自己的 MessageThinkingChain/PlanPanel 承接
              // （同源 steps），双份同屏是评分卡第 10 项要抓的自相矛盾。落位**之前**
              // （含终态到 loadPage 完成的窗口）过程区留存，用户始终看得到 3/3。
              && !(runObservation.view.resultMessageId !== null
                   && messages.some((m) => m.id === runObservation.view!.resultMessageId)) ? (
              <li className="flex items-start gap-2.5" data-testid="chat-run-process-area">
                {/* 头像与身份行改用真实 agent 名（见上方 `activeAgentId` 头注），
                    不再写死「AI」——这一行、下面流式草稿行、终态持久消息行现在
                    读的是同一个 agentLabel(agentId, agents)，不会中途改口。 */}
                <div
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
                >
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex min-w-0 max-w-[85%] flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    <span className="font-medium text-card-foreground">{agentLabel(activeAgentId, agents)}</span>
                    {agentRoleLabel(activeAgentId, agents)}
                  </div>
                  <AgentPlanPanel steps={runObservation.view.steps} />
                  <AgentApprovalPanel view={runObservation.view} sessionToken={bearer} />
                  <AgentToolChain
                    steps={runObservation.view.steps}
                    running={!isTerminalRunStatus(runObservation.view.status)}
                    runFailed={runObservation.view.status === "failed"}
                  />
                  {/*
                    UI 评分 2026-08-23 第 7 项修复（回归）——失败此前只在 composer 下方
                    一行裸错误码里出现，消息流里这条 agent 行完全没有任何失败呈现，
                    工具折叠头（上面 `AgentToolChain`）如果没有失败的工具调用还会继续
                    显示绿色 ✓。这里把失败态挂进这条 agent 行本身：人读文案（不是
                    `MODEL_CALL_FAILED` 这类稳定枚举，那个原样进了 `title`）+ 可点击的
                    重试入口。`AgentRunStatus`（composer 下方）保留一份摘要用于扫读，
                    但完整的失败呈现首先在这里，不是只在这里之外。
                  */}
                  {runObservation.view.status === "failed" ? (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2"
                      data-testid="chat-run-process-failure"
                    >
                      <p className="text-11 text-destructive" title={runObservation.view.error ?? undefined}>
                        {describeAgentRunError(runObservation.view.error)}
                      </p>
                      <Button
                        size="xs"
                        variant="outline"
                        data-testid="chat-run-process-failure-retry"
                        disabled={retrying}
                        onClick={() => void retryFailedRun()}
                      >
                        <RefreshCw aria-hidden className="h-3 w-3" />
                        {retrying ? "重试中…" : "重试"}
                      </Button>
                    </div>
                  ) : null}
                  {retryFailure ? (
                    <p className="text-11 text-destructive" data-testid="chat-run-process-retry-error">
                      {retryFailure}
                    </p>
                  ) : null}
                </div>
              </li>
            ) : null}
            {streamingText !== "" ? (
              // #654 阶段2d —— 逐 token 追加的草稿气泡。刻意不是 `chat-message-row`
              // 这个 testid：它不是一条持久消息（没有 `message.id`，刷新即消失），
              // 断言脚本不该把它误认成 #413 写回的那一条。终态一到（上面的流式
              // effect）它立刻清空，被 `loadPage` 重读出来的真正持久消息接管。
              <li
                className="flex items-start gap-2.5"
                data-testid="chat-message-row-streaming"
                data-run-id={activeRunId}
              >
                <div aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1 items-start">
                  <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    {/* 同 `activeAgentId`——不再写死「Agent」，与过程区/终态消息用同一份身份 */}
                    <span className="font-medium text-card-foreground">{agentLabel(activeAgentId, agents)}</span>
                    {agentRoleLabel(activeAgentId, agents)}
                    <Badge tone="outline">正在生成…</Badge>
                  </div>
                  {/* 2026-08-14 重做：在途 run 的工具调用链也挂在这条流式气泡自己身上，
                      不再挂在 composer 下方——同一条 run 落库后接力给 `MessageThinkingChain`
                      （上面持久消息那条），视觉位置不因"是否还在流式中"而跳动。 */}
                  <div className="rounded-2xl rounded-tl-sm bg-panel px-3.5 py-2.5 text-12 leading-relaxed text-card-foreground">
                    {/* 同一个 MarkdownMessage——流式草稿与落库后的最终消息渲染路径不该是两套。
                        流式期间未闭合的 ```mermaid 围栏不会被 extractMermaidBlocks 命中，故先当
                        markdown 文本渲染，围栏闭合（```）后才成图，不会在打字途中闪错误态。 */}
                    <MarkdownMessage text={streamingText} />
                  </div>
                </div>
              </li>
            ) : null}
            {awaitingReply ? (
              // 发送后等待动画——对标 Claude Code 的 thinking 指示。与流式草稿气泡互斥
              // （`streamingText === ""` 才走这里），与 V4 首载骨架也不同（那是读历史，
              // 这是等本轮回复）。三颗错峰脉动的点 = 明确的"系统在想，没卡死"信号。
              <li
                className="flex items-start gap-2.5"
                data-testid="chat-message-row-thinking"
                data-run-id={activeRunId}
              >
                <div aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1 items-start">
                  <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    {/* 同 `activeAgentId`——不再写死「Agent」，与过程区/终态消息用同一份身份 */}
                    <span className="font-medium text-card-foreground">{agentLabel(activeAgentId, agents)}</span>
                    {agentRoleLabel(activeAgentId, agents)}
                    <Badge tone="outline">正在思考…</Badge>
                    {/*
                      gap ②：已耗时。⚠ 它每秒在动 —— "会动"本身就是"没卡死"的证据，
                      而一句静止的「正在思考…」在第 10 秒和第 10 分钟长得一模一样。
                    */}
                    {runStartedAt !== null ? (
                      <span data-testid="chat-thinking-elapsed">
                        已用 {Math.max(0, Math.floor((nowTick - runStartedAt) / 1000))} 秒
                      </span>
                    ) : null}
                    {/*
                      gap ⑧（人类 2026-08-22 devapp 实测）：只有一句笼统的
                      「正在思考…已用 N 秒」，长任务中途看不出卡在哪一步。这里读
                      `runObservation.view.steps` 最新一条（无新接口，`AgentToolChain`
                      /`AgentPlanPanel` 就在吃同一个数组）翻译成用户可读阶段文案，
                      与计时器并列——计时器留着答"卡没卡死"，这句答"卡在哪一步"。
                    */}
                    {runPhaseLabel !== null ? (
                      <span data-testid="chat-thinking-phase">· {runPhaseLabel}</span>
                    ) : null}
                    {/*
                      gap ③：挂了 skill 的这轮可能要跑好几分钟（沙箱单次 120s ×
                      最多 3 次重试）。不给预期，用户会在第 2 分钟就以为它坏了。
                      ⚠ 只在真的挂了 skill 时才说"执行 skill 脚本"——issue #1803
                      gap #4（devapp 实测）：此前这句话只看耗时不看
                      `hasMountedSkills`，没挂 skill 的普通问答/Deep Research 线程
                      跑够 45 秒也会显示，误导用户以为在等 skill 脚本。没挂 skill
                      时换成不特指 skill 的通用措辞，而不是整行隐藏——耗时久这件事
                      本身对任何线程都是真的，只是"为什么久"的归因不该乱猜。
                    */}
                    {runStartedAt !== null && (nowTick - runStartedAt) > 45_000 ? (
                      <span data-testid="chat-thinking-longrun-hint">
                        · {hasMountedSkills ? "执行 skill 脚本时可能需要数分钟" : "复杂任务可能需要数分钟"}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-panel px-3.5 py-3"
                    role="status"
                    aria-label="正在思考，请稍候"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:200ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:400ms]" />
                  </div>
                </div>
              </li>
            ) : null}
          </ol>
        ) : null}
        {nextCursor ? (
          <div className="mt-3 flex justify-center">
            <Button
              size="xs"
              variant="outline"
              data-testid="chat-messages-load-more"
              disabled={loadingMore}
              onClick={() => void loadPage(nextCursor, "append")}
            >
              {loadingMore ? "正在加载…" : "加载更早之后的消息"}
            </Button>
          </div>
        ) : null}
        {/*
          V5（PROP-CHAT-10ITER-001）—— jump-to-latest 悬浮按钮。仅当用户上滚离开底部
          （`showJumpToLatest`）时出现，点击平滑滚到底。条件渲染而非 visibility 切换：
          不在底部时它才存在，避免常驻挡内容，也让 e2e 能用存在性断言（`toHaveCount`）
          确定性验证显隐。

          2026-08-19 重新定位（人类实测反馈 #1589：悬浮在 composer 上方一段空白里，位置
          奇怪，还会被建议回复 chips 行/输入框顶到）——`absolute bottom-24`（对整个面板
          定位、手拍的固定偏移量）换成 `sticky bottom-2`，挂在「消息滚动容器内部」
          右下角，不再是"对整个 chat-live-message-panel 定位、猜 composer 有多高"：
          composer 变几行（chips 行/agent 选择器行有无）都不影响它，因为它现在锚定的是
          自己所在的滚动视口边缘，不是面板底部。sticky 元素跟随滚动内容留在文档流里，
          天然不会盖住 composer（composer 是滚动区外的 sibling，不在同一层叠上下文里
          打架），此前 #1267 那次"z-index 顶牛"修法因此也不再需要。
        */}
        {showJumpToLatest ? (
          <div className="pointer-events-none sticky bottom-2 z-10 flex justify-end pr-1">
            <Button
              size="xs"
              variant="outline"
              data-testid="chat-jump-to-latest"
              aria-label="回到最新消息"
              title="回到最新消息"
              className="pointer-events-auto rounded-full shadow-md"
              onClick={scrollToLatest}
            >
              <ArrowDown aria-hidden className="mr-1 h-3.5 w-3.5" />
              回到最新
            </Button>
          </div>
        ) : null}
      </div>

      {aboveComposer}
      <div className="border-t border-border p-3" data-testid="chat-composer">
        {archived ? (
          <p className="mb-2 text-12 text-muted-foreground" data-testid="chat-composer-archived">
            该对话已归档，只能读取，不能创建消息或运行。
          </p>
        ) : (
          /*
            D8（chat-main-fidelity-rubric.md）—— 输入区顶部上下文行。参照图要求
            「参与 agent 头像串 + skill + 已引用上下文 + 输出落点 + 更多设置」五项，
            这里只接了有真实数据支撑的三项，如实标注剩余两项的数据缺口，不伪造：
            - 参与 agent 头像串：复用编制 `agents`（与线程头部同一份数据）。
            - skill：`hasMountedSkills` 是调用方已经从 `listThreadMounts` 读到的真实
              布尔值（同一事实源，见该 prop 的文档注释）——这里只显示"是否挂了"，
              不显示具体名字，避免在没有名字解析管线的前提下编一个名字出来。
            - 已引用上下文：`attach.attachments.length`——composer 当前草稿真实挂着
              的附件数（下一条消息真的会带着它们发出去），不是猜测值。
            - 「输出落点」（参照图"输出落到「假设树」"）：本仓没有"技能结构化输出槽位"
              这个概念（`landAsArtifact` 是通用落地动作，不挂靠具体技能的输出契约），
              没有真实数据源，不在这里画一个假的落点选择器——已开 data-gap issue 跟踪。
            - 「更多设置」：暂无可配置项，显式禁用 + 说明（同「分享」按钮的既有纪律：
              宁可显式禁用并说明，也不放一个点了没反应的按钮）。
          */
          <div
            className="mb-2 flex flex-wrap items-center gap-2 text-10 text-muted-foreground"
            data-testid="chat-composer-context-line"
          >
            {agents && agents.length > 0 ? (
              <span className="flex items-center -space-x-1" aria-hidden data-testid="chat-composer-context-agents">
                {agents.slice(0, 4).map((agent) => (
                  <Avatar key={agent.id} initials={agent.abbr} tone="ai" size="sm" className="ring-1 ring-background" />
                ))}
              </span>
            ) : null}
            {hasMountedSkills ? (
              <span className="inline-flex items-center gap-1" data-testid="chat-composer-context-skill">
                <Wrench aria-hidden className="h-3 w-3" />已挂载 skill
              </span>
            ) : null}
            {attach.attachments.length > 0 ? (
              <span className="inline-flex items-center gap-1" data-testid="chat-composer-context-attachments">
                <Paperclip aria-hidden className="h-3 w-3" />已引用 {attach.attachments.length} 项上下文
              </span>
            ) : null}
            <span className="flex-1" />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled
              title="更多设置尚未接入（暂无可配置项）"
              data-testid="chat-composer-context-more"
            >
              <MoreHorizontal aria-hidden className="h-3 w-3" />更多设置
            </Button>
          </div>
        )}
        {/*
          #728 P10 —— 无 agent 可选时，整个composer 的「发送类」控件（追问建议 / 麦克风）
          此前只看 `archived`/`submitting`，不看「有没有 agent 可以发」，于是在
          「没有可选 Agent」的线程上仍摆着一排看起来能点的按钮——点了却送不出去
          （提交按钮是唯一正确处理了这个状态的控件：`selectedAgentId === ""` 时禁用）。
          评分卡第 10 项点名的「假按钮」正是这个。

          `noAgentToRunWith` 与提交按钮用的是同一个事实（`agents` 为空数组），
          不是另起一条判断——两处判据不一致才是真正的风险。
        */}
        {followUpSuggestions.length > 0 && !noAgentToRunWith ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="chat-followup-suggestions">
            {followUpSuggestions.map((suggestion) => (
              <Button
                key={suggestion.id}
                type="button"
                size="xs"
                variant="outline"
                className="rounded-full"
                data-testid={`chat-followup-suggestion-${suggestion.id}`}
                disabled={submitting}
                onClick={() => updateDraft({ text: suggestion.text })}
              >
                {suggestion.text}
              </Button>
            ))}
            {/*
              真实建议还在路上：兜底 chip 已经先展示了（上面 map 出来的那些），这里只是
              明确告诉用户「这批不是最终结果」——不是没有建议，是还在等更贴合这轮对话的。
              端点失败/超时时这个指示会随 `followUpSuggestionsPending` 变 false 一起消失，
              兜底 chip 留在原地，不留下一个转不动的假加载态。
            */}
            {followUpSuggestionsPending ? (
              <span
                className="inline-flex items-center gap-1 text-10 text-muted-foreground"
                data-testid="chat-followup-suggestions-loading"
              >
                <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                正在生成更贴合的建议…
              </span>
            ) : null}
          </div>
        ) : null}
        {/* #946 · V9-a F152：就地报错横幅（超大小 / 非白名单 / 超数量），不静默丢弃。 */}
        {archived ? null : <ChatAttachmentBanner banner={attach.banner} />}
        {/*
          #1492 —— 拖拽落区不再局限于这个小盒子：drag 状态/事件已经挂到整个面板根容器
          （对标 Codex，拖到消息列表区域也生效），这里只保留附件预览条本身。
          border 不再随 dragActive 变化——高亮反馈交给面板级的 ChatFullSurfaceDropOverlay。
        */}
        <div className="relative rounded-2xl border border-border-subtle bg-card p-1.5 shadow-sm">
          {archived ? null : <ChatAttachmentList ctl={attach} disabled={submitting} />}
          <Textarea
            ref={composerRef}
            data-testid="chat-message-input"
            aria-label="消息内容"
            placeholder="输入要持久保存并交给所选 Agent 的消息，或把文件拖进来一起发送"
            value={text}
            disabled={archived || submitting}
            onChange={(event) => {
              updateDraft({ text: event.target.value });
              recomputeMentions(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={handleComposerKeyDown}
            onKeyUp={(event) => recomputeMentions(event.currentTarget.value, event.currentTarget.selectionStart)}
            onClick={(event) => recomputeMentions(event.currentTarget.value, event.currentTarget.selectionStart)}
            className="min-h-16 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0"
          />
          {/*
            `@` 引用本线程已上传过的文件——纯前端下拉，选中即把文件名插进正文
            （见上方状态注释）。没有匹配项时如实显示空态，不隐藏整个下拉——
            用户需要知道"@ 打对了但这个词没匹配到"和"@ 还没打完"的区别。
          */}
          {attachmentMention ? (
            <div
              className="mx-1.5 mb-1 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-2"
              data-testid="chat-attachment-mention-picker"
            >
              <span className="text-9 text-muted-foreground" data-testid="chat-attachment-mention-query">
                @ {attachmentMention.query}
              </span>
              {threadAttachmentOptions.length === 0 ? (
                <span className="text-11 text-muted-foreground" data-testid="chat-attachment-mention-pool-empty">
                  这条线程还没有可引用的附件。
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
          {/*
            #728 —— 人类指示（Claude Code 参照）：加 skill / 选 Agent 都收进和麦克风
            同一行、靠左；发送按钮只留图标。默认要有一个 agent，不需要用户手动选——
            这条已经在 `selectedAgentId` 的推导里满足（`agents?.[0]?.id`），本次
            只是把选择器从独立一行搬下来、做紧凑，不改选择逻辑本身。

            个人对话没有「加 skill」（`ChatSkillMountPanel` 只在项目对话侧挂载，
            人类这轮明确说项目对话先不做）——这里先只放 Agent 选择器，skill 入口
            留给项目对话那一轮再接进来，不在两边都不存在的东西上造一个空位。
          */}
          {/* issue #2248（P0，实测 SHA 014a47d9）—— 375/768 两档视口下这一行此前是纯
              `flex justify-between`（不换行、子项也不收缩）：左侧「Agent 选择器 + 📎 +
              生成用户画像」与右侧「麦克风设备下拉 + 麦克风 + 发送」合计宽度在窄屏下
              超过可用宽度，flex 子项默认不收缩到内容宽度以下，于是整行内容宽度超出
              容器——右侧发送按钮被真实挤出视口（375 档完全在屏外，768 档发送按钮圆形
              被切一半），不是视觉裁切，是主操作不可达。
              加 `flex-wrap` 让这一行在放不下时真实换行（左侧分组整体掉到第二行），
              发送按钮所在的右侧分组作为一个整体要么完整留在第一行、要么完整掉到
              下一行，不会被沿途裁断；右侧分组另加 `shrink-0` 兜底，即使换行后同一行
              仍放不下左右两组，也优先保住发送/麦克风不被压缩变形。 */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1.5 pb-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <AgentPicker
                agents={agents}
                selectedAgentId={selectedAgentId}
                disabled={archived || submitting || agents === null || agents.length === 0}
                onSelect={(agentId) => updateDraft({ agentId })}
              />
              {/* #946 · V9-a F152：📎 附件按钮 + 计数（接真实上传端点）。 */}
              <ChatAttachmentButton ctl={attach} disabled={archived || submitting} />
              {/*
                G2「生成用户画像」（design-delta chat-persona-roundtrip，签核选 A：
                composer 状态条动作）。渲染门与「落地为产物」同一个能力事实
                （canLandArtifacts）：persona-summary 内部走同一条 landAsArtifact
                写权门，观察者/个人线程摆这个按钮就是一枚必 403 的假按钮。
                空线程没有锚点消息可传（契约 in.messageId 必传），禁用而不是隐藏——
                用户能看见入口存在，也能看懂为什么现在点不了（title 说明）。
              */}
              {canLandArtifacts ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="chat-persona-summary-trigger"
                  disabled={archived || personaRunning || messages.length === 0}
                  title={messages.length === 0 ? "线程里还没有消息，无法生成画像" : "扫描整个线程，生成用户画像"}
                  onClick={() => void runPersonaSummary()}
                >
                  {personaRunning ? "生成画像中…" : "生成用户画像"}
                </Button>
              ) : null}
              {personaFailure ? (
                <span className="text-11 text-destructive" data-testid="chat-persona-summary-error">
                  {personaFailure}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/*
                realtime-asr 增补 A（contract.md §7）：麦克风设备下拉，紧挨麦克风按钮。
                录音中禁用——切设备要重起采音管线，不在本增补范围（§7.4 只排除了
                hold-to-record，切设备的中途重连同样留给后续），录音中就先锁住。
              */}
              <MicDevicePicker
                devices={micDevices.devices}
                selectedDeviceId={micDevices.selectedDeviceId}
                disabled={archived || submitting || speech.listening || speech.connecting || speech.stopping}
                onSelect={micDevices.select}
              />
              <Button
                type="button"
                size="icon"
                variant={speech.listening ? "destructive" : "outline"}
                // 人类反馈（devapp 实测）：麦克风按钮录音中整体闪烁（`animate-pulse` 让
                // 按钮本体+图标反复淡入淡出）体验差。录音态已经靠实心红底
                // （`variant="destructive"`）+ 下方 `chat-mic-listening` 那颗小红点
                // 表达"正在录音"，按钮本身不需要再动——去掉闪烁，按钮保持稳定的实心红。
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
                title={
                  noAgentToRunWith ? "没有可选 Agent，暂时无法发送消息"
                    : speech.connecting ? "正在连接语音识别…"
                    : speech.stopping ? "正在停止…"
                    : speech.listening ? "停止语音输入" : "开始语音输入"
                }
                // #726 real-upstream 补丁（devapp 实测「反应半天」「停不下来」）：connecting/
                // stopping 期间禁用——那段真实网络延迟里再点一下不该起第二条采音管线，也
                // 不该在还没停干净时又开始一条新的（`use-asr-draft.ts` 的 stoppingRef 是
                // 第二道防线，这里是第一道：UI 本身就不让点）。
                disabled={archived || submitting || noAgentToRunWith || speech.connecting || speech.stopping}
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
              >
                {speech.connecting || speech.stopping ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mic aria-hidden className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                type="button"
                size="icon"
                className="rounded-full"
                data-testid="chat-message-submit"
                aria-label={submitting ? "发送中" : "发送并排队"}
                title={
                  attach.hasUploading
                    ? "附件上传中，请稍候…"
                    : (submitting ? "发送中…" : "发送（Enter；Shift+Enter 换行）")
                }
                disabled={archived || submitting || attach.hasUploading || text.trim() === "" || selectedAgentId === ""}
                onClick={() => void submit()}
              >
                <Send aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {/*
            2026-08-14 人类实测反馈：这条常驻免责声明式提示（#728 第 8 轮 P10 加的）是多余的——
            它描述的行为约束（回复是服务端真实 run 写回，不是本地伪造）本就没有反例会让用户
            怀疑，常驻占一行纯噪音。约束本身没变，只是不再需要一直印在界面上说给用户看；
            `tests/ui/chat-read-screen.test.tsx`/`e2e/chat-read.spec.ts` 两处依赖这段文案的
            断言随本次改动一并删除（不是改文案，是这条提示整个不再存在）。
          */}
        </div>
        {speech.connecting ? (
          // #726 real-upstream 补丁——真实上游握手（麦克风权限弹窗 + WS 连接）不是 0 秒，
          // 这段等待期界面必须说话，不能沉默（devapp 实测反馈「点了反应半天」正是这段空窗）。
          <p className="mt-2 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="chat-mic-connecting">
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            正在连接语音识别……
          </p>
        ) : null}
        {speech.listening ? (
          // #726 —— 转录进行中的可见反馈："正在听"，不是静默录音。文字实时通过
          // `onTranscript` 写回 `text`（见上面 `updateDraft` 的调用），这里只是状态提示。
          <p className="mt-2 flex items-center gap-1.5 text-11 text-destructive" data-testid="chat-mic-listening">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
            正在听……实时转录中，说完点击麦克风按钮停止，确认无误后再手动发送。
          </p>
        ) : null}
        {speech.stopping ? (
          // 同上：`handle.stop()` 要等上游确认收尾（最多 15 秒，见
          // `configured-realtime-asr-provider.ts` 的 `FINISH_GRACE_MS`），这段时间界面
          // 必须说"正在停止"，不能让按钮变灰之后界面就没有任何进一步的反馈了。
          <p className="mt-2 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="chat-mic-stopping">
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            正在停止……等待最后一段转录落定。
          </p>
        ) : null}
        {speech.error !== null ? (
          <p className="mt-2 text-11 text-destructive" data-testid="chat-mic-error">
            {speech.error}
          </p>
        ) : null}
        {/*
          2026-08-19 人类实测反馈（#1589）：`消息已持久化，AgentRun 已排队。` 这一行 +
          紧跟着的 `AgentRunStatus`（`正在执行`/…）读起来是同一件事说了两遍——`queuedRun`
          与 `runObservation` 在提交后几乎同一时刻都非空（`submit()` 拿到 202 就立刻两个
          都置了值，中间没有只有前者的可观察窗口），不是"排队中"到"执行中"两个先后
          阶段，纯粹是同一条状态的重复文案。`data-testid="chat-message-queued"` 曾经
          承担的机器可断言职责（"服务端已确认持久化+建了 run"）完全被
          `chat-live-agent-run-status` 的 `data-run-id` 覆盖，删掉这一行不丢信息，
          只是不再对人眼说两遍。保留 `queuedRun` 这个 state 本身（`submitting` 等
          别处逻辑仍要用），只是不再渲这段文字。
        */}
        {runObservation ? <AgentRunStatus observation={runObservation} /> : null}
        {submitFailure ? (
          <div className="mt-2" data-testid="chat-message-submit-error">
            <FailureState message={submitFailure} onRetry={() => void submit()} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * agent 的显示名。从编制（`getAgentPanel` 的结果）里查，查不到回落到 id。
 * ⚠ 回落**不是**糊成「Agent」：查不到通常意味着它已被移出编制，糊掉会让这件事不可见。
 */
function agentLabel(agentId: string | null, agents: GetAgentPanelOut["agents"] | null): string {
  if (agentId === null) return "Agent";
  return agents?.find((a) => a.id === agentId)?.name ?? agentId;
}

/**
 * agent 的角色 chip。编制里没有这个 agent 时不渲染 —— 不编一个角色出来。
 *
 * #1705（#728 D-1，人类裁决 2026-08-21）—— 这里原来印的是 `duty`（一句话能力描述，
 * 偏长）；D5 身份行的 chip 应该是短头衔，改成 `roleLabel`（同 D2 编制区第一行用的
 * 同一个字段，「Ava · 战略分析师」的后半段），`duty` 那句能力描述留在 D2 编制区
 * 第二行，不在消息气泡这种寸土寸金的行内重复。
 */
function agentRoleLabel(
  agentId: string | null,
  agents: GetAgentPanelOut["agents"] | null,
): React.ReactNode {
  const roleLabel = agentId === null ? undefined : agents?.find((a) => a.id === agentId)?.roleLabel;
  return roleLabel ? <Badge tone="ai">{roleLabel}</Badge> : null;
}

const EMPTY_SKILL_MOUNTS: readonly ThreadSkillMount[] = [];
const EMPTY_SKILL_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * D5（chat-main-fidelity-rubric.md）—— agent 消息身份行的 skill chip。
 *
 * ⚠ 这不是"当前挂了什么"（那是 `hasMountedSkills` 在别处做的事），是"这条消息
 * **发出那一刻**哪个 skill 处于挂载状态"——挂载会被摘除（`removedAt`），把"现在"
 * 的挂载状态套在一条历史消息上会在摘除后变成误导（消息底下印着一个此刻已经不在
 * 挂载列表里的 skill 名字，像是编出来的）。用消息 `createdAt` 落在哪个挂载的
 * `[mountedAt, removedAt)` 时间窗里来判定，是这条消息发出时**真实**处于挂载状态
 * 的 skill，不是近似值。
 *
 * 同一时刻可能有多个 skill 同时挂载——参照图一次只示范一个，这里也只取第一个匹配
 * （按 `mountedAt` 最早的），不在寸土寸金的身份行里塞一整串。
 *
 * 找不到匹配挂载、或该 skill 的名字还没解析出来（`skillNames` 里没有）时不渲染——
 * 不编一个名字出来，也不回落显示裸 `skillId`（那对用户没有意义，且会被误认成又
 * 一个"查不到就显示原值"的角色 chip）。
 */
function agentSkillLabel(
  createdAt: string,
  skillMounts: readonly ThreadSkillMount[],
  skillNames: ReadonlyMap<string, string>,
): React.ReactNode {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return null;
  const active = skillMounts
    .filter((mount) => {
      const mountedAt = Date.parse(mount.mountedAt);
      if (Number.isNaN(mountedAt) || mountedAt > at) return false;
      if (mount.removedAt === null) return true;
      const removedAt = Date.parse(mount.removedAt);
      return Number.isNaN(removedAt) ? true : removedAt > at;
    })
    .sort((a, b) => Date.parse(a.mountedAt) - Date.parse(b.mountedAt))[0];
  if (!active) return null;
  const name = skillNames.get(active.skillId);
  if (!name) return null;
  return <Badge tone="neutral">skill: {name}</Badge>;
}

/**
 * 「时:分」。⚠ 刻意不做「几分钟前」：那会让同一条消息在两次渲染间文字不同，
 * 截图比对与快照测试都会因此抖动，换来的信息量为零。
 */
function messageTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * #435 —— AgentRun 的可见状态。**这是闭环第 8 步在界面上的唯一交付物。**
 *
 * ## 为什么 testid 叫 `chat-live-agent-run-status`
 *
 * 跟随本组件既有的 `chat-live-*` 前缀（本文件 :137 的 `chat-live-message-panel`），
 * 不另造一套命名。`core-loop.spec.ts` 曾断言一个叫 `chat-agent-run-status` 的东西，
 * 那个名字**在整个 `apps/web` 里从不存在** —— 于是步骤 8b 从写下那天起就恒红，
 * 而且红得不是因为 agent 没跑，是因为断言锚在虚空上。同型事故这是第五次。
 *
 * ## 状态取自服务端，不取自本地推断
 *
 * `data-run-status` 直接来自 `GET /agent-runs/:runId` 的 `status` 字段，
 * 是契约状态机的原值（`queued|running|writeback_pending|succeeded|failed`）。
 * 断言方因此可以判「跑到终态了」，而不是判「前端以为它跑完了」。
 *
 * `data-result-message-id` 只在 #413 的写回事务提交后才非空
 * （`wave2-runtime.ts:195` 原文：Non-null only once #413's writeback transaction has
 * committed）。它是「恰好一条回复真的落库了」在 DOM 上的投影。
 */
function AgentRunStatus({ observation }: { observation: RunObservation }) {
  const { runId, view, failure, timedOut, authExpired } = observation;
  const status: AgentRunStatus | null = view?.status ?? null;
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5 text-11"
      data-testid="chat-live-agent-run-status"
      data-run-id={runId}
      // 读不到状态时**不填**这个属性，而不是填一个猜的值。
      data-run-status={status ?? undefined}
      data-result-message-id={view?.resultMessageId ?? undefined}
      data-run-error={view?.error ?? undefined}
      // issue #1819 —— 401 是「不可恢复，需重新登录」，与其它可重试失败区分开，
      // 好让测试/未来 UI 不必靠正则匹配文案来判断是不是这一种终态。
      data-run-auth-expired={authExpired || undefined}
    >
      {failure !== null ? <span className="text-destructive">{failure}</span> : null}
      {failure === null && status === null ? (
        <span className="text-muted-foreground">正在读取 AgentRun 状态…</span>
      ) : null}
      {status !== null ? <span className={statusTone(status)}>{RUN_STATUS_TEXT[status]}</span> : null}
      {/*
        UI 评分 2026-08-23 第 7 项修复——这里此前直接印 `view.error` 的原值
        （如「（MODEL_CALL_FAILED）」），是仅供排障的稳定枚举，不是给用户看的话。
        `describeAgentRunError` 换成人读文案，原始 code 仍在 `title`（悬停/读屏可达，
        不是被抹掉）。完整的失败呈现（含重试入口）在消息流那条 agent 行本身
        （`chat-run-process-failure`），这里是扫读摘要，两处不重复渲染重试按钮。
      */}
      {view?.error ? (
        <span className="text-destructive" title={view.error}>（{describeAgentRunError(view.error)}）</span>
      ) : null}
      {timedOut ? (
        // 超时 ≠ 失败。run 可能还在服务端跑，界面只说自己没等到。
        <span className="text-muted-foreground">本页面已停止轮询，运行可能仍在继续。</span>
      ) : null}
    </div>
  );
}

const RUN_STATUS_TEXT: Record<AgentRunStatus, string> = {
  queued: "已排队，等待执行",
  running: "正在执行",
  writeback_pending: "已产出，正在写回对话",
  awaiting_approval: "等待你的批准（见上方审批卡）",
  succeeded: "执行完成，回复已写入对话",
  failed: "执行失败",
};

function statusTone(status: AgentRunStatus): string {
  if (status === "failed") return "text-destructive";
  if (status === "succeeded") return "text-primary";
  return "text-muted-foreground";
}

/*
 * issue #2050 —— 「落地为产物」的状态机 + 展示件已抽到
 * `@/components/chat/message-landing`，本文件不再私有一份：CopilotKit v2 轨道
 * （`copilotkit-v2-panel.tsx`）现在也要这个能力，抄第二份就是本仓硬约束点名的
 * 「同一事实声明在两处」。此处删除的是 `MessageLandingState`/`defaultArtifactTitle`/
 * `MessageLandingControls`/`LandedArtifactCard` 四个定义，**行为逐字未变**（新模块
 * 里的实现是原样搬迁，含 `mode:"draft"` 的既有理由与全部 `data-testid`）。
 */

/** 十项 UX 缺口第 6 项——建议 chip 的形状。`id` 只用于 `data-testid`/`key`，不是服务端概念。 */
interface FollowUpSuggestion {
  readonly id: string;
  readonly text: string;
}

/**
 * 规则驱动的「建议后续操作」（issue #712）。
 *
 * ⚠ 这**不是** AI 推荐——chat 后端没有任何建议引擎（调查见 issue #712），这里是
 *   纯前端的确定性规则，判据只有「最新一条消息的作者类别」「消息总数」
 *   「线程是否归档」三个已知量，不掺入任何模型调用。点击只**填充**输入框
 *   （复用 `updateDraft`），不自动发送——用户仍需手动确认并点击发送。
 *
 * 规则（按优先级）：
 *   1. 已归档 ⇒ 不建议（只读态，composer 本身已禁用）。
 *   2. 零消息 ⇒ 建议一条通用开场白。
 *   3. 最新一条来自 agent（刚回复完）⇒ 建议两条追问模板。
 *   4. 最新一条来自人类（发完在等 run）⇒ 不建议——避免在等待态堆无意义的 UI。
 */
function computeFollowUpSuggestions(
  messages: readonly DurableMessage[],
  archived: boolean,
): readonly FollowUpSuggestion[] {
  if (archived) return [];
  if (messages.length === 0) {
    return [{ id: "opener", text: "简要说明一下这次想解决的问题" }];
  }
  const latest = messages[messages.length - 1]!;
  if (latest.authorKind === "agent") {
    return [
      { id: "elaborate", text: "能否再详细说明一下？" },
      { id: "summarize", text: "谢谢，请总结一下要点" },
    ];
  }
  return [];
}

function appendUnique(current: DurableMessage[], incoming: DurableMessage[]): DurableMessage[] {
  const seen = new Set(current.map((message) => message.id));
  return [...current, ...incoming.filter((message) => !seen.has(message.id))];
}

function newClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function FailureState({
  testId,
  message,
  onRetry,
}: {
  testId?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2" data-testid={testId}>
      <p className="text-11 text-destructive">{message}</p>
      <Button size="xs" variant="outline" data-testid={testId ? `${testId}-retry` : "chat-message-submit-retry"} onClick={onRetry}>
        <RefreshCw aria-hidden className="h-3 w-3" />重试
      </Button>
    </div>
  );
}

// `describeMessageFailure` 本体移到 `@/lib/live-chat`（VZ-fabric 真实保存接线）：
// `chat-diagram-canvas-modal.tsx` 也要用它，而它经 `markdown-message.tsx` →
// `chat-diagram-fabric.tsx` 被本文件引入——若本体还留在本文件会成环
// （本文件→markdown-message→chat-diagram-fabric→chat-diagram-canvas-modal→本文件）。
// 这里保留一个**再导出**，让既有从本文件导入它的调用点（`chat-skill-mount-panel.tsx`、
// `chat-read-screen.test.tsx`）不必跟着改路径——再导出指向叶子模块，不构成新的环。
export { describeMessageFailure } from "@/lib/live-chat";
