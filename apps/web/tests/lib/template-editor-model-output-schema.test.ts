/**
 * issue #3337 反证之二：「输出结构」JSON（`buildOutputSchemaText`，模拟弹窗右栏那块
 * 只读 JSON 的单一事实源，见 `template-prompt-drawer.tsx` 149 行）不应包含「文本对象」
 * 这种编辑器里直接打好字的静态装帧字段——它的内容来自 `content`，不是模型要填的数据。
 * 此前这里只按 `name` 非空过滤，漏摘了「文本对象」，导致装饰性标题字段混进提示词
 * JSON（人类原话：「对于那些标题和title是不需要添加进去的，因为这部分不需要对应
 * 提示词的正常内容」）。
 */
import { describe, expect, it } from "vitest";
import { buildOutputSchemaText, type SectionDraft } from "@/components/canvas/template-editor-model";

function draft(over: Partial<SectionDraft>): SectionDraft {
  return {
    sectionId: over.sectionId ?? "s1",
    key: over.key ?? "s1",
    name: over.name ?? "分区一",
    type: over.type ?? "便利贴列表",
    aiHint: over.aiHint ?? null,
    order: over.order ?? 0,
    required: over.required ?? false,
    capacity: over.capacity ?? null,
    layout: over.layout ?? null,
    content: over.content ?? "",
    color: over.color ?? null,
    fontSize: over.fontSize ?? 24,
    align: over.align ?? "left",
    valign: over.valign ?? "top",
    fontWeight: over.fontWeight ?? "bold",
    hideFieldTitle: over.hideFieldTitle ?? false,
  };
}

describe("buildOutputSchemaText", () => {
  it("普通字段进 JSON", () => {
    const text = buildOutputSchemaText([
      draft({ key: "idea", name: "想法", type: "便利贴列表", layout: { col: 0, row: 0, w: 6, h: 4, cols: 3, max: 6, tone: 0, overflow: "缩小字号" } }),
    ]);
    expect(text).toContain('"idea"');
  });

  it("「文本对象」类型字段不应出现在输出结构 JSON 里——它是静态装帧文字，不是模型数据（issue #3337）", () => {
    const text = buildOutputSchemaText([
      draft({ key: "idea", name: "想法", type: "便利贴列表", layout: { col: 0, row: 0, w: 6, h: 4, cols: 3, max: 6, tone: 0, overflow: "缩小字号" } }),
      draft({ key: "title", name: "标题", type: "文本对象", content: "标题文字" }),
    ]);
    expect(text).toContain('"idea"');
    expect(text).not.toContain('"title"');
    expect(text).not.toContain("标题");
  });

  it("隐藏标题（hideFieldTitle）但类型正常的字段仍要出现在输出结构 JSON 里——那只是不画标题条，不是不要这份数据", () => {
    const text = buildOutputSchemaText([
      draft({ key: "hiddenTitleField", name: "隐藏标题字段", type: "便利贴列表", hideFieldTitle: true, layout: { col: 0, row: 0, w: 6, h: 4, cols: 3, max: 6, tone: 0, overflow: "缩小字号" } }),
    ]);
    expect(text).toContain('"hiddenTitleField"');
  });

  it("全是「文本对象」/空字段时回落到占位文案", () => {
    const text = buildOutputSchemaText([
      draft({ key: "title", name: "标题", type: "文本对象", content: "标题文字" }),
    ]);
    expect(text).toContain("还没有字段");
  });
});
