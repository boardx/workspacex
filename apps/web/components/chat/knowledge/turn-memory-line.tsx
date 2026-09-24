"use client";

import * as React from "react";
import { AnswerMemoryLine } from "./answer-memory-line";
import { fetchTurnMemory, type TurnMemory } from "@/lib/knowledge-graph-api";
import { requestOpenKnowledgePanel } from "@/lib/knowledge-graph-events";

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
 * - 「查看」打开右栏记忆面板；「撤销」的真实通路 F10 才接，此处为禁用态（见 `AnswerMemoryLine`）。
 */
export function TurnMemoryLine({ threadId, messageId }: { threadId: string; messageId: string }) {
  const [turn, setTurn] = React.useState<TurnMemory | null>(null);

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
  if (!turn.pending && turn.captured.length === 0) return null;
  return <AnswerMemoryLine turn={turn} onView={requestOpenKnowledgePanel} />;
}
