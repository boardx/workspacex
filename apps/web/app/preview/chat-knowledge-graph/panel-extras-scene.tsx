"use client";

import * as React from "react";
import { NominationCard } from "@/components/chat/knowledge/nomination-card";
import { PromotionResultList } from "@/components/chat/knowledge/promotion-result-list";
import {
  threadKnowledgeNormal,
  promotionResultsMixed,
  nominationsNormal,
} from "@/lib/mock/knowledge-graph";

/**
 * 「记入长期记忆」相关的两屏（逐条结果 / AI 提名）的客户端外壳 —— 它们要传 claimLabel 回调
 * （函数不能从 Server Component 传给 Client Component），所以收进 client 组件。纯预览，不接后端。
 */
export function PanelExtrasScene({ kind }: { kind: "promote-results" | "nomination" }) {
  const claimLabel = React.useCallback(
    (id: string) => threadKnowledgeNormal.claims.find((c) => c.id === id)?.statement ?? id,
    [],
  );

  if (kind === "promote-results") {
    return (
      <div className="flex h-full flex-col p-3" data-testid="kg-panel">
        <h2 className="mb-2 text-12 font-medium">记到长期记忆 · 逐条结果</h2>
        <p className="mb-2 text-10 text-muted-foreground">部分成功，不整批回滚（uc-18-4 E4）</p>
        <PromotionResultList data={promotionResultsMixed} claimLabel={claimLabel} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="kg-panel">
      <h2 className="text-12 font-medium">会话结束 · AI 提名</h2>
      <NominationCard data={nominationsNormal} claimLabel={claimLabel} />
    </div>
  );
}
