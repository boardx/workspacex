"use client";

import * as React from "react";
import { Bot, RefreshCw, Send, UserRound } from "lucide-react";
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
                    <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                      <span className="font-medium">{isAgent ? message.agentId ?? "Agent" : "我"}</span>
                      {message.agentRunId ? <Badge tone="outline">run {message.agentRunId}</Badge> : null}
                    </div>
                    <div
                      className={`copilotkit-message-markdown rounded-2xl px-3.5 py-2.5 text-12 leading-relaxed ${
                        isAgent
                          ? "rounded-tl-sm bg-panel text-card-foreground"
                          : "rounded-tr-sm bg-primary text-primary-foreground"
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

      <div className="border-t border-border p-3" data-testid="chat-composer">
        {archived ? (
          <p className="mb-2 text-12 text-muted-foreground" data-testid="chat-composer-archived">
            该对话已归档，只能读取，不能创建消息或运行。
          </p>
        ) : null}
        <div className="mb-2 flex items-center gap-2">
          <label htmlFor="chat-agent-select" className="text-11 text-muted-foreground">运行 Agent</label>
          <select
            id="chat-agent-select"
            data-testid="chat-agent-select"
            className="h-7 min-w-0 flex-1 rounded-full border border-input bg-card px-3 text-11"
            value={selectedAgentId}
            disabled={archived || submitting || agents === null || agents.length === 0}
            onChange={(event) => updateDraft({ agentId: event.target.value })}
          >
            {agents?.length ? null : <option value="">没有可选 Agent</option>}
            {agents?.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </div>
        {followUpSuggestions.length > 0 ? (
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
          <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
            <p className="text-10 text-muted-foreground">只显示服务端持久消息；不会合成即时 AI 回复。</p>
            <Button
              size="sm"
              className="rounded-full"
              data-testid="chat-message-submit"
              disabled={archived || submitting || text.trim() === "" || selectedAgentId === ""}
              onClick={() => void submit()}
            >
              <Send aria-hidden className="h-3.5 w-3.5" />{submitting ? "发送中…" : "发送并排队"}
            </Button>
          </div>
        </div>
        {queuedRun ? (
          <p className="mt-2 text-11 text-primary" data-testid="chat-message-queued">
            消息已持久化，AgentRun 已排队（{queuedRun.id}）。
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
      <Badge tone="outline">run {runId}</Badge>
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
