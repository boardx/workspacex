import * as React from "react";

/**
 * #1911：单元测试里的 `@xyflow/react` 替身。
 *
 * 真实 React Flow 在挂载时要量测节点尺寸（`ResizeObserver`），jsdom 没有这个浏览器
 * API，同 `monaco-editor-stub.tsx` 的理由——不该为了「画出真实节点位置」去追加一整套
 * 浏览器 API polyfill，那样测的是 jsdom 补丁全不全，不是本仓的业务逻辑。
 *
 * 这个替身只接管「怎么把 `nodes`/`edges` 摆上画布」这一半，`nodeTypes.capability`
 * （`agent-capability-graph-canvas.tsx` 里的 `CapabilityNode`）原样渲染，
 * 所以「点击某个节点跳到真实 href」这条断言测的仍然是真代码。
 *
 * 用法：`vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"))`。
 */
export const Position = { Left: "left", Right: "right", Top: "top", Bottom: "bottom" } as const;

export function Background() {
  return null;
}

export function Controls() {
  return null;
}

interface StubNode {
  id: string;
  data: Record<string, unknown>;
}

export function ReactFlow({
  nodes,
  edges,
  nodeTypes,
}: {
  nodes: StubNode[];
  edges: { id: string; source: string; target: string }[];
  nodeTypes?: Record<string, React.ComponentType<{ id: string; data: Record<string, unknown> }>>;
}) {
  const NodeComponent = nodeTypes?.capability;
  return (
    <div data-testid="xyflow-stub-canvas">
      <div data-testid="xyflow-stub-node-count">{nodes.length}</div>
      <div data-testid="xyflow-stub-edge-count">{edges.length}</div>
      {nodes.map((node) => (
        <div key={node.id} data-testid={`xyflow-stub-node-${node.id}`}>
          {NodeComponent ? <NodeComponent id={node.id} data={node.data} /> : null}
        </div>
      ))}
    </div>
  );
}
