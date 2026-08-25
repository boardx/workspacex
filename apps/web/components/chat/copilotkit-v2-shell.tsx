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
import {
  createPersonalThread, listPersonalThreads, listThreadArtifacts, listThreadAttachments,
  type ListThreadArtifactsOut, type ListThreadAttachmentsOut, type ListThreadsOut,
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
  const [artifactsFailure, setArtifactsFailure] = React.useState<{ key: string; value: string } | null>(null);
  const [materialsFailure, setMaterialsFailure] = React.useState<{ key: string; value: string } | null>(null);
  const [rightLoadingKey, setRightLoadingKey] = React.useState<string | null>(null);
  const rightGeneration = React.useRef(0);

  const artifacts = artifactsResult?.key === rightKey ? artifactsResult.value : null;
  const materials = materialsResult?.key === rightKey ? materialsResult.value : null;
  const artifactsError = artifactsFailure?.key === rightKey ? artifactsFailure.value : null;
  const materialsError = materialsFailure?.key === rightKey ? materialsFailure.value : null;
  const rightLoading = rightKey !== null && rightLoadingKey === rightKey;

  const loadRightPanel = React.useCallback(async () => {
    if (!bearer || !selectedThreadId) return;
    const key = `${bearer} ${selectedThreadId}`;
    const threadId = selectedThreadId;
    const generation = ++rightGeneration.current;
    setRightLoadingKey(key);
    setArtifactsFailure(null);
    setMaterialsFailure(null);
    const [nextArtifacts, nextMaterials] = await Promise.allSettled([
      listThreadArtifacts(threadId, null, bearer),
      listThreadAttachments(threadId, null, bearer),
    ]);
    if (generation !== rightGeneration.current) return;
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
        </div>
        {listError ? (
          <p className="px-3 text-11 text-destructive" data-testid="copilotkit-v2-thread-list-error">{listError}</p>
        ) : null}
        {!canCreate ? null : null}
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
          ) : (
            (threads?.groups ?? []).map((group) => (
              <React.Fragment key={group.label}>
                <p className="px-1 pb-0.5 pt-2 text-10 font-medium text-muted-foreground">{group.label}</p>
                {group.cards.map((card) => (
                  <ThreadCardButton
                    key={card.id}
                    card={card}
                    selected={card.id === selectedThreadId}
                    onSelect={() => selectThread(card.id)}
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
          threadAttachments={materials?.items ?? null}
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
