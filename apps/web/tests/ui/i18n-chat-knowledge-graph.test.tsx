import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { NodeChange } from "@xyflow/react";

const flow = vi.hoisted(() => ({
  move: null as ((changes: NodeChange[]) => void) | null,
  zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn(),
}));

// Only the external canvas/context boundary is replaced. The real nodeTypes.kg
// and edgeTypes.kg renderers, GraphView state and pure applyNodeChanges execute.
vi.mock("@xyflow/react", async (load) => {
  const actual = await load<typeof import("@xyflow/react")>();
  interface FlowNode { id: string; type?: string; position: { x: number; y: number }; ariaLabel?: string; data: Record<string, unknown> }
  interface FlowEdge { id: string; type?: string; label?: React.ReactNode; source: string; target: string; data?: Record<string, unknown> }
  interface Props {
    nodes: FlowNode[]; edges: FlowEdge[]; nodesDraggable?: boolean; children?: React.ReactNode;
    nodeTypes?: Record<string, React.ComponentType<{ id: string; data: Record<string, unknown> }>>;
    edgeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>;
    onNodesChange?: (changes: NodeChange[]) => void;
    onNodeClick?: (event: React.MouseEvent, node: FlowNode) => void;
  }
  return {
    ...actual,
    ReactFlow: function Flow({ nodes, edges, nodeTypes, edgeTypes, nodesDraggable, children, onNodesChange, onNodeClick }: Props) {
      if (nodesDraggable) flow.move = onNodesChange ?? null;
      return <div data-testid="kg-real-renderer-bridge" data-draggable={String(Boolean(nodesDraggable))}>
        {nodes.map(node => {
          const Component = nodeTypes?.[node.type ?? "kg"];
          return <div key={node.id} role="group" aria-label={node.ariaLabel} data-testid={`flow-node-${node.id}`}
            data-x={node.position.x} data-y={node.position.y} data-focused={String(Boolean(node.data.focused))}
            onClick={event => onNodeClick?.(event, node)}>
            {Component && <Component id={node.id} data={node.data} />}
          </div>;
        })}
        {edges.map(edge => {
          const Component = edgeTypes?.[edge.type ?? "kg"];
          return Component ? <Component key={edge.id} {...edge} sourceX={0} sourceY={0} targetX={100} targetY={100}
            sourcePosition={actual.Position.Right} targetPosition={actual.Position.Left} /> : null;
        })}
        {children}
      </div>;
    },
    Handle: () => null,
    Background: () => null,
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useReactFlow: () => ({ zoomIn: flow.zoomIn, zoomOut: flow.zoomOut, fitView: flow.fitView }),
  };
});

import { knowledgeGraph, KG_GRAPH_VIEW_MAX_NODES } from "@repo/contracts/chat-knowledge-graph";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import KnowledgeGraphCanvas from "@/components/chat/knowledge/knowledge-graph-canvas";
import { KnowledgeGraphView } from "@/components/chat/knowledge/knowledge-graph-view";

let changeLocale: () => void = () => {};
function LocaleControl() {
  const { setLocale } = useI18n();
  React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]);
  return null;
}
const scope = { kind: "chat_session" as const, id: "raw-thread" };
const rawName = "用户人物原名 {name}";
const rawStatement = "模型原始记忆 {count} 与 const x = '{locale}';";
const object = { id: "raw-person", scope, kind: "person" as const, name: rawName, aliases: [], createdBy: "model" as const, claimCount: 1 };
const claim = { id: "raw-claim", scope, kind: "decision" as const, statement: rawStatement, status: "accepted" as const, triState: "confirmed" as const,
  confidence: 0.8, createdBy: "model" as const, reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null,
  aboutObjectIds: [object.id], supportingCount: 1, contradictingCount: 0, createdAt: "2026-11-04T00:00:00Z" };
