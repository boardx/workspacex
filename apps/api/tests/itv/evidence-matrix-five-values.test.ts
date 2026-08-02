/**
 * F94 —— 主题 × 受访者证据矩阵五取值（`uc-6-5` R3 step4, AC4, R8 原型截图逐字重放）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import {
  computeCellStrength,
  cellToContractShape,
  EVIDENCE_STRENGTH_VALUES,
  type EvidenceCellFacts,
} from "../../src/domain/interview/evidence-matrix";

function cell(overrides: Partial<EvidenceCellFacts>): EvidenceCellFacts {
  return {
    hasQuotes: true,
    isCounterexample: false,
    isAppeasement: false,
    rawStrength: "strong",
    ...overrides,
  };
}

describe("F94 · AC4 · 五取值恰好五个、两两不同，且都在契约枚举里", () => {
  it("EVIDENCE_STRENGTH_VALUES 恰好 5 个不重复的值", () => {
    expect(new Set(EVIDENCE_STRENGTH_VALUES).size).toBe(5);
    expect(EVIDENCE_STRENGTH_VALUES).toEqual(
      expect.arrayContaining(["strong", "weak", "not-mentioned", "appeasement", "counterexample"]),
    );
  });

  it("契约 EvidenceStrength.parse 接受这五个值中的每一个", () => {
    for (const v of EVIDENCE_STRENGTH_VALUES) {
      expect(() => interview.EvidenceStrength.parse(v)).not.toThrow();
    }
  });
});

describe("F94 · AC4 · computeCellStrength 逐一还原原型截图的五种格子", () => {
  it("有强证据、非附和、非反例 ⇒ strong（如 P-04 对『责任归属无人承担』）", () => {
    expect(computeCellStrength(cell({ rawStrength: "strong" }))).toBe("strong");
  });

  it("有弱证据 ⇒ weak（如 P-09 对『本地案例决定信任』）", () => {
    expect(computeCellStrength(cell({ rawStrength: "weak" }))).toBe("weak");
  });

  it("没有引述落在这一格 ⇒ not-mentioned（如 P-09 对『责任归属无人承担』）", () => {
    expect(computeCellStrength(cell({ hasQuotes: false, rawStrength: null }))).toBe("not-mentioned");
  });

  it("下属在上级发言后附和 ⇒ appeasement，覆盖掉原始强/弱（P-11 对『责任归属』）", () => {
    expect(computeCellStrength(cell({ isAppeasement: true, rawStrength: "strong" }))).toBe("appeasement");
  });

  it("唯一反例 ⇒ counterexample，优先级最高（P-12 对『责任归属』）", () => {
    expect(computeCellStrength(cell({ isCounterexample: true, rawStrength: "weak" }))).toBe("counterexample");
  });

  it("反证：反例即便同时被标了附和标记，仍必须显示为 counterexample 而不是 appeasement", () => {
    const c = cell({ isCounterexample: true, isAppeasement: true, rawStrength: "strong" });
    expect(computeCellStrength(c)).toBe("counterexample");
  });
});

describe("F94 · AC4 · cellToContractShape 把 strength 与 counterexample 布尔绑成同一次计算", () => {
  it("strength === 'counterexample' 时 counterexample 字段恒为 true", () => {
    const shape = cellToContractShape("P-12", ["q1"], cell({ isCounterexample: true, rawStrength: "weak" }));
    expect(shape.strength).toBe("counterexample");
    expect(shape.counterexample).toBe(true);
  });

  it("strength 不是 'counterexample' 时 counterexample 字段恒为 false（反证：不会有 strength=strong 但 counterexample=true 的漂移）", () => {
    const shape = cellToContractShape("P-04", ["q2"], cell({ rawStrength: "strong" }));
    expect(shape.strength).toBe("strong");
    expect(shape.counterexample).toBe(false);
  });

  it("投影结果通过契约 EvidenceMatrix 单个 cell 的 schema 校验", () => {
    const rowSchema = interview.EvidenceMatrix.shape.rows.element.shape.cells.element;
    const shape = cellToContractShape("P-10", ["q3", "q4"], cell({ rawStrength: "weak" }));
    expect(() => rowSchema.parse(shape)).not.toThrow();
  });
});

describe("F94 · R8 · 原型截图逐行重放（『主题与证据矩阵』7 行 6 列的一部分）", () => {
  it("『责任归属无人承担』一行：P-04 强 / P-07 强 / P-09 未提及 / P-10 强 / P-11 附和 / P-12 反例", () => {
    const row = [
      cell({ rawStrength: "strong" }), // P-04
      cell({ rawStrength: "strong" }), // P-07
      cell({ hasQuotes: false, rawStrength: null }), // P-09
      cell({ rawStrength: "strong" }), // P-10
      cell({ isAppeasement: true, rawStrength: "strong" }), // P-11
      cell({ isCounterexample: true, rawStrength: "weak" }), // P-12
    ].map(computeCellStrength);

    expect(row).toEqual(["strong", "strong", "not-mentioned", "strong", "appeasement", "counterexample"]);
  });
});
