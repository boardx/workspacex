import { describe, expect, it } from "vitest";
import type { KgClaim, KgEdge, KgObject } from "@repo/contracts/chat-knowledge-graph";
import { layoutKnowledgeGraph } from "@/lib/knowledge-graph-layout";
const scope = { kind: "chat_session" as const, id: "layout-test" };
const claim = (id: string, status: KgClaim["status"] = "proposed"): KgClaim => ({ id, scope, statement: `北极星项目${id}的完整决定和背景理由，长句不会在投影阶段被截断。`, kind: "decision", status, triState: "pending", confidence: 0.9, createdBy: "human", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 0, contradictingCount: 0, createdAt: "2026-10-01T00:00:00Z" });
const object = (id: string, kind: KgObject["kind"] = "person"): KgObject => ({ id, scope, kind, name: id, aliases: [], createdBy: "human", claimCount: 1 });
const edge = (id: string, source: string, target: string, kind: "object" | "claim" = "object"): KgEdge => ({ id, src: { kind: "claim", id: source }, dst: { kind, id: target }, relation: kind === "object" ? "about" : "supported_by", createdBy: "human" });
function assertNoOverlap(items: ReturnType<typeof layoutKnowledgeGraph>["items"]) {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i]!, b = items[j]!;
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
}
describe("知识图谱可读布局", () => {
  it("截图同类九节点：人物在左、记忆在中、人和事在右且完全不重叠", () => {
    const data = { objects: [object("王芳"), object("赵磊"), object("安卓", "product"), object("北极星", "project"), object("物流", "organization"), object("GraphQL", "term")], claims: [claim("c1"), claim("c2"), claim("c3")], edges: [edge("e1", "c1", "王芳"), edge("e2", "c1", "安卓"), edge("e3", "c3", "赵磊"), edge("e4", "c3", "GraphQL")] };
    const result = layoutKnowledgeGraph(data);
    expect(result.items).toHaveLength(9);
    assertNoOverlap(result.items);
    expect(result.items.find(n => n.id === "object:王芳")!.x).toBeLessThan(result.items.find(n => n.id === "claim:c1")!.x);
    expect(result.items.find(n => n.id === "object:安卓")!.x).toBeGreaterThan(result.items.find(n => n.id === "claim:c1")!.x);
    expect(result.items.find(n => n.id === "claim:c1")!.label).toBe(data.claims[0]!.statement);
  });
  it("指向左边对象从左出右入，不再绕过自身卡片", () => {
    const { items, links } = layoutKnowledgeGraph({ objects: [object("王芳")], claims: [claim("c1")], edges: [edge("e1", "c1", "王芳")] });
    expect(items.find(n => n.id === "claim:c1")!.ports[0]!.side).toBe("left");
    expect(items.find(n => n.id === "object:王芳")!.ports[0]!.side).toBe("right");
    expect(links[0]!.label).toBe("关于");
  });
  it("密集共享对象的每条边拥有独立且排序稳定的端口", () => {
    const claims = Array.from({ length: 12 }, (_, i) => claim(`c${i}`));
    const edges = claims.map((c, i) => edge(`e${i}`, c.id, "项目"));
    const a = layoutKnowledgeGraph({ objects: [object("项目", "project")], claims, edges });
    const b = layoutKnowledgeGraph({ objects: [object("项目", "project")], claims, edges: [...edges].reverse() });
    const ports = a.items.find(n => n.id === "object:项目")!.ports;
    expect(new Set(ports.map(p => p.offset)).size).toBe(12);
    expect(ports).toEqual(b.items.find(n => n.id === "object:项目")!.ports);
    assertNoOverlap(a.items);
  });
  it("不把已替代条目、无效端点或孤立对象带回来", () => {
    const result = layoutKnowledgeGraph({ objects: [{ ...object("无引用"), claimCount: 0 }], claims: [claim("live"), claim("old", "superseded")], edges: [edge("gone", "old", "无引用")] });
    expect(result.items.map(n => n.id)).toEqual(["claim:live"]);
    expect(result.links).toHaveLength(0);
  });
  it("记忆间的循环保留为同列外侧路线，空图也安全", () => {
    const result = layoutKnowledgeGraph({ objects: [], claims: [claim("a"), claim("b")], edges: [edge("ab", "a", "b", "claim"), edge("ba", "b", "a", "claim")] });
    expect(result.links.every(l => l.sameColumn)).toBe(true);
    expect(result.links.map(l => l.lane)).toEqual([0, 1]);
    assertNoOverlap(result.items);
    expect(layoutKnowledgeGraph({ objects: [], claims: [], edges: [] })).toEqual({ items: [], links: [] });
  });
});
