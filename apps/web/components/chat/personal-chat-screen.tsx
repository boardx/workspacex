"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, RefreshCw } from "lucide-react";
import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/lib/api-client";
import {
  createPersonalThread,
  getThread,
  listPersonalThreads,
  type GetAgentPanelOut,
  type GetThreadOut,
  type ListThreadsOut,
  type ThreadCard,
} from "@/lib/live-chat";

/**
 * 🔴 #594 —— 个人对话（无项目）。**人类原话："马上做前端，否则我没法用"**，
 * 这是当前最高优先级，最小可用范围：列表 + 建线程 + 选中 + 发消息/看回复。
 *
 * ## 为什么另起一个组件，不往 `ChatReadScreen`（797 行）里加分支
 *
 * `ChatReadScreen` 里每一处状态（`sourceKey`/`loadThreads`/`handleCreate`/
 * `handleRename`/`handleDelete`/`runRosterMutation`）都以 `if (!projectId) return`
 * 起手，深度耦合非空 `projectId`。逐处插分支意味着改一个正在被大量既有 e2e/组件
 * 测试锚定的文件，而这次没有时间给每一处改动配等量的测试覆盖——那正是"仓促改一个
 * 未经充分测试覆盖的大组件，在时间压力下引入真实 bug"的形状。另起一个小组件，
 * 项目路径**一行没动**，新组件自己的问题也只影响新组件自己的用户。
 *
 * ## 本轮明确不做（人类已授权延后）
 *
 * 改名、删除、agent 编制（roster）——那三样在后端目前也没有个人线程版本
 * （`mutateExisting` 虽然接受 `projectId: null`，但改名/删除本身的产品化 UI
 * 本轮不做；`getAgentPanel`/`updateAgentRoster` 本身没有改过，仍要求非空
 * `projectId`，个人线程走这条会直接 400/404，所以本组件压根不调用它们）。
 *
 * ## agentId 怎么来——一个如实暴露的既有缺口，不是本组件藏起来的
 *
 * 本仓**没有任何已挂载的路由能列出组织的 agent 目录**（`GET /agents` 契约操作
 * `listAgents` 从未接控制器，`grep -rn '"/agents"' apps/api/src/interface`
 * 零命中——这是比 #594 更早的缺口，项目内会话的编制面板同样要求"填组织 agent
 * 目录里的 id"，不是下拉选择）。⇒ 本组件同样只能让用户**手填一个已知的 agent id**，
 * 不伪造一个"浏览目录"的假象。
 */
interface Sourced<T> {
  readonly key: string;
  readonly value: T;
}

