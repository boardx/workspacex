/** #3749 B1.3: decorated / reordered / re-spelled section and header names are corrected. */
import { describe, expect, it } from "vitest";
import { normalizeCanvasFenceSections } from "../../src/domain/canvas/normalize-fence-template-key";

const T = [
  { key: "journey-map", displayName: "用户旅程图", fields: ["阶段1", "阶段2"], sections: ["行为 · 阶段1", "行为 · 阶段2", "痛点 · 阶段1", "痛点 · 阶段2"] },
  { key: "persona", displayName: "用户画像", fields: ["姓名", "性别", "年龄"], sections: ["用户描述", "目标和需求", "痛点和挑战"] },
];

describe("normalizeCanvasFenceSections", () => {
  it("strips the (最多N条) decoration and restores order / separators (the three 2026-09-10 shapes)", () => {
    const text = "```canvas\n模板: journey-map\n阶段1: 到店\n## 阶段1行为（最多4条）\n- x\n## 行为阶段2\n- y\n## 痛点 · 阶段1\n- z\n```";
    const r = normalizeCanvasFenceSections(text, T);
    expect(r.text).toContain("## 行为 · 阶段1\n");
    expect(r.text).toContain("## 行为 · 阶段2\n");
    expect(r.corrections.map((c) => [c.kind, c.from, c.to])).toEqual([
      ["section", "阶段1行为（最多4条）", "行为 · 阶段1"], ["section", "行为阶段2", "行为 · 阶段2"],
    ]);
  });
  it("corrects header field names, not values, and only before the first section", () => {
    const text = "```canvas\n模板: persona\n姓名（推理）: 张三\n性 别: 女\n## 用户描述\n- 年龄: 不是字段\n```";
    const r = normalizeCanvasFenceSections(text, T);
    expect(r.text).toContain("\n姓名: 张三\n");
    expect(r.text).toContain("\n性别: 女\n");
    expect(r.text).toContain("- 年龄: 不是字段");
  });
  it("leaves names it cannot resolve unambiguously and unknown templates untouched", () => {
    const text = "```canvas\n模板: persona\n## 完全无关的分区\n- x\n```\n\n```canvas\n模板: nope\n## 阶段1行为\n```";
    const r = normalizeCanvasFenceSections(text, T);
    expect(r.text).toBe(text);
    expect(r.corrections).toEqual([]);
  });
  it("does not touch text without canvas fences", () => {
    expect(normalizeCanvasFenceSections("## 行为阶段2 in prose", T).text).toBe("## 行为阶段2 in prose");
  });
});