const data = knowledgeGraph.getThreadKnowledge.out.parse({ scope, revision: 7, objects: [object], claims: [claim],
  edges: [{ id: "raw-edge", src: { kind: "claim", id: claim.id }, dst: { kind: "object", id: object.id }, relation: "decided_by", createdBy: "model" }],
  ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: false, canPromote: false, visibility: "owner_only", extractionActive: true });

beforeEach(() => { vi.clearAllMocks(); flow.move = null; });
afterEach(cleanup);

it("renders real knowledge nodes and focused relation labels while preserving raw content and focus on locale", () => {
  const open = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgeGraphCanvas data={data} onOpenClaim={open} /></I18nProvider>);
  const person = screen.getByRole("group", { name: `Person: ${rawName}` });
  const actualNode = within(person).getByTestId("kg-graph-node-object-raw-person");
  expect(actualNode).toHaveTextContent("Person"); expect(actualNode).toHaveTextContent(rawName);
  expect(screen.getByRole("group", { name: `Decision: ${rawStatement}` })).toHaveTextContent("Confirmed");
  fireEvent.click(person); expect(person).toHaveAttribute("data-focused", "true");
  const relation = screen.getByTestId("kg-graph-label-raw-edge"); expect(relation).toHaveTextContent("Decided by");
  act(() => changeLocale());
  expect(screen.getByRole("group", { name: `人物：${rawName}` })).toBe(person);
  expect(within(person).getByTestId("kg-graph-node-object-raw-person")).toBe(actualNode);
  expect(person).toHaveAttribute("data-focused", "true"); expect(actualNode).toHaveTextContent(rawName);
  expect(screen.getByTestId("kg-graph-node-claim-raw-claim")).toHaveTextContent(rawStatement);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("flow-node-claim:raw-claim")); expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith(claim.id);
});

it("keeps expanded manual placement and actual node DOM across locale without a reset or extra source action", () => {
  const open = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgeGraphCanvas data={data} onOpenClaim={open} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Expand graph" }));
  const dialog = screen.getByRole("dialog", { name: "Relationship graph" });
  const person = within(dialog).getByTestId("flow-node-object:raw-person");
  expect(flow.move).not.toBeNull(); act(() => { flow.move?.([{ type: "position", id: "object:raw-person", position: { x: 351, y: 217 } }]); });
  expect(person).toHaveAttribute("data-x", "351"); expect(person).toHaveAttribute("data-y", "217");
  fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" })); expect(flow.zoomIn).toHaveBeenCalledTimes(1);
  act(() => changeLocale());
  expect(screen.getByRole("dialog", { name: "关系图" })).toBe(dialog);
  expect(within(dialog).getByTestId("flow-node-object:raw-person")).toBe(person);
  expect(person).toHaveAttribute("data-x", "351"); expect(person).toHaveAttribute("data-y", "217");
  expect(flow.fitView).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" })); expect(screen.queryByRole("dialog")).toBeNull();
});

it("uses the canonical oversize limit and keeps explicit expansion state across locale", async () => {
  const oversized = knowledgeGraph.getThreadKnowledge.out.parse({ ...data, claims: [], edges: [],
    objects: Array.from({ length: KG_GRAPH_VIEW_MAX_NODES + 1 }, (_, index) => ({ ...object, id: `raw-object-${index}`, name: `${rawName}-${index}` })) });
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgeGraphView data={oversized} /></I18nProvider>);
  expect(screen.getByTestId("kg-graph-oversize")).toHaveTextContent(`This conversation has ${KG_GRAPH_VIEW_MAX_NODES + 1} nodes`);
  expect(screen.getByTestId("kg-graph-cluster-object-person")).toHaveTextContent("Person");
  fireEvent.click(screen.getByRole("button", { name: "Expand all anyway" }));
  const canvas = await screen.findByTestId("kg-graph-canvas");
  expect(screen.queryByTestId("kg-graph-oversize")).toBeNull();
  act(() => changeLocale()); expect(screen.getByTestId("kg-graph-canvas")).toBe(canvas); expect(screen.queryByTestId("kg-graph-oversize")).toBeNull();
});
