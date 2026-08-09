"use client";

import * as React from "react";
import { Bot, CheckCircle2, Mic, RefreshCw, Send, UserRound, Wrench, XCircle } from "lucide-react";
import { Markdown } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { ApiError } from "@/lib/api-client";
import {
  createMessage,
  landAsArtifact,
  listMessages,
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
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
  onArtifactLanded,
  aboveComposer,
}: {
  threadId: string;
  bearer: string;
  agents: GetAgentPanelOut["agents"] | null;
  archived: boolean;
  /**
   * 十项 UX 缺口第 5 项（issue #708）—— 某条消息成功落地为产物后的通知。
   * 调用方（`chat-read-screen.tsx`）借此重读右栏「产物」列表——单一事实源仍是
   * `listThreadArtifacts` 的服务端响应，这里不在本组件内维护第二份产物计数。
   */
  onArtifactLanded?: () => void;
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
   * #726 —— 麦克风开始录音那一刻要读到"此刻输入框里的文字"作为追加基线，而
   * `useSpeechTranscription` 的 `start()` 是一个稳定回调（不随每次按键重建），所以基线读取
   * 必须走 ref 而不是闭包捕获的 `text`——否则会追加到"点击麦克风那一刻组件首次渲染时的
   * text"，用户点麦克风前刚手打的内容就会被追加逻辑错误地忽略或覆盖。
   */
  const textRef = React.useRef(text);
  textRef.current = text;
  const speech = useAsrDraft({
    getBaseText: () => textRef.current,
    onTranscript: (fullText) => updateDraft({ text: fullText }),
    sessionToken: bearer,
  });
  const speechStopRef = React.useRef(speech.stop);
  speechStopRef.current = speech.stop;
  const selectedAgentId = agents?.some((agent) => agent.id === agentId)
    ? agentId
    : agents?.[0]?.id ?? "";

  const loadPage = React.useCallback(async (cursor: string | null, replace: boolean) => {
    const requestGeneration = ++generation.current;
    if (replace) {
      setMessages([]);
      setNextCursor(null);
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setListFailure(null);
    try {
      const result = await listMessages(
        threadId,
        { cursor: cursor ?? undefined, limit: MESSAGE_PAGE_SIZE },
        bearer,
      );
      if (generation.current !== requestGeneration) return;
      setMessages((current) => replace ? result.messages : appendUnique(current, result.messages));
      setNextCursor(result.nextCursor);
    } catch (failure) {
      if (generation.current !== requestGeneration) return;
      setListFailure(describeMessageFailure(failure, "读取消息"));
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
    void loadPage(null, true);
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
        await loadPage(null, true);
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

  const submit = async () => {
    const normalizedText = text.trim();
    if (normalizedText === "" || selectedAgentId === "" || archived || submitting) return;
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
      const accepted = await createMessage(threadId, {
        clientMessageId: currentAttempt.clientMessageId,
        text: currentAttempt.text,
        agentId: currentAttempt.agentId,
      }, bearer);
      setQueuedRun({ id: accepted.agentRunId, messageId: accepted.message.id });
      setActiveRunId(accepted.agentRunId);
      setText("");
      setAttempt(null);
      await loadPage(null, true);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-live-message-panel">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? <p className="text-12 text-muted-foreground">正在读取持久消息…</p> : null}
        {listFailure ? (
          <FailureState
            testId="chat-message-list-error"
            message={listFailure}
            onRetry={() => void loadPage(null, true)}
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
                  className={`flex items-start gap-2.5 ${isAgent ? "" : "flex-row-reverse"}`}
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
                    </div>
                    <div
                      className={`copilotkit-message-markdown rounded-2xl px-3.5 py-2.5 text-12 leading-relaxed ${
                        isAgent
                          ? "rounded-tl-sm bg-panel text-card-foreground"
                          // #728 D5：原型里人的气泡是**中性底**，不是实心品牌色。
                          // 实心 primary 让用户自己说的每一句话都在抢视觉重量。
                          : "rounded-tr-sm bg-muted text-card-foreground"
                      }`}
                    >
                      {isAgent ? (
                        // CopilotKit 的 Markdown 渲染——agent 回复可能带代码块/列表/加粗，
                        // 之前直接当纯文本 `whitespace-pre-wrap` 会把这些字面语法原样吐出来。
                        // 只对 agent 消息用：用户自己打的文字没有 markdown 语义可渲染。
                        <Markdown content={message.text} />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      )}
                    </div>
                    <MessageLandingControls
                      message={message}
                      state={landingState[message.id]}
                      onOpen={() => openLandForm(message)}
                      onTitleChange={(title) => updateLandTitle(message.id, title)}
                      onCancel={() => cancelLand(message.id)}
                      onSubmit={() => void submitLand(message)}
                    />
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
                  <div className="copilotkit-message-markdown rounded-2xl rounded-tl-sm bg-panel px-3.5 py-2.5 text-12 leading-relaxed text-card-foreground">
                    {/* 同一个 CopilotKit Markdown 组件——流式草稿和落库后的最终消息
                        渲染路径不该是两套，图片 markdown 语法在两边要一样生效。 */}
                    <Markdown content={streamingText} />
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
              onClick={() => void loadPage(nextCursor, false)}
            >
              {loadingMore ? "正在加载…" : "加载更早之后的消息"}
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
        <div className="rounded-2xl border border-border-subtle bg-card p-1.5 shadow-sm">
          <Textarea
            data-testid="chat-message-input"
            aria-label="消息内容"
            placeholder="输入要持久保存并交给所选 Agent 的消息"
            value={text}
            disabled={archived || submitting}
            onChange={(event) => updateDraft({ text: event.target.value })}
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
            <AgentPicker
              agents={agents}
              selectedAgentId={selectedAgentId}
              disabled={archived || submitting || agents === null || agents.length === 0}
              onSelect={(agentId) => updateDraft({ agentId })}
            />
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="icon"
                variant={speech.listening ? "destructive" : "outline"}
                className={`rounded-full ${speech.listening ? "animate-pulse" : ""}`}
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
                title={submitting ? "发送中…" : "发送并排队"}
                disabled={archived || submitting || text.trim() === "" || selectedAgentId === ""}
                onClick={() => void submit()}
              >
                <Send aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {/*
            #728 第 8 轮 P10 —— 原文案「不会合成即时 AI 回复」在个人对话已经能收到
            真实 AI 回复的今天是假的（P6/P7 的取证截图里正上方就摆着一条真实回复，
            两句话字面矛盾）。改成描述真正的行为约束：回复是服务端跑完真实 run 后
            写回的持久消息，不是前端本地伪造/拼出来的——这条约束仍然成立，只是
            换一种不自相矛盾的说法。`tests/ui/chat-read-screen.test.tsx:500` 与
            `e2e/chat-read.spec.ts:61` 两处断言已同步改成新文案，不是删掉旧断言。
          */}
          <p className="px-1.5 pb-0.5 text-10 text-muted-foreground">
            只显示服务端持久化的消息；AI 回复来自真实执行完成的写回，不在本地伪造。
          </p>
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
        {runObservation?.view ? <AgentRunToolCallSteps steps={runObservation.view.steps} /> : null}
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

/**
 * #731 follow-up —— chat-ux-acceptance-criteria.md 第 2/3 项在界面上的交付物。
 *
 * ## 数据源：轮询里已经有的东西，不是新接口
 *
 * `runObservation.view.steps` 早就在 `GET /agent-runs/:runId` 的响应里（`lib/agent-run.ts`
 * 的 `AgentRunView`），只是之前没人读它。这里只筛出 `kind === "tool_call"` 的条目并渲染
 * ——不发起任何新请求，不在客户端合成任何字段。`toolArgsSummary`/`toolResultSummary`/
 * `planningNote` 全部原样来自后端，为 `null` 就不渲染那一行，绝不用占位文案顶替。
 *
 * ## 为什么不做"正在调用中"的假动画
 *
 * 后端只在一次工具调用**真正完成**（成功或失败）之后才写入这条 step——调用期间没有
 * 中间状态可读。伪造一个"正在调用…"的过渡态会是一句界面从未验证过的谎言；这里如实
 * 只展示"已经发生的事"，`AgentRunStatus` 上方已有的"正在执行"整体状态负责传达"run
 * 还没完"，两者不重复表达同一件事。
 */
function AgentRunToolCallSteps({ steps }: { steps: AgentRunView["steps"] }) {
  const toolSteps = steps.filter((step) => step.kind === "tool_call");
  if (toolSteps.length === 0) return null;
  return (
    <ol className="mt-1.5 flex flex-col gap-1.5" data-testid="chat-run-tool-call-steps">
      {toolSteps.map((step, index) => {
        const succeeded = step.status === "succeeded";
        return (
          <li
            key={index}
            className="rounded-md border border-border-subtle bg-card px-2 py-1.5 text-11"
            data-testid={`chat-run-tool-call-step-${index}`}
            data-tool-name={step.toolName ?? undefined}
            data-tool-status={step.status}
          >
            {step.planningNote ? (
              // 第 2 项——工具调用前的可见计划。真实来自模型同一轮回复里的文本，
              // 模型没说就不显示（见组件自身 doc comment），不编一句话出来凑数。
              <p className="mb-1 italic text-muted-foreground" data-testid={`chat-run-tool-call-plan-${index}`}>
                {step.planningNote}
              </p>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Wrench aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-medium">调用 {step.toolName ?? "未知工具"}</span>
              {succeeded ? (
                <Badge tone="primary"><CheckCircle2 aria-hidden className="h-2.5 w-2.5" />完成</Badge>
              ) : (
                <Badge tone="danger"><XCircle aria-hidden className="h-2.5 w-2.5" />失败</Badge>
              )}
            </div>
            {step.toolArgsSummary ? (
              <p className="mt-1 text-10 text-muted-foreground">
                参数：{step.toolArgsSummary}
              </p>
            ) : null}
            {step.toolResultSummary ? (
              <p className={`mt-0.5 text-10 ${succeeded ? "text-card-foreground" : "text-destructive"}`}>
                {succeeded ? "结果" : "失败原因"}：{step.toolResultSummary}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
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

export function describeMessageFailure(failure: unknown, action: string): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return `${action}失败：登录已失效（HTTP 401），请重新登录。`;
    if (failure.status === 403) return `${action}失败：当前身份没有写入权限（HTTP 403）。`;
    if (failure.status === 404) return `${action}失败：对话不存在或当前身份不可见（HTTP 404）。`;
    if (failure.status === 409 && failure.reasonCode === "IDEMPOTENCY_CONFLICT") {
      return `${action}失败：同一 clientMessageId 已对应其他内容（HTTP 409），未创建重复消息。`;
    }
    if (failure.status === 409) return `${action}失败：对话状态冲突或已归档（HTTP 409）。`;
    if (failure.status === 422) return `${action}失败：消息无效或所选 Agent 没有可用的已发布版本（HTTP 422）。`;
    if (failure.status === 503) return `${action}失败：授权或依赖服务暂不可用（HTTP 503），系统没有降级到 mock。`;
    return `${action}失败：${failure.reasonCode ?? "UNKNOWN"}（HTTP ${failure.status}）。`;
  }
  return failure instanceof Error ? `${action}失败：${failure.message}` : `${action}失败，请稍后重试。`;
}
