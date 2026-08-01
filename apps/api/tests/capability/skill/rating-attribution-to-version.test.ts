/**
 * F68 · 消息级评价的归因链（消息 → agent → skill → skill 版本）（UC-3.6 R3 阶段一，I-20）。
 *
 * V1（成功态）：对一条 AI 消息点 👎，评价可追到产生它的 agent、skill 与 skill 版本。
 * V13（防刷态）：同一人对同一消息重复评价只计一次（幂等键 `(messageId, raterId)`）。
 * V9/E1（归因失败态）：缺 `skillVersionId` 的评价只计入 agent 级，不计入任何 skill 的
 *   满意度，并出现在数据质量报表里——不得随意归给某个 skill。
 */
import { describe, expect, it } from "vitest";
import { rateMessage } from "../../../src/application/skill/rate-message";
import {
  classifyAttribution,
  idempotencyKeyOf,
} from "../../../src/domain/skill/rating-attribution";
import { dataQualityReport, ratingRepository } from "../../support/skill-fakes";

describe("classifyAttribution（纯函数）：skillId 与 skillVersionId 必须同时非空才算归到 skill", () => {
  it("两者都有 ⇒ skill-attributed", () => {
    const outcome = classifyAttribution({ agentId: "agent-fc", skillId: "sk-1", skillVersionId: "v3" });
    expect(outcome).toEqual({ kind: "skill-attributed", skillId: "sk-1", skillVersionId: "v3" });
  });

  it("缺 skillVersionId ⇒ agent-only-missing-version（即使 skillId 存在）", () => {
    const outcome = classifyAttribution({ agentId: "agent-fc", skillId: "sk-1", skillVersionId: null });
    expect(outcome).toEqual({ kind: "agent-only-missing-version", agentId: "agent-fc" });
  });

  it("skillId 与 skillVersionId 都缺 ⇒ 同样降级为 agent-only", () => {
    const outcome = classifyAttribution({ agentId: "agent-sc", skillId: null, skillVersionId: null });
    expect(outcome.kind).toBe("agent-only-missing-version");
  });
});

describe("V1：对一条 AI 消息点 👎，评价可追到产生它的 agent、skill 与 skill 版本", () => {
  it("完整归因链落库后原样可读", async () => {
    const ratings = ratingRepository();
    const dq = dataQualityReport();

    const result = await rateMessage(
      {
        ratingId: "rating-1",
        messageId: "msg-1",
        raterId: "user-facilitator-1",
        verdict: "down",
        reason: "打断时机过早",
        attribution: { agentId: "agent-fc", skillId: "sk-facilitator", skillVersionId: "v3" },
      },
      { ratings, dataQuality: dq },
    );

    expect(result.ok).toBe(true);
    expect(result.attributed).toBe(true);
    expect(result.attribution).toEqual({
      agentId: "agent-fc",
      skillId: "sk-facilitator",
      skillVersionId: "v3",
    });
    expect(ratings.saved).toHaveLength(1);
    expect(ratings.saved[0]?.attribution.skillVersionId).toBe("v3");
    // 评价不公开署名（D-40 同源）：落库记录里没有任何「展示名」字段，只有 raterId 供内部去重。
    expect(Object.keys(ratings.saved[0] ?? {})).not.toContain("raterDisplayName");
    expect(dq.entries).toHaveLength(0);
  });
});

describe("V13：同一人对同一消息重复评价只计一次", () => {
  it("第二次提交返回同一个 ratingId，且不新增一条记录", async () => {
    const ratings = ratingRepository();
    const dq = dataQualityReport();
    const attribution = { agentId: "agent-fc", skillId: "sk-facilitator", skillVersionId: "v3" } as const;

    const first = await rateMessage(
      { ratingId: "rating-1", messageId: "msg-1", raterId: "user-1", verdict: "down", reason: null, attribution },
      { ratings, dataQuality: dq },
    );
    const second = await rateMessage(
      { ratingId: "rating-2", messageId: "msg-1", raterId: "user-1", verdict: "up", reason: null, attribution },
      { ratings, dataQuality: dq },
    );

    expect(second.idempotentReplay).toBe(true);
    expect(second.ratingId).toBe(first.ratingId);
    expect(ratings.saved).toHaveLength(1);
  });

  it("不同人对同一消息各计一次；同一人对不同消息各计一次", async () => {
    const ratings = ratingRepository();
    const dq = dataQualityReport();
    const attribution = { agentId: "agent-fc", skillId: "sk-facilitator", skillVersionId: "v3" } as const;

    await rateMessage(
      { ratingId: "r1", messageId: "msg-1", raterId: "user-a", verdict: "down", reason: null, attribution },
      { ratings, dataQuality: dq },
    );
    await rateMessage(
      { ratingId: "r2", messageId: "msg-1", raterId: "user-b", verdict: "down", reason: null, attribution },
      { ratings, dataQuality: dq },
    );
    await rateMessage(
      { ratingId: "r3", messageId: "msg-2", raterId: "user-a", verdict: "up", reason: null, attribution },
      { ratings, dataQuality: dq },
    );

    expect(ratings.saved).toHaveLength(3);
  });

  it("幂等键的形状：不同 messageId 或不同 raterId 产生不同的键", () => {
    expect(idempotencyKeyOf("msg-1", "user-a")).not.toBe(idempotencyKeyOf("msg-1", "user-b"));
    expect(idempotencyKeyOf("msg-1", "user-a")).not.toBe(idempotencyKeyOf("msg-2", "user-a"));
    expect(idempotencyKeyOf("msg-1", "user-a")).toBe(idempotencyKeyOf("msg-1", "user-a"));
  });
});

describe("V9/E1：缺 skillVersionId 的评价只计 agent 级，不进任何 skill 满意度，且进数据质量报表", () => {
  it("落库成功（ok: true），但 attributed 为 false，并写入一条数据质量条目", async () => {
    const ratings = ratingRepository();
    const dq = dataQualityReport();

    const result = await rateMessage(
      {
        ratingId: "rating-9",
        messageId: "msg-9",
        raterId: "user-2",
        verdict: "down",
        reason: "引用页码偶发错位",
        attribution: { agentId: "agent-scout", skillId: "sk-scout", skillVersionId: null },
      },
      { ratings, dataQuality: dq },
    );

    expect(result.ok).toBe(true);
    expect(result.attributed).toBe(false);
    expect(dq.entries).toHaveLength(1);
    expect(dq.entries[0]).toEqual({
      ratingId: "rating-9",
      agentId: "agent-scout",
      reason: "missing-skill-version",
    });
  });

  it("不得随意归给某个 skill：即使 attribution 里带了 skillId，缺版本仍不计入该 skill", async () => {
    const ratings = ratingRepository();
    const dq = dataQualityReport();

    await rateMessage(
      {
        ratingId: "rating-10",
        messageId: "msg-10",
        raterId: "user-3",
        verdict: "down",
        reason: null,
        attribution: { agentId: "agent-scout", skillId: "sk-scout", skillVersionId: null },
      },
      { ratings, dataQuality: dq },
    );

    const bySkill = await ratings.listBySkillId("sk-scout");
    expect(bySkill).toHaveLength(1);
    // 记录本身存在，但按 F68 规则它不应参与该 skill 的满意度计算——
    // 见 `satisfaction-formula-sample-floor.test.ts` 对 `deriveSkillSatisfactionCounts` 的断言。
    expect(classifyAttribution(bySkill[0]!.attribution).kind).toBe("agent-only-missing-version");
  });
});
