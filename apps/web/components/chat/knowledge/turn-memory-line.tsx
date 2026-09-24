"use client";

import * as React from "react";
import { AnswerMemoryLine } from "./answer-memory-line";
import { AnswerKnowledgeFooter } from "./answer-knowledge-footer";
import {
  applyHumanAction,
  fetchTurnMemory,
  knowledgeGraphErrorCode,
  type TurnMemory,
} from "@/lib/knowledge-graph-api";
import { describeHumanActionFailure } from "@/lib/knowledge-graph-failure";
import {
  requestKnowledgeReload,
  requestOpenKnowledgePanel,
  useKnowledgeSnapshot,
} from "@/lib/knowledge-graph-events";

/**
 * 回答落库后，服务端仍在整理（`pending = true`）时的补读间隔。抽取是异步的：回答刚结束那一刻
 * 通常还没记完。**最多补读这几次**，不做常驻轮询——一屏历史消息各自常驻轮询会把接口打满。
 */
export const TURN_MEMORY_REPOLL_DELAYS_MS: readonly number[] = [3_000, 8_000];

/**
 * phase-18 F09 / U-1 —— 回答下方的「已记下 N 条 · 查看 · 撤销」，数据来自 `getTurnMemory`。
 *
 * - 只在这条回答**已落库**（调用方拿到了持久化 messageId）之后挂载，即回答已经说完；
 *   取数在 effect 里异步做，**不阻塞、不拖慢**正文渲染——取到之前什么都不画，不占位。
 * - `captured` 为空且不在整理中 ⇒ 不渲染任何东西（打扰要克制，E8）。
 * - 读失败 ⇒ 同样不渲染：这一行是回答的附注，不能因为记忆服务不可用就在每条回答下挂一条报错；
 *   记忆面板本身（右栏「记忆」页签）会如实显示错误态。这不是回退到假数据——什么都不显示。
 * - 「查看」打开右栏记忆面板。
 * - 「撤销」（F10）：只有所有者看得到（读模型快照 `canEdit`，见 `lib/knowledge-graph-events.ts`）。
 *   把本轮记下的逐条 `revokeClaim`，每条带上一条返回的最新 `revision`；已经不在的那条
 *   （`KG_CLAIM_NOT_FOUND`，比如先在面板里忘掉了）视为已撤销。结束后让右栏记忆重读。
 * - F13：本轮用到的记忆（`recalled`）与「查不全」（`recallDegraded`）画在最前面——引用 chip +
 *   「为什么用到它」，点 chip 打开那一条的来源抽屉；其后才是「已记下 N 条」。两样都没有 ⇒ 整块不渲染。
 *   主动卡片仍然最多一张（这里不画任何主动卡片）。
 */
export function TurnMemoryLine({ threadId, messageId }: { threadId: string; messageId: string }) {
  const [turn, setTurn] = React.useState<TurnMemory | null>(null);
  const snapshot = useKnowledgeSnapshot(threadId);
  const canUndo = snapshot?.canEdit === true;
  const baseRevision = snapshot?.revision ?? null;
  const captured = turn?.captured;

  const undo = React.useCallback(async (): Promise<void> => {
    if (baseRevision === null || !captured) return;
    let revision = baseRevision;
    try {
      for (const c of captured) {
        try {
          revision = (await applyHumanAction(threadId, revision, { type: "revokeClaim", claimId: c.claimId })).revision;
        } catch (e) {
          if (knowledgeGraphErrorCode(e) !== "KG_CLAIM_NOT_FOUND") throw e;
        }
      }
    } catch (e) {
      requestKnowledgeReload(threadId);
      throw new Error(describeHumanActionFailure(e));
    }
    requestKnowledgeReload(threadId);
  }, [threadId, baseRevision, captured]);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    setTurn(null);

    const attempt = (index: number): void => {
      fetchTurnMemory(threadId, messageId, controller.signal).then(
        (value) => {
          if (cancelled) return;
          const delay = TURN_MEMORY_REPOLL_DELAYS_MS[index];
          if (value.pending && delay !== undefined) {
            setTurn(value);
            timer = setTimeout(() => attempt(index + 1), delay);
            return;
          }
          // 补读次数用完仍在整理：不再挂一个永远转圈的「正在记…」——只报到目前为止真实记下的条数
          // （为 0 时整行不渲染）。完整结果在记忆面板里看。
          setTurn(value.pending ? { ...value, pending: false } : value);
        },
        () => {
          if (!cancelled) setTurn(null);
        },
      );
    };
    attempt(0);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [threadId, messageId]);

  if (turn === null) return null;
  const showFooter = turn.recalled.length > 0 || turn.recallDegraded;
  const showCaptured = turn.pending || turn.captured.length > 0;
  if (!showFooter && !showCaptured) return null;
  return (
    <>
      {showFooter ? <AnswerKnowledgeFooter recalled={turn.recalled} recallDegraded={turn.recallDegraded} /> : null}
      {showCaptured ? (
        <AnswerMemoryLine turn={turn} onView={requestOpenKnowledgePanel} onUndo={canUndo ? undo : undefined} />
      ) : null}
    </>
  );
}
