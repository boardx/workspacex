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
import { ChatArtifactPreviewDialog } from "@/components/chat/chat-artifact-preview-dialog";
import { ChatTaskInspector } from "@/components/chat/chat-task-inspector";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";
import { Input } from "@/components/ui/input";
import {
  createPersonalThread, deleteThread, getAgentPanel, getThread, listPersonalThreads,
  listThreadArtifacts, listThreadAttachments, renameThread, updateAgentRoster,
  type GetAgentPanelOut, type GetThreadOut, type ListThreadArtifactsOut,
  type ListThreadAttachmentsOut, type ListThreadsOut, type ThreadCard,
} from "@/lib/live-chat";
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
/**
 * issue #2402 —— 模块级缓存，跨 `CopilotKitV2Shell` 的每一次挂载存活。
 *
 * ## 为什么需要它：#2403 只堵住了一半的洞
 *
 * #2403 修的是 `pushThreadRoute` 4 秒兜底退化成 `window.location.assign` 整页
 * 硬导航那条路径——但人类实测确认合入后症状原样复现，且是**每次点击都发生**，
 * 排查发现根因根本不在那条兜底路径：即使软导航全程正常（不到 4 秒、从未触发
 * `window.location.assign`），Next App Router 在 `/chat/[threadId]` 的两个不同
 * `threadId` 之间导航时，本组件（`app/chat/(v2)/[threadId]/page.tsx` 直接渲染的
 * page 级组件）本身就会被整体卸载重装——真栈浏览器验证过（`asideSameNode` 断言：
 * 切换前后 `<aside data-testid="copilotkit-v2-thread-sidebar">` 是两个不同的 DOM
 * 节点），不是"判据误判"，是 Next 路由树对这两个 page 模块渲染就没有做成同一个
 * 组件实例。`threads` state 因此每次都从 `null` 重新开始，侧栏骨架屏
 * （`data-testid="loading"`）随之重新出现——这才是"每点一次就整栏刷新"的真正来源。
 *
 * ## 为什么修法是"模块级缓存"，不是"把侧栏搬进 `(v2)/layout.tsx`"
 *
 * 后者（侧栏渲染从 layout 里出，脱离会被路由重挂载的 page 子树）是更"正统"的
 * 解法，但要求把本文件的侧栏 JSX、搜索/置顶/改名/删除/创建等全部交互状态拆到一个
 * 新组件、再重新打通与右栏面板共享 `selectedThreadId`/`reloadThreads` 的通道——
 * 对这个已经被多个在途 issue（#2072/#2094/#2075/#2068/#2052）并发触碰的热点文件
 * 是一次影响面大得多的结构改动，不是这条 bug 本身要求的最小修复。
 *
 * 模块级变量在浏览器里跨"组件卸载又重新挂载"存活（只要整个 JS 模块没有被重新
 * 加载——SPA 内路由切换不会重新加载模块，只有真整页刷新才会，那种情况下本来就该
 * 显示一次骨架，缓存也确实会被清空，行为正确）。重新挂载时用它作为 `useState`
 * 的**初始值**，新实例第一次渲染就直接画出已经有的列表，不经过 `null` 骨架屏这一
 * 帧；`reloadThreads` 仍然照常在每次挂载后台重新拉一次最新数据（保鲜），拿到结果
 * 后原地更新缓存——不是"读一次缓存就不再校验"，只是不再让用户在明知答案的情况下
 * 白等一轮网络请求。
 *
 * ⚠ 按 `bearer` 分 key：换一个人登录（同一个浏览器标签页内 `logout` 再登录）不得
 * 看见上一位用户缓存的线程列表——同 `rightKey`（`bearer+threadId`）那一套纪律。
 *
 * ⚠ **独立 review 抓到的两处、合入前修正**：
 *
 * 1. **写路径必须唯一**——`handleDelete`（改名同理）此前绕开 `reloadThreads`，
 *    自己调一次 `listPersonalThreads` 只 `setThreads`，没有回写这份模块级缓存。
 *    删除选中线程后紧跟着的 `router.replace` 正是会触发本组件重挂载的那条路径
 *    （见上面「为什么需要它」）——新实例用**没更新过的旧缓存**初始化，被删的卡片
 *    会重新出现，直到下一次后台刷新才消失。修法：所有会改变线程列表的写操作
 *    （reload / create / rename / delete）一律经过下面 `fetchThreadList` 这一个
 *    出口，缓存与 `setThreads` 不可能再有第二条各自为政的路径。
 * 2. **跨实例的响应顺序**——`listGeneration` 是每个组件实例自己的 `useRef`，
 *    重新挂载会清零重数。旧实例发出请求 A、新实例（挂载时用缓存初始化后又自己
 *    发起一次刷新）发出请求 B，两者的实例内 generation 都可能是 1——A 更晚才
 *    resolve 时，实例内判据挡不住它覆盖新实例已经写好的共享缓存。这里另开一个
 *    模块级单调序号 `threadListRequestSeq`/`threadListAppliedSeq`，只按「谁发出得
 *    更晚」决定谁能真的写进缓存，与哪个组件实例、哪个 `listGeneration` 无关。
 */
