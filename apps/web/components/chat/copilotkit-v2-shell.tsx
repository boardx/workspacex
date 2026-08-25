"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import {
  NewThreadButton, ThreadCardButton, ThreadListHeader,
} from "@/components/chat/thread-list-shell";
import { useSession } from "@/components/session/session-provider";
import {
  createPersonalThread, listPersonalThreads, type ListThreadsOut,
} from "@/lib/live-chat";

/**
 * issue #2021 —— `/chat/copilotkit-v2` 消息持久化 + 多线程管理外壳。
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

  const [createPending, setCreatePending] = React.useState(false);

  const handleCreate = React.useCallback(async () => {
    if (!bearer) return;
    setCreatePending(true);
    try {
      const result = await createPersonalThread(null);
      await reloadThreads();
      router.push(`/chat/copilotkit-v2/${result.threadId}`);
    } finally {
      setCreatePending(false);
    }
  }, [bearer, reloadThreads, router]);

  const selectThread = React.useCallback((threadId: string) => {
    if (threadId === selectedThreadId) return;
    router.push(`/chat/copilotkit-v2/${threadId}`);
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
      window.history.replaceState(null, "", `/chat/copilotkit-v2/${resolvedThreadId}`);
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
        />
      </div>
    </div>
  );
}
