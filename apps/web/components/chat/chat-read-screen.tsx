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
  createThread,
  deleteThread,
  getAgentPanel,
  getThread,
  listThreads,
  renameThread,
  updateAgentRoster,
  type GetAgentPanelOut,
  type GetThreadOut,
  type ListThreadsOut,
  type ThreadCard,
} from "@/lib/live-chat";

/**
 * 会话增删改的写权只认**服务端下发的能力标记**，不从 `composer.send` 推断、
 * 也不在前端按角色重算——契约 `chat.mutateThread` 要求两侧都验收：按钮不渲染
 * **且**接口拒绝（`packages/contracts/src/chat.ts:408`）。
 *
 * 能力**取自 `listThreads`**（#489），不取自 `getThread`。原因是一条实测死路：
 * `getThread` 只在选中某条线程时才调用，**零会话的项目里它一次都不会被调用** ⇒
 * 拿不到任何写权依据 ⇒「新建」不渲染 ⇒ **新注册的管理员永远建不出第一条会话**，
 * 「注册 → 登录 → Chat 新增」死在第三步。#460 交付时这个缺口被命名并上报，
 * #489 由服务端在 `listThreads.out` 也下发同一份 `capabilitiesFor` 结果补上。
 *
 * ⚠ 两个端口下发的是**同一个事实源**（服务端 `capabilitiesFor`），不是两套判定。
 * 前端只读一处（列表），不做并集、不做回退到 `getThread`——两处读会让
 * 「哪个说了算」重新成为问题。
 */
