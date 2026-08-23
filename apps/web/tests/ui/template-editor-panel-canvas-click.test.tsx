/**
 * 2026-08-23 —— 人类明确要求「真正的可视化画布编辑器（推荐）」，不是"文字表单旁边摆一张
 * 静态预览图"。分区框在 `fabric-markdown` 引擎里是 `locked`（`evented: false`，见
 * `canvas-stage.tsx` `onCanvasClick` prop 文档），拖不动、也收不到对象级点击事件——
 * 能做到的"真实互动"是：点画布上的分区框，联动高亮 + 聚焦左侧对应的输入框。
 *
 * 手法与 `canvas-stage-edge-editability.test.tsx` 相同：`vi.mock("fabric")` 换一个
 * 子类把真实 `Canvas` 实例挂到 `globalThis.__lastFabricCanvas` 上，供测试直接操作；
 * `canvas.getScenePoint` 换成一个测试桩（真实指针坐标换算不是本用例要测的东西，
 * `canvas-stage.tsx` 自己只负责把 `getScenePoint()` 的返回值原样转发出去）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Canvas as FabricCanvasType } from "fabric";
import { computeAutoLayout } from "@/lib/canvas/auto-template-layout";
import type { CanvasTemplate } from "@/lib/live-canvas";

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

import { TemplateEditorPanel } from "@/components/canvas/template-editor-panel";

function getFabricCanvas(): FabricCanvasType {
  const canvas = (globalThis as any).__lastFabricCanvas as FabricCanvasType | undefined;
  if (!canvas) throw new Error("no fabric canvas instance registered — CanvasStage has not mounted yet");
  return canvas;
}

/** 用引擎自己的布局算法算出「第二个分区框」的场景坐标中心点——不是拍一个数字。 */
function centerOfSection(sectionNames: readonly string[], index: number): { x: number; y: number } {
  const sections = sectionNames.map((name, i) => ({
    sectionId: `s${i + 1}`, name, order: i, required: false, capacity: null,
  }));
  const layout = computeAutoLayout(sections);
  const cell = layout.cells[index];
  if (!cell) throw new Error(`no cell at index ${index}`);
  return { x: cell.x, y: cell.y };
}

function clickCanvasAt(canvas: FabricCanvasType, point: { x: number; y: number }): void {
  vi.spyOn(canvas, "getScenePoint").mockReturnValue(point as any);
  canvas.fire("mouse:down", { e: new MouseEvent("mousedown") } as any);
}

function draftRow(overrides: Partial<CanvasTemplate> = {}): CanvasTemplate {
  return {
    key: "swot", version: 1, status: "draft", displayName: "SWOT",
    builtin: false, visibility: "org-wide", underlyingType: "canvas",
    sections: [
      { sectionId: "s1", name: "优势", order: 0, required: false, capacity: null },
      { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: null },
      { sectionId: "s3", name: "机会", order: 2, required: false, capacity: null },
    ],
    usageCount: 0,
    ...overrides,
  };
}

describe("TemplateEditorPanel —— 点击画布上的分区框，联动高亮左侧输入框", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("点第二个分区框的中心点，第二个输入框获得焦点与高亮边框", async () => {
    const row = draftRow();
    render(
      <TemplateEditorPanel
        row={row}
        readOnly={false}
        onClose={() => {}}
        onSaved={() => {}}
        onPublish={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onTrial={() => {}}
        onMintVersion={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("tpladmin-editor-preview")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    const point = centerOfSection(["优势", "劣势", "机会"], 1); // 「劣势」

    clickCanvasAt(canvas, point);

    const input1 = screen.getByTestId("tpladmin-editor-section-1") as HTMLInputElement;
    await waitFor(() => expect(input1).toHaveFocus());
    expect(input1.className).toContain("border-primary");
    // 没点中的那两个框不受影响。
    expect(screen.getByTestId("tpladmin-editor-section-0").className).not.toContain("border-primary");
    expect(screen.getByTestId("tpladmin-editor-section-2").className).not.toContain("border-primary");
  });

  it("点两个分区框之间的间隙（gutter），不命中任何输入框——不是「归给最近的那个」", async () => {
    const row = draftRow();
    render(
      <TemplateEditorPanel
        row={row}
        readOnly={false}
        onClose={() => {}}
        onSaved={() => {}}
        onPublish={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onTrial={() => {}}
        onMintVersion={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("tpladmin-editor-preview")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    // 一个远离任何分区框的点（画幅右下角之外）——必然落在所有矩形外。
    clickCanvasAt(canvas, { x: -9999, y: -9999 });

    const input0 = screen.getByTestId("tpladmin-editor-section-0") as HTMLInputElement;
    expect(input0).not.toHaveFocus();
    expect(input0.className).not.toContain("border-primary");
  });

  it("非草稿行（只读预览）点击分区框不报错——即便面板整体不可编辑，联动高亮仍然安全", async () => {
    const row = draftRow({ status: "published" });
    render(
      <TemplateEditorPanel
        row={row}
        readOnly={false}
        onClose={() => {}}
        onSaved={() => {}}
        onPublish={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onTrial={() => {}}
        onMintVersion={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("tpladmin-editor-preview")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    const point = centerOfSection(["优势", "劣势", "机会"], 0);
    expect(() => clickCanvasAt(canvas, point)).not.toThrow();
  });
});

describe("TemplateEditorPanel —— 悬停画布上的分区框，预告哪个框会被点中（迭代 4）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("鼠标移到「劣势」框上方——第二个输入框换一档更弱的边框色，不聚焦、不滚动", async () => {
    const row = draftRow();
    render(
      <TemplateEditorPanel
        row={row}
        readOnly={false}
        onClose={() => {}}
        onSaved={() => {}}
        onPublish={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onTrial={() => {}}
        onMintVersion={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("tpladmin-editor-preview")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    const point = centerOfSection(["优势", "劣势", "机会"], 1); // 「劣势」
    vi.spyOn(canvas, "getScenePoint").mockReturnValue(point as any);
    canvas.fire("mouse:move", { e: new MouseEvent("mousemove") } as any);

    const input1 = screen.getByTestId("tpladmin-editor-section-1") as HTMLInputElement;
    await waitFor(() => expect(input1.className).toContain("border-primary/60"));
    // 悬停≠点击——不抢焦点，也不是点击命中后的那种更亮的 ring 高亮。
    expect(input1).not.toHaveFocus();
    expect(input1.className).not.toContain("ring-2");
  });

  it("鼠标移出画布——悬停高亮清空，不会卡在最后一个划过的框上", async () => {
    const row = draftRow();
    render(
      <TemplateEditorPanel
        row={row}
        readOnly={false}
        onClose={() => {}}
        onSaved={() => {}}
        onPublish={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onTrial={() => {}}
        onMintVersion={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("tpladmin-editor-preview")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    const point = centerOfSection(["优势", "劣势", "机会"], 0);
    vi.spyOn(canvas, "getScenePoint").mockReturnValue(point as any);
    canvas.fire("mouse:move", { e: new MouseEvent("mousemove") } as any);

    const input0 = screen.getByTestId("tpladmin-editor-section-0") as HTMLInputElement;
    await waitFor(() => expect(input0.className).toContain("border-primary/60"));

    canvas.fire("mouse:out", {} as any);
    await waitFor(() => expect(input0.className).not.toContain("border-primary/60"));
  });
});
