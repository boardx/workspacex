"use client";

import * as React from "react";
import { KnowledgePanel, type KnowledgePanelWriteActions, type PanelStatus } from "./knowledge-panel";
import {
  applyHumanAction,
  fetchClaimSources,
  fetchThreadKnowledge,
  knowledgeGraphErrorCode,
  listPromotionNominations,
  promoteToPersonal,
  promoteToProject,
  type KnowledgeGraphErrorCode,
  type PromotionChoice,
  type PromotionNominations,
  type PromotionResults,
  type ThreadKnowledge,
} from "@/lib/knowledge-graph-api";
import { KG_RELOAD_ON_FAILURE } from "@/lib/knowledge-graph-failure";
import { onKnowledgeReload, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import type { KgClaim, KgHumanAction } from "@repo/contracts/chat-knowledge-graph";
import { focusMessageHref, highlightChatMessage } from "@/lib/chat-message-focus";

export interface ThreadKnowledgeState {
  readonly threadId: string | null;
  readonly status: PanelStatus;
  readonly data: ThreadKnowledge | null;
  readonly errorCode: KnowledgeGraphErrorCode | null;
  /** 重新读一次（面板「重试」、页签被打开时刷新）。 */
  readonly reload: () => void;
}

/**
 * phase-18 F09 —— 一条会话的「记忆」读模型（`getThreadKnowledge`），给右栏页签角标与面板共用。
 *
 * - `threadId = null` ⇒ 不取（没选线程 / 调用方没开这个页签）。
 * - 取数在 effect 里做，**不阻塞**首帧与消息渲染；换线程时丢弃上一条线程的在途结果（按请求代次），
 *   并清空旧数据——旧线程的记忆挂在新线程的页签上，比空白更坏。
 * - 失败进错误态并带契约错误码，不回退任何本地数据。
 */
/**
 * issue #4350 —— 「整理中」期间的轮询节奏：队列里还有排队中 / 进行中的消息（`ingestion.queued + running > 0`）
 * 就按这个退避序列重读，最后一档封顶反复用；从开始轮询算起超过 `KNOWLEDGE_POLL_MAX_MS` 就停（人再点开页签 /
 * 切回窗口会重新计时）。没有待整理的消息时一次都不轮询。
 */
export const KNOWLEDGE_POLL_DELAYS_MS: readonly number[] = [3_000, 5_000, 10_000, 20_000, 30_000];
export const KNOWLEDGE_POLL_MAX_MS = 10 * 60_000;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = React.useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export interface ThreadKnowledgeOptions {
  /**
   * 「记忆」页签此刻是否在前台。false ⇒ 暂停「整理中」轮询（不影响首次读取与各种显式重读）。默认 true。
   */
  readonly active?: boolean;
}

export function useThreadKnowledge(threadId: string | null, options: ThreadKnowledgeOptions = {}): ThreadKnowledgeState {
  const active = options.active ?? true;
  const [state, setState] = React.useState<Omit<ThreadKnowledgeState, "reload">>({
    threadId: null,
    status: "loading",
    data: null,
    errorCode: null,
  });
  const generation = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback((target: string) => {
    const gen = ++generation.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => (prev.threadId === target && prev.data !== null
      // 同一条线程刷新：保留已显示的数据，不闪回骨架屏
      ? prev
      : { threadId: target, status: "loading", data: null, errorCode: null }));
    fetchThreadKnowledge(target, controller.signal).then(
      (data) => {
        if (gen !== generation.current) return;
        setState({ threadId: target, status: "ready", data, errorCode: null });
      },
      (e: unknown) => {
        if (gen !== generation.current) return;
        setState({ threadId: target, status: "error", data: null, errorCode: knowledgeGraphErrorCode(e) });
      },
    );
  }, []);

  React.useEffect(() => {
    if (threadId === null) {
      generation.current += 1;
      abortRef.current?.abort();
      setState({ threadId: null, status: "loading", data: null, errorCode: null });
      return;
    }
    load(threadId);
  }, [threadId, load]);

  React.useEffect(() => () => { abortRef.current?.abort(); }, []);

  const reload = React.useCallback(() => { if (threadId !== null) load(threadId); }, [threadId, load]);

  // F10：回答下「撤销」成功后请求重读（面板与页签角标是同一份读模型，一起更新）。
  React.useEffect(() => {
    if (threadId === null) return undefined;
    return onKnowledgeReload((target) => { if (target === threadId) load(threadId); });
  }, [threadId, load]);

  // F10：发布 `{ threadId, canEdit, revision }`，回答下的「撤销」据此决定渲不渲染、带哪个 revision。
  const readyData = state.threadId === threadId && state.status === "ready" ? state.data : null;
  React.useEffect(() => {
    if (threadId === null) { publishKnowledgeSnapshot(null); return; }
    if (readyData !== null) {
      publishKnowledgeSnapshot({ threadId, canEdit: readyData.canEdit, revision: readyData.revision });
    }
  }, [threadId, readyData]);
  // 卸载（换壳 / 离开 /chat）时撤回快照：不留一个「你是所有者」的旧结论给别的屏读到。
  React.useEffect(() => () => { publishKnowledgeSnapshot(null); }, []);

  // issue #4350：「整理中（N 条）」期间自己重读，直到队列清空——以前只在换线程 / 点页签 / 人撤销时重读，
  // 面板会一直停在「整理中」。每次读回新数据（不论是轮询还是别的重读触发的）都按退避序列排下一次；
  // 页签不在前台或窗口被隐藏 ⇒ 暂停（计时归零，回来后从头开始）；读失败 ⇒ readyData 为空，停。
  const documentVisible = useDocumentVisible();
  const pending = readyData === null ? 0 : readyData.ingestion.queued + readyData.ingestion.running;
  const polling = threadId !== null && active && documentVisible && pending > 0;
  const pollStep = React.useRef(0);
  const pollStartedAt = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!polling || threadId === null) {
      pollStep.current = 0;
      pollStartedAt.current = null;
      return undefined;
    }
    const now = Date.now();
    if (pollStartedAt.current === null) pollStartedAt.current = now;
    if (now - pollStartedAt.current >= KNOWLEDGE_POLL_MAX_MS) return undefined;
    const delay = KNOWLEDGE_POLL_DELAYS_MS[Math.min(pollStep.current, KNOWLEDGE_POLL_DELAYS_MS.length - 1)]!;
    pollStep.current += 1;
    const timer = setTimeout(() => load(threadId), delay);
    return () => clearTimeout(timer);
  }, [polling, threadId, readyData, load]);

  // 渲染期再核一次线程：effect 还没跑的那一帧里，state 可能仍是上一条线程的。
  const current = state.threadId === threadId ? state : { threadId, status: "loading" as const, data: null, errorCode: null };
  return { ...current, reload };
}

