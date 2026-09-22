// @vitest-environment jsdom
/**
 * issue #3642 · 几何漂移信号（`lib/canvas/layout-drift.ts`）的纯逻辑钉死。
 *
 * 这是「挪了框保存显示成功、刷新回原位」这条缺陷的**根信号**：markdown 里没有坐标，
 * 只挪位置时它逐字不变，上层唯一能看出用户改过东西的途径就是几何对比。
 * 这里覆盖判据本身（挪了要报、没挪不报、增删节点不算几何改动）；
 * 「界面据此不再假报成功」由 `chat-diagram-layout-honesty.test.tsx` 覆盖。
 */
import { describe, expect, it } from "vitest";
import { StaticCanvas, type Canvas } from "fabric";
import { extractModel, renderToCanvas, FlowNode, type DiagramModel } from "@repo/fabric-markdown";
import { movedNodeIds, snapshotGeometry } from "@/lib/canvas/layout-drift";

/** issue #3642 复现用的组织结构图（张三 CTO 下辖李四/王五，赵六直接汇报）。 */
function orgChart(): DiagramModel {
  return {
    kind: "flowchart",
    direction: "TB",
    nodes: [
      { id: "A", label: "张三（CTO）", shape: "rect", x: 559, y: 451, width: 160, height: 44 },
      { id: "B", label: "李四（前端组组长）", shape: "rect", x: 380, y: 555, width: 180, height: 44 },
      { id: "C", label: "王五（后端组组长）", shape: "rect", x: 559, y: 555, width: 180, height: 44 },
      { id: "D", label: "赵六（产品负责人）", shape: "rect", x: 740, y: 555, width: 180, height: 44 },
    ],
    edges: [
      { id: "e0", source: "A", target: "B", kind: "arrow" },
      { id: "e1", source: "A", target: "C", kind: "arrow" },
      { id: "e2", source: "A", target: "D", kind: "arrow" },
    ],
  };
}

describe("issue #3642 · movedNodeIds", () => {
  it("没动过 ⇒ 空", () => {
    const before = snapshotGeometry(orgChart());
    expect(movedNodeIds(before, snapshotGeometry(orgChart()))).toEqual([]);
  });

  it("issue 里实测的两次拖动都被报出来（张三 (559,451)→(700,390)、王五 (559,555)→(559,700)）", () => {
    const before = snapshotGeometry(orgChart());
    const after = orgChart();
    after.nodes[0]!.x = 700;
    after.nodes[0]!.y = 390;
    after.nodes[2]!.y = 700;
    expect(movedNodeIds(before, snapshotGeometry(after))).toEqual(["A", "C"]);
  });

  it("改尺寸也算几何改动（同样写不进 mermaid 源）", () => {
    const before = snapshotGeometry(orgChart());
    const after = orgChart();
    after.nodes[1]!.width = 320;
    expect(movedNodeIds(before, snapshotGeometry(after))).toEqual(["B"]);
  });

  it("亚像素噪声（<1px）不算挪动——不然提示条会无缘无故常驻", () => {
    const before = snapshotGeometry(orgChart());
    const after = orgChart();
    after.nodes[0]!.x += 0.4;
    after.nodes[0]!.y -= 0.3;
    expect(movedNodeIds(before, snapshotGeometry(after))).toEqual([]);
  });

  it("只改标签（结构改动，能真正保存）⇒ 不报几何改动", () => {
    const before = snapshotGeometry(orgChart());
    const after = orgChart();
    after.nodes[3]!.label = "赵六（产品总监）";
    expect(movedNodeIds(before, snapshotGeometry(after))).toEqual([]);
  });

  it("删除节点 ⇒ 不报几何改动：删除写得进 mermaid 源，能真正保存（issue 里实测 ✅ 的那一栏）", () => {
    const before = snapshotGeometry(orgChart());
    const after = orgChart();
    after.nodes = after.nodes.filter((n) => n.id !== "D");
    expect(movedNodeIds(before, snapshotGeometry(after))).toEqual([]);
  });

  it("新增节点 ⇒ 不报几何改动：新节点随结构一起保存，不构成「保存了等于没存」", () => {
    const before = snapshotGeometry(orgChart());
    const after = orgChart();
    after.nodes.push({ id: "E", label: "新人", shape: "rect", x: 900, y: 700, width: 120, height: 44 });
    expect(movedNodeIds(before, snapshotGeometry(after))).toEqual([]);
  });
});

/**
 * 基线必须从**画布**取，不能从 `markdownToCanvas` 回传的 model 取。
 *
 * `renderToCanvas` 会把 mermaid 算出来的布局整体平移到画布边距
 * （`margin - min`），这个平移量只作用在建出来的 fabric 对象上、**不回写那份
 * model**。拿 model 当基线，等于把整张图的平移量算成「用户挪了每一个节点」——
 * 一打开就满屏误报"位置存不了"，提示条会立刻失去可信度。
 *
 * 这条用真实 fabric 画布跑（`StaticCanvas` + jsdom，同
 * `apps/api/tests/canvas/*.test.ts` 的跑法），因为要反证的正是渲染那一步做的事。
 */
describe("issue #3642 · 几何基线取自画布而非解析出的 model", () => {
  it("刚渲染完、用户什么都没动 ⇒ 不报任何漂移", () => {
    const canvas = new StaticCanvas(undefined, { width: 1200, height: 800 }) as unknown as Canvas;
    renderToCanvas(orgChart(), canvas);

    const baseline = snapshotGeometry(extractModel(canvas));
    expect(movedNodeIds(baseline, snapshotGeometry(extractModel(canvas)))).toEqual([]);
  });

  it("解析出的 model 与渲染后的画布坐标确实不同（正是不能拿它当基线的原因）", () => {
    const model = orgChart();
    const canvas = new StaticCanvas(undefined, { width: 1200, height: 800 }) as unknown as Canvas;
    renderToCanvas(model, canvas);

    // 平移量不为零 ⇒ 若拿 model 当基线，四个节点会被全部误报成"挪过"。
    expect(movedNodeIds(snapshotGeometry(model), snapshotGeometry(extractModel(canvas))))
      .toEqual(["A", "B", "C", "D"]);
  });

  it("真在画布上拖一个节点 ⇒ 只报那一个", () => {
    const canvas = new StaticCanvas(undefined, { width: 1200, height: 800 }) as unknown as Canvas;
    renderToCanvas(orgChart(), canvas);
    const baseline = snapshotGeometry(extractModel(canvas));

    const node = canvas.getObjects().find((o) => o instanceof FlowNode && o.nodeId === "C") as FlowNode;
    node.set({ left: node.left + 141, top: node.top - 61 });

    expect(movedNodeIds(baseline, snapshotGeometry(extractModel(canvas)))).toEqual(["C"]);
  });
});
