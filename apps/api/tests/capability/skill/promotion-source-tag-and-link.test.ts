/**
 * F67 · **来源取值「晋升生成」+ 方法↔skill 双向关联**
 * （契约 `receivePromotedSkill` / `getPromotionProvenance`，UC-3.5 R3 步骤 4、
 * R6 AC1/AC4、I-22）。
 *
 * 四组：
 *   ① 成功路径：满足准入 + 三项必填 ⇒ 生成的 skill 来源标记恒为「晋升生成」。
 *   ② 双向可追溯：从 skill 能查到源知识/源决策，`PromotionLink` 是同一份记录。
 *   ③ 严格准入 / 必填缺项：逐条指出缺哪一条，且不生成 skill（不落库）。
 *   ④ 来源标记不可由调用方携带/改写：与 F61 `source-tag-system-assigned.test.ts` 同一条纪律。
 */
import { describe, expect, it } from "vitest";
import { receivePromotedSkill } from "../../../src/application/skill/receive-promoted-skill";
import { getPromotionProvenance } from "../../../src/application/skill/get-promotion-provenance";
import {
  collectAudit,
  promoterKind,
  promotionLinkStore,
  promotionSkillStore,
  redactionGate,
  validContract,
} from "../../support/skill-fakes";

const base = {
  orgId: "org-1",
  knowledgeItemId: "knowledge-远洋项目-工期承诺谈法",
  signedDecisionId: "decision-远洋-cfo-说服",
  reviewConclusionId: "review-远洋-复盘-判对",
  applicableScope: "跨境并购 / 德国·荷兰 / 需持照经营行业",
  validUntil: "24个月",
  reviewOwnerId: "u-高琳",
  redactedOnly: false,
  approverPrincipalId: "u-approver",
} as const;

function deps() {
  return {
    promoterKind: promoterKind(),
    redactionGate: redactionGate(),
    store: promotionSkillStore(),
    links: promotionLinkStore(),
    audit: collectAudit(),
  };
}

