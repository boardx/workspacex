/**
 * `fenceTextToRunData`——chat 模拟弹窗把模型原始回复翻成 `TemplateCanvasGrid` 认的
 * `runData`（见 `template-simulate-dialog.tsx` 文件头 R1）。
 *
 * ## 这里挡的两种**无声**失败
 *
 * 1. **中文名对不上**——模型围栏里的分区名与当前编辑器分区名哪怕差一个字，
 *    这条内容就悄悄消失（`byName.get()` 落空），不报错。
 * 2. **没有围栏**——模型没照格式写（纯聊天式回复），此时不该拿一个空
 *    `{}` 冒充「渲染成功但什么都没有」，要让调用方分得清「没围栏」与
 *    「围栏解出来但是空」。
 */
import { describe, it, expect } from "vitest";
import { fenceTextToRunData } from "../../components/canvas/template-simulate-dialog";
import type { SectionDraft } from "../../components/canvas/template-editor-model";

function draft(over: Partial<SectionDraft>): SectionDraft {
  return {
    sectionId: "s1", name: "分区", key: "sec", type: "便利贴列表",
    required: false, capacity: null, aiHint: "", order: 0,
    layout: null,
    ...over,
  } as SectionDraft;
}

const SECTIONS: readonly SectionDraft[] = [
  draft({ sectionId: "s-name", key: "name", name: "姓名", type: "短文本" }),
  draft({ sectionId: "s-age", key: "age", name: "年龄", type: "短文本" }),
  draft({ sectionId: "s-goals", key: "goals", name: "目标和需求", type: "便利贴列表" }),
];

describe("fenceTextToRunData", () => {
  it("表头字段按中文名对上 key，正文分区的要点变成字符串数组", () => {
    const text = [
      "```canvas",
      "模板: persona",
      "姓名: 小李",
      "年龄: 25",
      "## 目标和需求",
      "- 高效管理待办",
      "- 减少加班",
      "```",
    ].join("\n");
    const out = fenceTextToRunData(text, SECTIONS);
    expect(out).toEqual({
      name: "小李",
      age: "25",
      goals: ["高效管理待办", "减少加班"],
    });
  });

  it("围栏里的分区名对不上当前分区——那条内容不出现，不是整体失败", () => {
    const text = [
      "```canvas",
      "模板: persona",
      "姓名: 小李",
      "## 一个不存在的分区",
      "- 不该出现",
      "```",
    ].join("\n");
    const out = fenceTextToRunData(text, SECTIONS);
    expect(out).toEqual({ name: "小李" });
  });

  it("模型没有产出任何 canvas/persona 围栏 —— 返回 null，不是空对象", () => {
    const out = fenceTextToRunData("好的，这是一份用户画像的建议……（纯文字，没有围栏）", SECTIONS);
    expect(out).toBeNull();
  });

  it("有围栏但一条都对不上当前分区 —— 同样返回 null（不是「渲染成功但是空」）", () => {
    const text = ["```canvas", "模板: persona", "完全不存在的字段: 值", "```"].join("\n");
    const out = fenceTextToRunData(text, SECTIONS);
    expect(out).toBeNull();
  });
});