function loadSources(claimId: string) {
  return fetchClaimSources(claimId);
}

/**
 * F10 —— 人的编辑动作（`applyHumanAction`）。**只在服务端说 `canEdit=true` 时返回**：非所有者拿到
 * `undefined`，面板一个编辑入口都不画（uc-18-3 R5）。
 *
 * - `basedOnRevision` 取当前读模型的 `revision`（乐观并发）。
 * - 成功 ⇒ 立即重读（刷新期间保留已显示的数据，不闪骨架屏），面板与页签角标一起更新。
 * - `KG_REVISION_CHANGED` / 条目或人和事已不在 ⇒ 也重读，再把失败抛给面板显示人话。
 * - F11「记到我的长期记忆」（`promoteToPersonal`）：只在服务端同时说 `canEdit` 与 `canPromote`
 *   （所有者的个人对话）时给。成功（哪怕只是部分成功）⇒ 重读：没确认过的那几条已被服务端一并确认（U-3），
 *   面板三态要跟着变；逐条结果原样交给面板。整批被拒 ⇒ 抛给面板显示人话。
 * - 「整理本会话」不在这里（F13），面板因此不画那个入口。
 */
export function useKnowledgeWriteActions(state: ThreadKnowledgeState): KnowledgePanelWriteActions | undefined {
  const { threadId, data, reload } = state;
  const revision = data?.revision ?? null;
  const apply = React.useCallback(async (action: KgHumanAction): Promise<void> => {
    if (threadId === null || revision === null) throw new Error("knowledge_not_loaded");
    try {
      await applyHumanAction(threadId, revision, action);
    } catch (e) {
      const code = knowledgeGraphErrorCode(e);
      if (code !== null && KG_RELOAD_ON_FAILURE.has(code)) reload();
      throw e;
    }
    reload();
  }, [threadId, revision, reload]);
  const promote = React.useCallback(async (claimIds: string[], choices?: PromotionChoice[]): Promise<PromotionResults> => {
    if (threadId === null) throw new Error("knowledge_not_loaded");
    try {
      const result = await promoteToPersonal(threadId, claimIds, choices);
      reload();
      return result;
    } catch (e) {
      const code = knowledgeGraphErrorCode(e);
      if (code !== null && KG_RELOAD_ON_FAILURE.has(code)) reload();
      throw e;
    }
  }, [threadId, reload]);
  // 项目中枢 R7：记到项目大脑。服务端 `canPromoteToProject`（项目线程 + 创建者或引导师）；
  // 引导师不是创建者时 `canEdit` 为 false，但仍能把结论记到项目——所以 writeActions 不再只在 canEdit 时存在。
  const promoteProject = React.useCallback(async (claimIds: string[], choices?: PromotionChoice[]): Promise<PromotionResults> => {
    if (threadId === null) throw new Error("knowledge_not_loaded");
    try {
      const result = await promoteToProject(threadId, claimIds, choices);
      reload();
      return result;
    } catch (e) {
      const code = knowledgeGraphErrorCode(e);
      if (code !== null && KG_RELOAD_ON_FAILURE.has(code)) reload();
      throw e;
    }
  }, [threadId, reload]);
  const canEdit = data?.canEdit === true;
  const canPromote = canEdit && data?.canPromote === true;
  const canPromoteProject = data?.canPromoteToProject === true;
  return React.useMemo(
    () => (canEdit || canPromoteProject
      ? { apply, ...(canPromote ? { onPromote: promote } : {}), ...(canPromoteProject ? { onPromoteToProject: promoteProject } : {}) }
      : undefined),
    [canEdit, canPromote, canPromoteProject, apply, promote, promoteProject],
  );
}

