"use client";

import * as React from "react";
import { KnowledgePanel, type PanelStatus } from "./knowledge-panel";
import {
  fetchClaimSources,
  fetchThreadKnowledge,
  knowledgeGraphErrorCode,
  type KnowledgeGraphErrorCode,
  type ThreadKnowledge,
} from "@/lib/knowledge-graph-api";
import type { KgClaim } from "@repo/contracts/chat-knowledge-graph";

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

  // 渲染期再核一次线程：effect 还没跑的那一帧里，state 可能仍是上一条线程的。
  const current = state.threadId === threadId ? state : { threadId, status: "loading" as const, data: null, errorCode: null };
  return { ...current, reload };
}

function loadSources(claim: KgClaim) {
  return fetchClaimSources(claim.id);
}

/** 右栏「记忆」页签的内容：真实数据接进 `KnowledgePanel`。写动作 F10 起才接（见 `KnowledgePanelWriteActions`）。 */
export function ThreadKnowledgeTab({ state }: { state: ThreadKnowledgeState }) {
  return (
    <KnowledgePanel
      // 换线程 = 换一份记忆：列表/图视图、抽屉、多选都从头来
      key={state.threadId ?? "none"}
      status={state.status}
      data={state.data}
      errorCode={state.errorCode}
      onRetry={state.reload}
      loadSources={loadSources}
    />
  );
}
