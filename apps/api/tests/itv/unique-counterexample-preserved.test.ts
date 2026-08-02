/**
 * F94 —— 唯一反例不可被合并主题/拆分/调权抹掉（`uc-6-5` R3 step6, AC4/E4，
 * R8 原型原文「P-12 提供了唯一反例，报告必须保留」，契约 `COUNTEREXAMPLE_WOULD_VANISH`）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import { guardCounterexamplePreservation } from "../../src/domain/interview/evidence-matrix";

describe("F94 · AC4/E4 · 合并主题会让唯一反例消失时必须阻断", () => {
  it("合并前 P-12 在『责任归属』是 counterexample，合并后这一格被覆盖为 strong ⇒ 阻断", () => {
    const before = [{ themeId: "theme-责任归属", subjectId: "P-12", strength: "counterexample" as const }];
    const after = [{ themeId: "theme-合并后", subjectId: "P-12", strength: "strong" as const }];

    const result = guardCounterexamplePreservation(before, after);
    expect(result).toEqual({
      ok: false,
      reason: "COUNTEREXAMPLE_WOULD_VANISH",
      vanishing: [{ themeId: "theme-责任归属", subjectId: "P-12" }],
    });
  });

  it("合并后 P-12 这一格干脆被移除（不再出现在任何行）⇒ 同样阻断，不是只查『被覆盖』这一种情形", () => {
    const before = [{ themeId: "theme-责任归属", subjectId: "P-12", strength: "counterexample" as const }];
    const after: typeof before = [];

    const result = guardCounterexamplePreservation(before, after);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("COUNTEREXAMPLE_WOULD_VANISH");
  });

  it("反证：数量核对不够——合并后反例数量不变但换了受访者，同样必须阻断", () => {
    const before = [{ themeId: "theme-责任归属", subjectId: "P-12", strength: "counterexample" as const }];
    // 合并后反例数量仍是 1（表面上"没减少"），但守护的是 P-12 这个人，不是"反例总数"。
    const after = [{ themeId: "theme-合并后", subjectId: "P-09", strength: "counterexample" as const }];

    const result = guardCounterexamplePreservation(before, after);
    expect(result.ok).toBe(false);
  });

  it("契约 err 面确实收录 COUNTEREXAMPLE_WOULD_VANISH，且 mergeThemes/splitThemes/adjustEvidenceWeight 三个操作共用它", () => {
    expect(interview.operations.mergeThemes.err).toContain("COUNTEREXAMPLE_WOULD_VANISH");
    expect(interview.operations.splitThemes.err).toContain("COUNTEREXAMPLE_WOULD_VANISH");
    expect(interview.operations.adjustEvidenceWeight.err).toContain("COUNTEREXAMPLE_WOULD_VANISH");
  });
});

describe("F94 · AC4/E4 · 反例被原样保留时放行", () => {
  it("P-12 合并前后仍是 counterexample（即便换了 themeId）⇒ ok", () => {
    const before = [{ themeId: "theme-责任归属", subjectId: "P-12", strength: "counterexample" as const }];
    const after = [{ themeId: "theme-合并后", subjectId: "P-12", strength: "counterexample" as const }];

    expect(guardCounterexamplePreservation(before, after)).toEqual({ ok: true });
  });

  it("反证：本来就没有反例的合并，不应该被误判为需要阻断", () => {
    const before = [{ themeId: "theme-本地案例", subjectId: "P-04", strength: "strong" as const }];
    const after = [{ themeId: "theme-合并后", subjectId: "P-04", strength: "weak" as const }];

    expect(guardCounterexamplePreservation(before, after)).toEqual({ ok: true });
  });

  it("多个反例中只保留其中一个也算『抹掉』——每个反例受访者都必须逐一核对，不是『至少留一个』就行", () => {
    const before = [
      { themeId: "theme-x", subjectId: "P-05", strength: "counterexample" as const },
      { themeId: "theme-x", subjectId: "P-12", strength: "counterexample" as const },
    ];
    const after = [{ themeId: "theme-x", subjectId: "P-05", strength: "counterexample" as const }];

    const result = guardCounterexamplePreservation(before, after);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.vanishing).toEqual([{ themeId: "theme-x", subjectId: "P-12" }]);
  });
});
