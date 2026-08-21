/**
 * 连线（connector/edge）可编辑性回归——人类要求"review 可视化的连线的问题"后的
 * 实测发现：flowchart 类图上连线几乎不可编辑。三条具体缺口：
 *
 *   ① 完全没有新增连线的入口——「连线」工具此前存在但从未真正接线（点两个节点
 *      画不出连线），已被摘掉；本文件钉住新接的两点连线逻辑：`tool === "edge"`
 *      时点第一个节点记为起点，点第二个（不同的）节点画出一条真边；点同一个
 *      节点两次＝取消。
 *   ② 选中一条连线后，Delete 键和「删除」工具都对它没有任何反应——`onDeleteKey`
 *      和 delete 工具的 `mouse:down` 分支此前都硬编码只处理 `FlowNode`。
 *   ③ 选中态没有贴着线本身的视觉高亮，只有一个宽松的轴对齐外接矩形——vendored
 *      `FlowEdge._render` 现在在自己是 canvas 当前 active object 时换一种描边色/
 *      加粗线宽（`packages/fabric-markdown` 侧改动，回流规程见 VENDOR.md）。
 *
 * mindmap 图不接线/不接删边（边是树结构派生物，见 `canvas-stage.tsx` 对应注释），
 * 本文件用与既有 `canvas-stage-mindmap-keyboard.test.tsx` 相同的「部分 mock
 * @repo/fabric-markdown（只换掉 markdownToCanvas 里会走 mermaid.render() 的那一跳）
 * + 真实 fabric.Canvas」手法，同一条环境探明结论（见该文件头注释），不重复贴一遍。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Canvas as FabricCanvasType } from "fabric";
import type { DiagramModel } from "@repo/fabric-markdown";

/**
 *   X --> Y --> Z
 * 三节点两条边的 flowchart——够测「加第三条边（X→Z）」「删一条既有边」「选中
 * 一条边后高亮」三件事，不需要更复杂的图。
 */
function flowchartModel(): DiagramModel {
  return {
    kind: "flowchart",
    direction: "TD",
    nodes: [
      { id: "X", label: "节点X", shape: "rect", x: 0, y: 0, width: 120, height: 48 },
      { id: "Y", label: "节点Y", shape: "rect", x: 240, y: 0, width: 120, height: 48 },
      { id: "Z", label: "节点Z", shape: "rect", x: 480, y: 0, width: 120, height: 48 },
    ],
    edges: [
      { id: "e1", source: "X", target: "Y", kind: "open" },
      { id: "e2", source: "Y", target: "Z", kind: "open" },
    ],
  };
}

const FLOWCHART_MARKDOWN = "```mermaid\nflowchart TD\n  X --> Y --> Z\n```";

vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return {
    ...actual,
    markdownToCanvas: async (markdown: string, canvas: FabricCanvasType) => {
      const model = flowchartModel();
      actual.renderToCanvas(model, canvas);
      return { model, block: { code: markdown, lang: "mermaid", start: 0, end: markdown.length, fence: "```" } };
    },
  };
});

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

// `canvas-stage.tsx` 的 mouse:down 处理只读 `opt.target`/`opt.e`——`scenePoint`/
// `viewportPoint` 是真实指针事件里 fabric 自己填的字段，本测试不模拟真实指针
// 移动，`as any` 越过 TS 对这两个字段的要求，不是绕过什么真实校验。
function clickNode(canvas: FabricCanvasType, label: string): void {
  const target = canvas.getObjects().find((o: any) => o.label === label);
  if (!target) throw new Error(`no node with label ${label}`);
  canvas.fire("mouse:down", { target, e: new MouseEvent("mousedown") } as any);
}

function selectEdge(canvas: FabricCanvasType, edgeId: string): void {
  const target = canvas.getObjects().find((o: any) => o.edgeId === edgeId);
  if (!target) throw new Error(`no edge with id ${edgeId}`);
  canvas.setActiveObject(target);
  canvas.fire("selection:created", { selected: [target] });
}

function dispatchKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("CanvasStage 连线可编辑性回归", () => {
  let onMarkdownChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onMarkdownChange = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("① 连线工具：点起点节点再点终点节点，真的画出一条新边（此前是死按钮）", async () => {
    render(
      <CanvasStage readOnly={false} tool="edge" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const edgesBefore = canvas.getObjects().filter((o: any) => o.edgeId !== undefined).length;
    clickNode(canvas, "节点X");
    clickNode(canvas, "节点Z"); // X 和 Z 此前没有直接相连的边

    await waitFor(() => {
      const edgesAfter = canvas.getObjects().filter((o: any) => o.edgeId !== undefined);
      expect(edgesAfter.length).toBe(edgesBefore + 1);
    });
    const edges = canvas.getObjects().filter((o: any) => o.edgeId !== undefined) as any[];
    const nodes = canvas.getObjects().filter((o: any) => o.nodeId !== undefined) as any[];
    const x = nodes.find((n) => n.label === "节点X");
    const z = nodes.find((n) => n.label === "节点Z");
    expect(edges.some((e) => e.source === x.nodeId && e.target === z.nodeId)).toBe(true);
    // 画完新边之后应该回写了 markdown——不是只改了画布不落数据。
    expect(onMarkdownChange).toHaveBeenCalled();
  });

  it("① 连线工具：点同一个节点两次＝取消，不会连到自己", async () => {
    render(
      <CanvasStage readOnly={false} tool="edge" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const edgesBefore = canvas.getObjects().filter((o: any) => o.edgeId !== undefined).length;
    clickNode(canvas, "节点X");
    clickNode(canvas, "节点X");

    // 给一次事件循环机会——如果真的会画出自环边，这里会变化；断言的是"不变"。
    await new Promise((r) => setTimeout(r, 10));
    const edgesAfter = canvas.getObjects().filter((o: any) => o.edgeId !== undefined);
    expect(edgesAfter.length).toBe(edgesBefore);
  });

  it("② 选中一条连线后 Delete 键真的删掉它（此前对边毫无反应）", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    selectEdge(canvas, "e1");
    dispatchKey("Delete");

    await waitFor(() => {
      const remaining = canvas.getObjects().filter((o: any) => o.edgeId === "e1");
      expect(remaining.length).toBe(0);
    });
    expect(onMarkdownChange).toHaveBeenCalled();
  });

  it("② 「删除」工具点一条连线，真的删掉它（此前只对节点生效）", async () => {
    render(
      <CanvasStage readOnly={false} tool="delete" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const edge = canvas.getObjects().find((o: any) => o.edgeId === "e2")!;
    canvas.fire("mouse:down", { target: edge, e: new MouseEvent("mousedown") } as any);

    await waitFor(() => {
      const remaining = canvas.getObjects().filter((o: any) => o.edgeId === "e2");
      expect(remaining.length).toBe(0);
    });
  });

  it("③ 选中一条连线时描边颜色变化（贴着线本身的高亮，不只是外接矩形）", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const edge = canvas.getObjects().find((o: any) => o.edgeId === "e1") as any;
    const unselectedColor = (edge as { ["lineColor"]?: () => string }) as any;
    // `lineColor` 是私有方法，测试用 `as any` 越过 TS 的 private 检查读它的返回值——
    // 这是内部实现细节，但正是"选中态要不要换色"这件事本身，不是在测无关内部状态。
    const before = edge.lineColor();
    canvas.setActiveObject(edge);
    canvas.fire("selection:created", { selected: [edge] });
    const after = edge.lineColor();
    expect(after).not.toBe(before);
  });
});
