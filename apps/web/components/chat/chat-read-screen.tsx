"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare, RefreshCw, Users } from "lucide-react";
import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/lib/api-client";
import {
  getAgentPanel,
  getThread,
  listThreads,
  type GetAgentPanelOut,
  type GetThreadOut,
  type ListThreadsOut,
  type ThreadCard,
} from "@/lib/live-chat";

interface Sourced<T> {
  readonly key: string;
  readonly value: T;
}

interface SelectionState {
  readonly sourceKey: string;
  readonly routeThreadId: string | null;
  readonly threadId: string | null;
}

export function ChatReadScreen({
  projectId,
  initialThreadId,
}: {
  projectId: string | null;
  initialThreadId: string | null;
}) {
  const router = useRouter();
  const { session } = useSession();
  const bearer = session?.sessionToken ?? null;
  const currentOrgId = session?.currentOrgId ?? null;
  const sourceKey = projectId && bearer && currentOrgId
    ? `${projectId}\u0000${currentOrgId}\u0000${bearer}`
    : null;
  const [threadResult, setThreadResult] = React.useState<Sourced<ListThreadsOut> | null>(null);
  const [listLoadingKey, setListLoadingKey] = React.useState<string | null>(null);
  const [listFailure, setListFailure] = React.useState<Sourced<string> | null>(null);
  const [selection, setSelection] = React.useState<SelectionState | null>(null);
  const selectedThreadId = sourceKey &&
    selection?.sourceKey === sourceKey &&
    selection.routeThreadId === initialThreadId
    ? selection.threadId
    : initialThreadId;
  const detailKey = sourceKey && selectedThreadId ? `${sourceKey}\u0000${selectedThreadId}` : null;
  const [detailResult, setDetailResult] = React.useState<Sourced<GetThreadOut> | null>(null);
  const [detailLoadingKey, setDetailLoadingKey] = React.useState<string | null>(null);
  const [detailFailure, setDetailFailure] = React.useState<Sourced<string> | null>(null);
  const [rosterResult, setRosterResult] = React.useState<Sourced<GetAgentPanelOut> | null>(null);
  const [rosterLoadingKey, setRosterLoadingKey] = React.useState<string | null>(null);
  const [rosterFailure, setRosterFailure] = React.useState<Sourced<string> | null>(null);
  const listGeneration = React.useRef(0);
  const detailGeneration = React.useRef(0);

  const threads = threadResult?.key === sourceKey ? threadResult.value : null;
  const listLoading = listLoadingKey === sourceKey;
  const listError = listFailure?.key === sourceKey ? listFailure.value : null;
  const detail = detailResult?.key === detailKey ? detailResult.value : null;
  const detailLoading = detailLoadingKey === detailKey;
  const detailError = detailFailure?.key === detailKey ? detailFailure.value : null;
  const roster = rosterResult?.key === detailKey ? rosterResult.value : null;
  const rosterLoading = rosterLoadingKey === detailKey;
  const rosterError = rosterFailure?.key === detailKey ? rosterFailure.value : null;

  const loadThreads = React.useCallback(async () => {
    if (!projectId || !bearer || !sourceKey) return;
    const key = sourceKey;
    const generation = ++listGeneration.current;
    setListLoadingKey(key);
    setListFailure(null);
    try {
      const result = await listThreads(projectId, {}, bearer);
      if (generation !== listGeneration.current) return;
      setThreadResult({ key, value: result });
      const first = result.groups.flatMap((group) => group.cards)[0]?.id ?? null;
      setSelection((current) => {
        if (
          current?.sourceKey === key &&
          current.routeThreadId === initialThreadId &&
          current.threadId !== null
        ) return current;
        return { sourceKey: key, routeThreadId: initialThreadId, threadId: initialThreadId ?? first };
      });
    } catch (failure) {
      if (generation !== listGeneration.current) return;
      setThreadResult(null);
      setListFailure({ key, value: describeFailure(failure) });
    } finally {
      if (generation === listGeneration.current) setListLoadingKey(null);
    }
  }, [bearer, initialThreadId, projectId, sourceKey]);

  React.useEffect(() => {
    if (sourceKey) void loadThreads();
    return () => {
      listGeneration.current += 1;
    };
  }, [loadThreads, sourceKey]);

  const loadSelectedThread = React.useCallback(async () => {
    if (!projectId || !selectedThreadId || !bearer || !detailKey) return;
    const key = detailKey;
    const generation = ++detailGeneration.current;
    setDetailLoadingKey(key);
    setRosterLoadingKey(key);
    setDetailFailure(null);
    setRosterFailure(null);
    const [nextDetail, nextRoster] = await Promise.allSettled([
      getThread(selectedThreadId, projectId, bearer),
      getAgentPanel(selectedThreadId, projectId, bearer),
    ]);
    if (generation !== detailGeneration.current) return;
    if (nextDetail.status === "fulfilled") {
      setDetailResult({ key, value: nextDetail.value });
    } else {
      setDetailResult(null);
      setDetailFailure({ key, value: describeFailure(nextDetail.reason) });
    }
    if (nextRoster.status === "fulfilled") {
      setRosterResult({ key, value: nextRoster.value });
    } else {
      setRosterResult(null);
      setRosterFailure({ key, value: describeFailure(nextRoster.reason) });
    }
    setDetailLoadingKey(null);
    setRosterLoadingKey(null);
  }, [bearer, detailKey, projectId, selectedThreadId]);

  React.useEffect(() => {
    if (selectedThreadId) void loadSelectedThread();
    return () => {
      detailGeneration.current += 1;
    };
  }, [loadSelectedThread, selectedThreadId]);

  if (!projectId) {
    return (
      <AppShell previewRole={null}>
        <div className="grid h-full place-items-center p-6" data-testid="chat-missing-project-context">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <MessageSquare aria-hidden className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-16 font-semibold">请先选择项目</h1>
            <p className="text-12 text-muted-foreground">
              对话属于具体项目。当前地址没有真实 projectId，因此不会加载示例数据。
            </p>
            <Button asChild size="sm" variant="outline"><Link href="/projects">返回项目列表</Link></Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const cards = threads?.groups.flatMap((group) => group.cards) ?? [];
  const selectedCard = cards.find((card) => card.id === selectedThreadId) ?? null;

  return (
    <AppShell
      previewRole={null}
      left={(
        <ThreadList
          projectId={projectId}
          groups={threads?.groups ?? null}
          loading={listLoading}
          error={listError}
          selectedThreadId={selectedThreadId}
          onRetry={() => void loadThreads()}
          onSelect={(threadId) => {
            if (sourceKey) {
              setSelection({ sourceKey, routeThreadId: initialThreadId, threadId });
            }
            router.replace(chatHref(projectId, threadId));
          }}
        />
      )}
      right={(
        <RosterPanel
          roster={roster}
          loading={rosterLoading}
          error={rosterError}
          hasSelection={selectedThreadId !== null}
          onRetry={() => void loadSelectedThread()}
        />
      )}
    >
      <ThreadDetail
        projectId={projectId}
        currentOrgId={currentOrgId}
        card={selectedCard}
        detail={detail}
        bearer={bearer}
        roster={roster}
        loading={detailLoading}
        error={detailError}
        onRetry={() => void loadSelectedThread()}
      />
    </AppShell>
  );
}

function ThreadList({
  projectId, groups, loading, error, selectedThreadId, onRetry, onSelect,
}: {
  projectId: string;
  groups: ListThreadsOut["groups"] | null;
  loading: boolean;
  error: string | null;
  selectedThreadId: string | null;
  onRetry: () => void;
  onSelect: (threadId: string) => void;
}) {
  return (
    <div className="flex flex-col" data-testid="chat-read-thread-list">
      <div className="flex flex-col gap-1 p-3">
        <span className="text-10 uppercase tracking-wide text-muted-foreground">项目对话</span>
        <span className="truncate font-mono text-11" data-testid="chat-project-id">{projectId}</span>
      </div>
      <Separator />
      {loading && groups === null ? <p className="p-3 text-12 text-muted-foreground">正在加载真实线程…</p> : null}
      {error ? (
        <ErrorState testId="chat-thread-list-error" message={error} retryTestId="chat-thread-list-retry" onRetry={onRetry} />
      ) : null}
      {!loading && !error && groups?.length === 0 ? (
        <p className="p-3 text-12 text-muted-foreground" data-testid="chat-thread-list-empty">
          这个项目还没有可见对话。
        </p>
      ) : null}
      {groups && groups.length > 0 ? (
        <nav className="flex flex-col gap-3 p-3" aria-label="真实对话线程列表">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-1">
              <h2 className="px-1 text-10 font-medium text-muted-foreground">{group.label}</h2>
              {group.cards.length === 0 ? <p className="px-1 text-10 text-muted-foreground">本组为空</p> : null}
              {group.cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  data-testid={`chat-thread-${card.id}`}
                  aria-current={card.id === selectedThreadId ? "page" : undefined}
                  onClick={() => onSelect(card.id)}
                  className={[
                    "flex flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                    card.id === selectedThreadId ? "bg-muted" : "",
                  ].join(" ")}
                >
                  <span className="line-clamp-2 text-12 font-medium">{card.title}</span>
                  <ThreadMeta card={card} />
                </button>
              ))}
            </section>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function ThreadMeta({ card }: { card: ThreadCard }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-10 text-muted-foreground">
      <span>{card.visibilityScope}</span>
      {card.agentSummary ? <span>· {card.agentSummary}</span> : null}
      {card.badges.map((badge) => <Badge key={badge} tone="outline">{badge}</Badge>)}
    </span>
  );
}

function ThreadDetail({
  projectId, currentOrgId, card, detail, bearer, roster, loading, error, onRetry,
}: {
  projectId: string;
  currentOrgId: string | null;
  card: ThreadCard | null;
  detail: GetThreadOut | null;
  bearer: string | null;
  roster: GetAgentPanelOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && detail === null) return <CenteredState>正在读取线程详情…</CenteredState>;
  if (error) return <ErrorState testId="chat-thread-detail-error" message={error} retryTestId="chat-thread-detail-retry" onRetry={onRetry} />;
  if (!detail) return <CenteredState>从左侧选择一条真实线程查看。</CenteredState>;

  return (
    <div className="flex h-full flex-col" data-testid="chat-thread-detail">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-14 font-semibold">{card?.title ?? detail.thread.id}</h1>
          <p className="text-10 text-muted-foreground">
            项目 {projectId} · 组织 {currentOrgId ?? "未解析"} · 线程 {detail.thread.id}
          </p>
        </div>
        <Badge tone="outline">真实消息</Badge>
        {detail.thread.archived ? <Badge tone="neutral">已归档</Badge> : null}
      </header>
      {bearer ? (
        <ChatLiveMessagePanel
          threadId={detail.thread.id}
          bearer={bearer}
          agents={roster?.agents ?? null}
          archived={detail.thread.archived}
        />
      ) : <CenteredState>登录已失效，无法读取或发送消息。</CenteredState>}
    </div>
  );
}

function RosterPanel({
  roster, loading, error, hasSelection, onRetry,
}: {
  roster: GetAgentPanelOut | null;
  loading: boolean;
  error: string | null;
  hasSelection: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col" data-testid="chat-read-roster">
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-12 font-medium">Agent 编制（只读）</h2>
      </div>
      {!hasSelection ? <p className="p-3 text-12 text-muted-foreground">选择线程后读取编制。</p> : null}
      {loading ? <p className="p-3 text-12 text-muted-foreground">正在读取真实编制…</p> : null}
      {error ? <ErrorState testId="chat-roster-error" message={error} retryTestId="chat-roster-retry" onRetry={onRetry} /> : null}
      {roster ? (
        <div className="flex flex-col gap-2 p-3">
          <p className="text-10 text-muted-foreground">在场 {roster.presentCount} · 编制 {roster.rosterCount}</p>
          {roster.agents.length === 0 ? <p className="text-12 text-muted-foreground" data-testid="chat-roster-empty">当前编制为空。</p> : null}
          {roster.agents.map((agent) => (
            <div key={agent.id} className="rounded-md border border-border-subtle p-2" data-testid={`chat-roster-agent-${agent.id}`}>
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-ai-tint text-10 font-medium text-ai-tint-foreground">{agent.abbr}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-11 font-medium">{agent.name}</p>
                  <p className="truncate text-10 text-muted-foreground">{agent.duty}</p>
                </div>
                <Badge tone={agent.presence === "present" ? "primary" : "neutral"}>{agent.presence}</Badge>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ErrorState({
  testId, message, retryTestId, onRetry,
}: {
  testId: string;
  message: string;
  retryTestId: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 p-3" data-testid={testId}>
      <p className="text-12 text-destructive">{message}</p>
      <Button size="xs" variant="outline" data-testid={retryTestId} onClick={onRetry}>
        <RefreshCw aria-hidden className="h-3 w-3" />重试
      </Button>
    </div>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-6 text-12 text-muted-foreground">{children}</div>;
}

function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return "当前身份无权读取这项内容（HTTP 403）。";
    if (failure.status === 404) return "内容不存在或当前身份不可见（HTTP 404）。";
    return `${failure.reasonCode ?? "读取失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "读取失败，请稍后重试。";
}

function chatHref(projectId: string, threadId: string): string {
  const query = new URLSearchParams({ projectId, thread: threadId });
  return `/chat?${query.toString()}`;
}
