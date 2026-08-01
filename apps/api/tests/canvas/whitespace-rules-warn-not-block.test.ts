import { describe, expect, it } from "vitest";
import { validateWhitespaceRules, type SectionDef } from "../../src/domain/canvas/whitespace-rules";

/**
 * F106 — 留白两规则「只提示不阻断」（O-32 / D-11 / I-23 / I-25）。
 *
 * ## 这份测试在防什么
 *
 * ① `validateWhitespaceRules` 没有 err 通道（契约 `err: []`）——一个把「规则被突破」
 *    错实现成抛错/拒绝的版本，会让「AI 只填了六成」与「AI 挂了」变成同一件事。这里对
 *    「两条规则同时被突破」的输入直接调用，断言函数正常返回且 `warnings` 非空，而不是
 *    某种 throw/reject。
 * ② I-23「缺任一项即无来源·待补」——分别构造缺 segmentId / 缺时间码 / 缺原文三种残缺，
 *    各自都必须落成 `missing-citation`，不是「凑齐三项才算缺」。
 * ③ 规则①「至少留一格空」只在 `capacity` 非空时可判定（domain.md 已知缺口 [待定 D-a]）——
 *    `capacity: null` 的分区必须被跳过，而不是被硬套一个编造的判据。
 * ④ 人工便签（无 `[AVA]` 前缀）不受规则②约束——规则②管的是 AI 起草的草稿，不是画布上
 *    所有内容都要求补引述。
 */

const SECTIONS: SectionDef[] = [
  { sectionId: "sec-people", name: "谁", order: 0, required: true, capacity: 4 },
  { sectionId: "sec-pain", name: "痛点", order: 1, required: true, capacity: 3 },
  { sectionId: "sec-hmw", name: "我们可以怎样", order: 2, required: true, capacity: 4 },
];

describe("F106 · validateWhitespaceRules — 只提示不阻断", () => {
  it("两条规则都不被突破：没有 warnings", () => {
    const markdown = [
      "## 谁",
      '- [AVA] 工商业园区业主：自投自用 <!-- cite: seg-2#0142@12:05 "我们园区自己投自己用" -->',
      "",
      "## 痛点",
      '- [AVA] 回本周期看不清 <!-- cite: seg-2#0210@21:40 "最大的问题是回本周期算不清" -->',
      "",
      "## 我们可以怎样",
      '- [AVA] 怎样把回本测算做进销售话术 <!-- cite: seg-2#0251@26:03 "要是销售一开口就能把回本讲清楚就好了" -->',
    ].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toEqual([]);
  });

  it("规则①：分区填满未留空格 → section-full，且函数仍正常返回（不阻断）", () => {
    const markdown = [
      "## 痛点",
      '- [AVA] a <!-- cite: s1@00:01 "x" -->',
      '- [AVA] b <!-- cite: s2@00:02 "y" -->',
      '- [AVA] c <!-- cite: s3@00:03 "z" -->',
    ].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      rule: "section-full",
      sectionId: "sec-pain",
      stickyId: null,
      message: expect.stringContaining("痛点"),
    });
  });

  it("规则②：缺 segmentId → missing-citation", () => {
    const markdown = ['## 谁', '- [AVA] 缺来源的便签 <!-- cite: @12:05 "有原文没编号" -->'].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toEqual([
      { rule: "missing-citation", sectionId: "sec-people", stickyId: "sec-people#0", message: expect.any(String) },
    ]);
  });

  it("规则②：缺时间码 → missing-citation", () => {
    const markdown = ['## 谁', '- [AVA] 缺时间码的便签 <!-- cite: seg-1@ "有编号有原文" -->'].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toEqual([
      { rule: "missing-citation", sectionId: "sec-people", stickyId: "sec-people#0", message: expect.any(String) },
    ]);
  });

  it("规则②：缺原文 → missing-citation", () => {
    const markdown = ['## 谁', '- [AVA] 缺原文的便签 <!-- cite: seg-1@12:05 "" -->'].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toEqual([
      { rule: "missing-citation", sectionId: "sec-people", stickyId: "sec-people#0", message: expect.any(String) },
    ]);
  });

  it("规则②：整条没写 cite 注释，同样是 missing-citation（不是「全缺才算」）", () => {
    const markdown = ["## 谁", "- [AVA] 完全没有引述的便签"].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toEqual([
      { rule: "missing-citation", sectionId: "sec-people", stickyId: "sec-people#0", message: expect.any(String) },
    ]);
  });

  it("人工便签（无 [AVA] 前缀）不受规则②约束", () => {
    const markdown = ["## 谁", "- 人工写的一条，没有引述也不该被标"].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    expect(warnings).toEqual([]);
  });

  it("两条规则同时被突破：接口仍正常返回（不抛错），warnings 同时含两种 rule（I-25）", () => {
    const markdown = [
      "## 痛点",
      '- [AVA] a <!-- cite: s1@00:01 "x" -->',
      '- [AVA] b <!-- cite: s2@00:02 "y" -->',
      "- [AVA] c 没有引述",
    ].join("\n");
    expect(() => validateWhitespaceRules(markdown, SECTIONS)).not.toThrow();
    const { warnings } = validateWhitespaceRules(markdown, SECTIONS);
    const rules = warnings.map((w) => w.rule).sort();
    expect(rules).toEqual(["missing-citation", "section-full"]);
  });

  it("规则①对 capacity: null 的分区目前断言不出来 [待定 D-a] —— 跳过而不是编一个判据", () => {
    const openEnded: SectionDef[] = [{ sectionId: "sec-open", name: "开放区", order: 0, required: false, capacity: null }];
    const markdown = [
      "## 开放区",
      '- [AVA] a <!-- cite: s1@00:01 "x" -->',
      '- [AVA] b <!-- cite: s2@00:02 "y" -->',
      '- [AVA] c <!-- cite: s3@00:03 "z" -->',
      '- [AVA] d <!-- cite: s4@00:04 "w" -->',
      '- [AVA] e <!-- cite: s5@00:05 "v" -->',
    ].join("\n");
    const { warnings } = validateWhitespaceRules(markdown, openEnded);
    expect(warnings.filter((w) => w.rule === "section-full")).toEqual([]);
  });

  it("markdown 里没有该分区的标题（尚未起草）：视为 0 条便签，不报 missing-citation，仅可能报 section-full（当 capacity=0 时理论触发，此处 capacity>0 故也不报）", () => {
    const { warnings } = validateWhitespaceRules("", SECTIONS);
    expect(warnings).toEqual([]);
  });
});
