/**
 * #1453 —— chat 全屏编辑图的键盘交互：mindmap 选中节点后 Tab 加子节点 / Enter
 * 加兄弟节点 / Delete 删子树；非 mindmap 图（flowchart）上 Tab/Enter 必须无副作用
 * （那是 mindmap 专用的树操作快捷键，flowchart 节点之间不是父子关系，Tab/Enter
 * 加不出"子节点/兄弟节点"这种概念）。
 *
 * ⚠ Delete 不在"无副作用"之列（人类实测反馈，2026-08-19）：此前这条测试把
 *   「flowchart 里选中节点按 Delete 什么都不发生」当成正确行为钉住，但那其实是
 *   一个真实体验断层——切到工具条「删除」工具点一下就能删掉的同一个节点，键盘
 *   Delete 却删不掉，用户没有理由记住这条不一致。现在 Delete 在非 mindmap 图上
 *   走与「删除」工具**同一条**移除路径（`canvas.remove` + `object:modified`），
 *   Tab/Enter 仍保持无副作用。
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

    // 回归：新兄弟节点应该排在 A/B 下方（追加到最后），不是插到最上面
    // （人类实测反馈，2026-08-21）。根因是 `attachMindmapEditor` 加新边时用
    // `sendObjectToBack` 把它甩到整个 canvas 对象栈的绝对最前面——不只是排在
    // 所有节点前面（视觉上确实"在节点下方"），还排到了所有**既有边**前面。
    // `extractModel` 按 `canvas.getObjects()` 迭代顺序建 `model.edges`，
    // mindmap 布局按这个顺序给每个叶子分配 `leafIndex`（越靠前 y 越小、越靠
    // 上）——于是新节点永远拿到最小的 leafIndex，长在最上面，而不是最下面。
    // 直接断言：新兄弟的 y 坐标必须比 A、B 都大（在两者下方）。
    const branchA = nodes.find((n: any) => n.label === "分支A") as any;
    const branchB = nodes.find((n: any) => n.label === "分支B") as any;
    // 位置写回（`applyModel`）走 fabric 的 `node.animate()`（150ms 过渡动画），
    // 不是同步 set——`waitFor` 轮询到最终稳定值，不是读一次刚触发动画时的
    // 过渡中间值（那会读到还没动完的旧坐标，跟这里要验的排序 bug 无关）。
    await waitFor(() => expect(newNode.center().y).toBeGreaterThan(branchA.center().y));
    await waitFor(() => expect(newNode.center().y).toBeGreaterThan(branchB.center().y));

    // 同一件事的另一个独立证据（不依赖 layoutMindmap 的具体几何公式，只看
    // extractModel 产出的边顺序本身）：root 的新连边必须排在 root 已有的两条
    // 连边（root→A、root→B）之后，不是之前——这正是 layoutMindmap 用来分配
    // leafIndex 的那份顺序。
    const { extractModel } = await import("@repo/fabric-markdown");
    const model = extractModel(canvas);
    const rootChildEdgeIndices = model.edges
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.source === root.nodeId)
      .map(({ i }) => i);
    const newEdgeIndex = rootChildEdgeIndices.at(-1);
    expect(newEdgeIndex).toBeDefined();
    const priorEdgeIndices = rootChildEdgeIndices.slice(0, -1);
    expect(priorEdgeIndices.every((i) => i < (newEdgeIndex as number))).toBe(true);
  });

  it("mindmap：给同一个父节点连续 Tab 两次，第二个子节点排在第一个下方（追加，不是插到最前）", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={MINDMAP_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    // root 已有两个子节点（A、B）。选中 root 后连按两次 Tab，各加一个子节点——
    // 两次新增的子节点必须按加入顺序自上而下排列，不能都挤到 A/B 上方。
    selectNodeByLabel(canvas, "根主题");
    dispatchKey("Tab");
    await waitFor(() => expect(canvas.getObjects().some((o: any) => o.label === "新节点")).toBe(true));
    const first = canvas.getObjects().find((o: any) => o.label === "新节点") as any;
    // 重新选中 root（Tab 后活动对象已经切到新节点），再加第二个。
    selectNodeByLabel(canvas, "根主题");
    dispatchKey("Tab");
    await waitFor(() => expect(canvas.getObjects().filter((o: any) => o.label === "新节点").length).toBe(2));
    const both = canvas.getObjects().filter((o: any) => o.label === "新节点") as any[];
    const second = both.find((n) => n !== first)!;

    const branchB = canvas.getObjects().find((o: any) => o.label === "分支B") as any;
    // 位置写回走 `node.animate()`（150ms 过渡），`waitFor` 轮询到最终稳定值
    // （同上一条测试的理由）。
    // 两个新子节点都应该排在既有子节点 A/B 下方……
    await waitFor(() => expect(first.center().y).toBeGreaterThan(branchB.center().y));
    await waitFor(() => expect(second.center().y).toBeGreaterThan(branchB.center().y));
    // ……且第二个必须在第一个下方（按加入顺序追加，不是每次都插到最前）。
    await waitFor(() => expect(second.center().y).toBeGreaterThan(first.center().y));
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

  it("非 mindmap（flowchart）：选中节点后 Tab/Enter 无副作用（不是 mindmap 树操作）", async () => {
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

    expect(canvas.getObjects().length).toBe(beforeCount);
    expect(canvas.getObjects().map((o: any) => o.label).filter(Boolean).sort()).toEqual(beforeLabels);
  });

  it("非 mindmap（flowchart）：选中节点后 Delete 真的删掉它——与「删除」工具同一条路径", async () => {
    render(
      <CanvasStage readOnly={false} tool="select" zoom={1} markdown={FLOWCHART_MARKDOWN} onMarkdownChange={onMarkdownChange} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    const canvas = getFabricCanvas();
    await waitFor(() => expect(canvas.getObjects().length).toBeGreaterThan(0));

    const beforeCount = canvas.getObjects().length;

    selectNodeByLabel(canvas, "节点X");
    dispatchKey("Delete");

    expect(canvas.getObjects().length).toBeLessThan(beforeCount);
    expect(canvas.getObjects().map((o: any) => o.label).filter(Boolean)).not.toContain("节点X");
    // 删除必须真的走 syncFromCanvas 回写——不是只改了画布对象、没告诉父组件。
    expect(onMarkdownChange).toHaveBeenCalled();
  });
});
