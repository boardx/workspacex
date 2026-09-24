"use client";

/**
 * 知识图谱画布 —— 真正 `import "@xyflow/react"` 的那一层（uc-18-3 R3 图视图）。
 * 单独拆文件以便上层用 `next/dynamic({ ssr: false })` 懒加载（xyflow 挂载时量测尺寸，
 * SSR 无浏览器 API）——与 `agent-capability-graph-canvas.tsx` 同一个坑同一个修法。
 *
 * 只读边界：`nodesDraggable/nodesConnectable=false`，不传 `onConnect`——看清现状，不编辑。
 * 编辑动作走列表视图的 `ClaimEditMenu`（本轮图视图只读）。
 */
import * as React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KG_TRI_STATE_LABEL_ZH, claimTriState } from "@repo/contracts/chat-knowledge-graph";
import { KG_OBJECT_KIND_LABEL_ZH, KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";

type NodeVariant = "object" | "claim";

interface KgNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly sublabel: string;
  readonly variant: NodeVariant;
  readonly tone: "pending" | "confirmed" | "conflict" | "object";
  readonly testId: string;
}

const TONE_STYLE: Record<KgNodeData["tone"], string> = {
  object: "border-border bg-card text-background-foreground",
  pending: "border-warning bg-warning-tint text-warning-tint-foreground",
  confirmed: "border-success bg-success/10 text-background-foreground",
  conflict: "border-destructive bg-destructive/10 text-background-foreground",
};

function KgNode({ data }: NodeProps) {
  const d = data as KgNodeData;
  return (
    <div
      className={`max-w-40 rounded-lg border px-3 py-2 text-left transition-colors duration-base ${TONE_STYLE[d.tone]}`}
      data-testid={d.testId}
    >
      {/* 边要有挂点才画得出来：左入右出，挂点不可交互（图视图只读）。 */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
      <div className="flex flex-col gap-0.5 text-11">
        <span className="truncate">{d.label}</span>
        <span className="text-10 text-muted-foreground">{d.sublabel}</span>
      </div>
    </div>
  );
}

const NODE_TYPES = { kg: KgNode };

export default function KnowledgeGraphCanvas({
  data,
  onOpenClaim,
}: {
  data: ThreadKnowledge;
  /** 点一条「记下的」节点 → 打开来源抽屉（与列表视图同一个入口）。 */
  onOpenClaim?: (claimId: string) => void;
}) {
  const { nodes, edges } = React.useMemo(() => {
    const built: Node[] = [];
    // 实体按左列纵向排布，结论按右列纵向排布——两列布局便于看清 about/decided_by 连边。
    // claimCount = 0 的孤立人和事不渲染（契约 KgObject.claimCount 注释，uc-18-5 A1）。
    data.objects.filter((o) => o.claimCount > 0).forEach((o, i) => {
      built.push({
        id: `object:${o.id}`,
        type: "kg",
        position: { x: 0, y: i * 90 },
        data: {
          label: o.name,
          sublabel: KG_OBJECT_KIND_LABEL_ZH[o.kind],
          variant: "object",
          tone: "object",
          testId: `kg-graph-node-object-${o.id}`,
        } satisfies KgNodeData,
        sourcePosition: Position.Right,
        targetPosition: Position.Right,
      });
    });
    data.claims.forEach((c, i) => {
      const tri = claimTriState(c.status);
      if (!tri) return;
      built.push({
        id: `claim:${c.id}`,
        type: "kg",
        position: { x: 420, y: i * 90 },
        data: {
          label: c.statement.length > 24 ? `${c.statement.slice(0, 24)}…` : c.statement,
          sublabel: `${KG_CLAIM_KIND_LABEL_ZH[c.kind]} · ${KG_TRI_STATE_LABEL_ZH[tri]}`,
          variant: "claim",
          tone: tri,
          testId: `kg-graph-node-claim-${c.id}`,
        } satisfies KgNodeData,
        sourcePosition: Position.Left,
        targetPosition: Position.Left,
      });
    });
    const ids = new Set(built.map((n) => n.id));
    const built_edges: Edge[] = data.edges
      .map((e) => ({
        id: `edge:${e.id}`,
        source: `${e.src.kind}:${e.src.id}`,
        target: `${e.dst.kind}:${e.dst.id}`,
        label: e.relation,
        data: { testId: `kg-graph-edge-${e.id}` },
      }))
      .filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes: built, edges: built_edges };
  }, [data]);

  return (
    <div className="h-[520px] w-full rounded-lg border border-border bg-background" data-testid="kg-graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => {
          if (node.id.startsWith("claim:")) onOpenClaim?.(node.id.slice("claim:".length));
        }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
