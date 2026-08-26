"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import {
  NewThreadButton, ThreadCardButton, ThreadListHeader,
} from "@/components/chat/thread-list-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/session/session-provider";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import { Input } from "@/components/ui/input";
import {
  createPersonalThread, deleteThread, getAgentPanel, getThread, listPersonalThreads,
  listThreadArtifacts, listThreadAttachments, renameThread, updateAgentRoster,
  type GetAgentPanelOut, type GetThreadOut, type ListThreadArtifactsOut,
  type ListThreadAttachmentsOut, type ListThreadsOut, type ThreadCard,
} from "@/lib/live-chat";
// issue #2052（CK-P7）—— 编制面板与旧轨道共用同一份组件，不重画。
import { RosterPanel } from "@/components/chat/chat-roster-panel";
import { describeMutateFailure } from "@/lib/chat-failure-copy";
import { listCapabilities, type CapabilityListing } from "@/lib/live-capabilities";
import { readPinnedThreadIds, togglePinnedThreadId } from "@/lib/chat-pinned-threads";

/**
 * issue #2021 —— CopilotKit v2（#2044 起原生住在 `/chat`）消息持久化 + 多线程管理外壳。
 *
 * ## 为什么是一个新组件，不是往 `copilotkit-v2-panel.tsx` 里堆
 *
 * `copilotkit-v2-panel.tsx` 已经 850+ 行，且它的职责是"驱动一条 CopilotKit 对话"
 * （`useAgent`/HITL/工具卡/语音输入……）。线程列表/新建/切换是**外壳**职责——与旧轨道
 * `personal-chat-screen.tsx` 把"消息面板"（`ChatLiveMessagePanel`）和"外壳"
 * （线程列表 + 路由）分成两个文件是同一个理由，同一个纪律（这里刻意复用旧轨道的外壳
 * 组件本身 `thread-list-shell.tsx`，不重新画一遍视觉）。
 *
 * ## 持久化 `chatThreadId` 复用旧轨道**同一张表**，不新建第二套存储
 *
 * `copilotkit-agui.controller.ts` 的 `runAguiBridgeTurn` 内部调用的正是
 * `mutateThread`（op:create, projectId:null）+ `acceptHumanMessage`——与旧轨道
 * `PersonalChatScreen`/`ChatLiveMessagePanel` 发消息走的**同一个** application 函数、
 * 同一张 `chat_threads`/`chat_messages` 表。这意味着：
 *   1. 这里的"新建对话"直接调用旧轨道已有的 `createPersonalThread`（`POST
 *      /chat/threads/mutate`）即可拿到一个真实、可续聊的 `threadId`，不需要新端点。
 *   2. 这里的线程列表直接调用旧轨道已有的 `listPersonalThreads`（`GET
 *      /chat/threads`）即可，返回的是该用户名下**全部**个人线程（不区分"从旧 UI
 *      创建的"还是"从这条新轨道创建的"——它们在后端语义上是同一种实体：一条个人
 *      对话线程，见 issue 描述与 `.harness/state/chat-feature-parity-gap-2026-08-25.md`
 *      第 1 项裁决记录）。这不是偷懒省事：如果为"CopilotKit 轨道的线程"另起一张表，
 *      才是真正的"同一事实两处声明"——同一个用户的同一条个人对话，不能因为这次是从
 *      哪个前端入口发的消息就分裂成两份历史。
 *
 * ## URL 同步用 `history.replaceState`，不用 `router.replace`
 *
 * 首次发消息时后端才创建线程（`resolveThreadId` 的 `null` 分支），resolvedThreadId
 * 通过 AG-UI `CUSTOM {name:"chat_thread_id"}` 事件异步到达，此时 assistant 回复可能
 * 仍在流式输出（SSE 连接还开着）。`router.replace` 会触发 Next App Router 的路由
 * 切换，把 `page.tsx` → `[threadId]/page.tsx` 之间的组件树重新挂载，直接打断正在飞
 * 的 SSE 连接、丢失尚未流完的回复。`window.history.replaceState` 只改地址栏，不触发
 * 任何 React 重挂载——地址栏因此始终反映"这条对话真实的持久化 id"，但当前这次
 * 流式回复不受影响；下次真正刷新页面时，浏览器按这个新地址重新加载，`[threadId]/
 * page.tsx` 才会用这个真实 id 挂载并从服务端回读历史。
 *
 * ## issue #2053 CK-P5「会话录音归档」为什么**没有**挂在这里（如实登记，不是漏做）
 *
 * 差距表 #8 要求把旧壳的 `ChatRecordingPanel`（`chat-live-recording-*` 锚点，走
 * `POST /recording/sessions`）平移到 composer 上方。读契约与路由后确认**今天做不了**，
 * 两条互相独立的硬事实：
 *   1. `packages/contracts/src/recording.ts` 的 `startRecording.in.projectId` 是
 *      `z.string()`——**非空**，且 err 含 `NO_PROJECT_ROLE`，服务端
 *      `RecordingController.requireProjectRole` 按项目角色判权。
 *   2. 本外壳的线程**全部**是个人线程（`createPersonalThread(null)` 建，
 *      `listPersonalThreads` 列，`thread.projectId === null`）；带 `?projectId=` 的
 *      项目内对话在 `/chat` 上至今仍路由到旧屏 `ChatReadScreen`（见
 *      `app/chat/page.tsx` 头注：项目上下文是差距表第 1 项未收敛的另一半）。
 * 两条合起来：v2 轨道上**不存在**任何一条能合法开始录音的线程。在这里挂一个
 * 恒不满足渲染条件的面板，等于往仓库里放一段永远跑不到的代码；挂一个不判条件的
 * 按钮，等于放一枚必然 400/`NO_PROJECT_ROLE` 的假按钮——两种都违反本仓纪律。
 * 解锁需要二选一，且都要人类签核，不在本 issue 擅自决定：
 *   (a) v2 轨道接入项目线程（差距表 #1 的剩余半边），录音随项目上下文自然可用；
 *   (b) 放宽 `startRecording` 契约让个人线程可录（授权矩阵与保留期在"无项目"时
 *       按什么判据解析，是一个需要重新签核的设计问题，不是改个 `.nullable()`）。
 *
 * ## issue #2053 CK-P8 的读侧接通了，写侧的缺口一并登记
 *
 * `chat_threads.archived` 真实存在、`getThread` 真实下发 ⇒ 只读态接的是真数据。
 * 但 `mutateThread.in.op` 只有 `create | rename | delete`——**契约里没有 archive
 * 操作**，用户从任何界面都归不了档；且 `ThreadCard`（列表项）没有 `archived` 字段，
 * 左栏无法给归档线程加标记。两处缺口都需要契约新增 + 签核，本 issue 不擅自加。
 *
 * 切换到**另一条**已有线程（`selectThread`）或点"新建对话"则用真正的 `router.push`——
 * 这两种操作本来就该是"离开当前对话、开始/进入另一条"，重新挂载面板（清空
 * `agent.messages`、给一个新的 CopilotKit 本地 `threadId`）正是期望行为，与
 * `copilotkit-v2-panel.tsx` 文件头「每次挂载是一次新对话语义」的既有纪律一致。
 */
