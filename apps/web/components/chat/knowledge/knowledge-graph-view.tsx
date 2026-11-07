"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { KgObjectKind } from "@repo/contracts/chat-knowledge-graph";
import { useI18n } from "@/lib/i18n/provider";
import { graphObjectKindLabel, graphTriStateLabel } from "@/lib/knowledge-graph-copy";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  KG_GRAPH_VIEW_MAX_NODES,
  clusterKnowledgeGraph,
  graphNodeCount,
  type KnowledgeGraphCluster,
} from "@/lib/knowledge-graph-view";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";

function GraphLoading() {
  const { t } = useI18n();
  return <div className="grid h-[520px] w-full place-items-center rounded-lg border border-dashed border-border text-11 text-muted-foreground" data-testid="kg-graph-loading">{t("chatKnowledge.graph.loading")}</div>;
}
const KnowledgeGraphCanvas = dynamic(() => import("./knowledge-graph-canvas"), { ssr: false, loading: GraphLoading });

const CLUSTER_TONE: Record<KnowledgeGraphCluster["tone"], string> = {
  object: "border-border bg-card text-background-foreground",
  pending: "border-warning bg-warning-tint text-warning-tint-foreground",
  confirmed: "border-success bg-success/10 text-background-foreground",
  conflict: "border-destructive bg-destructive/10 text-background-foreground",
};

/**
 * 图视图外壳（uc-18-3 R3-1 / E4）：节点数 > KG_GRAPH_VIEW_MAX_NODES（200，契约常量）时
 * **折叠为簇**（人和事按类型、记下的按三态各聚成一个节点并标计数），而不是硬画满；
 * 给出「仍然展开全部」入口。上限来自契约单源，分簇规则见 `clusterKnowledgeGraph`。
 */
export function KnowledgeGraphView({
  data,
  onOpenClaim,
}: {
  data: ThreadKnowledge;
  onOpenClaim?: (claimId: string) => void;
}) {
  const { t, locale } = useI18n();
  const nodeCount = graphNodeCount(data);
  const [forceExpand, setForceExpand] = React.useState(false);
  const oversize = nodeCount > KG_GRAPH_VIEW_MAX_NODES && !forceExpand;

  if (oversize) {
    const clusters = clusterKnowledgeGraph(data);
    return (
      <div
        className="flex min-h-[520px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background p-6 text-center"
        data-testid="kg-graph-oversize"
        data-node-count={nodeCount}
      >
        <Layers aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-12 text-background-foreground">
          {t("chatKnowledge.graph.oversize", { count: nodeCount, limit: KG_GRAPH_VIEW_MAX_NODES })}
        </p>
        <p className="max-w-xs text-11 text-muted-foreground">
          {t("chatKnowledge.graph.clusters", { count: clusters.length })}
        </p>
        <ul className="flex max-w-sm flex-wrap justify-center gap-2" data-testid="kg-graph-clusters">
          {clusters.map((c) => (
            <li
              key={c.key}
              data-testid={`kg-graph-cluster-${c.key}`}
              data-count={c.count}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-11 ${CLUSTER_TONE[c.tone]}`}
            >
              <span>{c.variant === "claim" && c.tone !== "object" ? graphTriStateLabel(c.tone, locale) : (() => {
                const kind = KgObjectKind.safeParse(c.key.slice("object-".length));
                return kind.success ? graphObjectKindLabel(kind.data, locale) : c.label;
              })()}</span>
              <span className="rounded-control bg-muted px-1.5 py-0.5 text-10 text-muted-foreground">{c.count}</span>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" data-testid="kg-graph-force-expand" onClick={() => setForceExpand(true)}>
          {t("chatKnowledge.graph.expandAll")}
        </Button>
      </div>
    );
  }
  return <KnowledgeGraphCanvas data={data} onOpenClaim={onOpenClaim} />;
}
