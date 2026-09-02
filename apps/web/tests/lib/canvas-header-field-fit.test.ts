// @vitest-environment jsdom
/**
 * 表头字段值在真实 fabric 渲染管线里不出格——2026-09-02 人类实测截图回归钉子。
 *
 * chat 里的用户画像：`姓名: 华锐精密（无锡华锐精工科技有限公司，企业机构）` 这类
 * 没有空格的中文长值，fabric `Textbox` 默认按"单词"换行，整句被当成一个拆不开的
 * 单词，一行画到底、压过右边的「性别:」标签，最右一格更是画出表头框外（"文字跳出了
 * 区域"）。修法（`packages/fabric-markdown/src/fabric-objects.ts`，VENDOR 侧）：
 * `text` 节点按 `data.wrap === 'grapheme'` 逐字换行，再按 `data.fitHeight` 缩字号
 * 直到换行后的高度放得进这一行——与贴纸同一套机制。这里用真实 `StaticCanvas` +
 * 真实渲染（`registerTemplate` → `templateToModel` → `renderToCanvas`）验证。
 */
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { StaticCanvas, Textbox, type Canvas } from "fabric";
import { registerTemplate, renderToCanvas, FlowNode, templateToModel } from "@repo/fabric-markdown";
import type { TemplateSpec } from "@repo/fabric-markdown";

/**
 * ⚠ jsdom 里的 2D 上下文（node-canvas）解析不了 `theme.ts` 的
 * `FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif'`——`ctx.font`
 * 赋值被静默拒绝、`measureText` 对这套字体恒返回 0 宽，于是 fabric 永远不换行、
 * 也永远不缩字号（实测：同一段文字不带 fontFamily 换出 4 行，带上就是 1 行）。
 * 这是测试环境的缺陷，不是浏览器的行为。这里换成一个**确定性的度量模型**：
 * 中日韩字符 1em、其他字符 0.55em，字号取自 fabric 最近一次赋给 `ctx.font` 的声明——
 * 与真实浏览器"宽度随字号线性缩放"的性质一致，换行/缩字号的逻辑因此可测。
 */
type Ctx2D = CanvasRenderingContext2D & { __fontDecl?: string };
const ctxProto = Object.getPrototypeOf(document.createElement("canvas").getContext("2d")!) as Ctx2D;
const originalFont = Object.getOwnPropertyDescriptor(ctxProto, "font")!;
const originalMeasure = ctxProto.measureText;
beforeAll(() => {
  Object.defineProperty(ctxProto, "font", {
    configurable: true,
    get(this: Ctx2D) { return this.__fontDecl ?? (originalFont.get!.call(this) as string); },
    set(this: Ctx2D, v: string) {
      this.__fontDecl = v;
      try { originalFont.set!.call(this, v); } catch { /* node-canvas 拒绝的字体声明：只记下来 */ }
    },
  });
  ctxProto.measureText = function (this: Ctx2D, text: string) {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.__fontDecl ?? "");
    const px = m ? Number(m[1]) : 10;
    let width = 0;
    for (const ch of text) width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? px : px * 0.55;
    return { width } as TextMetrics;
  };
});
afterAll(() => {
  Object.defineProperty(ctxProto, "font", originalFont);
  ctxProto.measureText = originalMeasure;
});

const LONG = "华锐精密（无锡华锐精工科技有限公司，企业机构）汽车与工程机械精密零部件二级供应商";

function render(spec: TemplateSpec, code: string): FlowNode[] {
  registerTemplate(spec);
  const model = templateToModel(code);
  const canvas = new StaticCanvas(undefined, { width: 1800, height: 1000 }) as unknown as Canvas;
  renderToCanvas(model, canvas);
  return canvas.getObjects().filter((o) => o instanceof FlowNode) as FlowNode[];
}

describe("表头字段值不出格（2026-09-02 chat 用户画像截图）", () => {
  const spec: TemplateSpec = {
    key: "header-field-fit-check",
    title: "表头适配检查",
    fields: ["姓名", "性别", "年龄", "区域", "教育水平", "职位", "行业", "家庭情况", "收入水平"],
    headerRect: { x: 820, y: 144, w: 1520, h: 120 },
    fieldsPerRow: 6,
    sections: [{ name: "正文", x: 820, y: 500, w: 1520, h: 300 }],
    titleBars: true,
  };
  const code = `模板: header-field-fit-check\n姓名: ${LONG}\n性别: 不适用\n## 正文\n- x\n`;

  it("长中文值逐字换行、缩字号，画出来的文字框既不比值框宽，也不比行距高", () => {
    const nodes = render(spec, code);
    const nameNode = nodes.find((n) => n.data?.["role"] === "field" && n.data?.["key"] === "姓名")!;
    expect(nameNode).toBeDefined();
    const tb = nameNode.getObjects().find((o) => o instanceof Textbox) as Textbox;
    expect(tb.splitByGrapheme).toBe(true);
    // 真的换了行（不是一行画到底）。
    expect(tb.textLines.length).toBeGreaterThan(1);
    // 文字框宽度 = 值框宽度：任何一行都画不到相邻格的标签上。
    expect(tb.width).toBeLessThanOrEqual(nameNode.width + 1e-6);
    // 高度被缩到行距以内（fitHeight 由引擎按 h/(rows+1) 算出），字号确实缩过。
    const fitHeight = nameNode.data?.["fitHeight"] as number;
    expect(fitHeight).toBeGreaterThan(0);
    expect(tb.height).toBeLessThanOrEqual(fitHeight + 1e-6);
    expect(tb.fontSize).toBeLessThan(13);
    expect(tb.fontSize).toBeGreaterThanOrEqual(7);
    // 整个字段组仍落在表头框之内（右沿不出框）。
    const groupRight = nameNode.left + nameNode.width / 2;
    expect(groupRight).toBeLessThanOrEqual(820 + 760 + 1e-6);
  });

  it("短值不缩字号——只有放不下的值才缩", () => {
    const nodes = render(spec, code);
    const genderNode = nodes.find((n) => n.data?.["role"] === "field" && n.data?.["key"] === "性别")!;
    const tb = genderNode.getObjects().find((o) => o instanceof Textbox) as Textbox;
    expect(tb.textLines.length).toBe(1);
    expect(tb.fontSize).toBe(13);
  });

  it("setLabel 改成长值后重新适配（编辑器里改表头字段走同一条路）", () => {
    const nodes = render(spec, code);
    const genderNode = nodes.find((n) => n.data?.["role"] === "field" && n.data?.["key"] === "性别")!;
    genderNode.setLabel(LONG);
    const tb = genderNode.getObjects().find((o) => o instanceof Textbox) as Textbox;
    const fitHeight = genderNode.data?.["fitHeight"] as number;
    expect(tb.textLines.length).toBeGreaterThan(1);
    expect(tb.height).toBeLessThanOrEqual(fitHeight + 1e-6);
    // 改回短值：字号回到基准 13。
    genderNode.setLabel("女");
    expect(tb.fontSize).toBe(13);
  });
});
