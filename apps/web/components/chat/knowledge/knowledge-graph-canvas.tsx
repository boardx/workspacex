"use client";

import * as React from "react";
import { Expand, RotateCcw, Scan, ZoomIn, ZoomOut, Network, UserRound, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ReactFlow, Background, Handle, Position, BaseEdge, EdgeLabelRenderer, getBezierPath, MarkerType, applyNodeChanges, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KG_OBJECT_KIND_LABEL_ZH, type KgObjectKind, type KgClaimKind, type KgRelation } from "@repo/contracts/chat-knowledge-graph";
import { layoutKnowledgeGraph, type GraphItem } from "@/lib/knowledge-graph-layout";
import { useI18n } from "@/lib/i18n/provider";
import { graphObjectKindLabel, graphClaimKindLabel, graphRelationLabel, graphTriStateLabel } from "@/lib/knowledge-graph-copy";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";

interface KgNodeData extends Record<string, unknown> { item: GraphItem; dimmed: boolean; focused: boolean; displayKind?: string; isPerson?: boolean }
type KgNodeType = Node<KgNodeData, "kg">;
interface KgEdgeData extends Record<string, unknown> { focused: boolean; sameColumn: boolean; lane: number }
const TONE_STYLE = {
  object: "border-border bg-card text-background-foreground",
  pending: "border-warning/40 bg-warning-tint text-warning-tint-foreground",
  confirmed: "border-success/40 bg-card text-background-foreground",
  conflict: "border-destructive/40 bg-destructive/10 text-background-foreground",
};
function KgNode({ data }: NodeProps<KgNodeType>) {
  const { locale } = useI18n();
  const { item, dimmed, focused } = data;
  const Icon = item.variant === "claim" ? StickyNote : (data.isPerson ?? item.kindLabel === KG_OBJECT_KIND_LABEL_ZH.person) ? UserRound : Network;
  return <div title={item.label} data-testid={`kg-graph-node-${item.id.replace(":", "-")}`} style={{ width: item.width, height: item.height, opacity: dimmed ? 0.3 : 1 }} className={`rounded-xl border p-4 text-left shadow-sm transition-opacity duration-base ${TONE_STYLE[item.tone]} ${focused ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
    {item.ports.map(port => <Handle key={port.id} id={port.id} type={port.type} position={port.side === "left" ? Position.Left : Position.Right} isConnectable={false} style={{ top: `${port.offset}%` }} className="!h-1 !w-1 !border-0 !bg-muted-foreground !opacity-40" />)}
    <div className="mb-2 flex items-center gap-2 text-11 text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden /><span>{data.displayKind ?? item.kindLabel}</span>{item.tone !== "object" && <span className="ml-auto rounded-full border border-current/20 px-2 py-0.5 text-10">{graphTriStateLabel(item.tone, locale)}</span>}</div>
    <div className={`break-words text-sm font-medium leading-5 ${item.variant === "claim" ? "line-clamp-3" : "line-clamp-2"}`}>{item.label}</div>
  </div>;
}
function KgEdge(props: EdgeProps<Edge<KgEdgeData>>) {
  const d = props.data;
  const [bezier, mx, my] = getBezierPath(props);
  const laneX = Math.max(props.sourceX, props.targetX) + 48 + (d?.lane ?? 0) * 18;
  const path = d?.sameColumn ? `M ${props.sourceX},${props.sourceY} C ${laneX},${props.sourceY} ${laneX},${props.targetY} ${props.targetX},${props.targetY}` : bezier;
  // Focus limits labels to one neighborhood; its distinct endpoints spread labels along their curves.
  const labelX = d?.sameColumn ? laneX : mx;
  const labelY = my;
  return <>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={16} />
    {d?.focused && <EdgeLabelRenderer><div data-testid={`kg-graph-label-${props.id.slice(5)}`} className="pointer-events-none absolute rounded-md border border-border bg-background px-2 py-1 text-11 font-medium text-background-foreground shadow-sm" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{props.label}</div></EdgeLabelRenderer>}
  </>;
}
const NODE_TYPES = { kg: KgNode };
const EDGE_TYPES = { kg: KgEdge };
function GraphTools({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  const flow = useReactFlow();
  return <div className="absolute bottom-3 left-3 z-10 flex gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
    <Button size="icon" variant="ghost" aria-label={t("chatKnowledge.graph.zoomIn")} title={t("chatKnowledge.graph.zoomIn")} onClick={() => void flow.zoomIn()}><ZoomIn className="h-4 w-4" /></Button>
    <Button size="icon" variant="ghost" aria-label={t("chatKnowledge.graph.zoomOut")} title={t("chatKnowledge.graph.zoomOut")} onClick={() => void flow.zoomOut()}><ZoomOut className="h-4 w-4" /></Button>
    <Button size="icon" variant="ghost" aria-label={t("chatKnowledge.graph.fit")} title={t("chatKnowledge.graph.fit")} onClick={() => void flow.fitView({ padding: 0.16 })}><Scan className="h-4 w-4" /></Button>
    <Button size="icon" variant="ghost" aria-label={t("chatKnowledge.graph.reset")} title={t("chatKnowledge.graph.reset")} onClick={() => { reset(); requestAnimationFrame(() => void flow.fitView({ padding: 0.16 })); }}><RotateCcw className="h-4 w-4" /></Button>
  </div>;
}
function GraphView({ data, expanded, onOpenClaim }: { data: ThreadKnowledge; expanded: boolean; onOpenClaim?: (id: string) => void }) {
  const { t, locale } = useI18n();
  const layout = React.useMemo(() => layoutKnowledgeGraph(data), [data]);
  type KindInfo = { variant: "object"; kind: KgObjectKind } | { variant: "claim"; kind: KgClaimKind };
  const kinds = React.useMemo(() => new Map<string, KindInfo>([
    ...data.objects.map(o => [`object:${o.id}`, { variant: "object" as const, kind: o.kind }] as const),
    ...data.claims.map(c => [`claim:${c.id}`, { variant: "claim" as const, kind: c.kind }] as const),
  ]), [data]);
  const relations = React.useMemo(() => new Map<string, KgRelation>(data.edges.map(e => [`edge:${e.id}`, e.relation] as const)), [data]);
  const [focus, setFocus] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const active = hover ?? focus;
  const initial = React.useMemo<KgNodeType[]>(() => layout.items.map(item => ({ id: item.id, type: "kg", position: { x: item.x, y: item.y }, width: item.width, height: item.height, ariaLabel: `${item.kindLabel}：${item.label}`, data: { item, dimmed: false, focused: false } })), [layout]);
  const [placed, setPlaced] = React.useState(initial);
  React.useEffect(() => { setPlaced(initial); setFocus(null); setHover(null); }, [initial]);
  const neighbors = new Set(active ? [active, ...layout.links.filter(l => l.source === active || l.target === active).flatMap(l => [l.source, l.target])] : []);
  // Locale only changes this render projection, never layout/initial/placed or its reset effect.
  const nodes = placed.map(n => {
    const info = kinds.get(n.id);
    const displayKind = info ? info.variant === "object" ? graphObjectKindLabel(info.kind, locale) : graphClaimKindLabel(info.kind, locale) : n.data.item.kindLabel;
    return { ...n, ariaLabel: t("chatKnowledge.graph.nodeAria", { kind: displayKind, label: n.data.item.label }),
      data: { ...n.data, displayKind, isPerson: info ? info.variant === "object" && info.kind === "person" : n.data.item.kindLabel === KG_OBJECT_KIND_LABEL_ZH.person,
        dimmed: !!active && !neighbors.has(n.id), focused: n.id === active } };
  });
  const edges: Edge<KgEdgeData>[] = layout.links.map(l => {
    const focused = !!active && (l.source === active || l.target === active);
    const relation = relations.get(l.id);
    return { ...l, label: relation ? graphRelationLabel(relation, locale) : l.label, type: "kg", data: { focused, sameColumn: l.sameColumn, lane: l.lane }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: focused ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }, style: { stroke: focused ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", strokeWidth: focused ? 2 : 1.2, opacity: active ? focused ? 1 : 0.12 : 0.4 } };
  });
  const selected = layout.items.find(n => n.id === focus);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-11 text-muted-foreground">
      <span>{t("chatKnowledge.graph.counts", { objects: layout.items.filter(n => n.variant === "object").length, claims: layout.items.filter(n => n.variant === "claim").length })}</span>
      <span>{t(expanded ? "chatKnowledge.graph.expandedHint" : "chatKnowledge.graph.compactHint")}</span>
      {selected && <Button size="xs" variant="ghost" className="max-w-full truncate" onClick={() => { setFocus(null); setHover(null); }}>{t("chatKnowledge.graph.clearFocus", { label: selected.label })}</Button>}
    </div>
    <div className="relative min-h-0 flex-1">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} nodesDraggable={expanded} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} onNodesChange={changes => setPlaced(current => applyNodeChanges(changes, current))} fitView minZoom={0.1} maxZoom={1.6} fitViewOptions={{ padding: 0.16, maxZoom: 1 }} proOptions={{ hideAttribution: true }} onNodeMouseEnter={(_e, n) => setHover(n.id)} onNodeMouseLeave={() => setHover(null)} onPaneClick={() => { setFocus(null); setHover(null); }} onNodeClick={(_e, n) => { if (n.id.startsWith("claim:")) onOpenClaim?.(n.id.slice(6)); else setFocus(n.id); }}>
        <Background gap={24} size={1} color="hsl(var(--border))" />
        <GraphTools reset={() => { setPlaced(initial); setFocus(null); setHover(null); }} />
      </ReactFlow>
    </div>
  </div>;
}
export default function KnowledgeGraphCanvas({ data, onOpenClaim }: { data: ThreadKnowledge; onOpenClaim?: (claimId: string) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState(false);
  return <div className="relative flex h-[32rem] w-full flex-col overflow-hidden rounded-xl border border-border bg-background" data-testid="kg-graph-canvas">
    <div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="text-xs font-medium">{t("chatKnowledge.graph.title")}</span><Button size="xs" variant="outline" onClick={() => setExpanded(true)}><Expand className="mr-1.5 h-3 w-3" />{t("chatKnowledge.graph.expand")}</Button></div>
    <div className="min-h-0 flex-1"><GraphView data={data} expanded={false} onOpenClaim={onOpenClaim} /></div>
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="max-w-7xl"><DialogHeader><DialogTitle>{t("chatKnowledge.graph.title")}</DialogTitle><DialogDescription>{t("chatKnowledge.graph.description")}</DialogDescription></DialogHeader><div className="h-[75vh] w-full"><GraphView data={data} expanded onOpenClaim={id => { setExpanded(false); onOpenClaim?.(id); }} /></div></DialogContent></Dialog>
  </div>;
}
