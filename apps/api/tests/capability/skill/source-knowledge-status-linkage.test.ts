/**
 * F67 · **源知识状态联动**（契约 `onSourceKnowledgeStateChanged`，
 * UC-3.5 E5/E6/E7、R6 AC3、V8/V9）。
 *
 * 三组，对应三种互斥效果：
 *   ① `待复核` → `annotate`：标「源方法已过期」，**不自动停用**（D-j 待人类裁决）。
 *   ② `被推翻` / `被撤销` → `disable`：自动转已停用，**不硬删**，进行中项目不受影响（AC3/V8）。
 *   ③ `被替代` → `new-version`：发新版、旧版归档，已建实例锁旧版（V9）。
 */
import { describe, expect, it } from "vitest";
import { onSourceKnowledgeStateChanged } from "../../../src/application/skill/on-source-knowledge-state-changed";
import { exactlyOneEffective } from "../../../src/domain/skill/version-chain";
import {
  promotionLinkStore,
  skillVersionStore,
  sourceKnowledgeLinkageStore,
  validContract,
} from "../../support/skill-fakes";
import type { PromotionLink } from "../../../src/domain/skill/promotion-link";
import type { SkillVersionSnapshot } from "../../../src/domain/skill/version-chain";

function linkFor(skillId: string, knowledgeItemId: string): PromotionLink {
  return {
    skillId,
    knowledgeItemId,
    signedDecisionId: "decision-1",
    reviewConclusionId: "review-1",
    applicableScope: "跨境并购",
    validUntil: "24个月",
    reviewOwnerId: "u-高琳",
  };
}

describe("① 待复核 → annotate：标注不停用（D-j）", () => {
  it("effect = annotate，skill 状态联动落库面被调用了标注、没有被调用停用", async () => {
    const links = promotionLinkStore([linkFor("sk-promoted-1", "knowledge-1")]);
    const linkage = sourceKnowledgeLinkageStore();
    const versions = skillVersionStore();

    const r = await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-1", newState: "待复核", replacedByKnowledgeId: null },
      { links, linkage, versions },
    );

    expect(r).toEqual({ ok: true, effect: "annotate", skillId: "sk-promoted-1", versionId: null });
    expect(linkage.annotated).toEqual(["sk-promoted-1"]);
    expect(linkage.disabled).toEqual([]);
  });
});

describe("② 被推翻 / 被撤销 → disable：自动停用，不硬删（AC3/V8）", () => {
  it.each(["被推翻", "被撤销"] as const)("newState=%s ⇒ effect=disable", async (newState) => {
    const links = promotionLinkStore([linkFor("sk-promoted-2", "knowledge-2")]);
    const linkage = sourceKnowledgeLinkageStore();
    const versions = skillVersionStore();

    const r = await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-2", newState, replacedByKnowledgeId: null },
      { links, linkage, versions },
    );

    expect(r).toEqual({ ok: true, effect: "disable", skillId: "sk-promoted-2", versionId: null });
    expect(linkage.disabled).toEqual(["sk-promoted-2"]);
  });

  it("停用只调用 disable，不清空/不改动 PromotionLink（进行中项目不受影响、不硬删）", async () => {
    const link = linkFor("sk-promoted-3", "knowledge-3");
    const links = promotionLinkStore([link]);
    const linkage = sourceKnowledgeLinkageStore();
    const versions = skillVersionStore();

    await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-3", newState: "被撤销", replacedByKnowledgeId: null },
      { links, linkage, versions },
    );

    const stillLinked = await links.loadByKnowledgeItemId("knowledge-3");
    expect(stillLinked).toEqual(link);
  });
});

