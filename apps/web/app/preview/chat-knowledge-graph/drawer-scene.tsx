"use client";

import * as React from "react";
import { PreviewKnowledgePanel } from "./preview-knowledge-panel";
import { ClaimSourceDrawer } from "@/components/chat/knowledge/claim-source-drawer";
import {
  threadKnowledgeNormal,
  claimSourcesNormal,
  claimSourcesRevoked,
  type ClaimSources,
} from "@/lib/mock/knowledge-graph";

/**
 * 来源抽屉预览场景的客户端外壳 —— 抽屉需要 onClose 回调（函数不能从 Server Component 传给
 * Client Component），所以把这一屏收进一个 client 组件里自持状态。纯预览，不接后端。
 */
export function DrawerScene({ revoked }: { revoked: boolean }) {
  const [open, setOpen] = React.useState(true);
  const data: ClaimSources = revoked ? claimSourcesRevoked : claimSourcesNormal;
  return (
    <>
      <PreviewKnowledgePanel status="ready" data={threadKnowledgeNormal} initialView="list" />
      <ClaimSourceDrawer data={data} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