const THREAD_MUTATE_CAPABILITY = "thread.mutate";

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

  /* ── 会话增删改（#460）──────────────────────────────────────────────────────
   * 三条都**先等服务端返回，再从服务端重新读列表**——不做乐观更新。乐观更新会
   * 在服务端拒绝（NO_WRITE_ROLE / VERSION_CHANGED）时先给用户一个假的成功画面，
   * 而这条路径的整个意义就是「界面反映的是数据库里真实发生的事」。 */
  const [mutatePending, setMutatePending] = React.useState<"create" | "rename" | "delete" | null>(null);
  const [mutateFailure, setMutateFailure] = React.useState<string | null>(null);

  const runMutation = React.useCallback(async (
    op: "create" | "rename" | "delete",
    action: () => Promise<string | null>,
  ) => {
    if (!sourceKey || !projectId || !bearer) return;
    setMutatePending(op);
    setMutateFailure(null);
    try {
      const preferred = await action();
      // 重读列表，并**从服务端返回的列表里**解析选中态。删除后不能沿用路由上的
      // thread 参数——它指向刚被删掉的那条；「删完选中态正确回退」是本 issue 的验收项。
      const refreshed = await listThreads(projectId, {}, bearer);
      const cards = refreshed.groups.flatMap((group) => group.cards);
      const resolved = preferred && cards.some((card) => card.id === preferred)
        ? preferred
        : (cards[0]?.id ?? null);
      setThreadResult({ key: sourceKey, value: refreshed });
      setSelection({ sourceKey, routeThreadId: initialThreadId, threadId: resolved });
      if (resolved) router.replace(chatHref(projectId, resolved));
    } catch (failure) {
      setMutateFailure(describeMutateFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, initialThreadId, projectId, router, sourceKey]);

  const selectedVersion = detail?.thread.version ?? null;
  // 取自列表而不是详情：零会话时 `detail` 恒为 null，而「能不能建第一条会话」
  // 恰恰要在零会话时回答（#489）。
  const canMutate = threads?.capabilities.includes(THREAD_MUTATE_CAPABILITY) ?? false;

  const handleCreate = React.useCallback((title: string) => {
    if (!projectId) return;
    void runMutation("create", async () => {
      const result = await createThread({
        projectId,
        groupId: null,
        title,
        // 新建默认走全体可见；更细的可见范围是会话设置的事，不在本 issue。
        visibilityScope: "plenary",
      });
      return result.threadId;
    });
  }, [projectId, runMutation]);

  const handleRename = React.useCallback((title: string) => {
    if (!selectedThreadId || selectedVersion === null) return;
    void runMutation("rename", async () => {
      await renameThread(selectedThreadId, title, selectedVersion);
      return selectedThreadId;
    });
  }, [runMutation, selectedThreadId, selectedVersion]);

  const handleDelete = React.useCallback((reason: string) => {
    if (!selectedThreadId || selectedVersion === null) return;
    const removed = selectedThreadId;
    void runMutation("delete", async () => {
      await deleteThread(removed, selectedVersion, reason);
      // 删完的选中态：交给 loadThreads 从服务端返回的第一条兜底，不在本地猜。
      return null;
    });
  }, [runMutation, selectedThreadId, selectedVersion]);

  /* ── agent 编制的增删（#467）────────────────────────────────────────────────
   * 与上面的会话增删改同一套纪律：**先等服务端返回，再重读服务端**，不做乐观更新。
   *
   * ⚠ 交付的是**编制关系**（`chat_thread_agents` 的增删），**不是**「agent 真的执行
   *   并产生回复」——那是 #414 + #413。
   *
   * ⚠ `expectedRosterVersion` 只能由本地推进：**没有任何读端口下发 `rosterVersion`**
   *   （契约里只有 `updateAgentRoster.out` 有它，`getAgentPanel.out` 没有）。起点取
   *   `chat_threads.roster_version` 的 DDL 默认值 0，之后用每次响应返回的值推进。
   *   这是已上报的契约缺口；在补上读侧之前，别人改过编制的线程上首次提交会拿到
   *   409 `VERSION_CHANGED`——那时**如实报错**，不静默重试、不自动 +1 猜一个。 */
  const [rosterVersion, setRosterVersion] = React.useState(0);
  const [rosterPending, setRosterPending] = React.useState(false);
  const [rosterMutateFailure, setRosterMutateFailure] = React.useState<string | null>(null);

  // 换线程 ⇒ 版本号与错误都作废：把 A 线程的版本号发给 B 线程是一次静默的错写。
  React.useEffect(() => {
    setRosterVersion(0);
    setRosterMutateFailure(null);
  }, [detailKey]);

  const runRosterMutation = React.useCallback(async (
    change: { readonly add: readonly string[]; readonly remove: readonly string[] },
  ) => {
    if (!projectId || !selectedThreadId || !bearer) return;
    setRosterPending(true);
    setRosterMutateFailure(null);
    try {
      const result = await updateAgentRoster(
        selectedThreadId,
        projectId,
        { add: [...change.add], remove: [...change.remove], expectedRosterVersion: rosterVersion },
        bearer,
      );
      setRosterVersion(result.rosterVersion);
      // 重读服务端：界面上的编制来自 `getAgentPanel`，不是把响应体直接画上去，
      // 也不是本地拼一个。这条是「反映数据库里真实发生的事」的落点。
      await loadSelectedThread();
    } catch (failure) {
      setRosterMutateFailure(describeMutateFailure(failure));
    } finally {
      setRosterPending(false);
    }
  }, [bearer, loadSelectedThread, projectId, rosterVersion, selectedThreadId]);

  const handleRosterAdd = React.useCallback((agentId: string) => {
    const trimmed = agentId.trim();
    if (trimmed === "") return;
    void runRosterMutation({ add: [trimmed], remove: [] });
  }, [runRosterMutation]);

  const handleRosterRemove = React.useCallback((agentId: string) => {
    void runRosterMutation({ add: [], remove: [agentId] });
  }, [runRosterMutation]);

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
          canMutate={canMutate}
          mutatePending={mutatePending}
          mutateFailure={mutateFailure}
          onCreate={handleCreate}
          onRename={handleRename}
          onDelete={handleDelete}
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
          canMutate={canMutate}
          pending={rosterPending}
          mutateFailure={rosterMutateFailure}
          onAdd={handleRosterAdd}
          onRemove={handleRosterRemove}
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
  projectId, groups, loading, error, selectedThreadId,
  canMutate, mutatePending, mutateFailure, onCreate, onRename, onDelete,
  onRetry, onSelect,
}: {
  projectId: string;
  groups: ListThreadsOut["groups"] | null;
  loading: boolean;
  error: string | null;
  selectedThreadId: string | null;
  canMutate: boolean;
  mutatePending: "create" | "rename" | "delete" | null;
  mutateFailure: string | null;
  onCreate: (title: string) => void;
  onRename: (title: string) => void;
  onDelete: (reason: string) => void;
  onRetry: () => void;
  onSelect: (threadId: string) => void;
}) {
  return (
    <div className="flex flex-col" data-testid="chat-read-thread-list">
      <div className="flex flex-col gap-1 p-3">
        <span className="text-10 uppercase tracking-wide text-muted-foreground">项目对话</span>
        <span className="truncate font-mono text-11" data-testid="chat-project-id">{projectId}</span>
      </div>
      {canMutate ? (
        <ThreadActions
          selectedThreadId={selectedThreadId}
          pending={mutatePending}
          failure={mutateFailure}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
        />
      ) : null}
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

/**
 * 会话增删改入口。**只在服务端下发了 `thread.mutate` 时才渲染**（调用方已判），
 * 而不是渲染后禁用——「在集合里但标了 disabled」等于把授权判定交给客户端执行。
 */
function ThreadActions({
  selectedThreadId, pending, failure, onCreate, onRename, onDelete,
}: {
  selectedThreadId: string | null;
  pending: "create" | "rename" | "delete" | null;
  failure: string | null;
  onCreate: (title: string) => void;
  onRename: (title: string) => void;
  onDelete: (reason: string) => void;
}) {
  const [form, setForm] = React.useState<"create" | "rename" | "delete" | null>(null);
  const [draft, setDraft] = React.useState("");
  const busy = pending !== null;
  const hasSelection = selectedThreadId !== null;

  function open(next: "create" | "rename" | "delete") {
    setForm(next);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2 px-3 pb-3" data-testid="chat-thread-actions">
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="outline" data-testid="chat-thread-create" disabled={busy} onClick={() => open("create")}>
          新建会话
        </Button>
        <Button size="xs" variant="outline" data-testid="chat-thread-rename" disabled={busy || !hasSelection} onClick={() => open("rename")}>
          改名
        </Button>
        <Button size="xs" variant="outline" data-testid="chat-thread-delete" disabled={busy || !hasSelection} onClick={() => open("delete")}>
          删除
        </Button>
      </div>

      {form === "create" || form === "rename" ? (
        <form
          data-testid={form === "create" ? "chat-thread-create-form" : "chat-thread-rename-form"}
          onSubmit={(event) => {
            event.preventDefault();
            const title = draft.trim();
            if (!title) return;
            if (form === "create") onCreate(title); else onRename(title);
            setForm(null);
          }}
          className="flex flex-col gap-1"
        >
          <input
            aria-label={form === "create" ? "新会话标题" : "新的会话标题"}
            data-testid="chat-thread-title-input"
            className="rounded-md border border-border-subtle px-2 py-1 text-12"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex gap-1">
            <Button size="xs" variant="primary" type="submit" data-testid="chat-thread-title-submit" disabled={busy || draft.trim() === ""}>
              确认
            </Button>
            <Button size="xs" variant="outline" type="button" onClick={() => setForm(null)}>取消</Button>
          </div>
        </form>
      ) : null}

      {/* 删除要二次确认：它是可追溯动作，服务端会写审计并返回 impactScope。 */}
      {form === "delete" ? (
        <form
          data-testid="chat-thread-delete-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = draft.trim();
            if (!reason) return;
            onDelete(reason);
            setForm(null);
          }}
          className="flex flex-col gap-1"
        >
          <p className="text-11 text-muted-foreground">删除后不可撤销，请填写原因（会写入审计）。</p>
          <input
            aria-label="删除原因"
            data-testid="chat-thread-delete-reason"
            className="rounded-md border border-border-subtle px-2 py-1 text-12"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex gap-1">
            <Button size="xs" variant="destructive" type="submit" data-testid="chat-thread-delete-submit" disabled={busy || draft.trim() === ""}>
              确认删除
            </Button>
            <Button size="xs" variant="outline" type="button" onClick={() => setForm(null)}>取消</Button>
          </div>
        </form>
      ) : null}

      {busy ? <p className="text-10 text-muted-foreground" data-testid="chat-thread-mutate-pending">正在提交…</p> : null}
      {failure ? <p className="text-11 text-destructive" data-testid="chat-thread-mutate-error">{failure}</p> : null}
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

/**
 * ⚠ 写入口的渲染依据是 **`thread.mutate`**，因为契约里**没有** `roster.mutate` 这一档
 *   （`CHAT_WRITE_CAPABILITIES` 恰六个，见 `apps/api/src/domain/chat/thread-visibility.ts:276`）。
 *   服务端对编制的判定是 `role !== null && role !== "observer"`
 *   （`application/chat/update-agent-roster.ts` 的 `NO_WRITE_ROLE` 分支），与
 *   `thread.mutate` **同一个谓词** ⇒ 这里是**同源代理**，不是前端新造一份权限判断。
 *   缺一档专用能力已上报；服务端始终是权威（越权提交由 403 拒绝，见 API 测试）。
 */
function RosterPanel({
  roster, loading, error, hasSelection, canMutate, pending, mutateFailure, onAdd, onRemove, onRetry,
}: {
  roster: GetAgentPanelOut | null;
  loading: boolean;
  error: string | null;
  hasSelection: boolean;
  canMutate: boolean;
  pending: boolean;
  mutateFailure: string | null;
  onAdd: (agentId: string) => void;
  onRemove: (agentId: string) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = React.useState("");
  const writable = canMutate && hasSelection;

  return (
    <div className="flex flex-col" data-testid="chat-read-roster">
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-12 font-medium">Agent 编制{writable ? "" : "（只读）"}</h2>
      </div>
      {writable ? (
        <form
          className="flex flex-col gap-2 border-b border-border-subtle p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(draft);
            setDraft("");
          }}
        >
          <label className="text-10 text-muted-foreground" htmlFor="chat-roster-add-input">
            加入 agent（填组织 agent 目录里的 id）
          </label>
          <div className="flex items-center gap-2">
            <input
              id="chat-roster-add-input"
              data-testid="chat-roster-add-input"
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-11"
              placeholder="agent id"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending}
            />
            <Button size="xs" type="submit" data-testid="chat-roster-add-submit" disabled={pending}>
              {pending ? "提交中…" : "加入"}
            </Button>
          </div>
          {/* 「加入」按 id 而不是从下拉里选：契约里**没有**「列出本线程可加的 agent」
              这个读端口，编一个候选列表就得先编一份它的出处。缺口已上报。 */}
          {mutateFailure ? (
            <p className="text-10 text-destructive" data-testid="chat-roster-mutate-error">{mutateFailure}</p>
          ) : null}
        </form>
      ) : null}
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
                {writable ? (
                  <Button
                    size="xs"
                    variant="outline"
                    data-testid={`chat-roster-remove-${agent.id}`}
                    disabled={pending}
                    onClick={() => onRemove(agent.id)}
                  >
                    移出
                  </Button>
                ) : null}
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

/**
 * 写操作的失败文案。**回显服务端的 reasonCode**，不把所有失败糊成一句「操作失败」——
 * `VERSION_CHANGED`（别人先改了）与 `NO_WRITE_ROLE`（你没权限）是用户要区分对待的两件事。
 */
function describeMutateFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.reasonCode === "NO_WRITE_ROLE") return "当前身份没有会话写权限（NO_WRITE_ROLE）。";
    if (failure.reasonCode === "VERSION_CHANGED") return "这条会话已被其他人修改（VERSION_CHANGED），请刷新后重试。";
    if (failure.reasonCode === "TITLE_INVALID") return "标题不合法（TITLE_INVALID）。";
    if (failure.reasonCode === "THREAD_ARCHIVED_READONLY") return "会话已归档，只读（THREAD_ARCHIVED_READONLY）。";
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}

function chatHref(projectId: string, threadId: string): string {
  const query = new URLSearchParams({ projectId, thread: threadId });
  return `/chat?${query.toString()}`;
}
