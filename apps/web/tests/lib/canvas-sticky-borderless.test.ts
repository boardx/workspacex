// @vitest-environment jsdom
/**
 * 贴纸卡片无边框回归 —— issue #2372 的直接后续。
 *
 * 人类实测截图反馈：#2372 放开分区各自的贴纸颜色（`stickyColor`）后，每张贴纸卡片
 * 仍然套着一层固定的琥珀色描边（`STICKY_STROKE='#f59e0b'`，`theme.ts`）——那是
 * 原先只有单一默认黄色贴纸时校准出来的颜色，跟蓝/绿/粉这些非黄色底色放在一起会
 * 显得突兀，像一层不该有的边框。人类原话：「渲染的 fabricjs 便利贴，不要 border」。
 *
 * 修法（`packages/fabric-markdown/src/fabric-objects.ts`，VENDOR 侧）：贴纸卡片
 * 的 `Rect` 去掉 `stroke`/`strokeWidth`，只留 `fill`。这里用真实 `StaticCanvas` +
 * 真实渲染管线（`registerTemplate` → `templateToModel` → `renderToCanvas`）验证：
 * 贴纸对应的 `FlowNode`（一个 fabric `Group`）里那个底层 `Rect` 没有描边。
 */
import { describe, it, expect } from "vitest";
import { StaticCanvas, Rect, type Canvas } from "fabric";
import { registerTemplate, renderToCanvas, FlowNode, templateToModel } from "@repo/fabric-markdown";
import type { TemplateSpec } from "@repo/fabric-markdown";

describe("贴纸卡片无边框（issue #2372 后续）", () => {
  it("渲染出来的贴纸 Rect 没有 stroke，不管贴纸是不是自定义颜色", () => {
    const spec: TemplateSpec = {
      key: "sticky-borderless-check",
      title: "无边框检查",
      sections: [
        { name: "默认色", x: 0, y: 0, w: 300, h: 200 },
        { name: "自定义色", x: 400, y: 0, w: 300, h: 200, stickyColor: "#bfdbfe" },
      ],
      titleBars: true,
    };
    registerTemplate(spec);

    const code = `模板: sticky-borderless-check
## 默认色
- 默认色的一条便签
## 自定义色
- 自定义色的一条便签
`;
    const model = templateToModel(code);
    const canvas = new StaticCanvas(undefined, { width: 1000, height: 600 }) as unknown as Canvas;
    renderToCanvas(model, canvas);

    const stickies = canvas.getObjects().filter((o) => o instanceof FlowNode && o.shape === "sticky") as FlowNode[];
    expect(stickies).toHaveLength(2);

    for (const sticky of stickies) {
      const card = sticky.getObjects().find((o) => o instanceof Rect) as Rect | undefined;
      expect(card).toBeDefined();
      // 无边框：strokeWidth 为 0（fabric 默认）或 stroke 本身是空/未设置——
      // 不管具体走哪种"没有描边"的表达方式，视觉上都不应该画出一圈线。
      expect(card!.stroke == null || card!.strokeWidth === 0).toBe(true);
    }
  });
});
