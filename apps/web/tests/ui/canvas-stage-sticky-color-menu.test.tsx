/**
 * 便签颜色菜单回归——issue #3336（人类反馈：Chat 里最大化编辑一张 Fabric.js 便签
 * 后，只能改文字，改不了颜色）。
 *
 * 根因：`FlowNode.setColor`（`packages/fabric-markdown/src/fabric-objects.ts`）
 * 和 `STICKY_COLORS` 调色板（`.../diagrams/template-engine.ts`）此前都是 vendor
 * 早就备好的能力（注释写着"used by the sticky color menu"），但没有任何调用点
 * 接它们——`CanvasStage` 选中一个便签只更新一条底部文字提示，没有任何颜色相关的
 * UI。本文件钉住新接的行为：选中画布模板里的一枚便签（`data.role === 'sticky'`）
 * 后出现颜色菜单，点一个色块真的改了这枚便签的底色，并且落回的 markdown 带上了
 * 对应的 `#colorname` 尾缀（`serializeTemplate` 既有的序列化规则，见该文件
 * `extractStickyColor`）。
 *
 * 手法与 `canvas-stage-sticky-borderless.test.ts` 同款（`registerTemplate` +
 * `templateToModel` 生成真实模板模型），叠加 `canvas-stage-edge-editability.test.tsx`
 * 的「截获真实 fabric.Canvas 实例」手法，全程走真实渲染/序列化管线，不 mock
 * `template-engine.ts` 的任何一步。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Rect, type Canvas as FabricCanvasType } from "fabric";
import { registerTemplate, type TemplateSpec } from "@repo/fabric-markdown";

const SPEC: TemplateSpec = {
  key: "sticky-color-menu-check",
  title: "颜色菜单检查",
  sections: [{ name: "分区一", x: 0, y: 0, w: 400, h: 260 }],
  titleBars: true,
};
registerTemplate(SPEC);

const TEMPLATE_MARKDOWN = "```canvas\n模板: sticky-color-menu-check\n## 分区一\n- 待改色的便签\n```";

vi.mock("fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric")>();
  class ObservedCanvas extends actual.Canvas {
    constructor(...args: ConstructorParameters<typeof actual.Canvas>) {
      super(...args);
      (globalThis as any).__lastFabricCanvas = this;
    }
  }
  return { ...actual, Canvas: ObservedCanvas };
});

import { CanvasStage } from "@/components/canvas/canvas-stage";

function getFabricCanvas(): FabricCanvasType {
  const canvas = (globalThis as any).__lastFabricCanvas as FabricCanvasType | undefined;
  if (!canvas) throw new Error("no fabric canvas instance registered — CanvasStage has not mounted yet");
  return canvas;
}

function selectSticky(canvas: FabricCanvasType): any {
  const target = canvas.getObjects().find((o: any) => o.shape === "sticky");
  if (!target) throw new Error("no sticky node rendered");
  canvas.setActiveObject(target as any);
  canvas.fire("selection:created", { selected: [target] } as any);
  return target;
}

describe("CanvasStage 便签颜色菜单（issue #3336）", () => {
  let onMarkdownChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onMarkdownChange = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("选中便签后出现颜色菜单，选中其它节点/清空选择时消失", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={TEMPLATE_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().some((o: any) => o.shape === "sticky")).toBe(true));

    expect(screen.queryByTestId("canvas-sticky-color-menu")).not.toBeInTheDocument();

    selectSticky(canvas);
    await waitFor(() => expect(screen.getByTestId("canvas-sticky-color-menu")).toBeInTheDocument());

    // 选中分区框（非便签的结构节点）时菜单应该消失——同 Delete 键那条"只有便签
    // 是内容"的规则，不该对结构节点也弹出改色菜单。
    const section = canvas.getObjects().find((o: any) => o.data?.role === "section");
    expect(section).toBeDefined();
    canvas.setActiveObject(section as any);
    canvas.fire("selection:created", { selected: [section] } as any);
    await waitFor(() => expect(screen.queryByTestId("canvas-sticky-color-menu")).not.toBeInTheDocument());

    selectSticky(canvas);
    await waitFor(() => expect(screen.getByTestId("canvas-sticky-color-menu")).toBeInTheDocument());
    canvas.discardActiveObject();
    canvas.fire("selection:cleared", {} as any);
    await waitFor(() => expect(screen.queryByTestId("canvas-sticky-color-menu")).not.toBeInTheDocument());
  });

  it("点一个色块：便签底色立即变化，且回写的 markdown 带上对应的 #颜色名 标签", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={TEMPLATE_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().some((o: any) => o.shape === "sticky")).toBe(true));

    const sticky = selectSticky(canvas);
    await waitFor(() => expect(screen.getByTestId("canvas-sticky-color-menu")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("canvas-sticky-color-blue"));

    await waitFor(() => {
      const card = sticky.getObjects().find((o: any) => o instanceof Rect) as Rect;
      expect(card.fill).toBe("#bfdbfe");
    });
    expect(sticky.data?.color).toBe("#bfdbfe");

    await waitFor(() => {
      const lastCall = onMarkdownChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain("#blue");
    });
  });

  it("只读模式下选中便签不出现颜色菜单", async () => {
    render(
      <CanvasStage readOnly tool="select" zoom={1} markdown={TEMPLATE_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().some((o: any) => o.shape === "sticky")).toBe(true));

    selectSticky(canvas);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId("canvas-sticky-color-menu")).not.toBeInTheDocument();
  });
});
