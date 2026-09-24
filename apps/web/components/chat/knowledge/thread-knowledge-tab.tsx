"use client";

import * as React from "react";
import { KnowledgePanel, type KnowledgePanelWriteActions, type PanelStatus } from "./knowledge-panel";
import {
  applyHumanAction,
  fetchClaimSources,
  fetchThreadKnowledge,
  knowledgeGraphErrorCode,
  type KnowledgeGraphErrorCode,
  type ThreadKnowledge,
} from "@/lib/knowledge-graph-api";
import { KG_RELOAD_ON_FAILURE } from "@/lib/knowledge-graph-failure";
import { onKnowledgeReload, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import type { KgClaim, KgHumanAction } from "@repo/contracts/chat-knowledge-graph";

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
export function useThreadKnowledge(threadId: string | null): ThreadKnowledgeState {
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

  // 渲染期再核一次线程：effect 还没跑的那一帧里，state 可能仍是上一条线程的。
  const current = state.threadId === threadId ? state : { threadId, status: "loading" as const, data: null, errorCode: null };
  return { ...current, reload };
}

function loadSources(claim: KgClaim) {
  return fetchClaimSources(claim.id);
}

/**
 * F10 —— 人的编辑动作（`applyHumanAction`）。**只在服务端说 `canEdit=true` 时返回**：非所有者拿到
 * `undefined`，面板一个编辑入口都不画（uc-18-3 R5）。
 *
 * - `basedOnRevision` 取当前读模型的 `revision`（乐观并发）。
 * - 成功 ⇒ 立即重读（刷新期间保留已显示的数据，不闪骨架屏），面板与页签角标一起更新。
 * - `KG_REVISION_CHANGED` / 条目或人和事已不在 ⇒ 也重读，再把失败抛给面板显示人话。
 * - 「记到长期记忆」「整理本会话」不在这里（F11 / F13），面板因此不画那两个入口。
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
  const canEdit = data?.canEdit === true;
  return React.useMemo(() => (canEdit ? { apply } : undefined), [canEdit, apply]);
}

/** 右栏「记忆」页签的内容：真实数据接进 `KnowledgePanel`，所有者带编辑动作。 */
export function ThreadKnowledgeTab({ state }: { state: ThreadKnowledgeState }) {
  const writeActions = useKnowledgeWriteActions(state);
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
    />
  );
}
