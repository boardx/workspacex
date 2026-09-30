/**
 * 2026-09-30 devapp：真实模型给的 about 写法常与 entities[].name 不一致（或干脆留空），精确匹配下
 * 一条 about 边都连不上——10 个实体、3 条结论、0 条边，图路因此什么都走不到。
 * 这里钉住容差链接：精确 → 包含（取最长名）→ 陈述里出现的实体名；单字名不做容差。
 */
import { describe, expect, it } from "vitest";
import { buildCandidateBatch, type ExtractionResult } from "../../src/domain/knowledge-graph/extraction";

function batch(result: ExtractionResult) {
  let n = 0;
  const b = buildCandidateBatch({
    scope: { kind: "personal", id: "u-1" } as never,
    actionType: "extract_message",
    sourceRef: "msg-1",
    pipelineVersion: "t",
    sourceText: "我决定下个季度把团队周会改到周三上午十点，负责人是王磊。客户是华东医药。",
    evidenceFor: (excerpt) => ({ kind: "chat_message", excerpt }) as never,
    result,
    known: [],
    newId: (p) => `${p}-${++n}`,
  });
  if (b === null) throw new Error("expected a batch");
  const nameOf = new Map(b.objects.map((o) => [o.id, o.name]));
  return b.edges.map((e) => `${e.relation}:${nameOf.get(e.dstId)}`);
}

const entities: ExtractionResult["entities"] = [
  { name: "华东医药", kind: "organization", aliases: [] },
  { name: "王磊", kind: "person", aliases: [] },
  { name: "团队周会", kind: "event", aliases: [] },
];

function claim(over: Partial<ExtractionResult["claims"][number]>): ExtractionResult["claims"][number] {
  return { statement: "", kind: "fact", confidence: 0.9, about: [], decidedBy: null, quote: "", timeExpr: null, ...over } as never;
}

describe("extraction about-edge linking", () => {
  it("links an about name that contains (or is contained in) an entity name", () => {
    const edges = batch({ entities, claims: [claim({ statement: "客户要求十二月前上线新版报表", about: ["华东医药公司"] })] });
    expect(edges).toEqual(["about:华东医药"]);
  });

  it("links entities named in the statement when about is empty", () => {
    const edges = batch({ entities, claims: [claim({ statement: "团队周会改到周三上午十点，由王磊负责", kind: "decision" })] });
    expect(edges.sort()).toEqual(["about:团队周会", "about:王磊"].sort());
  });

  it("resolves decidedBy tolerantly, still only to a person", () => {
    const edges = batch({ entities, claims: [claim({ statement: "周会改到周三", kind: "decision", about: ["团队周会"], decidedBy: "王磊（负责人）" })] });
    expect(edges).toContain("decided_by:王磊");
  });

  it("never links single-character names loosely and dedupes repeated targets", () => {
    const edges = batch({
      entities: [...entities, { name: "A", kind: "product", aliases: [] }],
      claims: [claim({ statement: "华东医药 A 方案", about: ["华东医药", "华东医药集团", "A计划"] })],
    });
    expect(edges).toEqual(["about:华东医药"]);
  });
});
