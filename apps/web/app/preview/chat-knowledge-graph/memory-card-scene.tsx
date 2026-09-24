"use client";

import * as React from "react";
import { MemoryCard, type MemoryCardActOptions, type MemoryCardDecision } from "@/components/chat/knowledge/memory-card";
import type { MemoryCard as MemoryCardData } from "@/lib/mock/knowledge-graph";

/**
 * 「记住 / 忘掉」确认卡预览场景的客户端外壳 —— 卡片需要 onAct 回调（函数不能从 Server Component 传给
 * Client Component）。纯预览，不接后端：点「记住 / 忘掉 / 不用了」只在本地切成对应的结局
 * （产品路径经 TurnMemoryLine 调 actOnMemoryCard）。
 */
export function MemoryCardScene({ card, canAct = true }: { card: MemoryCardData; canAct?: boolean }) {
  const act = React.useCallback(async (decision: MemoryCardDecision, opts: MemoryCardActOptions): Promise<MemoryCardData> => {
    if (decision === "dismiss") return { ...card, state: "dismissed" };
    if (card.kind === "remember") {
      return { ...card, state: "done", items: [{ claimId: "clm-preview-remembered", statement: opts.editedStatement ?? card.items[0]!.statement }] };
    }
    const keep = opts.claimIds === undefined ? card.items : card.items.filter((i) => i.claimId !== null && opts.claimIds!.includes(i.claimId));
    return { ...card, state: "done", items: keep };
  }, [card]);
  return <MemoryCard card={card} canAct={canAct} onAct={act} onUndo={async () => {}} />;
}
