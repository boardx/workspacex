"use client";

import * as React from "react";
import { Bot, RefreshCw, Send, UserRound } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  createMessage,
  listMessages,
  type CreateMessageInput,
  type DurableMessage,
  type GetAgentPanelOut,
} from "@/lib/live-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MESSAGE_PAGE_SIZE = 50;

interface SubmissionAttempt extends CreateMessageInput {
  readonly threadId: string;
}

export function ChatLiveMessagePanel({
  threadId,
  bearer,
  agents,
  archived,
}: {
  threadId: string;
  bearer: string;
  agents: GetAgentPanelOut["agents"] | null;
  archived: boolean;
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
    void loadPage(null, true);
    return () => {
      generation.current += 1;
    };
  }, [loadPage, sourceKey]);

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
    try {
      const accepted = await createMessage(threadId, {
        clientMessageId: currentAttempt.clientMessageId,
        text: currentAttempt.text,
        agentId: currentAttempt.agentId,
      }, bearer);
      setQueuedRun({ id: accepted.agentRunId, messageId: accepted.message.id });
      setText("");
      setAttempt(null);
      await loadPage(null, true);
    } catch (failure) {
      setSubmitFailure(describeMessageFailure(failure, "发送消息"));
    } finally {
      setSubmitting(false);
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
          <ol className="flex flex-col gap-3" data-testid="chat-message-list">
            {messages.map((message) => (
              <li key={message.id} className="rounded-md border border-border-subtle bg-panel p-3" data-testid="chat-message-row" data-message-id={message.id}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                  {message.authorKind === "agent" ? <Bot aria-hidden className="h-3 w-3" /> : <UserRound aria-hidden className="h-3 w-3" />}
                  <span>{message.authorKind === "agent" ? message.agentId ?? "Agent" : "成员"}</span>
                  {message.agentRunId ? <Badge tone="outline">run {message.agentRunId}</Badge> : null}
                </div>
                <p className="whitespace-pre-wrap text-12 text-card-foreground">{message.text}</p>
              </li>
            ))}
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
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-12"
            value={selectedAgentId}
            disabled={archived || submitting || agents === null || agents.length === 0}
            onChange={(event) => updateDraft({ agentId: event.target.value })}
          >
            {agents?.length ? null : <option value="">没有可选 Agent</option>}
            {agents?.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </div>
        <Textarea
          data-testid="chat-message-input"
          aria-label="消息内容"
          placeholder="输入要持久保存并交给所选 Agent 的消息"
          value={text}
          disabled={archived || submitting}
          onChange={(event) => updateDraft({ text: event.target.value })}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-10 text-muted-foreground">只显示服务端持久消息；不会合成即时 AI 回复。</p>
          <Button
            size="sm"
            data-testid="chat-message-submit"
            disabled={archived || submitting || text.trim() === "" || selectedAgentId === ""}
            onClick={() => void submit()}
          >
            <Send aria-hidden className="h-3.5 w-3.5" />{submitting ? "发送中…" : "发送并排队"}
          </Button>
        </div>
        {queuedRun ? (
          <p className="mt-2 text-11 text-primary" data-testid="chat-message-queued">
            消息已持久化，AgentRun 已排队（{queuedRun.id}）。
          </p>
        ) : null}
        {submitFailure ? (
          <div className="mt-2" data-testid="chat-message-submit-error">
            <FailureState message={submitFailure} onRetry={() => void submit()} />
          </div>
        ) : null}
      </div>
    </div>
  );
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
