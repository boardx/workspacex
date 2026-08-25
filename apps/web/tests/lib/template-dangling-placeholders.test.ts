/**
 * §6 规则③ ——「占位符没有对应字段」的纯函数单测（2026-08-26）。
 *
 * ## 为什么测的是提示词而不是画布
 *
 * 规则③ 的字面表述是「**画布上**出现字段表里没有的占位符 → 同样报警」。那一半在本
 * 实现里**构造上不可能**：设计稿 §2.2 把 `fields[]` 与 `blocks[]` 分成两个数组、
 * block 用 `fieldKey` 引用字段，于是「删了字段没删 block」会留下悬空引用；本实现把
 * 两者合并成同一个对象（`SectionDraft` + 可选 `layout`），区块不可能没有字段——
 * 非法状态在类型层面就表达不出来，这比运行时报警更强的保证。
 *
 * 但**同一个失效模式**另有一条真实可达的路径：顾问在提示词正文里写 `{{gains}}`，
 * 而字段表里没有 `gains`。后果与规则③ 描述的完全一致（AI 被要求产出这个键，
 * 输出结构里没有它，数据静默丢失）。所以规则③ 落在这里。
 */
import { describe, expect, it } from "vitest";
import {
  extractPromptPlaceholders, checkTemplateHealth, type SectionDraft,
} from "@/components/canvas/template-editor-model";

function field(key: string, over: Partial<SectionDraft> = {}): SectionDraft {
  return {
    sectionId: `s-${key}`, key, name: key, type: "便利贴列表", aiHint: null,
    order: 0, required: false, capacity: null,
    layout: { col: 1, row: 1, w: 6, h: 3, cols: 5, max: 6, tone: 0, overflow: "缩小字号" },
    ...over,
  };
}

describe("extractPromptPlaceholders —— 只认 §2.1 规定的 key 形状", () => {
  it("抽出 {{key}} 与列表型 {{key[]}}，去重", () => {
    const got = extractPromptPlaceholders("先写 {{says}}，再写 {{thinks[]}}，最后再提一次 {{says}}。");
    expect(got.sort()).toEqual(["says", "thinks"]);
  });

  it("容忍花括号内的空白", () => {
    expect(extractPromptPlaceholders("{{ gains }} 与 {{ pains [] }}").sort()).toEqual(["gains", "pains"]);
  });

  it("⚠ 中文/大写/数字开头的花括号内容**不是**占位符——顾问写「{{注意}}」不该被报成未定义字段", () => {
    expect(extractPromptPlaceholders("{{注意}} {{Says}} {{1st}} {{}}")).toEqual([]);
  });

  it("没有占位符时返回空数组，不是抛错", () => {
    expect(extractPromptPlaceholders("一段完全没有占位符的人话。")).toEqual([]);
  });
});

describe("checkTemplateHealth —— §6 规则③", () => {
  it("提示词里的占位符在字段表里 ⇒ 不报警", () => {
    const h = checkTemplateHealth([field("says")], 12, "请整理 {{says}}。");
    expect(h.danglingPlaceholders).toEqual([]);
  });

  it("提示词里写了字段表没有的占位符 ⇒ 点名它（这是规则③ 真正可达的形态）", () => {
    const h = checkTemplateHealth([field("says")], 12, "请整理 {{says}} 和 {{gains}}。");
    expect(h.danglingPlaceholders).toEqual(["gains"]);
  });

  it("列表型写法 {{key[]}} 同样被检出——[] 是渲染提示，不是 key 的一部分", () => {
    const h = checkTemplateHealth([field("says")], 12, "请整理 {{gains[]}}。");
    expect(h.danglingPlaceholders).toEqual(["gains"]);
  });

  it("悬空占位符阻断 publishClean——发布前置检查要拦下它（§6 规则⑦）", () => {
    const clean = checkTemplateHealth([field("says")], 12, "{{says}}");
    expect(clean.publishClean).toBe(true);
    const dangling = checkTemplateHealth([field("says")], 12, "{{says}} {{ghost}}");
    expect(dangling.publishClean).toBe(false);
  });

  it("没有名字的分区不算进字段表——半填的空行不该让一个真实的悬空占位符变成「已定义」", () => {
    const h = checkTemplateHealth([field("ghost", { name: "  " })], 12, "{{ghost}}");
    expect(h.danglingPlaceholders).toEqual(["ghost"]);
  });

  it("不传 promptText 时向后兼容：不报任何悬空占位符（旧调用点不会凭空多出警告）", () => {
    const h = checkTemplateHealth([field("says")], 12);
    expect(h.danglingPlaceholders).toEqual([]);
    expect(h.publishClean).toBe(true);
  });
});
