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

describe("headings the model wrote without ##", () => {
  const J = [{ key: "jtbd", displayName: "JTBD", fields: ["执行者"], sections: ["情境触发", "核心任务", "期望成果"] }];

  it("promotes `分区名:` + bullets to `## 分区名` (eval lane R7: content present, every block blank)", () => {
    const text = "```canvas\n模板: jtbd\n执行者: 应届毕业生\n情境触发:\n- 临近毕业\n- 招聘会受挫\n核心任务:\n- 找到岗位\n```";
    const r = normalizeCanvasFenceSections(text, J);
    expect(r.text).toContain("\n## 情境触发\n");
    expect(r.text).toContain("\n## 核心任务\n");
    expect(r.text).toContain("\n执行者: 应届毕业生\n");
    expect(r.corrections.map((c) => c.to)).toEqual(["## 情境触发", "## 核心任务"]);
  });

  it("leaves a header field alone: it has a value after the colon", () => {
    const text = "```canvas\n模板: jtbd\n执行者: 应届毕业生\n## 情境触发\n- x\n```";
    expect(normalizeCanvasFenceSections(text, J).text).toBe(text);
  });

  it("leaves a colon line that is not a section name, and one with no bullets under it", () => {
    const text = "```canvas\n模板: jtbd\n随便一个名字:\n- x\n情境触发:\n普通段落\n```";
    expect(normalizeCanvasFenceSections(text, J).text).toBe(text);
  });
});

describe("one-line sections and the format-spec echo", () => {
  const P = [{ key: "persona", displayName: "用户画像", fields: ["姓名", "年龄"], sections: ["用户描述", "目标和需求"] }];

  it("promotes `分区名：一整段内容` and keeps the content as that section's bullet", () => {
    const text = "```canvas\n模板: persona\n姓名：林渊\n用户描述：他相信大学是孵化器。\n目标和需求：建立技术转移办公室。\n```";
    const r = normalizeCanvasFenceSections(text, P);
    expect(r.text).toContain("## 用户描述\n- 他相信大学是孵化器。");
    expect(r.text).toContain("## 目标和需求\n- 建立技术转移办公室。");
    expect(r.text).toContain("姓名：林渊"), "a header field is never promoted";
  });

  it("never promotes a header field even when it looks like a heading", () => {
    const text = "```canvas\n模板: persona\n姓名:\n- 林渊\n```";
    expect(normalizeCanvasFenceSections(text, P).text).toBe(text);
  });
});

describe("a section name on a bare line", () => {
  const J = [{ key: "jtbd", displayName: "JTBD", fields: ["执行者"], sections: ["情境触发", "核心任务"] }];

  it("promotes `分区名` + bullets, with no colon at all (third shape seen from a 4B)", () => {
    const text = "```canvas\n模板: jtbd\n执行者：在校大学生\n情境触发\n- 就业与考研的分流焦虑\n核心任务\n- 自我定位与岗位匹配\n```";
    const r = normalizeCanvasFenceSections(text, J);
    expect(r.text).toContain("\n## 情境触发\n");
    expect(r.text).toContain("\n## 核心任务\n");
    expect(r.text).toContain("执行者：在校大学生");
  });

  it("leaves a bare line that is not a section name, and one with no bullets under it", () => {
    const text = "```canvas\n模板: jtbd\n一句普通的话\n- x\n情境触发\n又一句普通的话\n```";
    expect(normalizeCanvasFenceSections(text, J).text).toBe(text);
  });
});
