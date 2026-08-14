"use client";

import * as React from "react";
import { ArrowDown, Bot, Check, Copy, Mic, RefreshCw, Send, UserRound } from "lucide-react";
// VZ-01 → live panel（coord 裁 ①+续刀）：活体 AI 消息渲染从 CopilotKit 的 Markdown
// 换成本仓 `MarkdownMessage`——同样渲 markdown，且识别 ```mermaid 围栏渲成图（白名单闸门 +
// 诚实错误态）。原型侧（ai-message.tsx）已随 #1020 落档，这里让它在**可达面**对用户生效。
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { AgentToolChain } from "@/components/chat/agent-tool-chain";
import { MessageThinkingChain } from "@/components/chat/message-thinking-chain";
import { MessageRating } from "@/components/chat/message-rating";
import {
  createMessage,
  describeMessageFailure,
  landAsArtifact,
  listMessages,
  pickDefaultAgentId,
  type CreateMessageInput,
  type DurableMessage,
  type GetAgentPanelOut,
} from "@/lib/live-chat";
import {
  getAgentRun,
  isTerminalRunStatus,
  type AgentRunStatus,
  type AgentRunView,
} from "@/lib/agent-run";
import { openAgentRunStream } from "@/lib/agent-run-stream";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChatAttachmentBanner,
  ChatAttachmentButton,
  ChatAttachmentDropzone,
  ChatAttachmentList,
  MessageAttachments,
  useChatAttachments,
} from "@/components/chat/chat-composer-attachments";

const MESSAGE_PAGE_SIZE = 50;

/**
 * #435 —— AgentRun 轮询的有界退避。
 *
 * 契约把 Wave 2 的 run 传输定为**轮询**并要求「有界退避 + 终态停止」
 * （`packages/contracts/src/wave2-runtime.ts:200-202`）。这三个常数就是那个「有界」：
 * 起步 400ms，每次 ×1.5，封顶 3s，总时长封顶 90s。
 *
 * ⚠ 超时**不等于**失败。超时只说明「本页面在这段时间内没等到终态」，
 * run 在服务端可能仍在跑。所以超时走 `timedOut` 分支显示「仍在进行」，
 * **不**伪造一个 `failed` —— 那会让界面对用户说谎。
 */
const RUN_POLL_FIRST_DELAY_MS = 400;
const RUN_POLL_BACKOFF = 1.5;
const RUN_POLL_MAX_DELAY_MS = 3_000;
const RUN_POLL_BUDGET_MS = 90_000;

interface SubmissionAttempt extends CreateMessageInput {
  readonly threadId: string;
}

/** 轮询到的 run 观测值。`view` 为 null 表示「还没读到第一份服务端状态」。 */
interface RunObservation {
  readonly runId: string;
  readonly view: AgentRunView | null;
  readonly failure: string | null;
  readonly timedOut: boolean;
}

