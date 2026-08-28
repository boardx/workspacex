/**
 * `rewriteTemplateKeyLine`——chat 模拟弹窗把模型原始回复喂给 `CanvasStage`（fabric.js）
 * 之前，把围栏正文里的 `模板: <真实 key>` 那一行重写成命名空间化的预览 key（见
 * `template-simulate-dialog.tsx` 文件头 R2、`rewriteTemplateKeyLine` 自己的头注：
 * 直接用真实 key 注册会让"未保存的草稿"污染全局模板表里"真实发布过的版本"）。
 */
import { describe, it, expect } from "vitest";
import { getTemplate } from "@repo/fabric-markdown";
import { canvas } from "@repo/contracts";
import { rewriteTemplateKeyLine, usesAutoLayoutSpec } from "../../components/canvas/template-simulate-dialog";

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

/**
 * `usesAutoLayoutSpec`——R2.1（2026-08-28 复核发现的真实回归）：chat 模拟对**内置**
 * 模板必须用它们真实的手工排版几何，不能套 `buildAutoTemplateSpec` 自动布局，否则
 * 画出来的位置/比例与真实 chat 渲染同一个 key 会对不上（人类原话：「设计好的 html
 * 模板可以通过提示词渲染出来 fabricjs 的画布并保持 ratio 和大小的一致」）。
 *
 * 这里不手写一份「19 个 key」的清单去比对——那正是本仓「同一事实不得声明在两处」
 * 已经栽过五次的形状。直接遍历契约自己的 `BUILTIN_CANVAS_TEMPLATES`（唯一事实源，
 * `canvas.builtinDisplayName` 也读的这张表），新增/删除内置模板时本测试自动跟着
 * 覆盖到新的清单，不需要有人记得同步改这里。
 */
describe("usesAutoLayoutSpec（R2.1：内置模板永不套自动布局）", () => {
  const builtinKeys = Object.keys(canvas.BUILTIN_CANVAS_TEMPLATES);

  it("契约的内置模板清单非空——防止这条测试因为清单意外读成空数组而恒真", () => {
    expect(builtinKeys.length).toBeGreaterThan(0);
  });

  it.each(builtinKeys)("内置 key「%s」—— usesAutoLayoutSpec 恒为 false", (key) => {
    expect(usesAutoLayoutSpec(key)).toBe(false);
  });

  it.each(builtinKeys)("内置 key「%s」—— fabric-markdown 引擎里真的注册了一份可渲染的 spec（不是空壳）", (key) => {
    const spec = getTemplate(key);
    expect(spec).toBeDefined();
    // 真几何，不是占位——分区列表非空，每个分区都有真实坐标/尺寸（不是 0/undefined）。
    expect(spec!.sections.length).toBeGreaterThan(0);
    for (const section of spec!.sections) {
      expect(section.w).toBeGreaterThan(0);
      expect(section.h).toBeGreaterThan(0);
    }
  });

  it("组织自建（非内置）key —— usesAutoLayoutSpec 为 true，走自动布局分支", () => {
    expect(usesAutoLayoutSpec("some-org-custom-key-not-in-builtin-list")).toBe(true);
  });
});
