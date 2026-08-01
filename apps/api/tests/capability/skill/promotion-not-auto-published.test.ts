/**
 * F67 · **自动生成 ≠ 自动发布** + AI 不能自行晋升 + 脱敏闸门
 * （契约 `receivePromotedSkill`，UC-3.5 R6 AC2、E2/V5、D-16/V7、I-23）。
 *
 * 三组：
 *   ① AC2：生成的 skill 恒落 `待审核`；直调把它推到 `已启用` 被 `GATE_NOT_PASSED` 拒绝，
 *      且写安全审计——**复用** F61 已测过的 `security-gate.ts` / `advance-skill-status.ts`，
 *      本文件只断言「晋升路径产出的版本同样过不了那条唯一写入口」。
 *   ② AI 不能自行晋升（E2/V5）：AI 可提名，不可自行批准入库；服务端拒绝并写安全审计。
 *   ③ 脱敏闸门（D-16/V7）：含客户机密的方法未过脱敏闸门时不生成 skill。
 */
import { describe, expect, it } from "vitest";
import { receivePromotedSkill } from "../../../src/application/skill/receive-promoted-skill";
import { advanceSkillStatus } from "../../../src/application/skill/advance-skill-status";
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
  draftContract: validContract(),
} as const;

function deps(over: {
  aiApprovers?: ReadonlySet<string>;
  needsRedaction?: ReadonlySet<string>;
} = {}) {
  return {
    promoterKind: promoterKind(over.aiApprovers),
    redactionGate: redactionGate(over.needsRedaction),
    store: promotionSkillStore(),
    links: promotionLinkStore(),
    audit: collectAudit(),
  };
}

describe("① AC2：自动生成 ≠ 自动发布", () => {
  it("生成的 skill 恒落「待审核」，不是「已启用」也不是「草稿」", async () => {
    const d = deps();
    const r = await receivePromotedSkill(base, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("待审核");
  });

  it("绕过双重门禁、直调把它推到「已启用」⇒ GATE_NOT_PASSED，并写安全审计（I-23）", async () => {
    const d = deps();
    const r = await receivePromotedSkill(base, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const audit = collectAudit();
    const advance = await advanceSkillStatus(
      {
        skillId: r.skillId,
        principalId: "u-attacker",
        from: "待审核",
        to: "已启用",
        // 晋升生成的版本此刻没有任何门禁记录——两道门禁都还没跑过
        gates: { scan: null, methodologyReview: null, acknowledgedRiskItemIds: [] },
      },
      { audit },
    );
    expect(advance.ok).toBe(false);
    if (advance.ok) return;
    expect(advance.code).toBe("GATE_NOT_PASSED");
    expect(advance.status).toBe("待审核"); // 状态没有改变
    expect(audit.events.map((e) => e.kind)).toContain("skill-gate-bypass-attempt");
  });

  it("没有任何路径能让 receivePromotedSkill 自己产出「已启用」——落库面结构上只有 savePendingReview 一个方法", async () => {
    const d = deps();
    const methods = Object.keys(d.store);
    expect(methods).toEqual(["saved", "failNext", "savePendingReview"]);
  });
});

describe("② AI 不能自行晋升（E2/V5）", () => {
  it("晋升审批人是 AI ⇒ AI_SELF_PROMOTION_FORBIDDEN，服务端拒绝且不生成 skill", async () => {
    const d = deps({ aiApprovers: new Set(["ai-ava"]) });
    const r = await receivePromotedSkill({ ...base, approverPrincipalId: "ai-ava" }, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("AI_SELF_PROMOTION_FORBIDDEN");
    expect(d.store.saved).toEqual([]);
  });

  it("拒绝的同时写安全审计（不留痕的拒绝与「从未发生」不可区分）", async () => {
    const d = deps({ aiApprovers: new Set(["ai-ava"]) });
    await receivePromotedSkill({ ...base, approverPrincipalId: "ai-ava" }, d);
    expect(d.audit.events.map((e) => e.kind)).toContain("skill-ai-self-promotion-attempt");
    expect(d.audit.events[0]?.principalId).toBe("ai-ava");
  });

  it("人类晋升审批人正常通过", async () => {
    const d = deps({ aiApprovers: new Set(["ai-ava"]) });
    const r = await receivePromotedSkill({ ...base, approverPrincipalId: "u-human" }, d);
    expect(r.ok).toBe(true);
  });
});

describe("③ 脱敏闸门（D-16/V7）", () => {
  it("含客户机密的方法未过脱敏闸门 ⇒ REDACTION_GATE_REQUIRED，不生成 skill", async () => {
    const d = deps({ needsRedaction: new Set([base.knowledgeItemId]) });
    const r = await receivePromotedSkill({ ...base, redactedOnly: false }, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("REDACTION_GATE_REQUIRED");
    expect(d.store.saved).toEqual([]);
  });

  it("过闸门后（redactedOnly=true）正常生成", async () => {
    const d = deps({ needsRedaction: new Set([base.knowledgeItemId]) });
    const r = await receivePromotedSkill({ ...base, redactedOnly: true }, d);
    expect(r.ok).toBe(true);
  });

  it("不含机密的方法不受闸门影响", async () => {
    const d = deps({ needsRedaction: new Set(["some-other-knowledge"]) });
    const r = await receivePromotedSkill({ ...base, redactedOnly: false }, d);
    expect(r.ok).toBe(true);
  });
});
