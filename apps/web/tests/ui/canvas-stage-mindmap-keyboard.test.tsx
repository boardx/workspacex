/**
 * #1453 —— chat 全屏编辑图的键盘交互：mindmap 选中节点后 Tab 加子节点 / Enter
 * 加兄弟节点 / Delete 删子树；非 mindmap 图（flowchart）上同样的按键必须无副作用。
 *
 * 测试环境探明（写在这里，不是猜的）：
 * - `packages/fabric-markdown` 既有 164 个单测全部只测 model/parsing 层，没有一个
 *   实例化真实 `new Canvas(...)`；仓库里有没有 `canvas`（node-canvas）这个包是能不能
 *   做真实 DOM 渲染集成测试的分水岭。实测：`node_modules/.pnpm` 下有
 *   `canvas@3.2.3`（`fabric` 的可选 peer dep，被别的依赖链带进来了），于是
 *   `new FabricCanvas(document.createElement("canvas"))` 在这个仓库当前的
 *   `apps/web` vitest(jsdom) 配置下【真实可用】——`canvas.add()` /
 *   `canvas.getActiveObject()` / `canvas.getObjects()` 全部是真实 fabric 状态，不是
 *   mock。这跟 `chat-diagram-save-gate.test.tsx` 头注、`markdown-message.test.tsx`
 *   头注里"VZ-fabric 系列：jsdom 里连 data-ready 都产不出"的旧结论不一样——那是
 *   静态痕迹（写下来之后没再被验证过），本文件按仓库当前 HEAD 实测。
 * - 但 `markdownToCanvas()` 内部会经过真实 `mermaid.render()`，而 mermaid 的
 *   mindmap/flowchart renderer 在节点布局阶段调用了 `SVGElement.getBBox()`——jsdom
 *   没有实现这个 API（`TypeError: text2.getBBox is not a function`，实测复现，见下方
 *   探针曾经跑过的报错）。这一层限制是 mermaid.js 对真实浏览器 DOM 的依赖，跟本次
 *   要测的键盘交互（完全发生在 fabric 对象图上，不再触碰 mermaid.render）无关。
 * - 因此这里对 `@repo/fabric-markdown` 做**部分** mock：只替换 `markdownToCanvas`
 *   （跳过它内部会走 `mermaid.render()` 的那一跳），换成直接调用**真实**
 *   `renderToCanvas(model, canvas)`（同一个包导出的真实生产函数，`CanvasStage` 平时
 *   保存/回填链路依赖的也是它）把手写的 `DiagramModel` 铺到画布上。
 *   `attachMindmapEditor` / `FlowNode` / `FlowEdge` / `extractModel` /
 *   `canvasToMarkdown` / `renderToCanvas` 全部走 `importOriginal` 保留原实现，未被
 *   mock；`CanvasStage` 本身、真实 `document.dispatchEvent(new KeyboardEvent(...))`
 *   键盘事件链路、真实 fabric selection 状态机，全部是真实集成，不是浅层 spy。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Canvas as FabricCanvasType } from "fabric";
import type { DiagramModel } from "@repo/fabric-markdown";

// ---------------------------------------------------------------------------
// Hand-built DiagramModel fixtures (bypass mermaid text parsing entirely).
// ---------------------------------------------------------------------------

/**
 *        root
 *        /  \
 *       A    B
 *       |
 *       A1
 */
function mindmapModel(): DiagramModel {
  const n = (id: string, label: string, x: number, y: number) => ({
    id,
    label,
    shape: "round" as const,
    x,
    y,
    width: 120,
    height: 48,
  });
  const e = (id: string, source: string, target: string) => ({
    id,
    source,
    target,
    kind: "open" as const,
    data: { mindmap: true },
  });
  return {
    kind: "mindmap",
    direction: "TD",
    nodes: [n("root", "根主题", 0, 0), n("A", "分支A", 240, -60), n("B", "分支B", 240, 60), n("A1", "A的子节点", 480, -60)],
    edges: [e("e1", "root", "A"), e("e2", "root", "B"), e("e3", "A", "A1")],
  };
}

/** Plain two-node flowchart — attachMindmapEditor's isMindmap() guard must reject this. */
function flowchartModel(): DiagramModel {
  return {
    kind: "flowchart",
    direction: "TD",
    nodes: [
      { id: "X", label: "节点X", shape: "rect", x: 0, y: 0, width: 120, height: 48 },
      { id: "Y", label: "节点Y", shape: "rect", x: 240, y: 0, width: 120, height: 48 },
    ],
    edges: [{ id: "e1", source: "X", target: "Y", kind: "open" }],
  };
}

const MINDMAP_MARKDOWN = "```mermaid\nmindmap\n  root((根主题))\n```";
const FLOWCHART_MARKDOWN = "```mermaid\nflowchart TD\n  X --> Y\n```";

vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return {
    ...actual,
    // Real renderToCanvas, real FlowNode/FlowEdge, real attachMindmapEditor —
    // only the mermaid.render()-dependent text→model hop is swapped for a
    // hand-built model (see file header for why).
    markdownToCanvas: async (markdown: string, canvas: FabricCanvasType) => {
      const model = markdown.includes("mindmap") ? mindmapModel() : flowchartModel();
      actual.renderToCanvas(model, canvas);
      return { model, block: { code: markdown, lang: "mermaid", start: 0, end: markdown.length, fence: "```" } };
    },
  };
});

// `CanvasStage` keeps its `fabric.Canvas` instance in an internal ref and never exposes it.
// To assert on real fabric state from the test we subclass the REAL `fabric.Canvas` (imported
// via importOriginal, all behaviour untouched) purely to stash a handle to the instance
// `CanvasStage` constructs on mount — this is not a functional mock, only an observation hook.
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

function selectNodeByLabel(canvas: FabricCanvasType, label: string): void {
  const target = canvas.getObjects().find((o: any) => o.label === label);
  if (!target) throw new Error(`no node with label ${label}`);
  canvas.setActiveObject(target);
  canvas.fire("selection:created", { selected: [target] });
}

/** The real `fabric.Canvas` instance `CanvasStage` constructed on mount (see the `fabric` mock above). */
function getFabricCanvas(): FabricCanvasType {
  const canvas = (globalThis as any).__lastFabricCanvas as FabricCanvasType | undefined;
  if (!canvas) throw new Error("no fabric canvas instance registered — CanvasStage has not mounted yet");
  return canvas;
}

function dispatchKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("CanvasStage 键盘交互 —— #1453", () => {
  let onMarkdownChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onMarkdownChange = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mindmap：选中一个非根节点后 Tab 加子节点，挂在被选中节点下", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={MINDMAP_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());

    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const beforeCount = canvas.getObjects().length;
    selectNodeByLabel(canvas, "分支A");
    dispatchKey("Tab");

    await waitFor(() => expect(canvas.getObjects().length).toBe(beforeCount + 2)); // +1 node +1 edge

    const nodes = canvas.getObjects().filter((o: any) => o.nodeId !== undefined);
    const newNode = nodes.find((n: any) => n.label === "新节点");
    expect(newNode).toBeDefined();

    const edges = canvas.getObjects().filter((o: any) => o.edgeId !== undefined);
    const parentA = nodes.find((n: any) => n.label === "分支A") as any;
    const linkedToA = edges.some((e: any) => e.source === parentA.nodeId && e.target === (newNode as any).nodeId);
    expect(linkedToA).toBe(true);
  });

  it("mindmap：选中一个非根节点后 Enter 加兄弟节点，挂在同一父节点下", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={MINDMAP_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const beforeCount = canvas.getObjects().length;
    selectNodeByLabel(canvas, "分支A");
    dispatchKey("Enter");

    await waitFor(() => expect(canvas.getObjects().length).toBe(beforeCount + 2));

    const nodes = canvas.getObjects().filter((o: any) => o.nodeId !== undefined);
    const edges = canvas.getObjects().filter((o: any) => o.edgeId !== undefined);
    const root = nodes.find((n: any) => n.label === "根主题") as any;
    const newNode = nodes.find((n: any) => n.label === "新节点") as any;
    expect(newNode).toBeDefined();
    // Sibling of A → parent is root, same as A's own parent.
    const linkedToRoot = edges.some((e: any) => e.source === root.nodeId && e.target === newNode.nodeId);
    expect(linkedToRoot).toBe(true);
  });

  it("mindmap：选中一个节点后 Delete 删除该节点及其子树、相连的边", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={MINDMAP_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    selectNodeByLabel(canvas, "分支A"); // has child A1
    dispatchKey("Delete");

    await waitFor(() => {
      const labels = canvas.getObjects().map((o: any) => o.label).filter(Boolean);
      expect(labels).not.toContain("分支A");
    });
    const labels = canvas.getObjects().map((o: any) => o.label).filter(Boolean);
    expect(labels).not.toContain("A的子节点");
    expect(labels).toContain("根主题");
    expect(labels).toContain("分支B");

    const nodeIds = new Set(
      canvas.getObjects().filter((o: any) => o.nodeId !== undefined).map((n: any) => n.nodeId),
    );
    const danglingEdge = canvas
      .getObjects()
      .filter((o: any) => o.edgeId !== undefined)
      .some((e: any) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
    expect(danglingEdge).toBe(false);
  });

  it("非 mindmap（flowchart）：选中节点后 Tab/Enter/Delete 均无副作用", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const beforeCount = canvas.getObjects().length;
    const beforeLabels = canvas.getObjects().map((o: any) => o.label).filter(Boolean).sort();

    selectNodeByLabel(canvas, "节点X");
    dispatchKey("Tab");
    dispatchKey("Enter");
    dispatchKey("Delete");

    expect(canvas.getObjects().length).toBe(beforeCount);
    expect(canvas.getObjects().map((o: any) => o.label).filter(Boolean).sort()).toEqual(beforeLabels);
  });
});