export function PersonalChatScreen({ initialThreadId }: { initialThreadId: string | null }) {
  const router = useRouter();
  const { session } = useSession();
  const bearer = session?.sessionToken ?? null;
  const currentOrgId = session?.currentOrgId ?? null;
  const sourceKey = bearer && currentOrgId ? `${currentOrgId} ${bearer}` : null;

  const [threadResult, setThreadResult] = React.useState<Sourced<ListThreadsOut> | null>(null);
  const [listLoadingKey, setListLoadingKey] = React.useState<string | null>(null);
  const [listFailure, setListFailure] = React.useState<Sourced<string> | null>(null);
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(initialThreadId);
  const detailKey = sourceKey && selectedThreadId ? `${sourceKey} ${selectedThreadId}` : null;
  const [detailResult, setDetailResult] = React.useState<Sourced<GetThreadOut> | null>(null);
  const [detailLoadingKey, setDetailLoadingKey] = React.useState<string | null>(null);
  const [detailFailure, setDetailFailure] = React.useState<Sourced<string> | null>(null);
  const listGeneration = React.useRef(0);
  const detailGeneration = React.useRef(0);

  const threads = threadResult?.key === sourceKey ? threadResult.value : null;
  const listLoading = listLoadingKey === sourceKey;
  const listError = listFailure?.key === sourceKey ? listFailure.value : null;
  const detail = detailResult?.key === detailKey ? detailResult.value : null;
  /**
   * 🔴 实测发现的真实 bug（活体浏览器验证时抓到，不是靠猜的）：
   * `detailLoadingKey` 与 `detailKey` 初始值都是 `null`，`null === null` 为真，
   * 于是**在还没选中任何线程时**，"正在读取线程详情…" 会永远显示，盖住了
   * 本该出现的"从左侧新建或选择一条个人对话"空态——两者都没有任何网络请求
   * 在飞，却显示成"正在加载"。修法是把"没有可比较的 key"这件事显式排除掉，
   * 不能只靠两个 `null` 巧合相等。
   */
  const detailLoading = detailKey !== null && detailLoadingKey === detailKey;
  const detailError = detailFailure?.key === detailKey ? detailFailure.value : null;

  const loadThreads = React.useCallback(async () => {
    if (!bearer || !sourceKey) return;
    const key = sourceKey;
    const generation = ++listGeneration.current;
    setListLoadingKey(key);
    setListFailure(null);
    try {
      const result = await listPersonalThreads({}, bearer);
      if (generation !== listGeneration.current) return;
      setThreadResult({ key, value: result });
    } catch (failure) {
      if (generation !== listGeneration.current) return;
      setThreadResult(null);
      setListFailure({ key, value: describeFailure(failure) });
    } finally {
      if (generation === listGeneration.current) setListLoadingKey(null);
    }
  }, [bearer, sourceKey]);

  React.useEffect(() => {
    if (sourceKey) void loadThreads();
    return () => {
      listGeneration.current += 1;
    };
  }, [loadThreads, sourceKey]);

  const loadSelectedThread = React.useCallback(async () => {
    if (!selectedThreadId || !bearer || !detailKey) return;
    const key = detailKey;
    const generation = ++detailGeneration.current;
    setDetailLoadingKey(key);
    setDetailFailure(null);
    try {
      const result = await getThread(selectedThreadId, null, bearer);
      if (generation !== detailGeneration.current) return;
      setDetailResult({ key, value: result });
    } catch (failure) {
      if (generation !== detailGeneration.current) return;
      setDetailResult(null);
      setDetailFailure({ key, value: describeFailure(failure) });
    } finally {
      if (generation === detailGeneration.current) setDetailLoadingKey(null);
    }
  }, [bearer, detailKey, selectedThreadId]);

  React.useEffect(() => {
    if (selectedThreadId) void loadSelectedThread();
    return () => {
      detailGeneration.current += 1;
    };
  }, [loadSelectedThread, selectedThreadId]);

  const [createPending, setCreatePending] = React.useState(false);
  const [createFailure, setCreateFailure] = React.useState<string | null>(null);
  const [titleDraft, setTitleDraft] = React.useState("");

  const handleCreate = React.useCallback(async (title: string) => {
    if (!sourceKey || !bearer) return;
    setCreatePending(true);
    setCreateFailure(null);
    try {
      const result = await createPersonalThread(title);
      // 先等服务端返回，再从服务端重新读列表——同 ChatReadScreen 的既有纪律，
      // 不做乐观更新（乐观更新会在服务端拒绝时先给用户一个假的成功画面）。
      const refreshed = await listPersonalThreads({}, bearer);
      setThreadResult({ key: sourceKey, value: refreshed });
      setSelectedThreadId(result.threadId);
      router.replace(personalChatHref(result.threadId));
    } catch (failure) {
      setCreateFailure(describeFailure(failure));
    } finally {
      setCreatePending(false);
    }
  }, [bearer, router, sourceKey]);

  const cards = threads?.groups.flatMap((group) => group.cards) ?? [];
  const selectedCard = cards.find((card) => card.id === selectedThreadId) ?? null;
  const canCreate = threads?.capabilities.includes("thread.mutate") ?? true;

  return (
    <AppShell
      previewRole={null}
      left={(
        <div className="flex flex-col" data-testid="chat-read-thread-list">
          <div className="flex flex-col gap-1 p-3">
            <span className="text-10 uppercase tracking-wide text-muted-foreground">我的对话</span>
            <span className="text-11 text-muted-foreground">不挂靠任何项目，仅自己可见</span>
          </div>
          {canCreate ? (
            <div className="flex flex-col gap-2 px-3 pb-3" data-testid="chat-thread-actions">
              <form
                data-testid="chat-thread-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = titleDraft.trim();
                  if (!title) return;
                  void handleCreate(title);
                  setTitleDraft("");
                }}
                className="flex flex-col gap-1"
              >
                <input
                  aria-label="新会话标题"
                  data-testid="chat-thread-title-input"
                  className="rounded-md border border-border-subtle px-2 py-1 text-12"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  placeholder="新对话的标题"
                />
                <Button
                  size="xs" variant="primary" type="submit" data-testid="chat-thread-title-submit"
                  disabled={createPending || titleDraft.trim() === ""}
                >
                  {createPending ? "创建中…" : "新建会话"}
                </Button>
              </form>
              {createFailure ? (
                <p className="text-11 text-destructive" data-testid="chat-thread-mutate-error">{createFailure}</p>
              ) : null}
            </div>
          ) : null}
          <Separator />
          {listLoading && threads === null ? <p className="p-3 text-12 text-muted-foreground">正在加载真实线程…</p> : null}
          {listError ? (
            <ErrorState testId="chat-thread-list-error" message={listError} retryTestId="chat-thread-list-retry" onRetry={() => void loadThreads()} />
          ) : null}
          {!listLoading && !listError && cards.length === 0 ? (
            <p className="p-3 text-12 text-muted-foreground" data-testid="chat-thread-list-empty">
              还没有个人对话，点上面「新建会话」开始第一次对话。
            </p>
          ) : null}
          {cards.length > 0 ? (
            <nav className="flex flex-col gap-3 p-3" aria-label="个人对话线程列表" data-testid="chat-thread-card-list">
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  data-testid={`chat-thread-${card.id}`}
                  aria-current={card.id === selectedThreadId ? "page" : undefined}
                  onClick={() => {
                    setSelectedThreadId(card.id);
                    router.replace(personalChatHref(card.id));
                  }}
                  className={[
                    "flex flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                    card.id === selectedThreadId ? "bg-muted" : "",
                  ].join(" ")}
                >
                  <span className="line-clamp-2 text-12 font-medium">{card.title}</span>
                  <ThreadMeta card={card} />
                </button>
              ))}
            </nav>
          ) : null}
        </div>
      )}
    >
      <PersonalThreadDetail
        card={selectedCard}
        detail={detail}
        bearer={bearer}
        loading={detailLoading}
        error={detailError}
        onRetry={() => void loadSelectedThread()}
      />
    </AppShell>
  );
}