describe("③ 被替代 → new-version：发新版、旧版归档，已建实例锁旧版（V9）", () => {
  function effectiveHistory(skillId: string): readonly SkillVersionSnapshot[] {
    return [
      {
        versionId: "v1",
        skillId,
        versionNumber: 1,
        content: validContract(),
        contentHash: "hash-v1",
        state: "已生效",
      },
    ];
  }

  it("产出新版本（草稿态，未自动生效——I-23 同样约束这条自动路径），旧版本历史未被清空", async () => {
    const skillId = "sk-promoted-4";
    const links = promotionLinkStore([linkFor(skillId, "knowledge-4")]);
    const linkage = sourceKnowledgeLinkageStore({ [skillId]: validContract() });
    const versions = skillVersionStore({ [skillId]: effectiveHistory(skillId) });

    const r = await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-4", newState: "被替代", replacedByKnowledgeId: "knowledge-4-v2" },
      { links, linkage, versions },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effect).toBe("new-version");
    expect(r.versionId).not.toBeNull();

    const history = await versions.loadChain(skillId);
    expect(history).toHaveLength(2);
    const v1 = history.find((v) => v.versionId === "v1");
    expect(v1?.state).toBe("已生效"); // 旧版仍在历史里可解析（已建实例锁旧版，I-10）
    const newVersion = history.find((v) => v.versionId === r.versionId);
    expect(newVersion?.state).not.toBe("已生效"); // 不自动生效
  });

  it("源知识指针随替代前移到 replacedByKnowledgeId，旧指针查不到（新指针能查到）", async () => {
    const skillId = "sk-promoted-5";
    const links = promotionLinkStore([linkFor(skillId, "knowledge-5")]);
    const linkage = sourceKnowledgeLinkageStore({ [skillId]: validContract() });
    const versions = skillVersionStore({ [skillId]: effectiveHistory(skillId) });

    await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-5", newState: "被替代", replacedByKnowledgeId: "knowledge-5-v2" },
      { links, linkage, versions },
    );

    expect(await links.loadByKnowledgeItemId("knowledge-5")).toBeNull();
    const moved = await links.loadByKnowledgeItemId("knowledge-5-v2");
    expect(moved?.skillId).toBe(skillId);
  });

  it("无生效版本可作为发新版起点时不臆造内容，明确失败 DEPENDENCY_UNAVAILABLE", async () => {
    const skillId = "sk-promoted-6";
    const links = promotionLinkStore([linkFor(skillId, "knowledge-6")]);
    const linkage = sourceKnowledgeLinkageStore(); // 空表：查不到当前生效契约
    const versions = skillVersionStore();

    const r = await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-6", newState: "被替代", replacedByKnowledgeId: null },
      { links, linkage, versions },
    );
    expect(r).toEqual({ ok: false, code: "DEPENDENCY_UNAVAILABLE" });
  });
});

describe("联动的 skill 不存在（未晋升过该知识条目）⇒ SKILL_NOT_FOUND", () => {
  it("查不到 PromotionLink 时不臆造 skillId", async () => {
    const links = promotionLinkStore();
    const linkage = sourceKnowledgeLinkageStore();
    const versions = skillVersionStore();

    const r = await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-ghost", newState: "被推翻", replacedByKnowledgeId: null },
      { links, linkage, versions },
    );
    expect(r).toEqual({ ok: false, code: "SKILL_NOT_FOUND" });
  });
});

describe("版本链不变量在联动路径下仍成立（复用 F66 的断言方式）", () => {
  it("发新版后依旧「恰好同时只有一个已生效」——本联动没有绕过 I-6", async () => {
    const skillId = "sk-promoted-7";
    const links = promotionLinkStore([linkFor(skillId, "knowledge-7")]);
    const linkage = sourceKnowledgeLinkageStore({
      [skillId]: {
        promptTemplate: "已生效版本正文",
        inputSchema: '{"type":"object","properties":{},"required":[]}',
        outputSchema: '{"type":"object","properties":{},"required":[]}',
        dataScope: [],
        readsRawTranscript: false,
        fallbackDeclaration: "失败重试",
      },
    });
    const versions = skillVersionStore({
      [skillId]: [
        {
          versionId: "v1",
          skillId,
          versionNumber: 1,
          content: validContract(),
          contentHash: "hash-v1",
          state: "已生效",
        },
      ],
    });

    await onSourceKnowledgeStateChanged(
      { knowledgeItemId: "knowledge-7", newState: "被替代", replacedByKnowledgeId: null },
      { links, linkage, versions },
    );

    const history = await versions.loadChain(skillId);
    expect(exactlyOneEffective(history)).toBe(true);
  });
});