describe("① 成功路径：来源标记恒为「晋升生成」", () => {
  it("满足准入 + 三项必填 ⇒ 生成 skill，落待审核，来源为晋升生成", async () => {
    const d = deps();
    const r = await receivePromotedSkill(
      { ...base, draftContract: validContract() },
      d,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("晋升生成");
    expect(r.status).toBe("待审核");
    expect(d.store.saved[0]?.source).toBe("晋升生成");
    expect(d.store.saved[0]?.knowledgeItemId).toBe(base.knowledgeItemId);
  });

  it("转写不完整时留空标待补，不臆造 schema——占位符字段被逐一列出", async () => {
    const d = deps();
    const r = await receivePromotedSkill(
      { ...base, draftContract: { promptTemplate: "把交付时间列在 IRR 之前说" } },
      d,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.incompleteFields).toContain("inputSchema");
    expect(r.incompleteFields).toContain("outputSchema");
    expect(r.incompleteFields).toContain("fallbackDeclaration");
    expect(r.incompleteFields).not.toContain("promptTemplate");
    const saved = d.store.saved[0];
    expect(saved?.contract.inputSchema).toContain("待补");
    // 不臆造：占位符不是一段看起来合法的 JSON schema
    expect(() => JSON.parse(saved?.contract.inputSchema ?? "")).toThrow();
  });

  it("数据范围默认最小必要：转写未声明 dataScope 时落空数组，不继承任何权限全集", async () => {
    const d = deps();
    const r = await receivePromotedSkill(
      { ...base, draftContract: { promptTemplate: "x" } },
      d,
    );
    expect(r.ok).toBe(true);
    expect(d.store.saved[0]?.contract.dataScope).toEqual([]);
  });
});

describe("② 双向可追溯（I-22）：同一份 PromotionLink，从 skill 能查回源知识与源决策", () => {
  it("getPromotionProvenance 返回源知识/源决策/复盘结论/三项必填", async () => {
    const d = deps();
    const r = await receivePromotedSkill({ ...base, draftContract: validContract() }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const provenance = await getPromotionProvenance({ skillId: r.skillId }, { links: d.links });
    expect(provenance.ok).toBe(true);
    if (!provenance.ok) return;
    expect(provenance.knowledgeItem).toBe(base.knowledgeItemId);
    expect(provenance.signedDecision).toBe(base.signedDecisionId);
    expect(provenance.reviewConclusion).toBe(base.reviewConclusionId);
    expect(provenance.applicableScope).toBe(base.applicableScope);
    expect(provenance.reviewOwner).toBe(base.reviewOwnerId);
  });

  it("从知识条目也能反向查到同一条 skill 记录（同一份资产两个视图）", async () => {
    const d = deps();
    const r = await receivePromotedSkill({ ...base, draftContract: validContract() }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const byKnowledge = await d.links.loadByKnowledgeItemId(base.knowledgeItemId);
    const bySkill = await d.links.loadBySkillId(r.skillId);
    expect(byKnowledge).not.toBeNull();
    expect(byKnowledge).toEqual(bySkill);
  });

  it("skill 不存在（未晋升过）⇒ SKILL_NOT_FOUND，不编一个假的溯源", async () => {
    const d = deps();
    const r = await getPromotionProvenance({ skillId: "skill-ghost" }, { links: d.links });
    expect(r).toEqual({ ok: false, code: "SKILL_NOT_FOUND" });
  });
});

describe("③ 严格准入 / 必填缺项：明确指出缺哪一条，且不生成 skill", () => {
  it("无签字决策 ⇒ PROMOTION_ADMISSION_FAILED，指出缺哪一条，不落库", async () => {
    const d = deps();
    const r = await receivePromotedSkill(
      { ...base, signedDecisionId: "", draftContract: validContract() },
      d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("PROMOTION_ADMISSION_FAILED");
    expect(r.reason).toContain("已签字决策");
    expect(d.store.saved).toEqual([]);
  });

  it("复盘未判对（复盘结论缺失）⇒ PROMOTION_ADMISSION_FAILED", async () => {
    const d = deps();
    const r = await receivePromotedSkill(
      { ...base, reviewConclusionId: "  ", draftContract: validContract() },
      d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("PROMOTION_ADMISSION_FAILED");
    expect(r.reason).toContain("复盘结论");
  });

  it.each(["applicableScope", "validUntil", "reviewOwnerId"] as const)(
    "三项必填缺 %s ⇒ PROMOTION_REQUIRED_FIELDS_MISSING，skill 生成一并阻断",
    async (field) => {
    const d = deps();
    const r = await receivePromotedSkill(
      { ...base, [field]: "", draftContract: validContract() },
      d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("PROMOTION_REQUIRED_FIELDS_MISSING");
    expect(d.store.saved).toEqual([]);
    expect(d.links.savedLinks).toEqual([]);
  });
});

describe("④ 来源标记不可由调用方携带（I-11，同 F61 纪律）", () => {
  it("rawBody 带 source 字段 ⇒ SOURCE_TAG_IMMUTABLE，不落库且写审计", async () => {
    const d = deps();
    const r = await receivePromotedSkill(
      {
        ...base,
        draftContract: validContract(),
        rawBody: { knowledgeItemId: base.knowledgeItemId, source: "自建" },
      },
      d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SOURCE_TAG_IMMUTABLE");
    expect(d.store.saved).toEqual([]);
    expect(d.audit.events.map((e) => e.kind)).toContain("skill-source-tag-write-attempt");
  });
});

describe("Skill 库不可写：不静默失败（E8/V11）", () => {
  it("store 抛错 ⇒ DEPENDENCY_UNAVAILABLE，明确失败可重试", async () => {
    const d = deps();
    d.store.failNext.value = true;
    const r = await receivePromotedSkill({ ...base, draftContract: validContract() }, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(d.links.savedLinks).toEqual([]);
  });
});
