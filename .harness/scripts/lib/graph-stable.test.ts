import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "./graph-types";
import { createGraphSnapshot, graphEdgeId, serializeGraphSnapshot } from "./graph-stable";

const source = { path: "phases/feature_list.json", pointer: "/features/0" };

describe("Graph Snapshot determinism", () => {
  it("相同内容不受输入数组顺序影响，且没有生成时间噪声", () => {
    const nodes: GraphNode[] = [
      { id: "node-b", type: "Feature", properties: { z: 1, a: 2 }, source },
      { id: "node-a", type: "Feature", properties: { b: 1 }, source },
    ];
    const edge: GraphEdge = {
      id: graphEdgeId("depends_on", "node-b", "node-a"),
      type: "depends_on",
      from: "node-b",
      to: "node-a",
      properties: {},
      source,
    };
    const first = serializeGraphSnapshot(createGraphSnapshot("abc123", nodes, [edge]));
    const second = serializeGraphSnapshot(createGraphSnapshot("abc123", [...nodes].reverse(), [edge]));
    expect(first).toBe(second);
    expect(first).not.toContain("generated_at");
    expect(first).not.toContain("created_at");
    expect(JSON.parse(first).nodes.map((node: GraphNode) => node.id)).toEqual(["node-a", "node-b"]);
  });

  it("edge id 只表达关系，相同关系稳定，限定属性变化才变化", () => {
    const first = graphEdgeId("contains", "a", "b");
    expect(first).toBe(graphEdgeId("contains", "a", "b"));
    expect(first).not.toBe(graphEdgeId("contains", "a", "c"));
    expect(first).not.toBe(graphEdgeId("contains", "a", "b", { role: "primary" }));
    expect(first).toMatch(/^EDGE-[A-F0-9]{16}$/);
  });
});