let threadListCache: { readonly bearer: string; readonly value: ListThreadsOut } | null = null;
/** 下一次发起线程列表请求要领取的序号；发起时自增，与响应到达的先后无关。 */
let threadListRequestSeq = 0;
/** 目前已经真正写进 `threadListCache` 的那次请求的序号——`applyThreadListResult`
 *  用它拒绝任何序号更小（=更早发出）的迟到响应，保证缓存单调地跟着"最新一次
 *  发出的请求"走，不被跨组件实例的竞态覆盖回旧值。 */
let threadListAppliedSeq = 0;

/** 唯一允许写 `threadListCache` 的地方——见上面头注「写路径必须唯一」。 */
function applyThreadListResult(bearer: string, seq: number, value: ListThreadsOut): void {
  if (seq < threadListAppliedSeq) return; // 比已经写进去的那次还早发出，丢弃
  threadListAppliedSeq = seq;
  threadListCache = { bearer, value };
}

export function CopilotKitV2Shell({ initialThreadId }: { initialThreadId: string | null }): JSX.Element {
  const router = useRouter();
  const { session } = useSession();
  const bearer = session?.sessionToken ?? null;
  const sourceKey = bearer ?? null;

  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(initialThreadId);
  React.useEffect(() => {
    setSelectedThreadId(initialThreadId);
  }, [initialThreadId]);
  /**
   * 2026-08-30 人类实测反馈——「每点一次会话就整栏刷新一次」，且是**每次都发生**、
   * 不是偶发。见下面 `pushThreadRoute` 的更正：旧判据用 `window.location.pathname`
   * 判断软导航有没有生效，这里补一份指向"内容真的切换了没有"的独立事实源，供那处
   * 判据改用（ref 而非直接读 state：`pushThreadRoute` 的 `setTimeout` 回调是一次性
   * 闭包，读 state 会拿到创建那一刻的旧值，读 ref 才是"检查那一刻的最新值"）。
   */
  const selectedThreadIdRef = React.useRef(selectedThreadId);
  React.useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  /** issue #2099 —— 右栏「产物」点击查看：非 null 时打开预览弹窗。 */
  const [openArtifact, setOpenArtifact] = React.useState<{ artifactId: string; title: string } | null>(null);

  const [threads, setThreads] = React.useState<ListThreadsOut | null>(
    () => (bearer && threadListCache?.bearer === bearer ? threadListCache.value : null),
  );
  const [listError, setListError] = React.useState<string | null>(null);
  const listGeneration = React.useRef(0);

  /**
   * 唯一的网络出口：拿到最新线程列表 + 把它写进模块级缓存（经
   * `applyThreadListResult` 做跨实例的到达顺序校验，见上面模块头注）。
   * 不touch 本实例的 `threads`/`listError` state——那部分留给调用方，因为
   * `reloadThreads` 与 `handleDelete` 对"要不要在失败时保留旧列表"、
   * "成功后要不要顺带导航"这些收尾动作并不相同，不该被这一个函数替它们决定。
   */
  const fetchThreadList = React.useCallback(async (): Promise<ListThreadsOut> => {
    if (!bearer) throw new Error("no session");
    const seq = ++threadListRequestSeq;
    const result = await listPersonalThreads({}, bearer);
    applyThreadListResult(bearer, seq, result);
    return result;
  }, [bearer]);

  const reloadThreads = React.useCallback(async () => {
    if (!bearer) return;
    const generation = ++listGeneration.current;
    try {
      const result = await fetchThreadList();
      if (generation !== listGeneration.current) return;
      setThreads(result);
      setListError(null);
    } catch (failure) {
      if (generation !== listGeneration.current) return;
      setListError(failure instanceof Error ? failure.message : "线程列表读取失败");
    }
  }, [bearer, fetchThreadList]);

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

  /**
   * 🔴 issue #2094：**已有空线程时复用它，不再建第二条**（人类裁决的配套半边）。
   *
   * 裁决的主体是「把 `0 个 agent` 换成自动标题 + 状态 + 产物数」，但自动命名对
   * **空线程**没有输入——一条没发过消息的线程叫什么都是编的。devapp 实测：
   * 58 条线程里 **36 条是空的**，全都长着一模一样的「新对话」。也就是说人类抱怨的
   * 「一屏全是新对话」有一多半根本不是命名问题，是**空线程在无限累积**。
   *
   * 所以这一半从源头掐：点「新建对话」时，如果已经有一条 `not-started` 的线程
   * （服务端判定，见 `apps/api/src/domain/chat/thread-badges.ts` 的 `threadCardStatus`），
   * 就直接进那一条。用户要的是「一个干净的地方开始」，不是「一条新纪录」。
   *
   * ⚠ **不做自动删除**。清掉旧空线程是删用户数据，而且空线程可能是用户故意留着
   *   待会儿用的。复用是可逆的（发一条消息它就变成真线程），删除不是。
   * ⚠ 判据用服务端下发的 `status`，**不在前端重算**「有没有消息」——前端手里根本
   *   没有消息数据，重算只能靠猜，而且那就是第二处判定。
   */
  const handleCreate = React.useCallback(async () => {
    if (!bearer) return;
    setCreatePending(true);
    try {
      const reusable = (threads?.groups.flatMap((group) => group.cards) ?? [])
        .find((card) => card.status === "not-started");
      if (reusable) {
        router.push(`/chat/${reusable.id}`);
        return;
      }
      const result = await createPersonalThread(null);
      await reloadThreads();
      router.push(`/chat/${result.threadId}`);
    } finally {
      setCreatePending(false);
    }
  }, [bearer, reloadThreads, router, threads]);

  /**
   * issue #2259 —— rev-e2e 真栈实测过一次：点击侧栏已有对话，网络面板证实
   * `/chat/thr-<id>?_rsc=...` 的软导航预取请求确实发出了，但 `location.href`
   * 之后仍停在旧路由，主面板不切换。这个 Next 版本上 `useRouter().push()`
   * 不返回 Promise、也不暴露任何失败信号——软导航的 RSC fetch 一旦失败/卡住
   * （真栈负载高、模型调用占满连接池时更容易撞上），调用方无从得知这次
   * 导航有没有真的生效，用户看到的就是"点了没反应"。
   *
   * 反复实测（Playwright 真栈 e2e + 浏览器工具原样复刻 rev-e2e 的
   * read_page+left_click 路径，均可在
   * `apps/web/e2e/copilotkit-v2-thread-persistence.spec.ts` 的
   * 「裸路由 /chat 落地」用例里验证）软导航本身当前工作正常——所以这里不是
   * "猜"出来的修复，是给已经确认过的失败模式补一层兜底：软导航发出后给它一个
   * 短窗口自证成功；到点还没成功就退化为硬导航（`window.location.assign`）——
   * 牺牲一次整页刷新换回"点了必有反应"，不是伪装成功、也不掩盖任何真实报错。
   *
   * ⚠ **2026-08-30 人类实测反馈更正**：「每点一次会话都会整栏刷新」，且是**每次都
   * 发生**，不是像 issue #2259 描述的那样只在真栈负载高时偶发——这个频率分布本身
   * 就是判据，指向"自证成功"这一步的判据本身有系统性偏差，而不是软导航真的每次都
   * 卡住。旧判据只认 `window.location.pathname === path`：这一份来自浏览器 History
   * API 的信号会在**什么时候**真的等于目标路径，与 Next 这个版本的软导航实现细节
   * 绑定，本仓从未验证过它与"页面内容真的切到了新线程"这件事之间没有时间差——如果
   * 软导航先完成内容更新、`location.pathname` 却滞后同步（或反过来），这条判据就会
   * 对**每一次**导航都判"没成功"，与实测的"每点必刷新"完全吻合，比"软导航真的每次
   * 都卡住"这个假设更合理。
   *
   * 改法：判据换成"内容真的切换了没有"这个更接近本意的事实——`selectedThreadIdRef`
   * 是 `initialThreadId` prop 同步出来的 state 的镜像（见上面该 ref 的声明），
   * 真的变成目标 `threadId` 才代表这次导航从路由到渲染整条链路都完成了，不依赖
   * `location.pathname` 这一层可能滞后的中间信号。两个判据**任一个**成立都算数
   * （`||`）——只放宽误判"卡住"的条件，不收紧，不会把真正卡住的情形误判成功。
   *
   * `navigationGeneration` 挡的是"检查窗口还没到点，用户已经点了下一条线程"
   * ——那种情况下无论哪个判据都早就不指向**这次**点击的目标，不该被上一次点击
   * 遗留的检查错误地判定为"卡住了"而强制硬导航打断新的选择。
   *
   * ⚠ **issue #2402 —— 上面两次修复都没堵住"退化动作本身"这个洞**：即使判据已经
   * 尽量准了，只要软导航在真实环境下（真栈负载高、模型调用占满连接池，#2259 原始
   * 场景）确实超过 4 秒才完成，判据到点时仍会判"没成功"——这不是判据错，是软导航
   * 这一次真的慢。此时原逻辑退化为 `window.location.assign(path)`：**整页**硬导航，
   * 会把 `app/chat/(v2)/layout.tsx` 挂的 `CopilotKitV2Shell`（连同它内部的会话列表
   * `threads` state）一起重新挂载——这正是人类截图里"左栏会话列表也变成 loading
   * 骨架"的直接原因，也是唯一一条会连累左栏的路径。
   *
   * 改法：兜底动作本身从"整页硬刷新"降级为"重试一次软导航"（再 `router.push`
   * 一次）。`router.push` 只会让 App Router 重新走一次已经在跑的软导航流程，
   * 不触碰 `window.location`，因此不会卸载 `(v2)/layout.tsx` 这层共享布局，左栏
   * 会话列表全程不受影响；"点了必有反应"（#2259 的原始诉求）仍然成立——只是"反应"
   * 换成了"再摧一把已经在飞的软导航"，而不是"炸掉整个页面重来"。
   */
  const navigationGeneration = React.useRef(0);
  const pushThreadRoute = React.useCallback((threadId: string) => {
    const path = `/chat/${threadId}`;
    const generation = ++navigationGeneration.current;
    router.push(path);
    window.setTimeout(() => {
      if (navigationGeneration.current !== generation) return;
      if (selectedThreadIdRef.current === threadId) return;
      if (window.location.pathname === path) return;
      router.push(path);
    }, 4_000);
  }, [router]);

  const selectThread = React.useCallback((threadId: string) => {
    if (threadId === selectedThreadId) return;
    pushThreadRoute(threadId);
  }, [pushThreadRoute, selectedThreadId]);

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
   * ⚠ 2026-08-30 人类裁决（回应"hover 没选中的卡片看不到「…」菜单"）：`ThreadCardButton`
   *   现在对任意卡片都渲染菜单入口，不再要求 `selected`（`thread-list-shell.tsx` 头注）。
   *   版本号因此不能再借用"已经在取的 `threadDetail`"——那只覆盖当前选中的一条。改成
   *   提交那一刻现取：`onRename`/`onDelete` 收到具体 `threadId`，先 `getThread(threadId)`
   *   拿它的最新版本号，再带着这个刚读到的版本号提交，与旧轨道
   *   `personal-chat-screen.tsx`/`chat-read-screen.tsx` 同名回调同一套理由（#513 那条
   *   "版本号只有服务端读端口一个事实源"没有变，只是取的时机从"渲染时"推迟到"提交时"）。
   *
   * `mutatingThreadId` 记录当前操作的是哪一条，与 `selectedThreadId` 分开——否则操作
   * 一张未选中的卡片时，pending/失败提示会错渲到当前选中的另一张卡片上。
   */
  const [mutatingThreadId, setMutatingThreadId] = React.useState<string | null>(null);
  const [mutatePending, setMutatePending] = React.useState<"rename" | "delete" | null>(null);
  const [mutateFailure, setMutateFailure] = React.useState<string | null>(null);

  const handleRename = React.useCallback(async (threadId: string, title: string) => {
    if (!bearer) return;
    setMutatingThreadId(threadId);
    setMutatePending("rename");
    setMutateFailure(null);
    try {
      const target = await getThread(threadId, null, bearer);
      await renameThread(threadId, null, title, target.thread.version);
      await reloadThreads();
      if (threadId === selectedThreadId) await loadRightPanel(); // 标题与 version 都变了，重读详情保持一致
    } catch (failure) {
      setMutateFailure(describeMutateFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, loadRightPanel, reloadThreads, selectedThreadId]);

  const handleDelete = React.useCallback(async (threadId: string, reason: string) => {
    if (!bearer) return;
    setMutatingThreadId(threadId);
    setMutatePending("delete");
    setMutateFailure(null);
    try {
      const target = await getThread(threadId, null, bearer);
      await deleteThread(threadId, null, target.thread.version, reason);
      const refreshed = await fetchThreadList();
      setThreads(refreshed);
      // 删的不是当前打开的这条 ⇒ 路由不该动，用户还在看别的对话。
      if (threadId === selectedThreadId) {
        const next = refreshed.groups.flatMap((group) => group.cards)[0]?.id ?? null;
        // 删掉的是当前这条 ⇒ 必须离开它的路由；一条都不剩就回 `/chat` 空状态。
        router.replace(next ? `/chat/${next}` : "/chat");
      }
    } catch (failure) {
      setMutateFailure(describeMutateFailure(failure));
    } finally {
      setMutatePending(null);
    }
  }, [bearer, fetchThreadList, router, selectedThreadId]);

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
  /**
   * issue #2068（TW-P0-3 读半 / TW-P0-4）—— 右栏 Inspector 需要的三样「面板 body 里
   * 才拿得到」的真实状态，由 `CopilotKitV2Panel` 经回调上抛。
   *
   * ⚠ 为什么是回调而不是把 `agent` 提上来：`agent` 由 `CopilotKit` provider 在面板
   * 内部经 `useAgent()` 取得，提上来要么把 provider 边界推到外壳（会 remount 整条
   * SSE 连接），要么在外壳再建一个第二实例（两条连接，两份 run 状态）。既有的
   * `onMessageSent` / `onArtifactLanded` 已经是同一套「面板向外壳上报真实事件」的
   * 模式，这三个是它的延续，不是新机制。
   */
  const [planTodos, setPlanTodos] = React.useState<readonly PlanTodo[] | null>(null);
  const [runState, setRunState] = React.useState<{
    readonly isRunning: boolean;
    readonly phaseLabel: string | null;
    readonly startedAt: number | null;
  }>({ isRunning: false, phaseLabel: null, startedAt: null });
  const [pendingMaterialsCount, setPendingMaterialsCount] = React.useState(0);

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
        {/* 2026-08-29 Claude Design 重设计稿——这个左栏在该稿里叫「工作」，不是「对话」：
            它承载的不只是聊天记录，还是"把一件事交给 AI"的入口。`ThreadListHeader`
            默认值（"对话"）留给旧轨道两屏，这里显式覆盖，不动共用组件的默认行为。 */}
        <ThreadListHeader title="工作" />
        <div className="flex flex-col gap-1.5 px-3">
          <NewThreadButton onClick={() => void handleCreate()} disabled={!bearer || createPending} label="交一件事给 AI" />
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
        {/* 2026-08-29 Claude Design 重设计稿——左栏不再画「本线程的 AI 团队」编制卡
            （人类原话「去掉本线程的AI团队 当前编制为空,从agent市场加入 这一块」）。
            issue #2052（CK-P7）的编制读写能力「没有被移除，换了入口」：`roster`/
            `runRosterMutation`/`agentCandidates` 这些状态原样保留，改传给右栏
            `ChatTaskInspector` 的 `roster` prop，渲染成新增的「编制」页签（见下面
            该组件调用处）。人类 2026-08-29 明确选择「移到右栏 Inspector 里」而不是
            彻底去掉入口——这不是本次重设计的默认选项，是就地问过之后的裁决。
            `copilotkit-v2-roster-landing.spec.ts`（CK-P7 e2e 验收）同步改成先点开
            「编制」页签，不再断言左栏常驻可见。 */}
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
                    onRename={canCreate ? (title) => void handleRename(card.id, title) : undefined}
                    onDelete={canCreate ? (reason) => void handleDelete(card.id, reason) : undefined}
                    pending={card.id === mutatingThreadId ? mutatePending : null}
                    failure={card.id === mutatingThreadId ? mutateFailure : null}
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
          /* 🔴 issue #2094 —— 除右栏外还要重读左栏线程列表。
             自动命名与卡片状态都发生在服务端（首条消息落库时改 `chat_threads.title`，
             `status` 由最近一次 run 派生），而侧栏此前只在挂载与增删线程时取一次。
             于是服务端已经把标题改成任务名了，屏幕上那张卡还写着「新对话」——
             真栈实测 `TW-P1-1` 红在这里，红的并不是服务端那一半
             （`tests/chat/thread-card-projection.test.ts` 5 条全绿，证明起名真的发生了）。
             ⚠ 复用既有的 `onMessageSent`，不新加 prop：panel 那侧是在途高冲突区
             （#2072），而这个回调本来就是「一轮对话有动静了」这个事实，不是右栏专用的。 */
          onMessageSent={() => {
            void loadRightPanel();
            void reloadThreads();
          }}
          /* issue #2050 —— 落地成功后重读右栏「产物」，让新产物真的出现在栏里。 */
          onArtifactLanded={() => void loadRightPanel()}
          /* issue #2068 —— 见上面三个 state 的注释：面板向外壳上报真实运行/计划状态。 */
          onPlanTodosChange={setPlanTodos}
          onRunStateChange={setRunState}
          onPendingMaterialsChange={setPendingMaterialsCount}
          threadAttachments={materials?.items ?? null}
          archived={archived}
          canGeneratePersona={canGeneratePersona}
        />
      </div>
      {/* issue #2068（TW-P0-4）—— 右栏从「产物 + 材料」固定两段堆叠换成四页签动态
          Inspector（进度 / 材料 / 产物 / 运行详情），按真实信号自动切换、无内容折叠成
          40px 图标栏。产物/材料两块仍是原来那两个组件（`ChatArtifactsPanel` /
          `ChatMaterialsPanel`），只是移进页签里——不另造第二份视觉。
          页签选择规则抽在 `lib/chat-task-inspector-tabs.ts`（有 vitest 逐条钉死）。
          issue #2099（真实 devapp 实测：条目点了没反应）—— `onOpenArtifact` 打开下面
          的只读预览弹窗；`ChatTaskInspector` 内部把它原样转给 `ChatArtifactsPanel`
          的 `onOpen`，不在这一层重新实现点击逻辑。 */}
      <ChatTaskInspector
        hasSelection={selectedThreadId !== null}
        threadId={selectedThreadId}
        artifacts={artifacts}
        materials={materials}
        loading={rightLoading}
        artifactsError={artifactsError}
        materialsError={materialsError}
        onRetry={() => void loadRightPanel()}
        onOpenArtifact={(item) => setOpenArtifact({ artifactId: item.artifactId, title: item.title })}
        pendingMaterialsCount={pendingMaterialsCount}
        planTodos={planTodos}
        isRunning={runState.isRunning}
        runPhaseLabel={runState.phaseLabel}
        runStartedAt={runState.startedAt}
        /* 2026-08-29——CK-P7 编制搬进右栏「编制」页签（见上面移除左栏 `RosterPanel`
           那处的头注）。只在选中了一条线程时传，未选中时整个 prop 是 `undefined`，
           `ChatTaskInspector` 因此完全不渲染这个页签——与此前"未选中线程时左栏
           也不画编制卡片"是同一条规则，只是换了地方生效。 */
        roster={selectedThreadId === null ? undefined : {
          roster,
          loading: rosterLoading,
          error: rosterError,
          hasSelection: selectedThreadId !== null,
          // rebase 注：main 在这之后合入了 CK-P8（归档只读态，`getThread` 真实下发
          // `thread.archived`）。服务端 `update-agent-roster.ts` 本就对归档线程拒绝
          // （`THREAD_ARCHIVED_READONLY`），但按「按钮不渲染 且 接口拒绝」的既有
          // 纪律，编辑入口也不该在归档线程上渲染——不是新增能力，是让前端诚实
          // 反映服务端已经在拒的事。
          canMutate: canCreate && !archived,
          pending: rosterPending,
          mutateFailure: rosterMutateFailure,
          candidates: agentCandidates,
          candidatesError: agentCatalogError,
          onAdd: (agentId) => {
            const trimmed = agentId.trim();
            if (trimmed !== "") void runRosterMutation({ add: [trimmed], remove: [] });
          },
          onRemove: (agentId) => void runRosterMutation({ add: [], remove: [agentId] }),
          onRetry: () => void loadRoster(),
        }}
      />
      {/* issue #2099 —— 只读预览弹窗，Radix `Dialog` 自己 portal 到 body，挂在这个
          位置纯粹是"逻辑上属于这棵组件树"，不影响实际渲染层级。个人线程恒
          `projectId=null`（本壳从不传 projectId，与 `landAsArtifact`/`listThread
          Artifacts` 等同一约定）。 */}
      {openArtifact !== null && selectedThreadId !== null ? (
        <ChatArtifactPreviewDialog
          threadId={selectedThreadId}
          projectId={null}
          artifactId={openArtifact.artifactId}
          title={openArtifact.title}
          bearer={bearer ?? undefined}
          onClose={() => setOpenArtifact(null)}
        />
      ) : null}
    </div>
  );
}
