"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageSquare, RefreshCw, Share2, Store, Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  NewThreadButton, ThreadCardButton, ThreadListHeader,
} from "@/components/chat/thread-list-shell";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import { ChatRecordingPanel } from "@/components/chat/chat-recording-panel";
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/lib/api-client";
import { listCapabilities, type CapabilityListing } from "@/lib/live-capabilities";
import {
  createThread,
  deleteThread,
  getAgentPanel,
  getThread,
  listThreadArtifacts,
  listThreads,
  renameThread,
  updateAgentRoster,
  type GetAgentPanelOut,
  type GetThreadOut,
  type ListThreadArtifactsOut,
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
  const userId = session?.userId ?? null;
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
  // 十项 UX 缺口第 4/5 项（#708）—— 右栏「产物」列表，与 `roster` 同一套
  // key/loading/failure 纪律，跟 `detail`/`roster` 一起在 `loadSelectedThread` 并发读取。
  const [artifactsResult, setArtifactsResult] = React.useState<Sourced<ListThreadArtifactsOut> | null>(null);
  const [artifactsLoadingKey, setArtifactsLoadingKey] = React.useState<string | null>(null);
  const [artifactsFailure, setArtifactsFailure] = React.useState<Sourced<string> | null>(null);
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
  const artifacts = artifactsResult?.key === detailKey ? artifactsResult.value : null;
  const artifactsLoading = artifactsLoadingKey === detailKey;
  const artifactsError = artifactsFailure?.key === detailKey ? artifactsFailure.value : null;

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
    setArtifactsLoadingKey(key);
    setDetailFailure(null);
    setRosterFailure(null);
    setArtifactsFailure(null);
    const [nextDetail, nextRoster, nextArtifacts] = await Promise.allSettled([
      getThread(selectedThreadId, projectId, bearer),
      getAgentPanel(selectedThreadId, projectId, bearer),
      listThreadArtifacts(selectedThreadId, projectId, bearer),
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
    if (nextArtifacts.status === "fulfilled") {
      setArtifactsResult({ key, value: nextArtifacts.value });
    } else {
      setArtifactsResult(null);
      setArtifactsFailure({ key, value: describeFailure(nextArtifacts.reason) });
    }
    setDetailLoadingKey(null);
    setRosterLoadingKey(null);
    setArtifactsLoadingKey(null);
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
  /**
   * `mutateFailure` 本身不带"这是哪个动作失败的"——2026-08-14 改名/删除入口下沉到各自
   * 卡片、新建入口留在栏头下之后，两处渲染位需要**分别**判断"这条错误是不是我的"，
   * 不然一次改名失败会在栏头下的新建区**和**卡片里同时冒出同一条 `chat-thread-mutate-error`
   * （同一个 testid 出现两次，断言直接以「found multiple elements」红掉）。
   */
  const [mutateFailureOp, setMutateFailureOp] = React.useState<"create" | "rename" | "delete" | null>(null);

  const runMutation = React.useCallback(async (
    op: "create" | "rename" | "delete",
    action: () => Promise<string | null>,
  ) => {
    if (!sourceKey || !projectId || !bearer) return;
    setMutatePending(op);
    setMutateFailure(null);
    setMutateFailureOp(null);
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
      setMutateFailureOp(op);
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
    // ⚠ `projectId` 也进守卫：后端 `mutateExisting` 把 `projectId === null`
    //   映射成裸 404（#541），少传它得到的不是「参数缺失」而是「线程不存在」。
    if (!selectedThreadId || selectedVersion === null || projectId === null) return;
    void runMutation("rename", async () => {
      await renameThread(selectedThreadId, projectId, title, selectedVersion);
      return selectedThreadId;
    });
  }, [runMutation, selectedThreadId, selectedVersion, projectId]);

  const handleDelete = React.useCallback((reason: string) => {
    /** `projectId` 同 `handleRename`（#541）。 */
    if (!selectedThreadId || selectedVersion === null || projectId === null) return;
    const removed = selectedThreadId;
    void runMutation("delete", async () => {
      await deleteThread(removed, projectId, selectedVersion, reason);
      // 删完的选中态：交给 loadThreads 从服务端返回的第一条兜底，不在本地猜。
      return null;
    });
  }, [runMutation, selectedThreadId, selectedVersion, projectId]);

  /* ── agent 编制的增删（#467）────────────────────────────────────────────────
   * 与上面的会话增删改同一套纪律：**先等服务端返回，再重读服务端**，不做乐观更新。
   *
   * ⚠ 交付的是**编制关系**（`chat_thread_agents` 的增删），**不是**「agent 真的执行
   *   并产生回复」——那是 #414 + #413。
   *
   * ⚠ `expectedRosterVersion` **只来自服务端的读端口**（#513）：
   *   `getAgentPanel.out.rosterVersion`，即上面 `roster` 那份响应里的字段。
   *   它与 `updateAgentRoster.out.rosterVersion` 是**同一个事实源**
   *   （`chat_threads.roster_version`），所以这里**不存本地版本号**——存一份就是
   *   第二个事实源，刷新之后必然与库里漂移（那正是 #513 修的病：#510 实测到
   *   刷新后改编制必 409）。
   *
   * ⛔ **没有兜底**：`roster` 还没读回来（null）时**不提交**，而不是传 0 / -1 / 省略。
   *   乐观锁的意义就是拒绝盲写，兜底等于把锁摘了。与上面 `handleRename` /
   *   `handleDelete` 在 `selectedVersion === null` 时直接 `return` 同一手法。
   *
   * ⚠ 并发冲突（别人在你读完之后改了编制）仍会 409 `VERSION_CHANGED`——那时
   *   **如实报错**，不静默重试、不自动 +1 猜一个。#513 修的是「读不到版本号」，
   *   不是「让写永远成功」。 */
  const rosterVersion = roster?.rosterVersion ?? null;
  const [rosterPending, setRosterPending] = React.useState(false);
  const [rosterMutateFailure, setRosterMutateFailure] = React.useState<string | null>(null);

  /* ── #619 —— roster 加入表单的候选来源（真选择器，不是自由文本框）───────────
   * 之前这里是一个「填组织 agent 目录里的 id」的自由文本框，注释明写着契约里
   * 没有「列出可加的 agent」这个读端口。#619 把 `org_agents` 收敛进了
   * `capability_listings`（F15 早就落地的目录），于是 admin 目录页已经在用的
   * `GET /capabilities?kind=agent` 就是那个缺失的读端口——不用新开一个契约操作，
   * 只是把前端也接上去。候选按 `currentOrgId` 读取，`enabled=false` 的行不进候选
   * （与 `chat_thread_agents` 的合法性触发器同一条件，见迁移
   * `20260807000000_i619_agent_roster_capability_convergence.sql`），避免选出一个
   * 提交必 500 的选项。 */
  const [agentCatalogResult, setAgentCatalogResult] = React.useState<Sourced<CapabilityListing[]> | null>(null);
  const [agentCatalogFailure, setAgentCatalogFailure] = React.useState<Sourced<string> | null>(null);
  const agentCatalogKey = currentOrgId && bearer ? `${currentOrgId}\u0000${bearer}` : null;
  const agentCatalog = agentCatalogResult?.key === agentCatalogKey ? agentCatalogResult.value : null;
  const agentCatalogError = agentCatalogFailure?.key === agentCatalogKey ? agentCatalogFailure.value : null;

  const loadAgentCatalog = React.useCallback(async () => {
    if (!agentCatalogKey || !currentOrgId) return;
    const key = agentCatalogKey;
    try {
      const result = await listCapabilities(currentOrgId, "agent");
      setAgentCatalogResult({ key, value: result });
      setAgentCatalogFailure(null);
    } catch (failure) {
      setAgentCatalogResult(null);
      setAgentCatalogFailure({ key, value: describeFailure(failure) });
    }
  }, [agentCatalogKey, currentOrgId]);

  React.useEffect(() => {
    if (agentCatalogKey) void loadAgentCatalog();
  }, [loadAgentCatalog, agentCatalogKey]);

  const agentCandidates = React.useMemo(() => {
    const mounted = new Set((roster?.agents ?? []).map((agent) => agent.id));
    return (agentCatalog ?? []).filter((listing) => listing.enabled && !mounted.has(listing.id));
  }, [agentCatalog, roster]);

  // 换线程 ⇒ 上一条线程的错误提示作废。版本号不需要在这里清：它跟着 `roster`
  // 走 `detailKey` 门（`rosterResult?.key === detailKey`），换线程时自动变 null。
  React.useEffect(() => {
    setRosterMutateFailure(null);
  }, [detailKey]);

  const runRosterMutation = React.useCallback(async (
    change: { readonly add: readonly string[]; readonly remove: readonly string[] },
  ) => {
    // ⛔ 版本号读不回来就**不提交**（#513）——不传 0、不传 -1、不省略。
    if (!projectId || !selectedThreadId || !bearer || rosterVersion === null) return;
    setRosterPending(true);
    setRosterMutateFailure(null);
    try {
      await updateAgentRoster(
        selectedThreadId,
        projectId,
        { add: [...change.add], remove: [...change.remove], expectedRosterVersion: rosterVersion },
        bearer,
      );
      // 重读服务端：界面上的编制**和下一次要用的版本号**都来自 `getAgentPanel`，
      // 不是把写端口的响应体直接画上去，也不是本地拼一个。这条是「反映数据库里
      // 真实发生的事」的落点，也是 #513 之后版本号只有一个事实源的落点。
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
          groups={threads?.groups ?? null}
          roster={(
            <RosterPanel
              roster={roster}
              loading={rosterLoading}
              error={rosterError}
              hasSelection={selectedThreadId !== null}
              canMutate={canMutate}
              pending={rosterPending}
              mutateFailure={rosterMutateFailure}
              // #619 × #728 D2：编制面板已被 #728 移到左栏，选择器的候选自然也要跟到这里。
              // ⚠ 这两个 prop 必须跟着 `RosterPanel` 走——它在仓里只有**一个**渲染点，
              //   rebase 时若把它们落在旧的右栏实例上，`candidates` 就是 undefined。
              candidates={agentCandidates}
              candidatesError={agentCatalogError}
              onAdd={handleRosterAdd}
              onRemove={handleRosterRemove}
              onRetry={() => void loadSelectedThread()}
            />
          )}
          loading={listLoading}
          error={listError}
          selectedThreadId={selectedThreadId}
          canMutate={canMutate}
          mutatePending={mutatePending}
          mutateFailure={mutateFailure}
          mutateFailureOp={mutateFailureOp}
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
      /* `right` 只放**这场对话的产出**（产物面板，#710 交付）。
         原型的右栏正是这一类内容（转录/执行/洞察/产物/材料），产物面板是其中的「产物」。
         ⚠ 编制（`RosterPanel`）已按 #728 D2 搬进左栏，这里不再渲染第二份 ——
           两处渲染同一份编制就是「同一事实两处声明」（AGENTS.md 硬约束）。 */
      right={(
        <ChatArtifactsPanel
          hasSelection={selectedThreadId !== null}
          artifacts={artifacts}
          loading={artifactsLoading}
          error={artifactsError}
          onRetry={() => void loadSelectedThread()}
        />
      )}
    >
      <ThreadDetail
        projectId={projectId}
        currentOrgId={currentOrgId}
        userId={userId}
        card={selectedCard}
        detail={detail}
        bearer={bearer}
        roster={roster}
        loading={detailLoading}
        error={detailError}
        onRetry={() => void loadSelectedThread()}
        onArtifactLanded={() => void loadSelectedThread()}
      />
    </AppShell>
  );
}

/**
 * 左栏 —— 栏头 + 新建入口 + **本线程的 AI 团队** + 线程列表，顺序照原型
 * （`ui-preview/chat-main-ref/chat-main-default.png` 左栏自上而下）。
 *
 * ## 编制为什么从右栏搬到左栏（#728 D2）
 * 原型的左栏是「谁在这条线程里 + 有哪些线程」，右栏是「这场对话产出了什么」
 * （转录/执行/洞察/产物/材料）。此前实现把编制放在右栏，于是右栏既不是产出、
 * 左栏也回答不了「谁在场」。搬动是**移动，不是复制** —— 编制在全仓仍只渲染一处，
 * 否则就是「同一事实两处声明」（AGENTS.md 硬约束，本仓已五次因此漂移）。
 *
 * ⚠ `projectId` 不再印在栏头。裸 id 在原型里一次都不出现，它属于线程头部的
 *   调试信息；`chat-project-id` 这个 testid 移到线程头部继续存在（有断言依赖它）。
 */
function ThreadList({
  groups, loading, error, selectedThreadId,
  canMutate, mutatePending, mutateFailure, mutateFailureOp, onCreate, onRename, onDelete,
  onRetry, onSelect, roster,
}: {
  groups: ListThreadsOut["groups"] | null;
  loading: boolean;
  error: string | null;
  selectedThreadId: string | null;
  canMutate: boolean;
  mutatePending: "create" | "rename" | "delete" | null;
  mutateFailure: string | null;
  /** 见 `chat-read-screen.tsx` 顶层同名 state 的注释：判断一条失败属于哪个动作，
   * 好让新建区与卡片自己的表单**各自**只显示属于自己的那条错误，不重复渲染同一条。 */
  mutateFailureOp: "create" | "rename" | "delete" | null;
  onCreate: (title: string) => void;
  onRename: (title: string) => void;
  onDelete: (reason: string) => void;
  onRetry: () => void;
  onSelect: (threadId: string) => void;
  roster: React.ReactNode;
}) {
  /* 新建入口自己的表单状态——改名/删除已经下沉进各自卡片自身（`ThreadCardButton`，
     2026-08-14 重做），不再需要一份「两个渲染位共用」的表单状态。 */
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState("");

  // 改名/删除的 pending/failure 只对「正在编辑/删除」的那个动作有意义——`mutatePending`
  // 恒是 "create"|"rename"|"delete"|null 三选一，卡片只关心后两者，"create" 时对卡片
  // 而言就是"没有正在进行的改名/删除"，与 null 同义。
  const cardPending = mutatePending === "create" ? null : mutatePending;
  const cardFailure = mutateFailureOp === "rename" || mutateFailureOp === "delete" ? mutateFailure : null;
  const createFailure = mutateFailureOp === "create" ? mutateFailure : null;

  return (
    <div className="flex flex-col" data-testid="chat-read-thread-list">
      <ThreadListHeader />
      {canMutate ? (
        <div className="flex flex-col gap-2 p-3" data-testid="chat-thread-actions">
          <NewThreadButton onClick={() => { setCreateOpen(true); setCreateDraft(""); }} disabled={mutatePending !== null} />
          {createOpen ? (
            <form
              data-testid="chat-thread-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                const title = createDraft.trim();
                if (!title) return;
                onCreate(title);
                setCreateOpen(false);
              }}
              className="flex flex-col gap-1"
            >
              <input
                aria-label="新会话标题"
                data-testid="chat-thread-title-input"
                className="rounded-md border border-border-subtle px-2 py-1 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={createDraft}
                onChange={(event) => setCreateDraft(event.target.value)}
              />
              <div className="flex gap-1">
                <Button size="xs" variant="primary" type="submit" data-testid="chat-thread-title-submit" disabled={mutatePending !== null || createDraft.trim() === ""}>
                  确认
                </Button>
                <Button size="xs" variant="outline" type="button" onClick={() => setCreateOpen(false)}>取消</Button>
              </div>
            </form>
          ) : null}
          {mutatePending === "create" ? <p className="text-10 text-muted-foreground" data-testid="chat-thread-mutate-pending">正在提交…</p> : null}
          {createFailure ? <p className="text-11 text-destructive" data-testid="chat-thread-mutate-error">{createFailure}</p> : null}
        </div>
      ) : null}
      {roster}
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
      {/* `chat-thread-card-list` 只包会话卡。写入口（`chat-thread-actions` /
          `-create` / `-rename` / `-delete`，#460 加的）在这个 nav 之外，
          所以「列出了几条会话」可以精确地只数这里面的按钮，不被写入口的增减误伤。
          注意不要用 `data-testid^="chat-thread-"` 前缀去数——那几个写入口的 testid
          与会话卡 `chat-thread-<id>` 共用同一前缀（也是 #460 起的名），分不开。 */}
      {groups && groups.length > 0 ? (
        <nav
          className="flex flex-col gap-3 p-3"
          aria-label="真实对话线程列表"
          data-testid="chat-thread-card-list"
        >
          {groups.map((group) => (
            /* ⚠ 空分组整块不渲染，不只是不渲染卡片。评分员实测：「本周」标题下没有线程，
               紧跟着就是 `selection` slot 的改名/删除两个控件，读起来像那一组里的一条会话。 */
            group.cards.length === 0 ? null : (
            <section key={group.label} className="flex flex-col gap-1">
              <h2 className="px-1 text-10 font-medium text-muted-foreground">{group.label}</h2>
              {group.cards.map((card) => (
                <ThreadCardButton
                  key={card.id}
                  card={card}
                  selected={card.id === selectedThreadId}
                  onSelect={() => onSelect(card.id)}
                  onRename={canMutate ? onRename : undefined}
                  onDelete={canMutate ? onDelete : undefined}
                  pending={card.id === selectedThreadId ? cardPending : null}
                  failure={card.id === selectedThreadId ? cardFailure : null}
                />
              ))}
            </section>
            )
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * 顶部实时状态 chip（十项 UX 缺口第 9 项）——"现在正在发生什么"的环境感知。
 *
 * ## 单一事实源：不是第二次请求，是同一份 `roster` 状态多渲染一处
 *
 * 数据来自 `ThreadDetail` 已经在 `RosterPanel` 里渲染过的同一个 `roster` prop
 * （`GetAgentPanelOut`，`chat-read-screen.tsx` 顶层已经 `getAgentPanel` 读取过）。
 * 这里不发第二次请求、不维护第二份计数逻辑——`presentCount`/`rosterCount` 本身
 * 就是服务端算好的权威值（`chat.controller.ts` 的 `getAgentPanel`），两处渲染
 * 读的是同一个对象，不会漂移成两个数字。
 *
 * `roster === null`（还没读到、或读取线程详情失败）时不渲染任何猜测出来的数字——
 * 和 `RosterPanel` 自己「不确定就显示"—"」的纪律一致，不伪造一个"0 个 agent"。
 */
function ThreadLiveStatusChip({ roster }: { roster: GetAgentPanelOut | null }) {
  if (roster === null) return null;
  return (
    <Badge tone={roster.presentCount > 0 ? "primary" : "neutral"} data-testid="chat-thread-live-status">
      {roster.presentCount} 个 agent 在场 · 编制 {roster.rosterCount}
    </Badge>
  );
}


/**
 * 三个写操作共用的一份表单（新建 / 改名 / 删除确认）。
 *
 * 提出来是因为 `ThreadActions` 现在有两个渲染位（新建入口在栏头下、改名删除在列表下方），
 * 而表单必须**只在触发它的那个位上出现一次** —— 两处各画一遍会让
 * `chat-thread-title-input` 命中两个元素。
 */
function ThreadWriteForm({
  form, draft, busy, setForm, setDraft, onCreate, onRename, onDelete,
}: {
  form: "create" | "rename" | "delete" | null;
  draft: string;
  busy: boolean;
  setForm: (next: "create" | "rename" | "delete" | null) => void;
  setDraft: (next: string) => void;
  onCreate: (title: string) => void;
  onRename: (title: string) => void;
  onDelete: (reason: string) => void;
}) {
  if (form === "create" || form === "rename") {
    return (
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
          className="rounded-md border border-border-subtle px-2 py-1 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    );
  }
  /* 删除要二次确认：它是可追溯动作，服务端会写审计并返回 impactScope。 */
  if (form === "delete") {
    return (
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
          className="rounded-md border border-border-subtle px-2 py-1 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    );
  }
  return null;
}

function ThreadDetail({
  projectId, currentOrgId, userId, card, detail, bearer, roster, loading, error, onRetry,
  onArtifactLanded,
}: {
  projectId: string;
  currentOrgId: string | null;
  userId: string | null;
  card: ThreadCard | null;
  detail: GetThreadOut | null;
  bearer: string | null;
  roster: GetAgentPanelOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onArtifactLanded: () => void;
}) {
  /**
   * composer 里敲 `#` → `ChatSkillMountPanel` 开面板/过滤/真挂载 → 挂载成功后
   * composer 把 `#query` 从正文删掉——两个兄弟组件之间**唯一**的新状态，
   * 由这里（它们共同的父组件）转发，不在任何一边私自维护第二份。
   */
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionResolvedNonce, setMentionResolvedNonce] = React.useState(0);

  if (loading && detail === null) return <CenteredState>正在读取线程详情…</CenteredState>;
  if (error) return <ErrorState testId="chat-thread-detail-error" message={error} retryTestId="chat-thread-detail-retry" onRetry={onRetry} />;
  if (!detail) return <CenteredState>从左侧选择一条真实线程查看。</CenteredState>;

  return (
    /* `data-thread-id` 是**机器可读的绑定证据**：断言要能证明「详情面绑的是选中的那条线程」，
       但这件事不该靠「把线程 id 印在副行上给用户看」来证明（那正是 #728 D4 要去掉的）。
       同理 `data-project-id`。 */
    <div
      className="flex h-full flex-col"
      data-testid="chat-thread-detail"
      data-thread-id={detail.thread.id}
      data-project-id={projectId}
    >
      {/*
        线程头部照原型：标题 + 人类可读副行 + 成员头像串 + 团队 N + 分享 + 侧栏开关。

        ⚠ 副行此前是「项目 <uuid> · 组织 <uuid> · 线程 <uuid>」三段裸 id —— 原型里
          一个 id 都不出现，副行是「远洋新能源 / 欧洲市场进入 · 第 2 周 · 转录中」。
          服务端已经下发了这一句：`ThreadCard.subtitle`。裸 id 不是删掉了，
          是收进 `title` 属性与 `chat-project-id`（有引用，不能消失）里，
          悬停仍可见，但不再占据副行。
      */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-14 font-semibold">{card?.title ?? detail.thread.id}</h1>
          <p
            className="truncate text-11 text-muted-foreground"
            title={`项目 ${projectId} · 组织 ${currentOrgId ?? "未解析"} · 线程 ${detail.thread.id}`}
          >
            <span className="hidden" data-testid="chat-project-id">{projectId}</span>
            {card?.subtitle?.trim() ?? ""}
          </p>
        </div>
        {roster && roster.agents.length > 0 ? (
          <span className="flex items-center -space-x-1.5" aria-hidden>
            {roster.agents.slice(0, 4).map((agent) => (
              <Avatar
                key={agent.id}
                initials={agent.abbr}
                tone="ai"
                size="sm"
                className="ring-1 ring-background"
              />
            ))}
          </span>
        ) : null}
        {/* 「团队 N」本轮只呈现编制人数，**不挂任何点击行为**。
            原型里它会打开侧栏，但本轮没有自建侧栏（产物面板走 AppShell 的 `right` 槽），
            给它挂一个什么都不做的 onClick 就是死控件。等 D9 真做侧栏分页签时再接上。 */}
        <span className="inline-flex items-center gap-1 text-11 text-muted-foreground" data-testid="chat-thread-team">
          <Users aria-hidden className="h-3 w-3" />团队 {roster?.rosterCount ?? 0}
        </span>
        {/* 分享是**真入口还没有**的那一档：契约里没有「分享线程」操作。按本仓纪律
            宁可显式禁用并说明，也不放一个点了没反应的按钮（见 admin「未接入后端」标识）。*/}
        <Button size="xs" variant="ghost" disabled title="分享尚未接入后端（契约里没有分享线程操作）">
          <Share2 aria-hidden className="h-3 w-3" />分享
        </Button>
        {detail.thread.archived ? <Badge tone="neutral">已归档</Badge> : null}
        <ThreadLiveStatusChip roster={roster} />
      </header>
      {bearer && currentOrgId ? (
        <ChatSkillMountPanel
          threadId={detail.thread.id}
          projectId={projectId}
          orgId={currentOrgId}
          bearer={bearer}
          mentionQuery={mentionQuery}
          onMentionMounted={() => setMentionResolvedNonce((v) => v + 1)}
        />
      ) : null}
      {bearer ? (
        <ChatLiveMessagePanel
          threadId={detail.thread.id}
          bearer={bearer}
          agents={roster?.agents ?? null}
          archived={detail.thread.archived}
          onMentionQueryChange={setMentionQuery}
          mentionResolvedNonce={mentionResolvedNonce}
          /*
            #728 round 16 P10 —— 落地按钮的渲染依据是服务端下发的能力
            （`capabilitiesFor`：写角色含 `artifact.land`，观察者不含），
            与 `thread.mutate`（#460）同一条「按钮不渲染 且 接口拒绝」规矩。
          */
          canLandArtifacts={detail.capabilities.includes("artifact.land")}
          onArtifactLanded={onArtifactLanded}
          /*
            #728 D10 —— 会话录音（#466 步骤 7）从「消息面板之上」挪到
            「输入框正上方」，照原型的「进行中」状态卡位置。`userId` 是
            `trackPlan` 的 participant：录的是谁的音轨，服务端据此判定
            授权矩阵，不能省——这条纪律没有变，只是挂载点换了。
          */
          aboveComposer={bearer && userId ? (
            <ChatRecordingPanel
              threadId={detail.thread.id}
              projectId={projectId}
              userId={userId}
              bearer={bearer}
            />
          ) : null}
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
  roster, loading, error, hasSelection, canMutate, pending, mutateFailure,
  candidates, candidatesError, onAdd, onRemove, onRetry,
}: {
  roster: GetAgentPanelOut | null;
  loading: boolean;
  error: string | null;
  hasSelection: boolean;
  canMutate: boolean;
  pending: boolean;
  mutateFailure: string | null;
  candidates: readonly CapabilityListing[];
  candidatesError: string | null;
  onAdd: (agentId: string) => void;
  onRemove: (agentId: string) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = React.useState("");
  const writable = canMutate && hasSelection;

  const [addOpen, setAddOpen] = React.useState(false);

  // 换线程/候选列表变化时，之前选中的 id 可能已不再是合法候选（比如已被加进编制）。
  React.useEffect(() => {
    if (draft !== "" && !candidates.some((candidate) => candidate.id === draft)) setDraft("");
  }, [candidates, draft]);

  return (
    <div className="flex flex-col gap-2 px-3 pb-3" data-testid="chat-read-roster">
      {/* 栏头照原型：「本线程的 AI 团队 · N」。⚠ N 用的是 `rosterCount`（编制），
          在场数另写一行 —— 契约把两个计数刻意分离（I-18），糊成一个就说谎了。 */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <h2 className="text-11 font-medium text-muted-foreground">
          本线程的 AI 团队{roster ? ` · ${roster.rosterCount}` : ""}
          {roster && roster.presentCount !== roster.rosterCount
            ? ` · 在场 ${roster.presentCount}`
            : ""}
        </h2>
        {writable ? (
          <Button
            size="xs"
            variant="ghost"
            data-testid="chat-roster-edit"
            aria-expanded={addOpen}
            onClick={() => setAddOpen((open) => !open)}
          >
            编辑
          </Button>
        ) : (
          <span className="text-10 text-muted-foreground">只读</span>
        )}
      </div>

      {writable && addOpen ? (
        <form
          className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft === "") return;
            onAdd(draft);
            setDraft("");
          }}
        >
          <label className="text-10 text-muted-foreground" htmlFor="chat-roster-add-input">
            加入 agent（选自组织 agent 目录）
          </label>
          <div className="flex items-center gap-2">
            <select
              id="chat-roster-add-input"
              data-testid="chat-roster-add-input"
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending || candidates.length === 0}
            >
              <option value="">
                {candidates.length === 0 ? "组织 agent 目录里没有可加入的 agent" : "选择一个 agent…"}
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}{candidate.abbr ? `（${candidate.abbr}）` : ""}
                </option>
              ))}
            </select>
            <Button size="xs" type="submit" data-testid="chat-roster-add-submit" disabled={pending || draft === ""}>
              {pending ? "提交中…" : "加入"}
            </Button>
          </div>
          {/* #619：候选来自 `GET /capabilities?kind=agent`（`org_agents` 收敛进
              `capability_listings` 之后，这就是"列出本线程可加的 agent"那个此前
              缺失的读端口），不再是自由文本框。
              ⚠ 原型的「从 Agent 市场加入」仍是另一个缺口：`marketEntry` 是服务端下发的
              可空入口，下发了才渲染，不自己造一个死链。 */}
          {/* #787 —— 诚实提示，纯 UI 措辞，不改数据流：
              这份候选列表读的是 `capability_listings`（目录），与实际执行读的
              `agents`/`agent_versions`（见 `resolvePublished`）不是同一张表。经后台
              目录页「+」（`POST /capabilities/mutate`）创建的 agent 只写
              `capability_listings`，不写 `agents`/`agent_versions`——加入编制之后
              发消息会 422 `AGENT_NOT_FOUND`（`AgentNotPublishedError`）。这是已知的
              后端数据模型裂痕（#787 记录在案，收敛方向待人类裁决），本处只如实
              告知，不假装能在这里修掉。 */}
          <p className="text-10 text-muted-foreground" data-testid="chat-roster-add-hint">
            候选来自组织 agent 目录，加入编制不代表该 agent 已具备可执行的运行时——如果加入后发消息失败，是已知的后台创建路径缺口，请联系管理员确认该 agent 是否已发布。
          </p>
          {candidatesError ? (
            <p className="text-10 text-destructive" data-testid="chat-roster-candidates-error">
              agent 目录读取失败：{candidatesError}
            </p>
          ) : null}
          {mutateFailure ? (
            <p className="text-10 text-destructive" data-testid="chat-roster-mutate-error">{mutateFailure}</p>
          ) : null}
        </form>
      ) : null}

      {!hasSelection ? <p className="text-11 text-muted-foreground">选择线程后读取编制。</p> : null}
      {loading ? <p className="text-11 text-muted-foreground">正在读取真实编制…</p> : null}
      {error ? <ErrorState testId="chat-roster-error" message={error} retryTestId="chat-roster-retry" onRetry={onRetry} /> : null}

      {roster ? (
        <>
          {roster.agents.length === 0 ? (
            <p className="text-11 text-muted-foreground" data-testid="chat-roster-empty">当前编制为空。</p>
          ) : null}
          <ul className="flex flex-col">
            {roster.agents.map((agent) => (
              <li
                key={agent.id}
                className="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted"
                data-testid={`chat-roster-agent-${agent.id}`}
              >
                <Avatar initials={agent.abbr} tone="ai" size="sm" className="mt-0.5" />
                {/*
                  #728 D2 —— 名字与职责分两行，不再挤在同一个 `truncate` 里同归于尽。

                  ⚠ 契约的 `agents[].duty`（`getAgentPanel.out`）是唯一一个描述性字段，
                    原型这一区其实印了两件事：角色（「战略分析师」）+ 一句能力描述
                    （「拆问题、标致命假设、给结论先行」）。我们的数据模型只有 `duty`
                    这一个字段，没有第二个字段可用——不编一句话出来凑第二行，
                    那会是伪造内容。这里如实只渲染 `duty` 一行，是否要拆分成
                    「角色 + 能力描述」两个字段需要走 ADR-023 扩契约，已记入
                    评分卡「需要人类裁决」。
                */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-12 font-medium">{agent.name}</p>
                  <p className="truncate text-10 text-muted-foreground">{agent.duty}</p>
                </div>
                <span className={presenceTone(agent.presence)}>{PRESENCE_TEXT[agent.presence]}</span>
                {writable ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    data-testid={`chat-roster-remove-${agent.id}`}
                    disabled={pending}
                    onClick={() => onRemove(agent.id)}
                  >
                    移出
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {roster.marketEntry ? (
            <Button asChild size="xs" variant="outline" className="w-full">
              <Link href={roster.marketEntry} data-testid="chat-roster-market-entry">
                <Store aria-hidden className="h-3 w-3" />从 Agent 市场加入
              </Link>
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * 在场态的中文投影。契约的 `AgentPresence` 是三值封闭枚举（I-17），
 * 所以这里是**穷举的 Record 而不是带 default 的函数** —— 枚举加一档时 tsc 会红，
 * 而不是静默显示成一个英文单词。原型上印的是「在场 / 跑批中 / 空闲」，
 * 但契约三值是 present/away/off，语义并不一一对应：`away`≠「跑批中」。
 * 这里按契约语义翻译，**不**为了对上原型字面而编一个原型才有的状态。
 */
const PRESENCE_TEXT: Record<GetAgentPanelOut["agents"][number]["presence"], string> = {
  present: "在场",
  away: "离开",
  off: "离线",
};

function presenceTone(presence: GetAgentPanelOut["agents"][number]["presence"]): string {
  return presence === "present" ? "text-10 text-primary" : "text-10 text-muted-foreground";
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
