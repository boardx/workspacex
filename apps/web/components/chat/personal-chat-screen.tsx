"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, MessageSquare, RefreshCw } from "lucide-react";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import { useChatAttachments, type ChatAttachmentsController } from "@/components/chat/chat-composer-attachments";
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
import { ChatPopoverCoordinatorProvider } from "@/components/chat/chat-popover-coordinator";
import {
  NewThreadButton, ThreadCardButton, ThreadListHeader,
} from "@/components/chat/thread-list-shell";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/lib/api-client";
import { listCapabilities, type CapabilityListing } from "@/lib/live-capabilities";
import {
  createPersonalThread,
  deleteThread,
  getThread,
  listPersonalThreads,
  listThreadArtifacts,
  listThreadAttachments,
  renameThread,
  type GetAgentPanelOut,
  type GetThreadOut,
  type ListThreadArtifactsOut,
  type ListThreadAttachmentsOut,
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
 * ## 改名/删除已补上（2026-08-14 补入口 → 同日晚人类实测反馈"看不到"后重做成 hover 菜单）
 *
 * 本条注释此前写着"改名、删除...本轮不做"——那是 #594 首版的范围，**后端一直就绪**
 * （`mutateExisting` 早就接受 `projectId: null`，`personal-thread-no-project.test.ts`
 * 真库反证过），只是前端一直没有把入口做出来。第一版补的是"选中会话 → 列表下方常驻
 * 按钮"（照抄 `ChatReadScreen` 当时的形状），人类实测反馈找不到；入口本体现已下沉进
 * `ThreadCardButton`（`thread-list-shell.tsx`）自己的 hover「…」菜单 + 双击改名，
 * 见下方 `handleRename`/`handleDelete`——两条路径（本组件与 `ChatReadScreen`）共用
 * 同一个 `ThreadCardButton`，交互形状天然一致，不是分别维护两份。
 *
 * **agent 编制（roster）仍不做**：`getAgentPanel`/`updateAgentRoster` 本身没有改过，
 * 仍要求非空 `projectId`，个人线程走这条会直接 400/404——这条依旧是真实的后端缺口，
 * 不是前端疏漏，本轮不碰。
 *
 * ## agentId 怎么来——2026-08-07 从"手填"改成"真下拉"
 *
 * 上一版本这里写着"本仓没有任何已挂载的路由能列出组织的 agent 目录"，逼用户
 * 手填一个 id——这是"新建了 chat 却发不出消息"投诉的直接病灶：用户根本不知道
 * id 是什么。#458 已经把 `listCapabilities(orgId, "agent")`（组织能力目录读端口）
 * 挂通并验证可用（见 `apps/web/lib/live-capabilities.ts`），本组件复用同一个
 * 已验证的调用，把手填文本框换成真下拉。组织里一个 agent 都没有时（#617/#619
 * 刚接通建 agent 写路径，很可能还没人建过）不能死锁：下拉禁用 + 一条指向
 * `/admin/agent` 的明确提示，而不是空白的"没有可选 Agent"。
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
  /**
   * UI 评分 2026-08-23 第 10 项点名的不一致①：刚建的空线程在消息区渲染出三个
   * 骨架气泡（伪装成有历史），同一线程稍后又显示正确空态——自相矛盾。
   * 记住「本会话里刚创建的线程 id」，传给消息面板跳过首载骨架：我们**确知**
   * 它没有历史，骨架在这里不是加载提示，是错误暗示。
   */
  const justCreatedThreadIdRef = React.useRef<string | null>(null);
  const detailKey = sourceKey && selectedThreadId ? `${sourceKey} ${selectedThreadId}` : null;
  const [detailResult, setDetailResult] = React.useState<Sourced<GetThreadOut> | null>(null);
  const [detailLoadingKey, setDetailLoadingKey] = React.useState<string | null>(null);
  const [detailFailure, setDetailFailure] = React.useState<Sourced<string> | null>(null);
  /**
   * issue #1824 —— 右栏「产物」/「材料」，与 `chat-read-screen.tsx` D9 之后同一套
   * key/loading/failure 纪律，跟 `detail` 一起在 `loadSelectedThread` 并发读取。
   * `listThreadArtifacts`/`listThreadAttachments` 都已支持 `projectId: null`
   * （个人线程判权路径），这里传 `null`，不是 `undefined`。
   */
  const [artifactsResult, setArtifactsResult] = React.useState<Sourced<ListThreadArtifactsOut> | null>(null);
  const [artifactsLoadingKey, setArtifactsLoadingKey] = React.useState<string | null>(null);
  const [artifactsFailure, setArtifactsFailure] = React.useState<Sourced<string> | null>(null);
  const [materialsResult, setMaterialsResult] = React.useState<Sourced<ListThreadAttachmentsOut> | null>(null);
  const [materialsLoadingKey, setMaterialsLoadingKey] = React.useState<string | null>(null);
  const [materialsFailure, setMaterialsFailure] = React.useState<Sourced<string> | null>(null);
  const listGeneration = React.useRef(0);
  const detailGeneration = React.useRef(0);

  const threads = threadResult?.key === sourceKey ? threadResult.value : null;
  const listLoading = listLoadingKey === sourceKey;
  const listError = listFailure?.key === sourceKey ? listFailure.value : null;
  const detail = detailResult?.key === detailKey ? detailResult.value : null;
  const artifacts = artifactsResult?.key === detailKey ? artifactsResult.value : null;
  const artifactsLoading = artifactsLoadingKey === detailKey;
  const artifactsError = artifactsFailure?.key === detailKey ? artifactsFailure.value : null;
  const materials = materialsResult?.key === detailKey ? materialsResult.value : null;
  const materialsLoading = materialsLoadingKey === detailKey;
  const materialsError = materialsFailure?.key === detailKey ? materialsFailure.value : null;
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
    setArtifactsLoadingKey(key);
    setMaterialsLoadingKey(key);
    setDetailFailure(null);
    setArtifactsFailure(null);
    setMaterialsFailure(null);
    const [nextDetail, nextArtifacts, nextMaterials] = await Promise.allSettled([
      getThread(selectedThreadId, null, bearer),
      listThreadArtifacts(selectedThreadId, null, bearer),
      listThreadAttachments(selectedThreadId, null, bearer),
    ]);
    if (generation !== detailGeneration.current) return;
    if (nextDetail.status === "fulfilled") {
      setDetailResult({ key, value: nextDetail.value });
    } else {
      setDetailResult(null);
      setDetailFailure({ key, value: describeFailure(nextDetail.reason) });
    }
    if (nextArtifacts.status === "fulfilled") {
      setArtifactsResult({ key, value: nextArtifacts.value });
    } else {
      setArtifactsResult(null);
      setArtifactsFailure({ key, value: describeFailure(nextArtifacts.reason) });
    }
    if (nextMaterials.status === "fulfilled") {
      setMaterialsResult({ key, value: nextMaterials.value });
    } else {
      setMaterialsResult(null);
      setMaterialsFailure({ key, value: describeFailure(nextMaterials.reason) });
    }
    setDetailLoadingKey(null);
    setArtifactsLoadingKey(null);
    setMaterialsLoadingKey(null);
  }, [bearer, detailKey, selectedThreadId]);

  React.useEffect(() => {
    if (selectedThreadId) void loadSelectedThread();
    return () => {
      detailGeneration.current += 1;
    };
  }, [loadSelectedThread, selectedThreadId]);

  const [createPending, setCreatePending] = React.useState(false);
  const [createFailure, setCreateFailure] = React.useState<string | null>(null);

  const handleCreate = React.useCallback(async (title: string | null) => {
    if (!sourceKey || !bearer) return;
    setCreatePending(true);
    setCreateFailure(null);
    try {
      const result = await createPersonalThread(title);
      // 先等服务端返回，再从服务端重新读列表——同 ChatReadScreen 的既有纪律，
      // 不做乐观更新（乐观更新会在服务端拒绝时先给用户一个假的成功画面）。
      const refreshed = await listPersonalThreads({}, bearer);
      setThreadResult({ key: sourceKey, value: refreshed });
      justCreatedThreadIdRef.current = result.threadId;
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

  /**
   * issue #1824（同 `chat-read-screen.tsx` #1758 的既有手法）—— composer 的附件
   * 控制器提到这一层，与右栏「材料」面板头部的直传入口共享**同一份** pending 队列。
   * 这一层是 `ChatArtifactsPanel`/`ChatMaterialsPanel`（`right` 槽）与
   * `PersonalThreadDetail`（承载 `ChatLiveMessagePanel`）共同的父组件——两处是兄弟
   * 节点，不是父子，所以共享状态只能提到它们共同的父级。
   */
  const attach = useChatAttachments({ threadId: selectedThreadId ?? "", bearer: bearer ?? undefined });

  /**
   * 改名/删除（2026-08-14 起，2026-08-30 改为按需取版本号）——同一套「先等服务端
   * 返回，再重读服务端」纪律，与上面 `handleCreate` 一致，不做乐观更新。`projectId`
   * 显式传 `null`：这是一条个人线程，`renameThread`/`deleteThread` 从 2026-08-14
   * 起接受这个值（见两者各自的文档注释——此前误传 `null` 是 #541 的 bug，现在是本该
   * 如此的值）。
   *
   * ⚠ 2026-08-30 人类裁决（回应"hover 没选中的卡片看不到「…」菜单"）：改名/删除不再
   *   要求"这条线程当前是选中的那条"——`ThreadCardButton` 现在对任意卡片都渲染菜单
   *   入口（`thread-list-shell.tsx` 头注），版本号也就不能再从 `detail`（只读被选中
   *   线程）里取。这里改成提交那一刻现取：调用方传入具体的 `threadId`，先
   *   `getThread` 拿它的最新版本号，再带着这个刚读到的版本号提交——版本号仍然只有
   *   服务端读端口一个事实源（#513 那条纪律没有变），只是取的时机从"卡片渲染时"
   *   推迟到"提交时"，不再要求它恰好是当前选中线程。
   *
   * `mutatingThreadId` 记的是"当前正在改名/删除的是哪一条"，与 `selectedThreadId`
   * 分开——否则同时 hover/操作一条未选中的卡片时，pending/失败提示会错渲到当前选中
   * 的另一张卡片上（那张卡片什么都没做，用户会看到一条无关的"正在提交…"）。
   */
  const [mutatingThreadId, setMutatingThreadId] = React.useState<string | null>(null);
  const [mutatePending, setMutatePending] = React.useState<"rename" | "delete" | null>(null);
  const [mutateFailure, setMutateFailure] = React.useState<string | null>(null);

  const handleRename = React.useCallback(async (threadId: string, title: string) => {
    if (!sourceKey || !bearer) return;
    setMutatingThreadId(threadId);
    setMutatePending("rename");
    setMutateFailure(null);
    try {
      const target = await getThread(threadId, null, bearer);
      await renameThread(threadId, null, title, target.thread.version);
      const refreshed = await listPersonalThreads({}, bearer);
      setThreadResult({ key: sourceKey, value: refreshed });
      if (threadId === selectedThreadId) void loadSelectedThread(); // 标题进了 detail 的可读副行，重读一次保持一致
    } catch (failure) {
      setMutateFailure(describeFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, loadSelectedThread, selectedThreadId, sourceKey]);

  const handleDelete = React.useCallback(async (threadId: string, reason: string) => {
    if (!sourceKey || !bearer) return;
    setMutatingThreadId(threadId);
    setMutatePending("delete");
    setMutateFailure(null);
    try {
      const target = await getThread(threadId, null, bearer);
      await deleteThread(threadId, null, target.thread.version, reason);
      const refreshed = await listPersonalThreads({}, bearer);
      const remaining = refreshed.groups.flatMap((group) => group.cards);
      setThreadResult({ key: sourceKey, value: refreshed });
      // 删的不是当前选中的那条 ⇒ 选中态、路由都不该动，用户还在看别的线程。
      if (threadId === selectedThreadId) {
        // 删完的选中态：交给服务端返回的第一条兜底（同 ChatReadScreen 的既有纪律），
        // 一条都不剩就清空选中，回退到"从左侧新建或选择"的空态。
        const next = remaining[0]?.id ?? null;
        setSelectedThreadId(next);
        // 2026-08-25 默认入口翻转后裸 /chat redirect 到 v2——删掉最后一条线程后
        // 必须留在旧屏世界（/chat/legacy），不能把用户弹进另一条轨道。
        router.replace(next ? personalChatHref(next) : "/chat/legacy");
      }
    } catch (failure) {
      setMutateFailure(describeFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, router, selectedThreadId, sourceKey]);

  /**
   * 手机端真实 bug（人类实测报告，2026-08-07）：`AppShell` 的 `left` 栏在 `<md` 断点
   * 整个 `hidden`（见该组件头注"改用底部一级 tab"），但 `/chat` 从没实现那个替代
   * 导航——手机上会话列表**完全不可达**，连"从左侧新建或选择"这句空态文案指向的
   * 那个"左侧"都不存在。这里不改 `AppShell`（全站共用，牵动面太大），只在本组件
   * 内做经典的 list/detail 手机响应式：没选中线程时把同一份列表内容也渲进主区域
   * （`md:hidden`，桌面端已经在 `aside` 里看得到，不重复渲染），选中后给一个仅手机可见
   * 的返回按钮清空选中态——桌面端两个分支的可见性完全不变。
   */
  const threadListPanel = (
    <div className="flex flex-col" data-testid="chat-read-thread-list">
          {/* 与项目对话共用同一个栏头（人类 2026-08-08 裁决：个人对话复用项目对话的壳）。
              「不挂靠任何项目，仅自己可见」这句移到新建区下面——它是这条路径的说明，
              不该占据栏头那一行（原型栏头只有标题与快捷键）。 */}
          <ThreadListHeader />
          {canCreate ? (
            <div className="flex flex-col gap-2 px-3 pb-3" data-testid="chat-thread-actions">
              {/* 一键即建（2026-08-11 人类裁决，对齐 ChatGPT/Claude）：点「新建对话」直接建一条
                  自动命名的个人线程并落进去，光标即在输入框——去掉「先填标题再点确认」那两步。
                  标题留空由服务端起默认名（mutate-thread 的 titleForPersonalCreate，兑现原占位符
                  「留空则自动命名」这句此前实为假承诺、会 422 的话）。按内容自动命名（取首条消息）
                  是紧接着的后续。旧的标题输入表单已删——个人线程改名 UI 本就未产品化，一键路径下
                  它只剩「多点一次确认」的纯摩擦。 */}
              <NewThreadButton onClick={() => void handleCreate(null)} disabled={createPending} />
              {createFailure ? (
                <p className="text-11 text-destructive" data-testid="chat-thread-mutate-error">{createFailure}</p>
              ) : null}
              <p className="text-10 text-muted-foreground">不挂靠任何项目，仅自己可见</p>
            </div>
          ) : null}
          <Separator />
          {listLoading && threads === null ? <p className="p-3 text-12 text-muted-foreground">正在加载线程…</p> : null}
          {listError ? (
            <ErrorState testId="chat-thread-list-error" message={listError} retryTestId="chat-thread-list-retry" onRetry={() => void loadThreads()} />
          ) : null}
          {!listLoading && !listError && cards.length === 0 ? (
            <p className="p-3 text-12 text-muted-foreground" data-testid="chat-thread-list-empty">
              还没有个人对话，点上面「新建对话」开始第一次对话。
            </p>
          ) : null}
          {cards.length > 0 ? (
            <nav className="flex flex-col gap-3 p-3" aria-label="个人对话线程列表" data-testid="chat-thread-card-list">
              {cards.map((card) => (
                <ThreadCardButton
                  key={card.id}
                  card={card}
                  selected={card.id === selectedThreadId}
                  onSelect={() => {
                    setSelectedThreadId(card.id);
                    router.replace(personalChatHref(card.id));
                  }}
                  onRename={canCreate ? (title) => void handleRename(card.id, title) : undefined}
                  onDelete={canCreate ? (reason) => void handleDelete(card.id, reason) : undefined}
                  pending={card.id === mutatingThreadId ? mutatePending : null}
                  failure={card.id === mutatingThreadId ? mutateFailure : null}
                />
              ))}
            </nav>
          ) : null}
    </div>
  );

  const isDesktop = useIsDesktop();
  // `AppShell` 的 `aside`（`left` prop）本身就是 CSS `hidden md:block`——手机上它
  // 不可见但仍在 DOM 里。桌面态才把同一份内容也交给它；手机态干脆不传，避免同一份
  // `data-testid`（如 `chat-thread-${id}`）在 DOM 里出现两份，让 `getByTestId`
  // 之类的唯一性查询在 jsdom（不跑 CSS 媒体查询，两份都"可见"）下直接炸掉。
  const showThreadListInMain = selectedThreadId === null && !isDesktop;

  return (
    <AppShell
      previewRole={null}
      hideTopBar
      left={isDesktop ? threadListPanel : undefined}
      /* issue #1824 —— 个人对话之前完全没有右栏。原样复用 `chat-read-screen.tsx`
         D9 之后的模式（产物 + 材料两个堆叠区块），同一份组件、同一套空态/加载态/
         错误态/点击预览逻辑，不另造第二份。 */
      right={(
        <div className="flex h-full flex-col" data-testid="chat-right-panel-stack">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-b border-border-subtle">
            <ChatArtifactsPanel
              hasSelection={selectedThreadId !== null}
              artifacts={artifacts}
              loading={artifactsLoading}
              error={artifactsError}
              onRetry={() => void loadSelectedThread()}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ChatMaterialsPanel
              hasSelection={selectedThreadId !== null}
              threadId={selectedThreadId}
              materials={materials}
              loading={materialsLoading}
              error={materialsError}
              onRetry={() => void loadSelectedThread()}
              uploadCtl={bearer ? attach : null}
            />
          </div>
        </div>
      )}
    >
      {showThreadListInMain ? (
        threadListPanel
      ) : selectedThreadId === null ? (
        <PersonalThreadDetail
          knownEmpty={selectedThreadId !== null && justCreatedThreadIdRef.current === selectedThreadId}
          card={selectedCard}
          detail={detail}
          bearer={bearer}
          orgId={currentOrgId}
          loading={detailLoading}
          error={detailError}
          attach={attach}
          onRetry={() => void loadSelectedThread()}
          onThreadSettled={() => void loadThreads()}
          onArtifactLanded={() => void loadSelectedThread()}
          onMessageSent={() => void loadSelectedThread()}
        />
      ) : (
        <PersonalThreadDetail
          knownEmpty={selectedThreadId !== null && justCreatedThreadIdRef.current === selectedThreadId}
          card={selectedCard}
          detail={detail}
          bearer={bearer}
          orgId={currentOrgId}
          loading={detailLoading}
          error={detailError}
          attach={attach}
          onRetry={() => void loadSelectedThread()}
          onBackMobile={!isDesktop ? () => {
            setSelectedThreadId(null);
            // 2026-08-25 默认入口翻转后，裸 `/chat` redirect 到 CopilotKit v2——
            // 移动端「返回线程列表」必须留在旧屏世界，否则一次返回就把用户
            // 踢出正在用的旧轨道。
            router.replace("/chat/legacy");
          } : undefined}
          onThreadSettled={() => void loadThreads()}
          onArtifactLanded={() => void loadSelectedThread()}
          onMessageSent={() => void loadSelectedThread()}
        />
      )}
    </AppShell>
  );
}

/**
 * `AppShell` 的响应式断点是纯 CSS（`md:` = 768px），组件树里没有对应的 JS 状态可读。
 * 这里需要 JS 层的"当前是不是桌面"来做条件渲染（同一份 testid 不能在 DOM 里出现
 * 两份），所以补一个最小的 `matchMedia` hook——`md:` 断点值取自 Tailwind 默认
 * `768px`，与 `app-shell.tsx` 用的同一个断点。
 *
 * SSR 安全：初始渲染（服务端 / 首次客户端渲染，`window` 还没有真实宽度可读）默认
 * `true`（桌面态），与 `AppShell` 的 CSS 默认值一致（`hidden md:block`：不到
 * `md` 才隐藏，`md` 以上默认显示）——避免首帧闪一下手机布局。
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(true);
  React.useEffect(() => {
    // jsdom（组件测试环境）不实现 `matchMedia`——测试环境里没有真实视口，保持默认
    // 桌面态即可，断言的是"手机态渲染出正确的那份 DOM 结构"，不是"jsdom 真的报出了
    // 375px"，本来就得靠显式 mock 这个 hook，不是靠这里硬编一个 polyfill。
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function PersonalThreadDetail({
  card, detail, bearer, orgId, loading, error, onRetry, onBackMobile, onThreadSettled,
  attach, onArtifactLanded, onMessageSent, knownEmpty = false,
}: {
  /** 父组件确知这是本会话刚创建的空线程（见 justCreatedThreadIdRef 注释）。 */
  knownEmpty?: boolean;
  card: ThreadCard | null;
  detail: GetThreadOut | null;
  bearer: string | null;
  orgId: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** 仅手机（<md）渲染的"返回列表"按钮；桌面端左栏一直可见，不需要这个 */
  onBackMobile?: () => void;
  /**
   * #728 第 9 轮 P10 —— 透传给 `ChatLiveMessagePanel` 的 `onRunSettled`，见那边的注释。
   * 由 `PersonalChatScreen` 传入自己的 `loadThreads`，本组件不持有左栏数据。
   */
  onThreadSettled?: () => void;
  /** issue #1824 —— composer 附件控制器，与右栏「材料」面板头部的上传入口共享同一份。 */
  attach: ChatAttachmentsController;
  /** issue #1824 —— 一次落地成功后触发，刷新右栏「产物」计数。 */
  onArtifactLanded: () => void;
  /** issue #1824 —— 一条消息（可能带附件）成功发出后触发，刷新右栏「材料」计数。 */
  onMessageSent: () => void;
}) {
  const agentOptions = useOrgAgentOptions(orgId, bearer);
  /* `#` mention 的两个状态，与 `chat-read-screen.tsx` 逐字同一套：composer 上报
     query，挂载成功后自增 nonce 让 composer 把 `#query` 从正文里删掉。 */
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionResolvedNonce, setMentionResolvedNonce] = React.useState(0);
  /** issue #1803 gap #4 —— 同 `chat-read-screen.tsx`，转存挂载数给 longrun hint 用。 */
  const [mountedSkillCount, setMountedSkillCount] = React.useState(0);

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

  return (
    /* #728 P10 —— 副行不再印裸线程 id。评分员实测抓到：`线程 thr-83dd0882-…` 这种
       40 位 UUID 直接暴露给用户，375 档下甚至把头部撑成三行。同一件事在项目对话
       侧已经修过一次（D4，`chat-read-screen.tsx` 的 `data-thread-id` 模式）——
       这里补的是同一条纪律在个人对话侧的遗漏，不是新裁决。
       绑定关系改由 `data-thread-id` 证明（测试要能核实「详情面绑的是选中的那条线程」，
       但不该靠把 id 印给用户看来证明），可读副行退回到 `subtitle`（个人线程没有
       subtitle 时才用「仅自己可见」这句静态说明，不回落到 id）。 */
    <div className="flex h-full flex-col" data-testid="chat-thread-detail" data-thread-id={detail.thread.id}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {onBackMobile ? (
          <Button
            size="xs"
            variant="ghost"
            className="md:hidden"
            data-testid="chat-thread-back-mobile"
            aria-label="返回会话列表"
            onClick={onBackMobile}
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-14 font-semibold">{card?.title ?? "个人对话"}</h1>
          <p className="truncate text-10 text-muted-foreground">
            {card?.subtitle?.trim() ? card.subtitle : "个人对话 · 仅自己可见"}
          </p>
        </div>
      </header>
      {agentOptions.status === "error" ? (
        <div className="border-b border-border-subtle px-4 py-2">
          <ErrorState
            testId="personal-chat-agent-list-error"
            message={`无法读取组织 Agent 目录：${agentOptions.message}`}
            retryTestId="personal-chat-agent-list-retry"
            onRetry={agentOptions.retry}
          />
        </div>
      ) : null}
      {agentOptions.status === "ready" && agentOptions.agents.length === 0 ? (
        <p
          className="border-b border-border-subtle px-4 py-2 text-11 text-muted-foreground"
          data-testid="personal-chat-no-agents-hint"
        >
          这个组织还没有可用的 Agent，先去
          <a href="/platform-admin/agent" className="mx-1 text-primary underline">
            后台创建一个 Agent
          </a>
          才能发消息。
        </p>
      ) : null}
      {/*
        issue #1803 gap #3 —— 同 `chat-read-screen.tsx`：`ChatLiveMessagePanel`
        （内含 `AgentPicker`）与 `ChatSkillMountPanel` 各自的浮层此前互不相知，
        Provider 包在共同父层让两边共享「同一时刻只开一个」的互斥状态。
      */}
      <ChatPopoverCoordinatorProvider>
        {bearer ? (
          <ChatLiveMessagePanel
            threadId={detail.thread.id}
            knownEmpty={knownEmpty}
            bearer={bearer}
            attach={attach}
            agents={agentOptions.status === "ready" ? agentOptions.agents : null}
            archived={detail.thread.archived}
            /* `#` 的检测在 composer 里已经实现（与项目屏共用同一套），本屏此前
               只是没人接收它上报的 query。两条 prop 与 `chat-read-screen.tsx`
               逐字同名同义，不另造一套。 */
            onMentionQueryChange={setMentionQuery}
            mentionResolvedNonce={mentionResolvedNonce}
            /*
              #728 round 16 P10 起：个人线程的能力集合从「恒不含 `artifact.land`」，
              经 2026-08-21 人类裁决改为「恒含 `artifact.land`」——个人对话也要能
              真的落地产物（`PERSONAL_THREAD_CAPABILITIES`，`land-as-artifact.ts`
              对个人线程创建者放行、非draft 拒绝，见该文件注释）。这里从服务端
              下发的 `getThread.out.capabilities` 取值，不写死 true/false——服务端
              能力集合改，这行自动跟上，前端不用再动（这正是当初这么写的理由，
              这次裁决反转没有触发任何前端改动，只是这行现在读到的值变了）。
            */
            canLandArtifacts={detail.capabilities.includes("artifact.land")}
            onRunSettled={onThreadSettled}
            onArtifactLanded={onArtifactLanded}
            onMessageSent={onMessageSent}
            hasMountedSkills={mountedSkillCount > 0}
          />
        ) : <CenteredState>登录已失效，无法读取或发送消息。</CenteredState>}
        {/*
          人类裁决（2026-08-21，原话）：「个人对话必须要可以使用公共的 skills」
          「所有的人都可以用」。

          此前个人对话「没有任何挂载入口」——`ChatSkillMountPanel` 只在项目屏
          （`chat-read-screen.tsx`）渲染，本屏连 import 都没有。服务端那一半已在
          #1693 放开（个人线程可挂载，授权改为从线程反推项目），但用户在界面上
          仍然挂不上，裁决因此没有真正生效。

          ⚠ `projectId` 不传：个人线程没有项目。服务端已不再把 `?projectId=` 当
          授权输入（#1693 同一批修的越权洞），可见性过滤仍在服务端，前端不复述
          任何权限规则——这里只负责"给不给入口"。
        */}
        {bearer && orgId ? (
          <ChatSkillMountPanel
            threadId={detail.thread.id}
            orgId={orgId}
            bearer={bearer}
            mentionQuery={mentionQuery}
            onMentionMounted={() => setMentionResolvedNonce((v) => v + 1)}
            onMountsChange={setMountedSkillCount}
          />
        ) : null}
      </ChatPopoverCoordinatorProvider>

    </div>
  );
}

/**
 * 组织 agent 下拉的数据源——复用 #458 已验证可用的 `listCapabilities(orgId, "agent")`，
 * 把 `CapabilityListing`（能力目录的通用形状）投影成 `ChatLiveMessagePanel` 需要的
 * `GetAgentPanelOut["agents"]` 形状。只取 `enabled` 的条目：被停用的 agent 不该出现在
 * 「可以发消息给它」的下拉里。
 */
type AgentOptionsState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string; readonly retry: () => void }
  | { readonly status: "ready"; readonly agents: GetAgentPanelOut["agents"] };

function useOrgAgentOptions(orgId: string | null, bearer: string | null): AgentOptionsState {
  const sourceKey = orgId && bearer ? `${orgId} ${bearer}` : null;
  const [result, setResult] = React.useState<{ key: string; agents: GetAgentPanelOut["agents"] } | null>(null);
  const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);
  const [loadingKey, setLoadingKey] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!orgId || !bearer || !sourceKey) return;
    const key = sourceKey;
    const gen = ++generation.current;
    setLoadingKey(key);
    setFailure(null);
    try {
      const rows = await listCapabilities(orgId, "agent");
      if (gen !== generation.current) return;
      setResult({ key, agents: rows.filter((row) => row.enabled).map(toAgentOption) });
    } catch (error) {
      if (gen !== generation.current) return;
      setResult(null);
      setFailure({ key, message: describeFailure(error) });
    } finally {
      if (gen === generation.current) setLoadingKey(null);
    }
  }, [orgId, bearer, sourceKey]);

  React.useEffect(() => {
    if (sourceKey) void load();
    return () => {
      generation.current += 1;
    };
  }, [load, sourceKey]);

  if (!sourceKey) return { status: "loading" };
  if (failure?.key === sourceKey) return { status: "error", message: failure.message, retry: () => void load() };
  if (result?.key === sourceKey) return { status: "ready", agents: result.agents };
  return { status: "loading" };
}

function toAgentOption(row: CapabilityListing): GetAgentPanelOut["agents"][number] {
  const trimmedName = row.name.trim();
  const abbrSource = trimmedName || row.id;
  return {
    id: row.id,
    abbr: abbrSource.slice(0, 2).toUpperCase(),
    name: trimmedName || row.id,
    duty: "组织已配置 Agent",
    // #1705（#728 D-1）：`CapabilityListing`（能力目录读侧的通用形状）本身不带
    // `role_label`——它和 `getAgentPanel` 是两条不同的读路径，本函数把它投影成
    // `getAgentPanel` 的输出形状时，`duty` 已经是同样手法的占位文案（见上一行），
    // `roleLabel` 同理不编一个更具体的头衔出来，跟 `duty` 用同一段占位文案。
    roleLabel: "组织已配置 Agent",
    presence: "present",
  };
}

// 改名/删除入口本体已下沉进 `ThreadCardButton`（`thread-list-shell.tsx`，2026-08-14
// 重做为 hover「…」菜单 + 双击改名）——`handleRename`/`handleDelete` 原样保留，只是
// 现在直接作为 `onRename`/`onDelete` 传给每张卡片自己，不再经过这个中间表单组件。

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
