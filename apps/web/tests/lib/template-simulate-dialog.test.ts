/**
 * `rewriteTemplateKeyLine`——chat 模拟弹窗把模型原始回复喂给 `CanvasStage`（fabric.js）
 * 之前，把围栏正文里的 `模板: <真实 key>` 那一行重写成命名空间化的预览 key（见
 * `template-simulate-dialog.tsx` 文件头 R2、`rewriteTemplateKeyLine` 自己的头注：
 * 直接用真实 key 注册会让"未保存的草稿"污染全局模板表里"真实发布过的版本"）。
 */
import { describe, it, expect } from "vitest";
import { rewriteTemplateKeyLine } from "../../components/canvas/template-simulate-dialog";

describe("rewriteTemplateKeyLine", () => {
  it("把 `模板: <key>` 那一行换成预览 key，其余内容一字不动", () => {
    const text = [
      "模板: persona",
      "姓名: 小李",
      "## 目标和需求",
      "- 高效管理待办",
    ].join("\n");
    expect(rewriteTemplateKeyLine(text, "persona__simulate-preview")).toBe([
      "模板: persona__simulate-preview",
      "姓名: 小李",
      "## 目标和需求",
      "- 高效管理待办",
    ].join("\n"));
  });

  it("`模板:` 冒号前后有多余空格也认得", () => {
    const text = "模板 :  persona\n姓名: 小李";
    expect(rewriteTemplateKeyLine(text, "persona__simulate-preview"))
      .toBe("模板 :  persona__simulate-preview\n姓名: 小李");
  });

  it("只换第一行匹配的那一处，正文里出现的\"模板\"两个字不受影响", () => {
    const text = [
      "模板: persona",
      "姓名: 关于模板: 这是我的模板设计说明",
    ].join("\n");
    expect(rewriteTemplateKeyLine(text, "persona__simulate-preview")).toBe([
      "模板: persona__simulate-preview",
      "姓名: 关于模板: 这是我的模板设计说明",
    ].join("\n"));
  });

  it("没有 `模板:` 行——原样返回，不抛错、不引入内容", () => {
    const text = "纯文字，没有围栏格式";
    expect(rewriteTemplateKeyLine(text, "persona__simulate-preview")).toBe(text);
  });
});
