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
  type ClaimSources,
  type ThreadKnowledge,
} from "@/lib/mock/knowledge-graph";
import type { KgClaim } from "@repo/contracts/chat-knowledge-graph";

/**
 * 签核预览专用的面板外壳 —— 把 mock 数据接进 `KnowledgePanel` 的取数 / 动作口。
 *
 * 真实 `/chat` 的面板由 `ThreadKnowledgeTab`（`getThreadKnowledge` / `getClaimSources`）喂数据；
 * 这里只喂 mock，**只在 `/preview/chat-knowledge-graph` 用**（函数不能从 Server Component 传给
 * Client Component，所以演示用的回调收在这个 client 组件里）。纯预览，不接后端。
 */
const demoWriteActions: KnowledgePanelWriteActions = {
  onAction: () => {},
  onPromote: () => Promise.resolve(promotionResultsMixed),
  onReindex: () => {},
};

function demoLoadSources(claim: KgClaim): Promise<ClaimSources> {
  return Promise.resolve(
    claim.status === "proposed" && claim.id === "clm-todo-migrate" ? claimSourcesRevoked : { ...claimSourcesNormal, claim },
  );
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
