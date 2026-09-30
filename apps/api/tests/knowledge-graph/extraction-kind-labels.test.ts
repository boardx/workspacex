/**
 * 2026-09-30 devapp 实测：抽取全部读作「空」（14/14）。部署没开 KERNEL_MODEL_JSON_SCHEMA（没有约束解码）时，
 * 真实模型把 kind 写成中文或首字母大写，parseExtraction 以前把这些项全部静默丢弃。
 * 这里锁两件事：解析认中文标签 / 大小写 / 少数同义词，不认识的照旧丢弃；prompt 逐个列出允许的枚举值。
 */
import { describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { parseExtraction } from "../../src/domain/knowledge-graph/extraction";
import { KG_EXTRACTION_SYSTEM_PROMPT } from "../../src/infrastructure/knowledge-graph/model-knowledge-extractor";

const claim = (kind: unknown, statement = "我决定先在初二三个班试点项目式学习") => ({ statement, kind, confidence: 0.9, about: [], decidedBy: null, quote: "", timeExpr: null });

describe("parseExtraction —— 类型值宽松识别", () => {
  it("中文标签（取自契约）⇒ 对应的枚举值", () => {
    for (const k of KG.KgClaimKind.options) {
      const r = parseExtraction({ entities: [], claims: [claim(KG.KG_CLAIM_KIND_LABEL_ZH[k])] });
      expect(r.claims.map((c) => c.kind), k).toEqual([k]);
    }
    for (const k of KG.KgObjectKind.options) {
      const r = parseExtraction({ entities: [{ name: "初二三班", kind: KG.KG_OBJECT_KIND_LABEL_ZH[k], aliases: [] }], claims: [] });
      expect(r.entities.map((e) => e.kind), k).toEqual([k]);
    }
  });

  it("首字母大写 / 全大写 / 前后空格 ⇒ 认", () => {
    const r = parseExtraction({
      entities: [{ name: "王老师", kind: "Person", aliases: [] }],
      claims: [claim("Decision"), claim(" GOAL ", "我的目标是期末前完成两轮复盘"), claim("preference", "我更喜欢简洁的回答")],
    });
    expect(r.entities.map((e) => e.kind)).toEqual(["person"]);
    expect(r.claims.map((c) => c.kind)).toEqual(["decision", "goal", "preference"]);
  });

  it("少数常见同义词 ⇒ 认；不认识的照旧丢弃，不猜", () => {
    const r = parseExtraction({
      entities: [{ name: "某公司", kind: "组织", aliases: [] }, { name: "某物", kind: "东西", aliases: [] }],
      claims: [claim("决策"), claim("假设", "可能要推迟"), claim("心情", "今天很开心"), claim(42)],
    });
    expect(r.entities.map((e) => e.kind)).toEqual(["organization"]);
    expect(r.claims.map((c) => c.kind)).toEqual(["decision", "hypothesis"]);
  });
});

describe("KG_EXTRACTION_SYSTEM_PROMPT —— 逐个列出允许的枚举值", () => {
  it("每个实体类型、每个结论类型的英文值都在 prompt 里", () => {
    for (const k of [...KG.KgObjectKind.options, ...KG.KgClaimKind.options]) expect(KG_EXTRACTION_SYSTEM_PROMPT).toContain(k);
    expect(KG_EXTRACTION_SYSTEM_PROMPT).toContain("只能是这些英文值之一");
  });
});
