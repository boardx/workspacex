/**
 * B3-T3（issue #4497）—— `computeProjectReasoning` 纯函数：冲突 / 缺口 / 推理链。
 * 全部 DB-free；每条用例都含反证（不该出现的就断言不出现）。
 */
import { describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { computeProjectReasoning, gapSuggestion, type ProjectReasoningInput } from "../../src/domain/knowledge-graph/project-reasoning";
import { isConflict, statementsConflict } from "../../src/domain/knowledge-graph/conflict";

const SCOPE = { kind: "project", id: "p1" } as const;
type Claim = KG.KgClaim;
type Anchor = KG.KgEvidenceAnchor;

function claim(id: string, kind: KG.KgClaimKind, statement: string, extra: Partial<Claim> = {}): Claim {
  return {
    id, scope: SCOPE, kind, statement, status: "accepted", triState: "confirmed", confidence: 1, createdBy: "human", reviewedBy: "u1",
    supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: ["o-de"], supportingCount: 0, contradictingCount: 0,
    createdAt: `2026-09-27T00:00:0${id.length % 10}Z`, ...extra,
  };
}
function anchor(sourceKind: Anchor["sourceKind"], extra: Partial<Anchor> = {}): Anchor {
  return { segmentId: `seg-${sourceKind}`, stance: "supporting", sourceKind, sourceRef: `ref-${sourceKind}`, excerpt: `摘录（${sourceKind}）`, locator: null, revoked: false, ...extra };
}
function edge(id: string, src: string, dst: string, relation: KG.KgRelation): KG.KgEdge {
  return { id, src: { kind: "claim", id: src }, dst: { kind: "claim", id: dst }, relation, createdBy: "human" };
}
const OBJECTS = [{ id: "o-de", name: "德国" }];
const input = (partial: Partial<ProjectReasoningInput>): ProjectReasoningInput => ({ claims: [], edges: [], objects: OBJECTS, evidence: {}, ...partial });

describe("冲突：复用 F16 的比对", () => {
  const a = claim("a", "fact", "德国 9/29 上线", { createdAt: "2026-09-01T00:00:00Z" });
  const b = claim("b", "fact", "德国 改到 10/1 上线", { createdAt: "2026-09-02T00:00:00Z" });

  it("statementsConflict 对称，且 isConflict 与之同一判定（不是第二份实现）", () => {
    const x = { kind: "fact" as const, statement: a.statement, about: ["德国"] };
    const y = { kind: "fact" as const, statement: b.statement, about: ["德国"] };
    expect(statementsConflict(x, y)).toBe(true);
    expect(statementsConflict(y, x)).toBe(true);
    expect(isConflict({ ...x, id: "a", confidence: 1 }, { ...y, id: "b", scope: "chat_session", confirmedAt: "2026-09-02T00:00:00Z" })).toBe(true);
  });

  it("双方证据来自两类来源 ⇒ cross_source，带各自的来源类型与 evidenceId，先记下的在 A", () => {
    const out = computeProjectReasoning(input({
      claims: [b, a],
      evidence: { a: [anchor("chat_message", { evidenceId: "ev-a1" })], b: [anchor("survey_response", { evidenceId: "ev-b1" }), anchor("survey_response", { evidenceId: "ev-b2", segmentId: "s2" })] },
    }));
    expect(out.conflicts).toEqual([{
      id: "conflict:a:b", claimIds: ["a", "b"], statementA: a.statement, statementB: b.statement,
      sourceKindsA: ["chat_message"], sourceKindsB: ["survey_response"], evidenceIdsA: ["ev-a1"], evidenceIdsB: ["ev-b1", "ev-b2"], kind: "cross_source",
    }]);
  });

  it("反证：同来源相反（双方都只有对话）⇒ 仍是冲突，但 same_source", () => {
    const out = computeProjectReasoning(input({ claims: [a, b], evidence: { a: [anchor("chat_message")], b: [anchor("chat_message")] } }));
    expect(out.conflicts.map((c) => c.kind)).toEqual(["same_source"]);
    expect(out.conflicts[0]!.evidenceIdsA).toEqual([]);
  });

  it("反证：已撤回的证据不计——撤回后只剩一类来源 ⇒ 退回 same_source；反对证据也不算支持", () => {
    const out = computeProjectReasoning(input({
      claims: [a, b],
      evidence: {
        a: [anchor("chat_message"), anchor("survey_response", { revoked: true, evidenceId: "ev-gone" })],
        b: [anchor("chat_message"), anchor("interview_segment", { stance: "contradicting", evidenceId: "ev-con" })],
      },
    }));
    expect(out.conflicts[0]!.kind).toBe("same_source");
    expect(out.conflicts[0]!.sourceKindsA).toEqual(["chat_message"]);
    expect(out.conflicts[0]!.evidenceIdsA).toEqual([]);
    expect(out.conflicts[0]!.evidenceIdsB).toEqual([]);
  });

  it("反证：说的不是同一组人和事（实体不同）、或不是 fact / decision ⇒ 不算冲突", () => {
    const objects = [...OBJECTS, { id: "o-it", name: "意大利" }];
    const other = claim("c", "fact", "意大利 改到 10/1 上线", { aboutObjectIds: ["o-it"] });
    const hyp1 = claim("h1", "hypothesis", "德国 9/29 上线");
    const hyp2 = claim("h2", "hypothesis", "德国 改到 10/1 上线");
    const out = computeProjectReasoning(input({ objects, claims: [a, other, hyp1, hyp2] }));
    expect(out.conflicts).toEqual([]);
  });

  it("双方都没有证据 ⇒ same_source、来源与 evidenceId 都为空（不崩）", () => {
    const out = computeProjectReasoning(input({ claims: [a, b] }));
    expect(out.conflicts[0]).toMatchObject({ kind: "same_source", sourceKindsA: [], sourceKindsB: [], evidenceIdsA: [], evidenceIdsB: [] });
  });
});

describe("缺口", () => {
  it("无证据的猜测 ⇒ no_evidence，建议是固定模板；有两类来源的猜测不进缺口", () => {
    const bare = claim("h-bare", "hypothesis", "业主愿为工期承诺付溢价");
    const solid = claim("h-solid", "hypothesis", "并网周期是首要阻碍");
    const out = computeProjectReasoning(input({ claims: [solid, bare], evidence: { "h-solid": [anchor("chat_message"), anchor("interview_segment")] } }));
    expect(out.gaps).toEqual([{ claimId: "h-bare", statement: bare.statement, kind: "no_evidence", sourceKinds: [], suggestion: gapSuggestion("hypothesis", []) }]);
    expect(out.gaps[0]!.suggestion).toContain("还没有任何来源支持");
  });

  it("只有一类来源 ⇒ single_source，建议点名那一类来源与该用什么验证", () => {
    const h = claim("h1", "hypothesis", "业主愿为工期承诺付溢价");
    const out = computeProjectReasoning(input({ claims: [h], evidence: { h1: [anchor("chat_message", { evidenceId: "ev-1" }), anchor("chat_message", { evidenceId: "ev-2", segmentId: "m2" })] } }));
    expect(out.gaps).toEqual([{ claimId: "h1", statement: h.statement, kind: "single_source", sourceKinds: ["chat_message"], suggestion: "只有对话支持，建议用访谈或问卷验证。" }]);
    expect(gapSuggestion("decision", ["interview_segment"])).toBe("只有访谈片段支持，建议用问卷验证。");
  });

  it("反证：已撤回的证据不算来源——撤回后一类都不剩 ⇒ no_evidence；事实 / 待办不进缺口", () => {
    const h = claim("h1", "hypothesis", "业主愿为工期承诺付溢价");
    const fact = claim("f1", "fact", "并网周期是首要阻碍");
    const todo = claim("t1", "todo", "约三家业主访谈");
    const out = computeProjectReasoning(input({ claims: [h, fact, todo], evidence: { h1: [anchor("survey_response", { revoked: true })] } }));
    expect(out.gaps.map((g) => [g.claimId, g.kind])).toEqual([["h1", "no_evidence"]]);
  });

  it("前提的证据算在下游头上：决定 derived_from 一条有访谈证据的事实，自己只有对话 ⇒ 两类来源，不进缺口；没证据的先于单一来源", () => {
    const fact = claim("f1", "fact", "并网周期是首要阻碍");
    const d = claim("d1", "decision", "先做德国工商业", { createdAt: "2026-09-03T00:00:00Z" });
    const lonely = claim("d2", "decision", "先做意大利", { createdAt: "2026-09-01T00:00:00Z" });
    const single = claim("h1", "hypothesis", "业主愿为工期承诺付溢价", { createdAt: "2026-09-02T00:00:00Z" });
    const out = computeProjectReasoning(input({
      claims: [d, lonely, single, fact], edges: [edge("e1", "d1", "f1", "derived_from")],
      evidence: { f1: [anchor("interview_segment", { evidenceId: "ev-f" })], d1: [anchor("chat_message", { evidenceId: "ev-d" })], h1: [anchor("chat_message")] },
    }));
    expect(out.gaps.map((g) => [g.claimId, g.kind])).toEqual([["d2", "no_evidence"], ["h1", "single_source"]]);
  });
});

describe("推理链", () => {
  it("决定的链：前提 = derived_from 的上游（带它的引用）+ 自己的每条直接证据；推论 = 决定本身汇总全部引用；每步至少一个 evidenceId 或 claimId", () => {
    const fact = claim("f1", "fact", "并网周期是首要阻碍");
    const d = claim("d1", "decision", "先做德国工商业", { createdAt: "2026-09-03T00:00:00Z" });
    const out = computeProjectReasoning(input({
      claims: [d, fact], edges: [edge("e1", "d1", "f1", "derived_from")],
      evidence: { f1: [anchor("interview_segment", { evidenceId: "ev-f", excerpt: "受访者说并网要等八个月" })], d1: [anchor("chat_message", { evidenceId: "ev-d", excerpt: "团队讨论后先做德国" })] },
    }));
    expect(out.chains).toEqual([{
      claimId: "d1", statement: d.statement,
      steps: [
        { kind: "premise", text: fact.statement, evidenceIds: ["ev-f"], sourceKinds: ["interview_segment"], claimId: "f1" },
        { kind: "premise", text: "团队讨论后先做德国", evidenceIds: ["ev-d"], sourceKinds: ["chat_message"] },
        { kind: "inference", text: d.statement, evidenceIds: ["ev-d", "ev-f"], sourceKinds: ["chat_message", "interview_segment"], claimId: "d1" },
      ],
    }]);
    for (const s of out.chains[0]!.steps) expect(s.evidenceIds.length > 0 || s.claimId !== undefined).toBe(true);
    expect(KG.knowledgeGraph.getProjectReasoning.out.safeParse({ ...out, computedAt: "2026-09-27T00:00:00Z" }).success).toBe(true);
  });

  it("没有 evidenceId 的老证据：那一步以所属结论的 claimId 兜底（界面回退到来源抽屉），链仍然每步有引用", () => {
    const h = claim("h1", "hypothesis", "业主愿为工期承诺付溢价");
    const out = computeProjectReasoning(input({ claims: [h], evidence: { h1: [anchor("chat_message", { excerpt: "客户说愿意多付一点" })] } }));
    expect(out.chains[0]!.steps).toEqual([
      { kind: "premise", text: "客户说愿意多付一点", evidenceIds: [], sourceKinds: ["chat_message"], claimId: "h1" },
      { kind: "inference", text: h.statement, evidenceIds: [], sourceKinds: ["chat_message"], claimId: "h1" },
    ]);
  });

  it("反证：没有任何前提的猜测不出链（它在缺口里）；已撤回的证据不成一步；supported_by 也算前提；环不死循环", () => {
    const bare = claim("h-bare", "hypothesis", "业主愿为工期承诺付溢价");
    const x = claim("x", "decision", "先做德国工商业", { createdAt: "2026-09-02T00:00:00Z" });
    const y = claim("y", "fact", "并网周期是首要阻碍", { createdAt: "2026-09-01T00:00:00Z" });
    const out = computeProjectReasoning(input({
      claims: [bare, x, y],
      edges: [edge("e1", "x", "y", "supported_by"), edge("e2", "y", "x", "derived_from")],
      evidence: { "h-bare": [anchor("chat_message", { revoked: true })], y: [anchor("survey_response", { evidenceId: "ev-y" })] },
    }));
    expect(out.chains.map((c) => c.claimId)).toEqual(["x"]);
    expect(out.chains[0]!.steps.map((s) => [s.kind, s.claimId])).toEqual([["premise", "y"], ["inference", "x"]]);
    expect(out.gaps.map((g) => g.claimId)).toEqual(["h-bare", "x"]);
  });

  it("确定性：同一份输入两次输出完全相同，且与输入顺序无关", () => {
    const fact = claim("f1", "fact", "并网周期是首要阻碍");
    const d = claim("d1", "decision", "先做德国工商业", { createdAt: "2026-09-03T00:00:00Z" });
    const a = claim("a", "fact", "德国 9/29 上线", { createdAt: "2026-09-01T00:00:00Z" });
    const b = claim("b", "fact", "德国 改到 10/1 上线", { createdAt: "2026-09-02T00:00:00Z" });
    const evidence = { f1: [anchor("interview_segment")], a: [anchor("chat_message")], b: [anchor("survey_response")] };
    const edges = [edge("e1", "d1", "f1", "derived_from")];
    const one = computeProjectReasoning(input({ claims: [d, fact, a, b], edges, evidence }));
    const two = computeProjectReasoning(input({ claims: [b, a, fact, d], edges, evidence }));
    expect(two).toEqual(one);
  });
});