export function CopilotKitV2Shell({ initialThreadId }: { initialThreadId: string | null }): JSX.Element {
  const router = useRouter();
  const { session } = useSession();
  const bearer = session?.sessionToken ?? null;
  const sourceKey = bearer ?? null;

  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(initialThreadId);
  React.useEffect(() => {
    setSelectedThreadId(initialThreadId);
  }, [initialThreadId]);

  const [threads, setThreads] = React.useState<ListThreadsOut | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const listGeneration = React.useRef(0);

  const reloadThreads = React.useCallback(async () => {
    if (!bearer) return;
    const generation = ++listGeneration.current;
    try {
      const result = await listPersonalThreads({}, bearer);
      if (generation !== listGeneration.current) return;
      setThreads(result);
      setListError(null);
    } catch (failure) {
      if (generation !== listGeneration.current) return;
      setListError(failure instanceof Error ? failure.message : "线程列表读取失败");
    }
  }, [bearer]);

  React.useEffect(() => {
    if (sourceKey) void reloadThreads();
  }, [sourceKey, reloadThreads]);

  /**
   * issue #2046（CK-P1）—— 右栏「产物」/「材料」，key/loading/failure 纪律与
   * `personal-chat-screen.tsx` #1824 那份逐字同套（key = bearer+threadId，防陈旧
   * 响应写进已切换的线程视图）。`projectId` 显式传 `null`：这些是个人线程。
   * 「材料」这份数据同时下传给消息面板作 `@` 引用候选（CK-P2）——同一份事实，
   * 不让面板发第二次请求。
   */
  const rightKey = bearer && selectedThreadId ? `${bearer} ${selectedThreadId}` : null;
  const [artifactsResult, setArtifactsResult] = React.useState<{ key: string; value: ListThreadArtifactsOut } | null>(null);
  const [materialsResult, setMaterialsResult] = React.useState<{ key: string; value: ListThreadAttachmentsOut } | null>(null);
  /**
   * issue #2053（CK-P6 / CK-P8）—— 线程详情。这是本外壳里**唯一**一处"当前这条线程
   * 是什么"的事实来源：`getThread` 一次调用同时给出
   *   · `thread.archived`  ⇒ CK-P8 只读态的判据（`chat_threads.archived` 的真实投影，
   *     不是前端编一个状态；`getThread` 对归档线程正常返回，不抛错——读 `get-thread.ts` 确认）
   *   · `capabilities`     ⇒ CK-P6「生成用户画像」的渲染门（含 `artifact.land` 才渲染，
   *     与旧轨道 `canLandArtifacts` 同一个服务端事实）
   *   · `thread.projectId` ⇒ CK-P5 会话录音能不能开的判据（见下方 `personalOnlyNote`）
   * 与「产物」/「材料」同一次 `loadRightPanel` 里取，共用同一把 key（bearer+threadId）
   * 与同一套陈旧响应防护——不为同一条线程另起第二条读取时序。
   *
   * ⚠ `projectId` 传 `null` 是正确的、不是偷懒：`resolveVisibility` 见 `projectId === null`
   *   就走个人线程分支，而本外壳的线程**全部**是个人线程（`createPersonalThread` 建、
   *   `listPersonalThreads` 列）。带 `?projectId=` 的项目内对话在 `/chat` 上仍路由到
   *   旧屏 `ChatReadScreen`（见 `app/chat/page.tsx` 头注），v2 轨道至今没有项目线程。
   */
  const [threadDetailResult, setThreadDetailResult] = React.useState<{ key: string; value: GetThreadOut } | null>(null);
  const [artifactsFailure, setArtifactsFailure] = React.useState<{ key: string; value: string } | null>(null);
  const [materialsFailure, setMaterialsFailure] = React.useState<{ key: string; value: string } | null>(null);
  const [rightLoadingKey, setRightLoadingKey] = React.useState<string | null>(null);
  const rightGeneration = React.useRef(0);

  const artifacts = artifactsResult?.key === rightKey ? artifactsResult.value : null;
  const materials = materialsResult?.key === rightKey ? materialsResult.value : null;
  const artifactsError = artifactsFailure?.key === rightKey ? artifactsFailure.value : null;
  const materialsError = materialsFailure?.key === rightKey ? materialsFailure.value : null;
  const rightLoading = rightKey !== null && rightLoadingKey === rightKey;

  const threadDetail = threadDetailResult?.key === rightKey ? threadDetailResult.value : null;
  /**
   * 详情读不到（尚未读回 / 读失败）时**保守取 `false`**：
   * · `archived: false` ⇒ 不会因为一次读取失败就把一条正常线程锁成只读（那是把
   *   基础设施抖动伪装成一个业务状态）；服务端仍是权威，真归档了写操作会被拒。
   * · `canGeneratePersona: false` ⇒ 不渲染入口。宁可少一个按钮，也不摆一个
   *   没有能力事实支撑、点下去可能 403 的按钮（同本仓「不渲染而不是渲染后禁用」纪律）。
   */
  const archived = threadDetail?.thread.archived ?? false;
  const canGeneratePersona = threadDetail?.capabilities.includes("artifact.land") ?? false;

  const loadRightPanel = React.useCallback(async () => {
    if (!bearer || !selectedThreadId) return;
    const key = `${bearer} ${selectedThreadId}`;
    const threadId = selectedThreadId;
    const generation = ++rightGeneration.current;
    setRightLoadingKey(key);
    setArtifactsFailure(null);
    setMaterialsFailure(null);
    const [nextArtifacts, nextMaterials, nextDetail] = await Promise.allSettled([
      listThreadArtifacts(threadId, null, bearer),
      listThreadAttachments(threadId, null, bearer),
      // issue #2053 —— 线程详情与右栏同批取。它自己失败**不**让右栏整体失败
      // （契约 getThread 的"部分成功"精神），只是 archived/能力回落到保守缺省。
      getThread(threadId, null, bearer),
    ]);
    if (generation !== rightGeneration.current) return;
    setThreadDetailResult(nextDetail.status === "fulfilled" ? { key, value: nextDetail.value } : null);
    if (nextArtifacts.status === "fulfilled") {
      setArtifactsResult({ key, value: nextArtifacts.value });
    } else {
      setArtifactsResult(null);
      setArtifactsFailure({ key, value: nextArtifacts.reason instanceof Error ? nextArtifacts.reason.message : "产物列表读取失败" });
    }
    if (nextMaterials.status === "fulfilled") {
      setMaterialsResult({ key, value: nextMaterials.value });
    } else {
      setMaterialsResult(null);
      setMaterialsFailure({ key, value: nextMaterials.reason instanceof Error ? nextMaterials.reason.message : "材料列表读取失败" });
    }
    setRightLoadingKey(null);
  }, [bearer, selectedThreadId]);

  React.useEffect(() => {
    if (rightKey) void loadRightPanel();
    return () => {
      rightGeneration.current += 1;
    };
  }, [rightKey, loadRightPanel]);

  /* ── issue #2052（CK-P7）本会话的 agent 编制 ────────────────────────────────
   * #2025 把这半边明确延后，理由是"v2 的 threadId 是每次挂载的临时随机值，没有一条
   * 真实的 `chat_thread_agents` 可以增删"。#2028 落地持久化线程之后这个前提不成立了：
   * 这里的 `selectedThreadId` 就是 `chat_threads.id` 本身。
   *
   * ⚠ 与 `AgentPicker`（#2025，选"这条消息用哪个 agent 发"）语义不同，见面板栏头文案。
   *
   * ⚠ `projectId` 恒传 `null`：v2 外壳管的全是个人线程（`createPersonalThread`）。
   *   服务端这条路本轮才打通（controller 归一化 + `update-agent-roster.ts` 的
   *   `isPersonalThread` 豁免），不是一直就能用。
   *
   * 纪律照抄旧轨道 `chat-read-screen.tsx`：**先等服务端返回，再重读服务端**，不做乐观
   * 更新；`expectedRosterVersion` 只来自读端口 `getAgentPanel.out.rosterVersion`
   * （#513：本地存一份版本号就是第二个事实源，刷新后必 409），读不回来就**不提交**。
   */
  const [rosterResult, setRosterResult] = React.useState<{ key: string; value: GetAgentPanelOut } | null>(null);
  const [rosterFailure, setRosterFailure] = React.useState<{ key: string; value: string } | null>(null);
  const [rosterPending, setRosterPending] = React.useState(false);
  const [rosterMutateFailure, setRosterMutateFailure] = React.useState<string | null>(null);
  const rosterGeneration = React.useRef(0);

  const roster = rosterResult?.key === rightKey ? rosterResult.value : null;
  const rosterError = rosterFailure?.key === rightKey ? rosterFailure.value : null;
  const rosterLoading = rightKey !== null && roster === null && rosterError === null;

  const loadRoster = React.useCallback(async () => {
    if (!bearer || !selectedThreadId) return;
    const key = `${bearer} ${selectedThreadId}`;
    const generation = ++rosterGeneration.current;
    try {
      const result = await getAgentPanel(selectedThreadId, null, bearer);
      if (generation !== rosterGeneration.current) return;
      setRosterResult({ key, value: result });
      setRosterFailure(null);
    } catch (failure) {
      if (generation !== rosterGeneration.current) return;
      setRosterResult(null);
      setRosterFailure({ key, value: failure instanceof Error ? failure.message : "编制读取失败" });
    }
  }, [bearer, selectedThreadId]);

  React.useEffect(() => {
    if (rightKey) void loadRoster();
    setRosterMutateFailure(null); // 换线程 ⇒ 上一条线程的错误提示作废
  }, [rightKey, loadRoster]);

  const [agentCatalog, setAgentCatalog] = React.useState<CapabilityListing[] | null>(null);
  const [agentCatalogError, setAgentCatalogError] = React.useState<string | null>(null);
  const currentOrgId = session?.currentOrgId ?? null;

  React.useEffect(() => {
    if (!currentOrgId || !bearer) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await listCapabilities(currentOrgId, "agent");
        if (cancelled) return;
        setAgentCatalog(result);
        setAgentCatalogError(null);
      } catch (failure) {
        if (cancelled) return;
        setAgentCatalog(null);
        setAgentCatalogError(failure instanceof Error ? failure.message : "agent 目录读取失败");
      }
    })();
    return () => { cancelled = true; };
  }, [currentOrgId, bearer]);

  const agentCandidates = React.useMemo(() => {
    const mounted = new Set((roster?.agents ?? []).map((agent) => agent.id));
    return (agentCatalog ?? []).filter((listing) => listing.enabled && !mounted.has(listing.id));
  }, [agentCatalog, roster]);

  const runRosterMutation = React.useCallback(async (
    change: { readonly add: readonly string[]; readonly remove: readonly string[] },
  ) => {
    // ⛔ 版本号读不回来就不提交（#513）——不传 0、不传 -1、不省略。乐观锁的意义
    //    就是拒绝盲写，兜底等于把锁摘了。
    const rosterVersion = roster?.rosterVersion ?? null;
    if (!bearer || !selectedThreadId || rosterVersion === null) return;
    setRosterPending(true);
    setRosterMutateFailure(null);
    try {
      await updateAgentRoster(
        selectedThreadId,
        null,
        { add: [...change.add], remove: [...change.remove], expectedRosterVersion: rosterVersion },
        bearer,
      );
      // 重读服务端：界面上的编制**和下一次要用的版本号**都来自 `getAgentPanel`，
      // 不把写端口的响应体直接画上去，也不本地拼一个（#513 之后版本号只有一个事实源）。
      await loadRoster();
    } catch (failure) {
      setRosterMutateFailure(describeMutateFailure(failure));
    } finally {
      setRosterPending(false);
    }
  }, [bearer, loadRoster, roster, selectedThreadId]);

  const [createPending, setCreatePending] = React.useState(false);

  const handleCreate = React.useCallback(async () => {
    if (!bearer) return;
    setCreatePending(true);
    try {
      const result = await createPersonalThread(null);
      await reloadThreads();
      router.push(`/chat/${result.threadId}`);
    } finally {
      setCreatePending(false);
    }
  }, [bearer, reloadThreads, router]);

  const selectThread = React.useCallback((threadId: string) => {
    if (threadId === selectedThreadId) return;
    router.push(`/chat/${threadId}`);
  }, [router, selectedThreadId]);

  /**
   * `copilotkit-v2-panel.tsx` 把这次调用挂在 `onThreadResolved` —— 见该文件新增的
   * prop。只在 URL 尚未带真实 id 时才需要写地址栏（`selectedThreadId === null`，
   * 即这是"新建对话即发第一条消息"这条路径）；已经带 id 打开的线程续聊不会触发这个
   * 分支（`chatThreadIdRef` 初始值已经等于 URL 里的 id，不会"resolve 出一个不同的
   * id"）。
   */
  const handleThreadResolved = React.useCallback((resolvedThreadId: string) => {
    setSelectedThreadId((prev) => {
      if (prev === resolvedThreadId) return prev;
      window.history.replaceState(null, "", `/chat/${resolvedThreadId}`);
      return resolvedThreadId;
    });
    void reloadThreads();
  }, [reloadThreads]);

  const cards = threads?.groups.flatMap((group) => group.cards) ?? [];
  const canCreate = threads?.capabilities.includes("thread.mutate") ?? true;

  /**
   * issue #2075（TW-P2-6）—— 改名 / 删除。
   *
   * v2 轨道此前**根本没有**这两个操作：`ThreadCardButton` 的 `canMutate` 是
   * `selected && onRename && onDelete`，这里两个回调都没传 ⇒ 「…」菜单一次都没渲染过，
   * 用户在 v2 上建的对话既改不了名也删不掉。这不是"视觉缺口"，是功能缺口。
   *
   * 乐观并发所需的 `version` 来自**已经在取的** `getThread`（`threadDetail`），
   * 不为此新发一次请求；写法与旧轨道 `personal-chat-screen.tsx` 的
   * `handleRename`/`handleDelete` 逐字同套（先等服务端返回再重读服务端，不做乐观更新），
   * 不另立第二套并发纪律。
   */
  const [mutatePending, setMutatePending] = React.useState<"rename" | "delete" | null>(null);
  const [mutateFailure, setMutateFailure] = React.useState<string | null>(null);
  const selectedVersion = threadDetail?.thread.version ?? null;

  const handleRename = React.useCallback(async (title: string) => {
    if (!bearer || !selectedThreadId || selectedVersion === null) return;
    setMutatePending("rename");
    setMutateFailure(null);
    try {
      await renameThread(selectedThreadId, null, title, selectedVersion);
      await reloadThreads();
      await loadRightPanel(); // 标题与 version 都变了，重读详情保持一致
    } catch (failure) {
      setMutateFailure(describeMutateFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, loadRightPanel, reloadThreads, selectedThreadId, selectedVersion]);

  const handleDelete = React.useCallback(async (reason: string) => {
    if (!bearer || !selectedThreadId || selectedVersion === null) return;
    const removed = selectedThreadId;
    setMutatePending("delete");
    setMutateFailure(null);
    try {
      await deleteThread(removed, null, selectedVersion, reason);
      const refreshed = await listPersonalThreads({}, bearer);
      setThreads(refreshed);
      const next = refreshed.groups.flatMap((group) => group.cards)[0]?.id ?? null;
      // 删掉的是当前这条 ⇒ 必须离开它的路由；一条都不剩就回 `/chat` 空状态。
      router.replace(next ? `/chat/${next}` : "/chat");
    } catch (failure) {
      setMutateFailure(describeMutateFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, router, selectedThreadId, selectedVersion]);

  /**
   * issue #2075（TW-P2-6）—— 搜索与置顶。
   *
   * 搜索是纯前端过滤：`listPersonalThreads` 契约里**没有**查询参数，服务端一次返回
   * 该用户的全部个人对话，所以在客户端过滤这份已经在手的数据是这条链路上唯一能做、
   * 也是正确的做法——不是"先做个假的等以后接后端"。
   *
   * 置顶的持久化范围与它做不到的事，见 `lib/chat-pinned-threads.ts` 的头注
   * （契约 `mutateThread.op` 是封闭枚举，跨设备置顶要签核，本 issue 不擅自加）。
   */
  const [query, setQuery] = React.useState("");
  const [pinnedIds, setPinnedIds] = React.useState<readonly string[]>([]);
  // localStorage 只在浏览器里有：首帧（SSR 与 hydration）一律空，挂载后再读，
  // 避免 hydration mismatch（同本文件麦克风那条 SSR/CSR 首帧分叉的教训）。
  React.useEffect(() => {
    setPinnedIds(readPinnedThreadIds());
  }, []);
  const togglePin = React.useCallback((threadId: string) => {
    setPinnedIds(togglePinnedThreadId(threadId));
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = React.useCallback(
    (card: ThreadCard) => normalizedQuery === "" || card.title.toLowerCase().includes(normalizedQuery),
    [normalizedQuery],
  );

  /**
   * 渲染分组 = 「置顶」组（若有）+ 服务端的时间分组（已置顶的从里面摘出去，
   * 免得同一条对话在列表里出现两次——那正是"同一事实两处"在列表层的形态）。
   */
  const renderGroups: { label: string; cards: ThreadCard[] }[] = [];
  const pinnedCards = cards.filter((card) => pinnedIds.includes(card.id)).filter(matchesQuery);
  if (pinnedCards.length > 0) renderGroups.push({ label: "置顶", cards: pinnedCards });
  for (const group of threads?.groups ?? []) {
    const rest = group.cards.filter((card) => !pinnedIds.includes(card.id)).filter(matchesQuery);
    if (rest.length > 0) renderGroups.push({ label: group.label, cards: rest });
  }
  const visibleCardCount = renderGroups.reduce((sum, group) => sum + group.cards.length, 0);

  /**
   * issue #2039（UIUX 三轮迭代第 1 轮 gap #2）—— 375px 响应式。此前 `w-64 shrink-0`
   * 侧栏在手机宽度常驻，把主区压到 ~119px（真栈实测横向溢出 313px，
   * `.copilotkit-v2-uiux/empty-mobile-375.png` 修复前版）。修法与旧轨道
   * `personal-chat-screen.tsx` 的 list/detail 同一心智：<md 只显示两者之一，
   * 顶部一个仅手机可见的开关在「对话列表 ↔ 当前对话」之间切换；≥md 两栏并排不变。
   * 路由跳转（选中线程/新建）天然重挂载本组件，`mobileListOpen` 自动归位。
   */
  const [mobileListOpen, setMobileListOpen] = React.useState(false);

  return (
    <div className="flex h-full w-full min-w-0 flex-col md:flex-row">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
        <Button
          size="xs"
          variant="outline"
          data-testid="copilotkit-v2-mobile-list-toggle"
          aria-expanded={mobileListOpen}
          onClick={() => setMobileListOpen((v) => !v)}
        >
          {mobileListOpen ? "返回当前对话" : "对话列表"}
        </Button>
      </div>
      <aside
        className={cn(
          "w-full shrink-0 flex-col gap-2 border-r border-border py-2 md:flex md:w-64",
          mobileListOpen ? "flex" : "hidden",
        )}
        data-testid="copilotkit-v2-thread-sidebar"
      >
        <ThreadListHeader />
        <div className="flex flex-col gap-1.5 px-3">
          <NewThreadButton onClick={() => void handleCreate()} disabled={!bearer || createPending} />
          {/* issue #2039（第 3 轮 gap #2，fidelity P2）——个人对话上下文如实说明，
              与旧轨道 `personal-chat-screen.tsx` 同一句文案，不画假项目名填空。 */}
          <p className="text-10 text-muted-foreground">不挂靠任何项目，仅自己可见</p>
          {/* issue #2075（TW-P2-6）—— 搜索。纯前端过滤已经在手的这份列表，
              理由见上面 `query` 声明处（契约里没有服务端查询参数）。 */}
          <Input
            type="search"
            data-testid="chat-task-workbench-thread-search"
            aria-label="搜索对话"
            placeholder="搜索对话标题"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {listError ? (
          <p className="px-3 text-11 text-destructive" data-testid="copilotkit-v2-thread-list-error">{listError}</p>
        ) : null}
        {/* ⚠ 改名/删除的失败信息**只**在卡片自己的表单里显示（`ThreadCardButton` 的
            `failure` prop，锚点 `chat-thread-mutate-error`）——在侧栏再印一份，就是同一件事
            声明在两处，且用户会看到两条一模一样的红字。 */}
        {!canCreate ? null : null}
        {/* issue #2052（CK-P7）—— 本会话编制。放在线程列表**之上**、与旧轨道
            （`chat-read-screen.tsx` 按 #728 D2 把编制搬进左栏）同一个位置语义：
            "这条对话有谁在" 属于会话上下文，不是消息操作。 */}
        {selectedThreadId !== null ? (
          <div className="border-b border-border-subtle pb-2">
            <RosterPanel
              roster={roster}
              loading={rosterLoading}
              error={rosterError}
              hasSelection={selectedThreadId !== null}
              // rebase 注：main 在这之后合入了 CK-P8（归档只读态，`getThread` 真实下发
              // `thread.archived`）。服务端 `update-agent-roster.ts` 本就对归档线程拒绝
              // （`THREAD_ARCHIVED_READONLY`），但按「按钮不渲染 且 接口拒绝」的既有
              // 纪律，编辑入口也不该在归档线程上渲染——不是新增能力，是让前端诚实
              // 反映服务端已经在拒的事。
              canMutate={canCreate && !archived}
              pending={rosterPending}
              mutateFailure={rosterMutateFailure}
              candidates={agentCandidates}
              candidatesError={agentCatalogError}
              onAdd={(agentId) => {
                const trimmed = agentId.trim();
                if (trimmed !== "") void runRosterMutation({ add: [trimmed], remove: [] });
              }}
              onRemove={(agentId) => void runRosterMutation({ add: [], remove: [agentId] })}
              onRetry={() => void loadRoster()}
            />
          </div>
        ) : null}
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2" data-testid="copilotkit-v2-thread-list">
          {/* issue #2039（第 2 轮 gap #2）——此前 `flatMap` 把服务端已经分好的
              「今天/本周」时间分组（`listPersonalThreads.out.groups[].label`，契约
              封闭枚举）压平丢掉了（fidelity rubric D3 明确要求分组）。这里按组渲染
              组头；空组服务端本来就不下发，不需要前端过滤。 */}
          {/* issue #2039（第 3 轮 gap #3，uiux-standards U1）——列表在读（threads
              还没回来）时给骨架行，不再闪一帧「还没有对话」的假空态。 */}
          {threads === null && listError === null ? (
            <div data-testid="loading" className="flex animate-pulse flex-col gap-2 px-1 py-2" aria-hidden>
              <div className="h-12 rounded-md bg-muted" />
              <div className="h-12 rounded-md bg-muted" />
              <div className="h-12 rounded-md bg-muted" />
            </div>
          ) : cards.length === 0 ? (
            <p className="px-1 py-2 text-11 text-muted-foreground">还没有对话，点上面「新建对话」开始第一次对话</p>
          ) : visibleCardCount === 0 ? (
            /* issue #2075（TW-P2-6）——"搜了但没搜到"必须与"一条对话都没有"分开说：
               前者要告诉用户是「这个词」没匹配上，不是他的对话丢了。 */
            <p className="px-1 py-2 text-11 text-muted-foreground" data-testid="chat-task-workbench-thread-search-empty">
              没有标题含「{query.trim()}」的对话。换个词，或点上面「新建对话」。
            </p>
          ) : (
            renderGroups.map((group) => (
              <React.Fragment key={group.label}>
                <p className="px-1 pb-0.5 pt-2 text-10 font-medium text-muted-foreground">{group.label}</p>
                {group.cards.map((card) => (
                  <ThreadCardButton
                    key={card.id}
                    card={card}
                    selected={card.id === selectedThreadId}
                    onSelect={() => selectThread(card.id)}
                    pinned={pinnedIds.includes(card.id)}
                    onTogglePin={() => togglePin(card.id)}
                    onRename={card.id === selectedThreadId ? (title) => void handleRename(title) : undefined}
                    onDelete={card.id === selectedThreadId ? (reason) => void handleDelete(reason) : undefined}
                    pending={card.id === selectedThreadId ? mutatePending : null}
                    failure={card.id === selectedThreadId ? mutateFailure : null}
                  />
                ))}
              </React.Fragment>
            ))
          )}
        </div>
      </aside>
      <div className={cn("min-w-0 flex-1", mobileListOpen ? "hidden md:block" : "block")}>
        {/*
          ⚠ `key` 用的是 `initialThreadId`（route 参数本身），不是 `selectedThreadId`
          （本组件内部状态）——两者绝大多数时候相等，但在
          "新建对话即发第一条消息、`handleThreadResolved` 异步写回真实 id" 这条路径上
          刻意不相等：那次只应该更新地址栏 + 侧栏高亮，不能触发 remount（见上面
          `handleThreadResolved` 的文档，一次 remount 会打断仍在飞的 SSE 流）。
          `initialThreadId` 只在真正的路由导航（切换线程 / 新建对话 / 整页刷新）时
          变化，是这里唯一安全的 remount 触发信号。
        */}
        <CopilotKitV2Panel
          key={initialThreadId ?? "new"}
          chatThreadId={selectedThreadId}
          onThreadResolved={handleThreadResolved}
          onMessageSent={() => void loadRightPanel()}
          /* issue #2050 —— 落地成功后重读右栏「产物」，让新产物真的出现在栏里。 */
          onArtifactLanded={() => void loadRightPanel()}
          threadAttachments={materials?.items ?? null}
          archived={archived}
          canGeneratePersona={canGeneratePersona}
        />
      </div>
      {/* issue #2046（CK-P1，人类 2026-08-25 原话「需要有右边的上传的文件列表和产物，
          现在都没有」）—— 右栏原样复用旧壳的「产物 + 材料」堆叠（`personal-chat-screen.tsx`
          #1824 同一布局、同一份组件、同一套空态/加载态/错误态），不另造第二份视觉。
          `uploadCtl` 传 `null`：composer 的附件控制器（含附件线程生命周期）在面板
          Body 层，上传入口已有 📎/全 surface 拖拽——材料栏本轮是读侧，不为一个
          跨三层的状态提升画一个半通的「+」。DA-13 的 `ActiveFilePanel` 仍在面板内
          （DA-15 事件至今没有真实生产者，生产环境不出现；等生产者落地再统一分区）。 */}
      <aside
        className="hidden w-72 shrink-0 flex-col border-l border-border md:flex"
        data-testid="copilotkit-v2-right-panel"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-b border-border-subtle">
          <ChatArtifactsPanel
            hasSelection={selectedThreadId !== null}
            artifacts={artifacts}
            loading={rightLoading}
            error={artifactsError}
            onRetry={() => void loadRightPanel()}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatMaterialsPanel
            hasSelection={selectedThreadId !== null}
            threadId={selectedThreadId}
            materials={materials}
            loading={rightLoading}
            error={materialsError}
            onRetry={() => void loadRightPanel()}
            uploadCtl={null}
          />
        </div>
      </aside>
    </div>
  );
}
