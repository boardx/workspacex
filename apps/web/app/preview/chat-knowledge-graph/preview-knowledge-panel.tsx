"use client";

import * as React from "react";
import {
  KnowledgePanel,
  type KnowledgePanelWriteActions,
  type PanelStatus,
  type PanelView,
} from "@/components/chat/knowledge/knowledge-panel";
import {
  claimSourcesNormal,
  claimSourcesRevoked,
  promotionResultsMixed,
  threadKnowledgeNormal,
  type ClaimSources,
  type ThreadKnowledge,
} from "@/lib/mock/knowledge-graph";

/**
 * 签核预览专用的面板外壳 —— 把 mock 数据接进 `KnowledgePanel` 的取数 / 动作口。
 *
 * 真实 `/chat` 的面板由 `ThreadKnowledgeTab`（`getThreadKnowledge` / `getClaimSources`）喂数据；
 * 这里只喂 mock，**只在 `/preview/chat-knowledge-graph` 用**（函数不能从 Server Component 传给
 * Client Component，所以演示用的回调收在这个 client 组件里）。纯预览，不接后端。
 */
const demoWriteActions: KnowledgePanelWriteActions = {
  apply: () => Promise.resolve(),
  onPromote: () => Promise.resolve(promotionResultsMixed),
  onReindex: () => {},
};

/** 按 claimId 取演示来源：本会话里有的那条带上它自己；长期记忆里的（不在本会话）沿用默认那份。 */
function demoLoadSources(claimId: string): Promise<ClaimSources> {
  if (claimId === "clm-todo-migrate") return Promise.resolve(claimSourcesRevoked);
  const claim = threadKnowledgeNormal.claims.find((c) => c.id === claimId);
  return Promise.resolve(claim ? { ...claimSourcesNormal, claim } : claimSourcesNormal);
}

export function PreviewKnowledgePanel({
  status,
  data,
  errorCode,
  initialView,
  showPromotionResult = false,
}: {
  status: PanelStatus;
  data: ThreadKnowledge | null;
  errorCode?: string;
  initialView?: PanelView;
  showPromotionResult?: boolean;
}) {
  return (
    <KnowledgePanel
      status={status}
      data={data}
      errorCode={errorCode}
      initialView={initialView}
      onRetry={() => {}}
      loadSources={demoLoadSources}
      writeActions={demoWriteActions}
      initialPromotionResult={showPromotionResult ? promotionResultsMixed : null}
    />
  );
}
