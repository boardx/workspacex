"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KG_GRAPH_VIEW_MAX_NODES, type ThreadKnowledge } from "@/lib/mock/knowledge-graph";
import { claimTriState } from "@repo/contracts/chat-knowledge-graph";

const KnowledgeGraphCanvas = dynamic(() => import("./knowledge-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-[520px] w-full place-items-center rounded-lg border border-dashed border-border text-11 text-muted-foreground"
      data-testid="kg-graph-loading"
    >
      图加载中…
    </div>
  ),
});

/**
 * 图视图外壳（uc-18-3 R3-1 / E4）：节点数 > KG_GRAPH_VIEW_MAX_NODES（200，契约常量）时
 * **折叠为簇**而不是硬画满，避免卡死；给出「展开」入口。上限来自契约单源。
 */
export function KnowledgeGraphView({ data }: { data: ThreadKnowledge }) {
  const nodeCount = data.objects.length + data.claims.filter((c) => claimTriState(c.status) !== null).length;
  const [forceExpand, setForceExpand] = React.useState(false);
  const oversize = nodeCount > KG_GRAPH_VIEW_MAX_NODES && !forceExpand;

  if (oversize) {
    return (
      <div
        className="flex h-[520px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background p-6 text-center"
        data-testid="kg-graph-oversize"
      >
        <Layers aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-12 text-background-foreground">
          本会话有 {nodeCount} 个节点，超过一次可展示的 {KG_GRAPH_VIEW_MAX_NODES} 个
        </p>
        <p className="max-w-xs text-11 text-muted-foreground">
          已折叠为簇以保证不卡顿。请用上方筛选缩小范围，或强制展开（可能较慢）。
        </p>
        <Button size="sm" variant="outline" data-testid="kg-graph-force-expand" onClick={() => setForceExpand(true)}>
          仍然展开全部
        </Button>
      </div>
    );
  }
  return <KnowledgeGraphCanvas data={data} />;
}
