/**
 * F95 —— 普遍性断言写作约束：独立受访者 < 5 时阻断 (`uc-6-5` R3 step7 / R4 E5,
 * AC7/V7，[已裁决 O-16]：触发线 = 独立受访者 5 人，计数口径 = 独立受访者人数，
 * 同一人多次算 1，附和与虚拟不计入)。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 */
import { describe, expect, it } from "vitest";
import { thresholds } from "@repo/contracts";
import {
  checkGeneralizationClaim,
  countIndependentSubjects,
  crossOrgAggregationMinSample,
  generalizationClaimThreshold,
  type QuoteForIndependentCount,
} from "../../src/domain/interview/generality-claim";

function quote(overrides: Partial<QuoteForIndependentCount>): QuoteForIndependentCount {
  return { subjectId: "s1", sourceKind: "human", isAppeasement: false, ...overrides };
}

describe("F95 · O-16 · 阈值全仓单一门槛：本文件不重新声明数字，只引用 thresholds.ts", () => {
  it("普遍性断言触发线 = 5", () => {
    expect(generalizationClaimThreshold()).toBe(5);
    expect(
      thresholds.requireValue(
        thresholds.THRESHOLDS.generalizationClaimMinIndependentSubjects,
        "generalizationClaimMinIndependentSubjects",
      ),
    ).toBe(5);
  });

  it("跨组织聚合最小样本量 = 8（同一处单源，供跨束消费）", () => {
    expect(crossOrgAggregationMinSample()).toBe(8);
  });
});

describe("F95 · I-27 计数口径 · countIndependentSubjects", () => {
  it("同一人说三次只算 1", () => {
    const quotes = [quote({ subjectId: "p1" }), quote({ subjectId: "p1" }), quote({ subjectId: "p1" })];
    expect(countIndependentSubjects(quotes)).toBe(1);
  });

  it("附和 · 非独立证据不计入", () => {
    const quotes = [quote({ subjectId: "p1" }), quote({ subjectId: "p2", isAppeasement: true })];
    expect(countIndependentSubjects(quotes)).toBe(1);
  });

  it("来源类型 = 虚拟不计入", () => {
    const quotes = [quote({ subjectId: "p1" }), quote({ subjectId: "p2", sourceKind: "virtual" })];
    expect(countIndependentSubjects(quotes)).toBe(1);
  });

  it("反证：若附和/虚拟被误计入，4 位独立 + 1 附和 + 1 虚拟会数成 6 而不是 4", () => {
    const quotes = [
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p2" }),
      quote({ subjectId: "p3" }),
      quote({ subjectId: "p4" }),
      quote({ subjectId: "p5", isAppeasement: true }),
      quote({ subjectId: "p6", sourceKind: "virtual" }),
    ];
    expect(countIndependentSubjects(quotes)).toBe(4);
    expect(countIndependentSubjects(quotes)).not.toBe(6);
  });
});

describe("F95 · AC7/V7 · R4 E5 · 独立受访者 4 位时「用户普遍认为」被阻断，给出实际人数 4", () => {
  it("4 位独立受访者 ⇒ blocked=true, independentSubjects=4, suggestion 含「部分受访者提到」", () => {
    const quotes = ["p1", "p2", "p3", "p4"].map((s) => quote({ subjectId: s }));
    const result = checkGeneralizationClaim("用户普遍认为责任归属不清", quotes);
    expect(result.blocked).toBe(true);
    expect(result.independentSubjects).toBe(4);
    expect(result.suggestion).toContain("部分受访者提到");
    expect(result.suggestion).toContain("4");
  });

  it("补到 5 位后同一句放行（V7 逐字要求）", () => {
    const quotes = ["p1", "p2", "p3", "p4", "p5"].map((s) => quote({ subjectId: s }));
    const result = checkGeneralizationClaim("用户普遍认为责任归属不清", quotes);
    expect(result).toEqual({ blocked: false, independentSubjects: 5, suggestion: null });
  });

  it("同一人 3 条强引述断言仍算 1（补到 5 位必须是 5 个不同人，不是发言条数）", () => {
    const quotes = [
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p2" }),
      quote({ subjectId: "p3" }),
      quote({ subjectId: "p4" }),
    ];
    // 6 条引述但只有 4 个独立的人 ⇒ 仍应阻断
    const result = checkGeneralizationClaim("用户普遍认为", quotes);
    expect(result.blocked).toBe(true);
    expect(result.independentSubjects).toBe(4);
  });

  it("反证：若把 6 条引述本身当作计数依据而非独立人数，本该阻断的场景会被误判为放行", () => {
    const quotes = [
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p1" }),
      quote({ subjectId: "p2" }),
      quote({ subjectId: "p3" }),
      quote({ subjectId: "p4" }),
    ];
    const wrongCountByQuoteVolume = quotes.length; // 6 ⇒ 若按条数判定会 >= 5，错误地放行
    expect(wrongCountByQuoteVolume).toBeGreaterThanOrEqual(5);
    expect(checkGeneralizationClaim("用户普遍认为", quotes).blocked).toBe(true);
  });
});

describe("F95 · 未含普遍性措辞 ⇒ 永不阻断，即便独立受访者数 < 5", () => {
  it("「部分受访者提到」这类本就克制的表述不触发阻断", () => {
    const quotes = [quote({ subjectId: "p1" })];
    const result = checkGeneralizationClaim("部分受访者提到责任归属不清", quotes);
    expect(result).toEqual({ blocked: false, independentSubjects: 1, suggestion: null });
  });
});

describe("F95 · E6 呼应 · 提示文案必须给出实际人数（不是笼统的『证据不足』）", () => {
  it("独立受访者 0 位时同样给出人数 0，而不是省略这个数字", () => {
    const result = checkGeneralizationClaim("用户普遍认为", []);
    expect(result.blocked).toBe(true);
    expect(result.independentSubjects).toBe(0);
    expect(result.suggestion).toContain("0");
  });
});