export function ChatLiveMessagePanel({
  threadId,
  bearer,
  agents,
  archived,
  canLandArtifacts,
  onArtifactLanded,
  onRunSettled,
  aboveComposer,
}: {
  threadId: string;
  bearer: string;
  agents: GetAgentPanelOut["agents"] | null;
  archived: boolean;
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
}) {
  const sourceKey = `${threadId}\u0000${bearer}`;
  const [messages, setMessages] = React.useState<DurableMessage[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [listFailure, setListFailure] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  // #946 · V9-a F152：composer 附件（📎 / 拖拽 / 预览条 / 上传态 / 移除）。接真实上传端点。
  const attach = useChatAttachments({ threadId, bearer });
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
  const [runObservation, setRunObservation] = React.useState<RunObservation | null>(null);
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
  const [landingState, setLandingState] = React.useState<Record<string, MessageLandingState>>({});
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
    atBottomRef.current = atBottom;
    setShowJumpToLatest((current) => (current === !atBottom ? current : !atBottom));
  }, []);
  const scrollToLatest = React.useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);
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
  // 2026-08-14 devapp 实测根因（Deep Research 意外被选中导致长时间卡在"思考中"）+
  // 修法见 `pickDefaultAgentId` 自己的文档注释——纯函数抽到 `lib/live-chat.ts`，
  // 与 `describeMessageFailure` 同一理由：可独立单测，不用挂真实组件。
  const selectedAgentId = pickDefaultAgentId(agents, agentId);

  /**
   * V1 —— 新消息列表变化或流式 token 追加时，若用户还贴着底部就跟到底。
   * 依赖 `messages.length`（新持久消息）与 `streamingText`（逐 token 追加）两个信号；
   * `atBottomRef` 为 false（用户上滚了）时什么都不做。用 `requestAnimationFrame`
   * 等这一帧的 DOM 高度落定后再设 scrollTop，否则会滚到「加内容之前」的旧高度。
   */
  React.useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages.length, streamingText]);

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
      setMessages((current) => mode === "append" ? appendUnique(current, result.messages) : result.messages);
      setNextCursor(result.nextCursor);
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
  }, [bearer, threadId]);

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
    setRunObservation({ runId, view: null, failure: null, timedOut: false });

    const poll = async (delay: number): Promise<void> => {
      if (cancelled) return;
      let view: AgentRunView;
      try {
        view = await getAgentRun(runId, bearer);
      } catch (failure) {
        if (cancelled) return;
        // 读失败就如实说读失败。**不**把它渲染成一个 run 状态——
        // 「读不到 run」与「run 失败了」是两件事，混起来就是在界面上撒谎。
        setRunObservation({
          runId,
          view: null,
          failure: describeMessageFailure(failure, "读取 AgentRun 状态"),
          timedOut: false,
        });
        // ⚠ 读失败**不终止轮询**（预算耗尽才停）。一次 503 或网络抖动就把状态永久冻在
        //   「读取失败」上是错的：run 在服务端还跑着，界面却再也不会更新了。
        //   实测见过这个形态 —— 缺了 `/agent-runs` 的 rewrite 时，首次轮询就失败并
        //   就此停住，62 次断言重试读到的都是同一个冻住的 DOM。持续失败仍然会
        //   一直显示失败文案，所以「如实报错」没有被削弱。
        if (Date.now() >= deadline) return;
        timer = setTimeout(
          () => void poll(Math.min(delay * RUN_POLL_BACKOFF, RUN_POLL_MAX_DELAY_MS)),
          delay,
        );
        return;
      }
      if (cancelled) return;
      setRunObservation({ runId, view, failure: null, timedOut: false });
      if (isTerminalRunStatus(view.status)) {
        // 终态才重读消息页：写回是在 `writeback_pending` 之后才提交的，
        // 早读会读到一个还没有助手回复的列表，并且再也不会自己刷新。
        await loadPage(null, "soft"); // 终态重读：软换，不清空不弹骨架（#925 ② 消灭闪烁）
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
        setRunObservation({ runId, view, failure: null, timedOut: true });
        return;
      }
      timer = setTimeout(() => void poll(Math.min(delay * RUN_POLL_BACKOFF, RUN_POLL_MAX_DELAY_MS)), delay);
    };

    timer = setTimeout(() => void poll(RUN_POLL_FIRST_DELAY_MS), 0);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [activeRunId, bearer, loadPage]);

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
      } else if (event.type === "final" || event.type === "timeout") {
        // The persisted message list (via the status-poll effect's `loadPage`) is about
        // to become the single source of truth for this reply -- keeping the streamed
        // draft around after that would risk showing the SAME text twice for a moment.
        setStreamingText("");
      }
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

  // 十项 UX 缺口第 6 项（issue #712）——规则驱动的建议后续操作。
  const followUpSuggestions = computeFollowUpSuggestions(messages, archived);
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

  const submit = async () => {
    const normalizedText = text.trim();
    if (normalizedText === "" || selectedAgentId === "" || archived || submitting) return;
    // #946 · V9-a F152：有附件还在上传时不发送——等它们各自到 uploaded/error 再发，
    // 否则会把还没拿到 serverId 的附件漏发。错误态的附件不阻塞发送（用户可先移除或重试）。
    if (attach.hasUploading) return;
    const currentAttempt = attempt && attempt.threadId === threadId &&
      attempt.text === normalizedText && attempt.agentId === selectedAgentId
      ? attempt
      : {
        threadId,
        clientMessageId: newClientMessageId(),
        text: normalizedText,
        agentId: selectedAgentId,
      };
    setAttempt(currentAttempt);
    setSubmitting(true);
    setSubmitFailure(null);
    setQueuedRun(null);
    setActiveRunId(null);
    setRunObservation(null);
    try {
      const attachmentIds = attach.uploadedIds;
      const accepted = await createMessage(threadId, {
        clientMessageId: currentAttempt.clientMessageId,
        text: currentAttempt.text,
        agentId: currentAttempt.agentId,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      }, bearer);
      setQueuedRun({ id: accepted.agentRunId, messageId: accepted.message.id });
      setActiveRunId(accepted.agentRunId);
      setText("");
      setAttempt(null);
      attach.clear(); // 发送成功：附件已挂到该消息，清空 composer 的本地附件态

      await loadPage(null, "soft"); // 发送后重读：软换，不清空不弹骨架（#925 ② 消灭闪烁）
      // #925 ③（人类裁决）—— 发送是显式意图，无条件滚到最新一条，**覆盖 V1「尊重上滚」**
      // （用户之前上滚看历史，发送后也要拽回底部；对齐 Claude/ChatGPT）。置 atBottomRef=true
      // 让后续流式/回复继续跟随；显式 rAF 滚一次保证这次立刻到底。
      atBottomRef.current = true;
      setShowJumpToLatest(false);
      requestAnimationFrame(() => {
        const el = scrollAreaRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (failure) {
      setSubmitFailure(describeMessageFailure(failure, "发送消息"));
    } finally {
      setSubmitting(false);
    }
  };

  const openLandForm = (message: DurableMessage) => {
    setLandingState((current) => ({
      ...current,
      [message.id]: { status: "form", title: defaultArtifactTitle(message.text) },
    }));
  };

  const updateLandTitle = (messageId: string, title: string) => {
    setLandingState((current) => {
      const existing = current[messageId];
      if (!existing || existing.status !== "form") return current;
      return { ...current, [messageId]: { ...existing, title } };
    });
  };

  const cancelLand = (messageId: string) => {
    setLandingState((current) => {
      const rest = { ...current };
      delete rest[messageId];
      return rest;
    });
  };

  const submitLand = async (message: DurableMessage) => {
    const entry = landingState[message.id];
    if (!entry || entry.status !== "form") return;
    const title = entry.title.trim();
    if (title === "") return;
    setLandingState((current) => ({ ...current, [message.id]: { status: "submitting", title } }));
    try {
      const result = await landAsArtifact(
        threadId,
        { messageId: message.id, mode: "draft", title, payloadRef: message.text },
        bearer,
      );
      setLandingState((current) => ({
        ...current,
        [message.id]: { status: "done", title, artifactId: result.artifactId },
      }));
      onArtifactLanded?.();
    } catch (failure) {
      setLandingState((current) => ({
        ...current,
        [message.id]: { status: "error", title, error: describeMessageFailure(failure, "落地为产物") },
      }));
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
   */
  const awaitingReply = activeRunId !== null
    && streamingText === ""
    && !(runObservation?.view != null && isTerminalRunStatus(runObservation.view.status));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="chat-live-message-panel">
      <div
        ref={scrollAreaRef}
        onScroll={handleScrollAreaScroll}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="chat-message-scroll"
      >
        {loading ? (
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
        {!loading && !listFailure && messages.length === 0 ? (
          <div className="grid min-h-40 place-items-center text-12 text-muted-foreground" data-testid="chat-message-list-empty">
            这条线程还没有持久消息。
          </div>
        ) : null}
        {messages.length > 0 ? (
          <ol className="flex flex-col gap-4" data-testid="chat-message-list">
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
                    {isAgent ? <Bot className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
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
                      {isAgent ? agentDuty(message.agentId, agents) : null}
                      <span>{messageTime(message.createdAt)}</span>
                      {/*
                        V3 —— 逐条复制。hover 出现（`opacity-0 group-hover`），键盘聚焦时也
                        显形（`focus-visible:opacity-100`）保证键盘可达；复制后 2 秒内显对勾。
                      */}
                      <button
                        type="button"
                        data-testid="chat-message-copy"
                        data-message-id={message.id}
                        aria-label="复制消息"
                        title="复制消息"
                        onClick={() => void handleCopyMessage(message)}
                        className="ml-0.5 inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors invisible hover:bg-muted hover:text-card-foreground focus-visible:visible focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:visible"
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
                        画在身份行里（与逐条复制同一排），跟随同一套 hover 显形规则。
                      */}
                      {isAgent && message.agentRunId ? (
                        <MessageRating messageId={message.id} />
                      ) : null}
                    </div>
                    {/*
                      2026-08-14 人类实测反馈重做：思考/工具调用链挂在这条消息自己身上
                      （紧跟身份行、在正文气泡之前），不是只在 composer 下方为"当前正在提交
                      的 run"临时显示——翻页、切线程再切回来，历史消息的思考链依然可见。
                      只对 AI 消息、且有 `agentRunId` 时渲染；`MessageThinkingChain` 内部
                      挂载才惰性拉取，失败静默降级，不影响消息正文本身。
                    */}
                    {isAgent ? <MessageThinkingChain agentRunId={message.agentRunId} bearer={bearer} /> : null}
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
                        // 于是图「最大化→编辑→保存」在个人线程（canLandArtifacts 恒 false，
                        // `artifact-land-capability.test.ts` 钉死的既有设计：产物对个人线程
                        // 是只读，不是禁用）里会调 landAsArtifact 撞上后端角色门，403「保存
                        // 失败：当前身份没有写入权限」——那不是权限模型错了，是这个入口没接
                        // 上已有的能力开关，让一枚本该退回「本地演示」的按钮伪装成了可保存。
                        // 不传时 `ChatDiagramCanvasModal` 自己的 `canPersist` 判断会退回本地
                        // 演示态（明确标「本地演示，未接后端」），不会崩、也不会打出一个
                        // 注定 403 的请求。
                        <MarkdownMessage
                          text={message.text}
                          threadId={canLandArtifacts ? threadId : undefined}
                          messageId={canLandArtifacts ? message.id : undefined}
                          bearer={canLandArtifacts ? bearer : undefined}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      )}
                    </div>
                    {/* #946 · V9-a F152：消息挂的附件（listMessages 投影，只读展示）。 */}
                    {message.attachments && message.attachments.length > 0 ? (
                      <MessageAttachments attachments={message.attachments} />
                    ) : null}
                    {canLandArtifacts ? (
                      <MessageLandingControls
                        message={message}
                        state={landingState[message.id]}
                        onOpen={() => openLandForm(message)}
                        onTitleChange={(title) => updateLandTitle(message.id, title)}
                        onCancel={() => cancelLand(message.id)}
                        onSubmit={() => void submitLand(message)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
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
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1 items-start">
                  <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    <span className="font-medium">Agent</span>
                    <Badge tone="outline">正在生成…</Badge>
                  </div>
                  {/* 2026-08-14 重做：在途 run 的工具调用链也挂在这条流式气泡自己身上，
                      不再挂在 composer 下方——同一条 run 落库后接力给 `MessageThinkingChain`
                      （上面持久消息那条），视觉位置不因"是否还在流式中"而跳动。 */}
                  {runObservation?.view ? <AgentToolChain steps={runObservation.view.steps} /> : null}
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
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1 items-start">
                  <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    <span className="font-medium">Agent</span>
                    <Badge tone="outline">正在思考…</Badge>
                  </div>
                  {runObservation?.view ? <AgentToolChain steps={runObservation.view.steps} /> : null}
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
      </div>

      {/*
        V5（PROP-CHAT-10ITER-001）—— jump-to-latest 悬浮按钮。仅当用户上滚离开底部
        （`showJumpToLatest`）时出现，绝对定位在消息区底部正中、输入区上方。点击平滑滚到底。
        条件渲染而非 visibility 切换：不在底部时它才存在，避免常驻挡内容，也让 e2e 能用
        存在性断言（`toHaveCount`）确定性验证显隐。
      */}
      {showJumpToLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
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

      {aboveComposer}
      <div className="border-t border-border p-3" data-testid="chat-composer">
        {archived ? (
          <p className="mb-2 text-12 text-muted-foreground" data-testid="chat-composer-archived">
            该对话已归档，只能读取，不能创建消息或运行。
          </p>
        ) : null}
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
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="chat-followup-suggestions">
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
          </div>
        ) : null}
        {/* #946 · V9-a F152：就地报错横幅（超大小 / 非白名单 / 超数量），不静默丢弃。 */}
        {archived ? null : <ChatAttachmentBanner banner={attach.banner} />}
        <div
          className={`relative rounded-2xl border bg-card p-1.5 shadow-sm transition-all duration-200 ${
            attach.dragActive ? "border-primary ring-2 ring-primary" : "border-border-subtle"
          }`}
          {...(archived ? {} : attach.dragHandlers)}
        >
          {/* 拖拽落区 + 附件预览条（活路由，接真实上传端点）。 */}
          {archived ? null : <ChatAttachmentDropzone active={attach.dragActive} />}
          {archived ? null : <ChatAttachmentList ctl={attach} disabled={submitting} />}
          <Textarea
            ref={composerRef}
            data-testid="chat-message-input"
            aria-label="消息内容"
            placeholder="输入要持久保存并交给所选 Agent 的消息，或把文件拖进来一起发送"
            value={text}
            disabled={archived || submitting}
            onChange={(event) => updateDraft({ text: event.target.value })}
            onKeyDown={handleComposerKeyDown}
            className="min-h-16 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0"
          />
          {/*
            #728 —— 人类指示（Claude Code 参照）：加 skill / 选 Agent 都收进和麦克风
            同一行、靠左；发送按钮只留图标。默认要有一个 agent，不需要用户手动选——
            这条已经在 `selectedAgentId` 的推导里满足（`agents?.[0]?.id`），本次
            只是把选择器从独立一行搬下来、做紧凑，不改选择逻辑本身。

            个人对话没有「加 skill」（`ChatSkillMountPanel` 只在项目对话侧挂载，
            人类这轮明确说项目对话先不做）——这里先只放 Agent 选择器，skill 入口
            留给项目对话那一轮再接进来，不在两边都不存在的东西上造一个空位。
          */}
          <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
            <div className="flex items-center gap-2">
              <AgentPicker
                agents={agents}
                selectedAgentId={selectedAgentId}
                disabled={archived || submitting || agents === null || agents.length === 0}
                onSelect={(agentId) => updateDraft({ agentId })}
              />
              {/* #946 · V9-a F152：📎 附件按钮 + 计数（接真实上传端点）。 */}
              <ChatAttachmentButton ctl={attach} disabled={archived || submitting} />
            </div>
            <div className="flex items-center gap-1.5">
              {/*
                realtime-asr 增补 A（contract.md §7）：麦克风设备下拉，紧挨麦克风按钮。
                录音中禁用——切设备要重起采音管线，不在本增补范围（§7.4 只排除了
                hold-to-record，切设备的中途重连同样留给后续），录音中就先锁住。
              */}
              <MicDevicePicker
                devices={micDevices.devices}
                selectedDeviceId={micDevices.selectedDeviceId}
                disabled={archived || submitting || speech.listening}
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
                aria-label={speech.listening ? "停止语音输入" : "开始语音输入"}
                title={noAgentToRunWith ? "没有可选 Agent，暂时无法发送消息" : (speech.listening ? "停止语音输入" : "开始语音输入")}
                disabled={archived || submitting || noAgentToRunWith}
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
              >
                <Mic aria-hidden className="h-3.5 w-3.5" />
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
        {speech.listening ? (
          // #726 —— 转录进行中的可见反馈："正在听"，不是静默录音。文字实时通过
          // `onTranscript` 写回 `text`（见上面 `updateDraft` 的调用），这里只是状态提示。
          <p className="mt-2 flex items-center gap-1.5 text-11 text-destructive" data-testid="chat-mic-listening">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
            正在听……实时转录中，说完点击麦克风按钮停止，确认无误后再手动发送。
          </p>
        ) : null}
        {speech.error !== null ? (
          <p className="mt-2 text-11 text-destructive" data-testid="chat-mic-error">
            {speech.error}
          </p>
        ) : null}
        {queuedRun ? (
          // #728 第 8 轮 P10 —— 裸 40 位 id 不再印进人读文案，`data-run-id`（下方
          // AgentRunStatus）已经把它挂在 DOM 上供机器断言，人眼不需要看两遍同一个 id。
          <p className="mt-2 text-11 text-primary" data-testid="chat-message-queued" data-run-id={queuedRun.id}>
            消息已持久化，AgentRun 已排队。
          </p>
        ) : null}
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

/** agent 的角色 chip。编制里没有这个 agent 时不渲染 —— 不编一个角色出来。 */
function agentDuty(
  agentId: string | null,
  agents: GetAgentPanelOut["agents"] | null,
): React.ReactNode {
  const duty = agentId === null ? undefined : agents?.find((a) => a.id === agentId)?.duty;
  return duty ? <Badge tone="ai">{duty}</Badge> : null;
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
  const { runId, view, failure, timedOut } = observation;
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
    >
      {failure !== null ? <span className="text-destructive">{failure}</span> : null}
      {failure === null && status === null ? (
        <span className="text-muted-foreground">正在读取 AgentRun 状态…</span>
      ) : null}
      {status !== null ? <span className={statusTone(status)}>{RUN_STATUS_TEXT[status]}</span> : null}
      {view?.error ? <span className="text-destructive">（{view.error}）</span> : null}
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
  succeeded: "执行完成，回复已写入对话",
  failed: "执行失败",
};

function statusTone(status: AgentRunStatus): string {
  if (status === "failed") return "text-destructive";
  if (status === "succeeded") return "text-primary";
  return "text-muted-foreground";
}

/** 十项 UX 缺口第 5 项——一条消息「落地为产物（草稿）」的本地 UI 状态机。 */
type MessageLandingState =
  | { readonly status: "form"; readonly title: string }
  | { readonly status: "submitting"; readonly title: string }
  | { readonly status: "done"; readonly title: string; readonly artifactId: string }
  | { readonly status: "error"; readonly title: string; readonly error: string };

function defaultArtifactTitle(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : (firstLine || "未命名产物");
}

/**
 * 十项 UX 缺口第 5 项（issue #708）——内联「落地为产物」控件。
 * 真实调用 `landAsArtifact`（`POST /chat/threads/:threadId/artifacts`），只提供
 * `mode: "draft"`——`live`/`pinned` 要求非空 citations，而 citations 写入路径目前
 * 不存在，见本文件顶部 `landAsArtifact` 引入处的注释。
 */
function MessageLandingControls({
  message, state, onOpen, onTitleChange, onCancel, onSubmit,
}: {
  message: DurableMessage;
  state: MessageLandingState | undefined;
  onOpen: () => void;
  onTitleChange: (title: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (state === undefined) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="self-start text-10 text-muted-foreground"
        data-testid={`chat-land-artifact-open-${message.id}`}
        onClick={onOpen}
      >
        落地为产物（草稿）
      </Button>
    );
  }

  if (state.status === "done") {
    return (
      <p className="text-10 text-primary" data-testid={`chat-land-artifact-done-${message.id}`}>
        已落地为产物（草稿）：{state.title}
      </p>
    );
  }

  const busy = state.status === "submitting";
  return (
    <form
      className="flex w-full max-w-xs flex-col gap-1 rounded-md border border-border-subtle bg-card p-2"
      data-testid={`chat-land-artifact-form-${message.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="text-10 text-muted-foreground" htmlFor={`chat-land-artifact-title-${message.id}`}>
        产物标题（草稿，落地后仍可在右栏「产物」看到）
      </label>
      <input
        id={`chat-land-artifact-title-${message.id}`}
        data-testid={`chat-land-artifact-title-${message.id}`}
        className="h-7 rounded-md border border-input bg-transparent px-2 text-11"
        value={state.title}
        disabled={busy}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          type="submit"
          data-testid={`chat-land-artifact-submit-${message.id}`}
          disabled={busy || state.title.trim() === ""}
        >
          {busy ? "落地中…" : "确认落地"}
        </Button>
        <Button size="xs" type="button" variant="outline" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
      {state.status === "error" ? (
        <p className="text-10 text-destructive" data-testid={`chat-land-artifact-error-${message.id}`}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

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

/**
 * 运行 Agent 选择器。
 *
 * ⚠ 不用原生 `&lt;select&gt;`——app 层禁止裸原生表单元素（uiux-standards U6），
 *   且 #728 D8 判据逐字写「没有裸 `&lt;select&gt;`」。仿照本仓已有的手写弹层惯例
 *   （`components/projects/project-more-menu.tsx`：Button 触发 + `role="listbox"` 面板，
 *   不是 `@radix-ui/react-select`，虽然那个依赖已装但本仓这类小面板一贯手写）。
 *
 * `data-testid="chat-agent-select"` 留在**触发按钮**上（原来在 `&lt;select&gt;` 本身），
 * 值用可见文字呈现（Agent 名），不再是 `&lt;option&gt;` 的 `value`——
 * `toHaveValue()` 断言因此改成 `toHaveTextContent()`，`selectOption()` 改成点开+点选项。
 * 这不是削弱断言：它验证的还是「当前选中的 agent 是谁」，只是读取方式跟着控件形态换了。
 */
/**
 * realtime-asr 增补 A（contract.md §7）：composer 麦克风的输入设备下拉。
 *
 * 仿 `AgentPicker` 的手搓 listbox（本仓没有下拉基元库）。三条诚实约束（§7.3）：
 *  - 未授权 → label 为空 → 显示占位「麦克风 N（授权后显示名称）」，不空白也不编名；
 *  - 「系统默认」永远是第一项、选中态由 `selectedDeviceId === null` 表示；
 *  - 选中项打勾（`Check`）。热插拔刷新与记忆在 `useAudioInputDevices` 里，这里只渲染。
 */
function MicDevicePicker({
  devices, selectedDeviceId, disabled, onSelect,
}: {
  devices: readonly { readonly deviceId: string; readonly label: string }[];
  selectedDeviceId: string | null;
  disabled: boolean;
  onSelect: (deviceId: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const labelFor = (deviceId: string, label: string, index: number): string =>
    label !== "" ? label : `麦克风 ${index + 1}（授权后显示名称）`;
  const selected = devices.find((device) => device.deviceId === selectedDeviceId) ?? null;
  const triggerText = selectedDeviceId === null
    ? "系统默认麦克风"
    : (selected ? labelFor(selected.deviceId, selected.label, devices.indexOf(selected)) : "系统默认麦克风");

  return (
    <div className="relative flex items-center">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="max-w-40 justify-start gap-1.5 rounded-full px-2"
        data-testid="chat-mic-device-select"
        data-selected-device={selectedDeviceId ?? ""}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择麦克风"
        title={`麦克风：${triggerText}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Mic aria-hidden className="h-3 w-3 text-muted-foreground" />
        <span className="truncate text-11">{triggerText}</span>
        <span aria-hidden className="text-9 text-muted-foreground">▾</span>
      </Button>
      {open ? (
        <div
          role="listbox"
          aria-label="选择麦克风"
          data-testid="chat-mic-device-listbox"
          className="absolute bottom-8 left-0 z-10 w-56 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {/* 「系统默认」恒为第一项：不选具体设备就跟随系统，这是 deviceId=null 的语义。 */}
          <button
            type="button"
            role="option"
            aria-selected={selectedDeviceId === null}
            data-testid="chat-mic-device-option-default"
            onClick={() => { onSelect(null); setOpen(false); }}
            className={[
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 hover:bg-muted",
              selectedDeviceId === null ? "text-primary" : "text-card-foreground",
            ].join(" ")}
          >
            <Check aria-hidden className={["h-3 w-3 shrink-0", selectedDeviceId === null ? "opacity-100" : "opacity-0"].join(" ")} />
            <span className="truncate">系统默认麦克风</span>
          </button>
          {devices.length === 0 ? (
            <p className="px-2 py-1.5 text-11 text-muted-foreground" data-testid="chat-mic-device-empty">
              未检测到其它输入设备。授权麦克风后会显示设备名。
            </p>
          ) : null}
          {devices.map((device, index) => {
            const isSelected = device.deviceId === selectedDeviceId;
            return (
              <button
                key={device.deviceId}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid={`chat-mic-device-option-${device.deviceId}`}
                onClick={() => { onSelect(device.deviceId); setOpen(false); }}
                className={[
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 hover:bg-muted",
                  isSelected ? "text-primary" : "text-card-foreground",
                ].join(" ")}
              >
                <Check aria-hidden className={["h-3 w-3 shrink-0", isSelected ? "opacity-100" : "opacity-0"].join(" ")} />
                <span className="truncate">{labelFor(device.deviceId, device.label, index)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AgentPicker({
  agents, selectedAgentId, disabled, onSelect,
}: {
  agents: GetAgentPanelOut["agents"] | null;
  selectedAgentId: string;
  disabled: boolean;
  onSelect: (agentId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = agents?.find((agent) => agent.id === selectedAgentId) ?? null;

  return (
    /*
      #728 —— 紧凑化：从「运行 Agent [长按钮撑满一行]」改成 Claude Code 那种
      左下角小触发器（头像/缩写 + 名字，不再有单独的标签行）。默认已经选中
      `agents[0]`（见调用方 `selectedAgentId` 的推导），用户多数时候不需要点开它，
      所以给它的视觉权重降到跟麦克风、发送同一级，而不是占一整行。
    */
    <div className="relative flex items-center">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="max-w-40 justify-start gap-1.5 rounded-full px-2"
        data-testid="chat-agent-select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="运行 Agent"
        title={selected ? `运行 Agent：${selected.name}` : "运行 Agent"}
        onClick={() => setOpen((value) => !value)}
      >
        {selected ? <Avatar initials={selected.abbr} tone="ai" size="xs" /> : null}
        <span className="truncate text-11">{selected?.name ?? (agents?.length ? "选择 Agent" : "没有可选 Agent")}</span>
        <span aria-hidden className="text-9 text-muted-foreground">▾</span>
      </Button>
      {open && agents?.length ? (
        <div
          role="listbox"
          aria-label="运行 Agent"
          data-testid="chat-agent-select-listbox"
          className="absolute bottom-8 left-0 z-10 w-48 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={agent.id === selectedAgentId}
              data-testid={`chat-agent-select-option-${agent.id}`}
              onClick={() => {
                onSelect(agent.id);
                setOpen(false);
              }}
              className={[
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 hover:bg-muted",
                agent.id === selectedAgentId ? "text-primary" : "text-card-foreground",
              ].join(" ")}
            >
              <Avatar initials={agent.abbr} tone="ai" size="xs" />
              <span className="truncate">{agent.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
