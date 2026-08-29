/**
 * 回归测试（人类实测反馈，2026-08-29）：
 *
 * 「生成用户画像画布 → 最大化 → 拖动编辑 → 保存 → 退出」之后，气泡里的画布围栏
 * 变成不可渲染：`checkCanvasFence` 报「缺少「模板: <模板 key>」行」。
 *
 * 根因：本仓 AI 产出 persona 画布时恒用**显式**写法（```canvas 围栏 + 首行
 * `模板: persona`，见 `canvas-template-guidance.ts` 的格式指引），但
 * `fabric-markdown` 的 `serializeTemplate` 对 `key === 'persona'` 有一条只对
 * **隐式**写法（```persona 围栏，key 由围栏语言本身声明）成立的省略——它恒不写
 * 「模板: persona」这一行。`serializeCanvasMarkdown` 编辑后走 `replaceMermaidBlock`
 * 时保留的是原围栏的 `lang`（这里是 `canvas`，不会因为这次序列化算出的 lang 是
 * `persona` 就把围栏语言换掉），于是编辑一次之后围栏语言仍是 `canvas`、却丢了
 * 唯一还能声明 key 的那一行文字——第一次生成（未经这条序列化路径）正常，编辑
 * 保存一次之后就再也无法渲染。
 *
 * 这里只 mock `extractModel`（画布 → 模型这一步依赖真实 fabric.Canvas，jsdom 建
 * 不出，与本条要验的东西无关），其余（`serializeTemplate`/`replaceMermaidBlock`/
 * `templateToModel`）全部用真实实现——用真实 `checkCanvasFence` 复核输出确实可渲染，
 * 不是只断言字符串包含。
 */
import { describe, expect, it, vi } from "vitest";
import type { Canvas as FabricCanvas } from "fabric";

const extractModel = vi.fn();
vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return { ...actual, extractModel };
});

describe("serializeCanvasMarkdown：显式 ```canvas + 模板: persona 围栏编辑一次后仍可渲染", () => {
  it("保留围栏语言 canvas 的同时，补回被 serializeTemplate 省掉的「模板: persona」行", async () => {
    const { templateToModel } = await import("@repo/fabric-markdown");
    const { serializeCanvasMarkdown } = await import("@/lib/canvas/serialize-canvas-markdown");
    const { checkCanvasFence } = await import("@/lib/canvas/canvas-fence");

    const originalMarkdown = [
      "```canvas",
      "模板: persona",
      "姓名: 林可",
      "",
      "## 用户描述",
      "- 项目型采购",
      "```",
    ].join("\n");

    // 模拟用户在全屏编辑器里改了姓名——`extractModel` 从画布读回来的模型，
    // 用真实 `templateToModel` 产出（同引擎的正向路径，key 解析、meta 填充都是
    // fabric-markdown 自己的逻辑，不在这里重新发明一份）。
    const editedText = [
      "模板: persona",
      "姓名: 新用户",
      "",
      "## 用户描述",
      "- 编辑后的新内容",
    ].join("\n");
    extractModel.mockReturnValue(templateToModel(editedText));

    const next = serializeCanvasMarkdown({} as FabricCanvas, originalMarkdown);

    // 围栏语言不因为这次编辑悄悄从 canvas 换成 persona（既有行为，不应回归）。
    expect(next.startsWith("```canvas\n")).toBe(true);
    expect(next).toContain("模板: persona");

    const block = next.match(/^```canvas\n([\s\S]*?)\n```$/);
    expect(block).not.toBeNull();
    const check = checkCanvasFence(block![1]!, "canvas");
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.key).toBe("persona");
  });

  it("已经是隐式 ```persona 围栏时不重复添加「模板:」行（既有行为不回归）", async () => {
    const { templateToModel } = await import("@repo/fabric-markdown");
    const { serializeCanvasMarkdown } = await import("@/lib/canvas/serialize-canvas-markdown");
    const { checkCanvasFence } = await import("@/lib/canvas/canvas-fence");

    const originalMarkdown = ["```persona", "姓名: 林可", "", "## 用户描述", "- 项目型采购", "```"].join(
      "\n",
    );
    extractModel.mockReturnValue(templateToModel("姓名: 新用户\n\n## 用户描述\n- 编辑后的新内容", "persona"));

    const next = serializeCanvasMarkdown({} as FabricCanvas, originalMarkdown);

    expect(next.startsWith("```persona\n")).toBe(true);
    expect(next).not.toContain("模板:");

    const block = next.match(/^```persona\n([\s\S]*?)\n```$/);
    expect(block).not.toBeNull();
    const check = checkCanvasFence(block![1]!, "persona");
    expect(check.ok).toBe(true);
  });
});