/**
 * F11 —— AI 提名「值得记住」（`listPromotionNominations`）。只在能记到长期记忆时取（所有者的个人对话）；
 * 取到的只是提名，**不执行任何东西**，记不记由人点。提名是锦上添花：读失败就不画那张卡，
 * 不进错误态、不打扰面板。换线程时丢弃在途结果。
 */
export function usePromotionNominations(threadId: string | null, enabled: boolean): PromotionNominations | null {
  const [state, setState] = React.useState<{ threadId: string; data: PromotionNominations } | null>(null);
  React.useEffect(() => {
    if (threadId === null || !enabled) return undefined;
    const controller = new AbortController();
    listPromotionNominations(threadId, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ threadId, data }); },
      () => { if (!controller.signal.aborted) setState(null); },
    );
    return () => { controller.abort(); };
  }, [threadId, enabled]);
  return enabled && state !== null && state.threadId === threadId ? state.data : null;
}

/**
 * F15（06-UX R3-6 / E4）：来源抽屉「跳到原消息」——这条原话在哪个对话：会话里记下的就是那个会话；
 * 长期记忆里的，沿「记到长期记忆」时连回的那一条（`derivedFromClaimId`）找到原会话。
 * 就在当前对话、而且界面上已经有它 ⇒ 就地滚动并高亮；否则打开那个对话、加载完再高亮（`?focusMessage=`）。
 */
export async function threadOfClaimSource(claim: KgClaim): Promise<string | null> {
  if (claim.scope.kind === "chat_session") return claim.scope.id;
  if (claim.derivedFromClaimId === null) return null;
  try {
    const origin = (await fetchClaimSources(claim.derivedFromClaimId)).claim;
    return origin.scope.kind === "chat_session" ? origin.scope.id : null;
  } catch {
    return null;
  }
}

function useJumpToSource(currentThreadId: string | null) {
  // 不用 next/navigation 的 router：这一栏也在没有 App Router 的场合渲染（组件测试、预览）；整页打开原会话，历史按真实 id 加载。
  return React.useCallback((input: { claim: KgClaim; sourceKind: string; sourceRef: string }) => {
    if (input.sourceKind !== "chat_message") return;
    void threadOfClaimSource(input.claim).then((threadId) => {
      const target = threadId ?? currentThreadId;
      if (target === null) return;
      if (target === currentThreadId) {
        if (highlightChatMessage(input.sourceRef)) return;
        // 同一个对话、但界面上这条还是发送时的临时 id（刚说的话）：整页重开，历史按真实 id 加载后再高亮。
        const projectId = new URLSearchParams(window.location.search).get("projectId");
        window.location.assign(focusMessageHref({ threadId: target, messageId: input.sourceRef, projectId }));
        return;
      }
      window.location.assign(focusMessageHref({ threadId: target, messageId: input.sourceRef }));
    });
  }, [currentThreadId]);
}

/** 右栏「记忆」页签的内容：真实数据接进 `KnowledgePanel`，所有者带编辑动作。 */
export function ThreadKnowledgeTab({ state }: { state: ThreadKnowledgeState }) {
  const writeActions = useKnowledgeWriteActions(state);
  const jumpToSource = useJumpToSource(state.threadId);
  const nominations = usePromotionNominations(state.threadId, writeActions?.onPromote !== undefined);
  return (
    <KnowledgePanel
      // 换线程 = 换一份记忆：列表/图视图、抽屉、多选都从头来
      key={state.threadId ?? "none"}
      status={state.status}
      data={state.data}
      errorCode={state.errorCode}
      onRetry={state.reload}
      loadSources={loadSources}
      writeActions={writeActions}
      nominations={nominations}
      onJumpToSource={jumpToSource}
    />
  );
}
