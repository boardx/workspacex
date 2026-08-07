import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, GraphRegistry } from "./graph-types";
import { createGraphSnapshot, graphEdgeId } from "./graph-stable";
import { validateGraph } from "./graph-validator";

const registry: GraphRegistry = {
  nodeTypes: [{ name: "Feature" }, { name: "Verification" }],
  edgeTypes: [
    { name: "depends_on", allowed_pairs: [{ from: "Feature", to: "Feature" }] },
    { name: "verified_by", allowed_pairs: [{ from: "Feature", to: "Verification" }] },
  ],
};

const source = { path: "feature_list.json", pointer: "/features/0" };

function node(id: string, type = "Feature"): GraphNode {
  return { id, type, properties: {}, source };
}

function edge(type: string, from: string, to: string): GraphEdge {
  return { id: graphEdgeId(type, from, to), type, from, to, properties: {}, source };
}

function constraints(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  return validateGraph(createGraphSnapshot("sha", nodes, edges), registry).map((item) => item.constraint_id);
}

describe("validateGraph injection counter-proofs", () => {
  it("干净图全绿", () => {
    expect(constraints([node("F1"), node("V1", "Verification")], [edge("verified_by", "F1", "V1")])).toEqual([]);
  });

  it("注入未知 node type 只红类型约束", () => {
    expect(constraints([node("F1", "Unknown")], [])).toEqual(["HGC-TYPE-001"]);
  });

  it("注入重复 node id 只红身份约束", () => {
    expect(constraints([node("F1"), node("F1")], [])).toEqual(["HGC-IDENTITY-001"]);
  });

  it("注入悬空 target 只红引用约束", () => {
    expect(constraints([node("F1")], [edge("depends_on", "F1", "missing")])).toEqual(["HGC-REFERENCE-002"]);
  });

  it("注入非法端点组合只红端点类型约束", () => {
    expect(constraints([node("F1"), node("V1", "Verification")], [edge("depends_on", "F1", "V1")])).toEqual([
      "HGC-TYPE-003",
    ]);
  });

  it("注入依赖环只红环约束并给出完整路径", () => {
    const findings = validateGraph(
      createGraphSnapshot("sha", [node("F1"), node("F2")], [edge("depends_on", "F1", "F2"), edge("depends_on", "F2", "F1")]),
      registry
    );
    expect(findings.map((item) => item.constraint_id)).toEqual(["HGC-DEPENDENCY-001"]);
    expect(findings[0]?.message).toContain("F1 -> F2 -> F1");
  });

  it("finding id 对同一 focus/path 稳定，不受 message 文案影响", () => {
    const first = validateGraph(createGraphSnapshot("sha", [node("F1", "Unknown")], []), registry)[0];
    const second = validateGraph(createGraphSnapshot("sha-2", [node("F1", "Unknown")], []), registry)[0];
    expect(first?.finding_id).toBe(second?.finding_id);
  });
});