function PersonalThreadDetail({
  card, detail, bearer, loading, error, onRetry,
}: {
  card: ThreadCard | null;
  detail: GetThreadOut | null;
  bearer: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  // 🔴 agentId 手填——本仓没有任何已挂载的「浏览组织 agent 目录」路由，
  //   见本文件头注。发消息前必须先知道一个真实存在、已发布的 agent id。
  const [agentIdDraft, setAgentIdDraft] = React.useState("");

  if (!detail) {
    if (loading) return <CenteredState>正在读取线程详情…</CenteredState>;
    if (error) return <ErrorState testId="chat-thread-detail-error" message={error} retryTestId="chat-thread-detail-retry" onRetry={onRetry} />;
    /**
     * ⚠ testid **刻意不用** `chat-missing-project-context`——那个名字连同「请先选择
     * 项目」这句文案是 `ChatReadScreen` 的既有拦截空态（`chat-read-screen.tsx:314`），
     * 被 `chat-read-screen.test.tsx`（直接渲染 `<ChatReadScreen projectId={null}>`，
     * 未受本次改动影响）与 `chat-read.spec.ts` 的旧用例锚定。这里语义完全不同
     * （"还没选中一条个人对话" ≠ "拒绝伪造项目上下文"），复用同一个 testid 会让两个
     * 不同的意思在将来某次改动里被误判成同一件事——同名不同义正是本仓漂移过五次的坑。
     */
    return (
      <div className="grid h-full place-items-center p-6" data-testid="chat-personal-no-selection">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <MessageSquare aria-hidden className="h-8 w-8 text-muted-foreground" />
          <h1 className="text-16 font-semibold">从左侧新建或选择一条个人对话</h1>
          <p className="text-12 text-muted-foreground">这些对话只有你自己能看到，不属于任何项目。</p>
        </div>
      </div>
    );
  }

  const agents: GetAgentPanelOut["agents"] | null = agentIdDraft.trim()
    ? [{ id: agentIdDraft.trim(), abbr: agentIdDraft.trim().slice(0, 2).toUpperCase(), name: agentIdDraft.trim(), duty: "个人对话", presence: "present" }]
    : null;

  return (
    <div className="flex h-full flex-col" data-testid="chat-thread-detail">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-14 font-semibold">{card?.title ?? detail.thread.id}</h1>
          <p className="text-10 text-muted-foreground">个人对话 · 线程 {detail.thread.id}</p>
        </div>
        <Badge tone="outline">真实消息</Badge>
      </header>
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <label className="text-10 text-muted-foreground" htmlFor="personal-chat-agent-id">
          Agent id（发消息前先填一个已发布的 agent id）
        </label>
        <input
          id="personal-chat-agent-id"
          data-testid="personal-chat-agent-id"
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-11"
          value={agentIdDraft}
          onChange={(event) => setAgentIdDraft(event.target.value)}
          placeholder="agent id"
        />
      </div>
      {bearer ? (
        <ChatLiveMessagePanel
          threadId={detail.thread.id}
          bearer={bearer}
          agents={agents}
          archived={detail.thread.archived}
        />
      ) : <CenteredState>登录已失效，无法读取或发送消息。</CenteredState>}
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
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}

function personalChatHref(threadId: string): string {
  const query = new URLSearchParams({ thread: threadId });
  return `/chat?${query.toString()}`;
}
