/**
 * Phase 18 F11 —— 晋升去重的阈值边界（纯函数，评审 N2）。
 * 拉丁词元便于精确控制 Jaccard：每个两字母以上的词就是一个词元。
 */
import { describe, expect, it } from "vitest";
import { SIMILAR_THRESHOLD, dedupAgainstPersonal } from "../../src/domain/knowledge-graph/promotion";

const existing = (statement: string) => [{ id: "p-1", statement }];

describe("F11: dedupAgainstPersonal", () => {
  it("阈值是 0.6", () => expect(SIMILAR_THRESHOLD).toBe(0.6));

  it("归一后全文相同 ⇒ duplicate", () => {
    expect(dedupAgainstPersonal("AA bb CC", existing("aa bb cc"))).toEqual({ kind: "duplicate", existingId: "p-1" });
  });

  it("Jaccard 恰好 0.6（3/5）⇒ similar", () => {
    expect(dedupAgainstPersonal("aa bb cc dd", existing("aa bb cc ee"))).toEqual({ kind: "similar", existingId: "p-1" });
  });

  it("Jaccard 4/6 ≈ 0.67 ⇒ similar", () => {
    expect(dedupAgainstPersonal("aa bb cc dd ee", existing("aa bb cc dd ff"))).toEqual({ kind: "similar", existingId: "p-1" });
  });

  it("Jaccard 4/7 ≈ 0.57，刚好低于阈值 ⇒ new", () => {
    expect(dedupAgainstPersonal("aa bb cc dd ee", existing("aa bb cc dd ff gg"))).toEqual({ kind: "new" });
  });

  it("多条相近时取最像的那条", () => {
    const personal = [{ id: "p-low", statement: "aa bb cc dd ff" }, { id: "p-high", statement: "aa bb cc dd ee gg" }];
    expect(dedupAgainstPersonal("aa bb cc dd ee", personal)).toEqual({ kind: "similar", existingId: "p-high" });
  });
});
