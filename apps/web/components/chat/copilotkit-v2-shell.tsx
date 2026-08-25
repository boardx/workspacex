"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import {
  NewThreadButton, ThreadCardButton, ThreadListHeader,
} from "@/components/chat/thread-list-shell";
import { useSession } from "@/components/session/session-provider";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import {
  createPersonalThread, getThread, listPersonalThreads, listThreadArtifacts, listThreadAttachments,
  type GetThreadOut, type ListThreadArtifactsOut, type ListThreadAttachmentsOut, type ListThreadsOut,
} from "@/lib/live-chat";

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

  return (
    <div className="flex h-full w-full">
      <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-border py-2" data-testid="copilotkit-v2-thread-sidebar">
        <ThreadListHeader title="CopilotKit 对话" />
        <div className="px-3">
          <NewThreadButton onClick={() => void handleCreate()} disabled={!bearer || createPending} />
        </div>
        {listError ? (
          <p className="px-3 text-11 text-destructive" data-testid="copilotkit-v2-thread-list-error">{listError}</p>
        ) : null}
        {!canCreate ? null : null}
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2" data-testid="copilotkit-v2-thread-list">
          {cards.length === 0 ? (
            <p className="px-1 py-2 text-11 text-muted-foreground">还没有对话，点上面「新建对话」开始第一次对话</p>
          ) : (
            cards.map((card) => (
              <ThreadCardButton
                key={card.id}
                card={card}
                selected={card.id === selectedThreadId}
                onSelect={() => selectThread(card.id)}
              />
            ))
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
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
