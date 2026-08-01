/**
 * F68 · 满意度口径与最小样本量，接在归因链之后（UC-3.6 R10 O-37「与 UC-3.1 R10 同一口径，
 * 逐字一致」；本文件是 F62 `computeSatisfaction`（同一份 O-37）与 F68 归因链的接缝）。
 *
 * V5/AC3：Skill 库的满意度百分比由真实评价计算，样本不足显示「样本不足」而非数字。
 * V9/E1：缺归因（`agent-only-missing-version`）的评价**结构性地**不参与任何 skill
 *   的满意度计数——这条在 `deriveSkillSatisfactionCounts` 里断言，不靠调用方记得过滤。
 */
import { describe, expect, it } from "vitest";
import { computeSatisfaction } from "../../../src/domain/skill/satisfaction";
import {
  deriveSkillSatisfactionCounts,
  type RatingRecord,
} from "../../../src/domain/skill/rating-attribution";

function rating(over: Partial<RatingRecord> & { ratingId: string }): RatingRecord {
  return {
    messageId: `msg-${over.ratingId}`,
    raterId: `rater-${over.ratingId}`,
    verdict: "down",
    reason: null,
    attribution: { agentId: "agent-fc", skillId: "sk-facilitator", skillVersionId: "v3" },
    ...over,
  };
}

describe("deriveSkillSatisfactionCounts：只统计已完整归因（skillId ∧ skillVersionId 均非空）的评价", () => {
  it("缺 skillVersionId 的评价不计入该 skill 的 up/down，即便 skillId 匹配", () => {
    const ratings: RatingRecord[] = [
      rating({ ratingId: "1", verdict: "up" }),
      rating({ ratingId: "2", verdict: "down" }),
      rating({
        ratingId: "3",
        verdict: "down",
        attribution: { agentId: "agent-fc", skillId: "sk-facilitator", skillVersionId: null },
      }),
    ];

    const counts = deriveSkillSatisfactionCounts(ratings, "sk-facilitator");
    expect(counts).toEqual({ up: 1, down: 1 });
  });

  it("跨 skill 隔离：不属于该 skillId 的评价不泄漏进计数", () => {
    const ratings: RatingRecord[] = [
      rating({ ratingId: "1", verdict: "up" }),
      rating({
        ratingId: "2",
        verdict: "down",
        attribution: { agentId: "agent-scout", skillId: "sk-scout", skillVersionId: "v1" },
      }),
    ];

    expect(deriveSkillSatisfactionCounts(ratings, "sk-facilitator")).toEqual({ up: 1, down: 0 });
    expect(deriveSkillSatisfactionCounts(ratings, "sk-scout")).toEqual({ up: 0, down: 1 });
  });

  it("全部缺归因 ⇒ 该 skill 的计数恒为 0/0（不是「无数据」抛错，是结构性的空计数）", () => {
    const ratings: RatingRecord[] = [
      rating({
        ratingId: "1",
        verdict: "down",
        attribution: { agentId: "agent-fc", skillId: null, skillVersionId: null },
      }),
    ];
    expect(deriveSkillSatisfactionCounts(ratings, "sk-facilitator")).toEqual({ up: 0, down: 0 });
  });
});

describe("V5/AC3：满意度口径 up/(up+down) 接在归因过滤之后，样本不足显示「样本不足」", () => {
  it("阈值=10：9 条已归因评价（含被过滤掉的 1 条缺版本评价）⇒ insufficient", () => {
    const ratings: RatingRecord[] = [
      ...Array.from({ length: 6 }, (_, i) => rating({ ratingId: `up-${i}`, verdict: "up" })),
      ...Array.from({ length: 3 }, (_, i) => rating({ ratingId: `down-${i}`, verdict: "down" })),
      // 第 10 条缺版本，理应被过滤，不该把样本量顶到 10。
      rating({
        ratingId: "unattributed",
        verdict: "up",
        attribution: { agentId: "agent-fc", skillId: "sk-facilitator", skillVersionId: null },
      }),
    ];

    const counts = deriveSkillSatisfactionCounts(ratings, "sk-facilitator");
    const result = computeSatisfaction(counts, 10);

    expect(result.sampleSize).toBe(9);
    expect(result.insufficient).toBe(true);
    expect(result.value).toBeNull();
  });

  it("补一条已归因评价把已归因样本量顶到 10 ⇒ 返回真实百分比", () => {
    const ratings: RatingRecord[] = [
      ...Array.from({ length: 7 }, (_, i) => rating({ ratingId: `up-${i}`, verdict: "up" })),
      ...Array.from({ length: 3 }, (_, i) => rating({ ratingId: `down-${i}`, verdict: "down" })),
    ];

    const counts = deriveSkillSatisfactionCounts(ratings, "sk-facilitator");
    const result = computeSatisfaction(counts, 10);

    expect(result.sampleSize).toBe(10);
    expect(result.insufficient).toBe(false);
    expect(result.value).toBeCloseTo(0.7);
  });

  it("不含未评价、不加权：同一批数据换一个注入阈值（5），结构规则不变", () => {
    const ratings: RatingRecord[] = [
      rating({ ratingId: "1", verdict: "up" }),
      rating({ ratingId: "2", verdict: "up" }),
      rating({ ratingId: "3", verdict: "down" }),
    ];
    const counts = deriveSkillSatisfactionCounts(ratings, "sk-facilitator");

    expect(computeSatisfaction(counts, 5).insufficient).toBe(true);
    const withMore = deriveSkillSatisfactionCounts(
      [
        ...ratings,
        rating({ ratingId: "4", verdict: "up" }),
        rating({ ratingId: "5", verdict: "up" }),
      ],
      "sk-facilitator",
    );
    const enough = computeSatisfaction(withMore, 5);
    expect(enough.insufficient).toBe(false);
    expect(enough.value).toBeCloseTo(0.8);
  });
});
