/**
 * S8（#4365）—— 整合计划（纯函数）：去重「宁可漏合」的每一道门、实体合一、矛盾只开卡。落表与撤销见 consolidation-db.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  CONSOLIDATION_COSINE_MIN, contentTokens, duplicateBasis, lexicalSimilarity, planConsolidation, planEntityMerges,
  type ConsolidationClaim, type ConsolidationObject,
} from "../../src/domain/knowledge-graph/consolidation";

let n = 0;
const claim = (statement: string, over: Partial<ConsolidationClaim> = {}): ConsolidationClaim => ({
  id: `c${String(++n).padStart(3, "0")}`, kind: "preference", statement, status: "proposed", reviewed: false,
  createdAt: `2026-09-2${Math.min(n, 9)}T00:00:00Z`, aboutObjectIds: [], ...over,
});
const obj = (id: string, name: string, over: Partial<ConsolidationObject> = {}): ConsolidationObject =>
  ({ id, kind: "project", name, aliases: [], createdAt: "2026-09-20T00:00:00Z", ...over });

describe("#4365 结论去重的门", () => {
  it("归一后相同（空白、标点、全半角、大小写）⇒ exact", () => {
    expect(duplicateBasis(claim("我更喜欢简洁的回答"), claim("我更喜欢 简洁的回答。"), null)).toEqual({ basis: "exact", score: 1 });
    expect(duplicateBasis(claim("I prefer SHORT answers"), claim("i prefer short answers!"), null)).toEqual({ basis: "exact", score: 1 });
  });

  it("数值不同永远不合（那是矛盾，不是重复）——即使向量说几乎一样", () => {
    expect(duplicateBasis(claim("项目A 预算定为 50 万", { kind: "decision" }), claim("项目A 预算定为 60 万", { kind: "decision" }), 0.99)).toBeNull();
  });

  it("否定极性不同不合：「我喜欢咖啡」≠「我不喜欢咖啡」", () => {
    expect(duplicateBasis(claim("我喜欢喝咖啡"), claim("我不喜欢喝咖啡"), 0.97)).toBeNull();
  });

  it("类型不同、已在冲突中的不合", () => {
    expect(duplicateBasis(claim("我决定用 React", { kind: "decision" }), claim("我决定用 React", { kind: "goal" }), null)).toBeNull();
    expect(duplicateBasis(claim("我更喜欢简洁的回答", { status: "contested" }), claim("我更喜欢简洁的回答"), null)).toBeNull();
  });

  it("有向量：余弦 ≥ 门槛 且 字面相似 ≥ 0.6 才合（semantic）；只有余弦高、字面不像 ⇒ 不合", () => {
    const a = claim("我更喜欢简洁的回答");
    const b = claim("我更喜欢简洁一点的回答");
    expect(lexicalSimilarity(a.statement, b.statement)).toBeGreaterThan(0.6);
    expect(duplicateBasis(a, b, CONSOLIDATION_COSINE_MIN + 0.01)).toEqual({ basis: "semantic", score: CONSOLIDATION_COSINE_MIN + 0.01 });
    expect(duplicateBasis(a, b, CONSOLIDATION_COSINE_MIN - 0.01)).toBeNull();
    expect(duplicateBasis(a, claim("回答请尽量短一些"), 0.99)).toBeNull();
  });

  it("没有向量：只认几乎逐字相同（lexical ≥ 0.9）", () => {
    expect(duplicateBasis(claim("我更喜欢简洁的回答"), claim("我更喜欢简洁一点的回答"), null)).toBeNull();
    const v = duplicateBasis(claim("我希望团队的周报每周五下午五点之前发到群里"), claim("我希望团队的周报每周五下午五点之前都发到群里"), null);
    expect(v?.basis).toBe("lexical");
    expect(v?.score).toBeGreaterThanOrEqual(0.9);
  });
});

describe("#4491 H2：只差一个内容词的两句不是重复（字面、向量都很像也不合）", () => {
  it.each([
    ["项目A的负责人是张三", "项目A的负责人是李四", "fact"],
    ["客户希望在上海举办发布会", "客户希望在北京举办发布会", "fact"],
    ["我更喜欢用Python写后端服务", "我更喜欢用Go写后端服务", "preference"],
  ] as const)("「%s」对「%s」⇒ 不合（余弦 0.99 也不合）", (x, y, kind) => {
    const a = claim(x, { kind, aboutObjectIds: ["o1"] });
    const b = claim(y, { kind, aboutObjectIds: ["o1"] });
    expect(lexicalSimilarity(x, y)).toBeGreaterThan(0.6);
    expect(duplicateBasis(a, b, 0.99)).toBeNull();
    expect(planConsolidation({ claims: [a, b], objects: [], similar: [{ a: a.id, b: b.id, cosine: 0.99 }] }).claimMerges).toEqual([]);
  });

  it("只差虚词（的 / 一点 / 都）⇒ 内容词相同，仍可合", () => {
    expect(contentTokens("我更喜欢简洁一点的回答")).toEqual(contentTokens("我更喜欢简洁的回答"));
    expect(contentTokens("项目A的负责人是张三")).not.toEqual(contentTokens("项目A的负责人是李四"));
  });

  it("涉及的实体不同 ⇒ 不合（同一句话说的是两个项目）；实体合一之后相同 ⇒ 合", () => {
    const a = claim("负责人是张三", { kind: "fact", aboutObjectIds: ["o1"], createdAt: "2026-09-01T00:00:00Z" });
    const b = claim("负责人是张三", { kind: "fact", aboutObjectIds: ["o9"], createdAt: "2026-09-02T00:00:00Z" });
    expect(duplicateBasis(a, b, null)).toBeNull();
    expect(planConsolidation({ claims: [a, b], objects: [obj("o1", "项目A"), obj("o9", "项目B")], similar: [] }).claimMerges).toEqual([]);
    const c = claim("负责人是张三", { kind: "fact", aboutObjectIds: ["o2"], createdAt: "2026-09-03T00:00:00Z" });
    const plan = planConsolidation({ claims: [a, c], objects: [obj("o1", "项目A", { createdAt: "2026-09-01T00:00:00Z" }), obj("o2", "项目 A")], similar: [] });
    expect(plan.claimMerges.map((m) => [m.keepId, m.mergeId])).toEqual([[a.id, c.id]]);
  });
});

describe("#4491 H1：撤销过的对不再进计划", () => {
  it("结论对、实体对、矛盾对各自排除", () => {
    const p1 = claim("我更喜欢简洁的回答");
    const p2 = claim("我更喜欢简洁的回答。");
    const older = claim("项目A 预算定为 50 万", { kind: "decision", aboutObjectIds: ["o1"], createdAt: "2026-09-01T00:00:00Z" });
    const newer = claim("项目A 预算定为 60 万", { kind: "decision", aboutObjectIds: ["o1"], createdAt: "2026-09-08T00:00:00Z" });
    const objects = [obj("o1", "项目A", { createdAt: "2026-09-01T00:00:00Z" }), obj("o2", "项目 A")];
    const before = planConsolidation({ claims: [p1, p2, older, newer], objects, similar: [] });
    expect([before.claimMerges.length, before.entityMerges.length, before.conflicts.length]).toEqual([1, 1, 1]);
    const after = planConsolidation({
      claims: [p1, p2, older, newer], objects, similar: [],
      undone: [{ a: p2.id, b: p1.id }, { a: "o1", b: "o2" }, { a: older.id, b: newer.id }],
    });
    expect(after).toEqual({ claimMerges: [], entityMerges: [], conflicts: [] });
  });
});

describe("#4365 计划", () => {
  it("保留谁：确认过的优先，其次最早；三条同义只保留一条，另两条合进来", () => {
    const old = claim("我更喜欢简洁的回答", { createdAt: "2026-09-01T00:00:00Z" });
    const reviewed = claim("我更喜欢简洁的回答。", { createdAt: "2026-09-05T00:00:00Z", reviewed: true, status: "accepted" });
    const late = claim("我更喜欢 简洁的回答", { createdAt: "2026-09-09T00:00:00Z" });
    const plan = planConsolidation({ claims: [late, old, reviewed], objects: [], similar: [] });
    expect(plan.claimMerges.map((m) => [m.keepId, m.mergeId]).sort()).toEqual([[reviewed.id, late.id], [reviewed.id, old.id]].sort());
    expect(plan.conflicts).toEqual([]);
  });

  it("链式相似（A≈B≈C，A 与 C 不直接相似）只合与保留方直接相似的", () => {
    const a = claim("我希望团队周报每周五下午发出", { createdAt: "2026-09-01T00:00:00Z" });
    const b = claim("我希望团队的周报每周五下午发出", { createdAt: "2026-09-02T00:00:00Z" });
    const c = claim("我希望团队的周报每周五下午都能准时发出", { createdAt: "2026-09-03T00:00:00Z" });
    const plan = planConsolidation({
      claims: [a, b, c], objects: [],
      similar: [{ a: a.id, b: b.id, cosine: 0.99 }, { a: b.id, b: c.id, cosine: 0.99 }, { a: a.id, b: c.id, cosine: 0.5 }],
    });
    expect(plan.claimMerges.map((m) => m.mergeId)).toEqual([b.id]);
  });

  it("实体合一：同类型、归一名相同或一方是另一方的别名；不同类型不合", () => {
    const merges = planEntityMerges([
      obj("o1", "项目A", { createdAt: "2026-09-01T00:00:00Z" }), obj("o2", "项目 a"), obj("o3", "Apollo", { aliases: ["阿波罗"] }),
      obj("o4", "阿波罗"), obj("o5", "项目A", { kind: "product" }),
    ]);
    expect(merges).toEqual([{ keepId: "o1", mergeId: "o2" }, { keepId: "o3", mergeId: "o4" }]);
  });

  it("矛盾：同一实体（合一之后）、同一指标、不同数值 ⇒ 一对（新 → 旧），不合并、不裁决", () => {
    const older = claim("项目A 预算定为 50 万", { kind: "decision", aboutObjectIds: ["o1"], createdAt: "2026-09-01T00:00:00Z" });
    const newer = claim("项目 A 预算定为 60 万", { kind: "decision", aboutObjectIds: ["o2"], createdAt: "2026-09-08T00:00:00Z" });
    const plan = planConsolidation({ claims: [newer, older], objects: [obj("o1", "项目A"), obj("o2", "项目 A")], similar: [] });
    expect(plan.entityMerges).toEqual([{ keepId: "o1", mergeId: "o2" }]);
    expect(plan.claimMerges).toEqual([]);
    expect(plan.conflicts).toEqual([{ newerId: newer.id, olderId: older.id }]);
  });

  it("不同实体的不同数值不算矛盾；已在冲突中的不再判", () => {
    const a = claim("项目A 预算定为 50 万", { kind: "decision", aboutObjectIds: ["o1"] });
    const b = claim("项目B 预算定为 60 万", { kind: "decision", aboutObjectIds: ["o9"] });
    const c = claim("项目A 预算定为 70 万", { kind: "decision", aboutObjectIds: ["o1"], status: "contested" });
    const plan = planConsolidation({ claims: [a, b, c], objects: [obj("o1", "项目A"), obj("o9", "项目B")], similar: [] });
    expect(plan.conflicts).toEqual([]);
  });

  it("同样的输入永远得到同样的计划（顺序无关）", () => {
    const cs = [claim("我更喜欢简洁的回答"), claim("我更喜欢简洁的回答！"), claim("项目A 预算定为 50 万", { kind: "decision" })];
    const p1 = planConsolidation({ claims: cs, objects: [], similar: [] });
    const p2 = planConsolidation({ claims: [...cs].reverse(), objects: [], similar: [] });
    expect(p2).toEqual(p1);
  });
});
