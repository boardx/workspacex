/**
 * `CanvasStage.fitToContent()` / `fitOnLoad`——「chat 模拟」结果预览默认展示全部内容
 * 的核心逻辑（`canvas-stage.tsx`，见 `CanvasStageHandle.fitToContent` 头注，人类原话
 * 「画布默认要可以看到整体的画布，不需要经过缩放」+「加一个：看到所有的内容的reset
 * 按钮」）。
 *
 * 同 `canvas-stage-export.test.tsx` 同款手法：`markdownToCanvas` 换成真实
 * `renderToCanvas`，跳过内部会走 `mermaid.render()` 的 text→model 那一跳，
 * `CanvasStage` 本身/fabric 状态全部真实，不是浅层 mock。
 *
 * ## 为什么两个节点隔开 700/500px、不是紧挨着、也不是隔得离谱远
 *
 * jsdom 不做真实布局，`container.getBoundingClientRect()` 恒返回 0，`canvas-stage.tsx`
 * 挂载 effect 因此把画布尺寸夹到 `Math.max(600, 0)=600` × `Math.max(400, 0)=400`——
 * 这是一个稳定、可预测的画布尺寸，不随测试环境窗口大小变化。内容隔开这么多之后，
 * 并集包围盒明显大于 600×400 的画布，`fitToContent` 算出来的缩放必须**明显小于
 * 100%**（否则内容会被裁掉一截）——但间距也没大到把这个比例砸穿 `ZOOM_MIN`（0.5）
 * 夹到下限，这样算出来的值落在开区间 `(ZOOM_MIN, 1)` 内，才同时证明「真的按内容
 * 算过」与「算出来的是内容决定的值，不是被下限夹死的常数」。如果只用挨得很近的
 * 小内容（此前 e2e 那条「先按适应画布回到100%……fit-content 也应该还是100%」的
 * 写法），无论 `fitOnLoad`/`fitToContent` 有没有真的跑，"100%"都会通过，是一条
 * 查不出问题的断言（PR review 已指出这一点）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Canvas as FabricCanvasType } from "fabric";
import type { DiagramModel } from "@repo/fabric-markdown";

function farApartModel(x: number, y: number): DiagramModel {
  return {
    kind: "flowchart",
    direction: "TD",
    nodes: [
      { id: "X", label: "节点X", shape: "rect", x: 0, y: 0, width: 120, height: 48 },
      { id: "Y", label: "节点Y", shape: "rect", x, y, width: 120, height: 48 },
    ],
    edges: [],
  };
}

const FAR_APART_MARKDOWN = "```mermaid\nflowchart TD\n  X --> Y\n```";
// 内容大到"按内容算出来的比例"本身就比 `ZOOM_MIN`（0.5）还小——用来验证
// `fitToContent` 不该把这个下限套在自己头上（见该函数实现改动的头注）。
const HUGE_MARKDOWN = "```mermaid\nflowchart TD\n  X ==huge==> Y\n```";

vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return {
    ...actual,
    markdownToCanvas: async (markdown: string, canvas: FabricCanvasType) => {
      const model = markdown === HUGE_MARKDOWN ? farApartModel(5000, 3000) : farApartModel(700, 500);
      actual.renderToCanvas(model, canvas);
      return { model, block: { code: markdown, lang: "mermaid", start: 0, end: markdown.length, fence: "```" } };
    },
  };
});

import { CanvasStage, type CanvasStageHandle } from "@/components/canvas/canvas-stage";
import { ZOOM_MIN } from "@/components/canvas/canvas-toolbar";

describe("CanvasStage.fitToContent / fitOnLoad", () => {
  afterEach(() => vi.clearAllMocks());

  it("fitOnLoad：内容渲染完自动缩到能装下整个并集包围盒，不停在初始的 100%", async () => {
    const stageRef = { current: null as CanvasStageHandle | null };
    const onZoomChange = vi.fn();
    render(
      <CanvasStage
        ref={(r) => { stageRef.current = r; }}
        readOnly={false}
        tool="select"
        zoom={1}
        onZoomChange={onZoomChange}
        markdown={FAR_APART_MARKDOWN}
        onMarkdownChange={vi.fn()}
        fitOnLoad
      />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());

    // fitOnLoad 跑在 markdownToCanvas 的 Promise resolve 之后——等 onZoomChange
    // 真的被叫过一次，而不是靠 setTimeout 猜时序。
    await waitFor(() => expect(onZoomChange).toHaveBeenCalled());
    const autoFitZoom = onZoomChange.mock.calls.at(-1)![0] as number;

    // 600×400 的画布装不下这份内容的并集包围盒（两节点隔开 700/500px + 自身尺寸 +
    // 64px 留白），必须缩小；但选的间距也没大到把比例砸穿 `ZOOM_MIN`（0.5）夹到
    // 下限——落在 (ZOOM_MIN, 1) 开区间内才能同时证明「真的算过」（不是停在 100%）
    // 与「算出来的是内容本身决定的值，不是被下限夹死的常数」。
    expect(autoFitZoom).toBeLessThan(1);
    expect(autoFitZoom).toBeGreaterThan(ZOOM_MIN);
  });

  it("fitToContent 是确定性的——手动把缩放拨到别的值后再调用，结果收敛回同一个 fitOnLoad 算出来的值（不是原地不动）", async () => {
    const stageRef = { current: null as CanvasStageHandle | null };
    const onZoomChange = vi.fn();
    const { rerender } = render(
      <CanvasStage
        ref={(r) => { stageRef.current = r; }}
        readOnly={false}
        tool="select"
        zoom={1}
        onZoomChange={onZoomChange}
        markdown={FAR_APART_MARKDOWN}
        onMarkdownChange={vi.fn()}
        fitOnLoad
      />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    await waitFor(() => expect(onZoomChange).toHaveBeenCalled());
    const autoFitZoom = onZoomChange.mock.calls.at(-1)![0] as number;
    onZoomChange.mockClear();

    // 手动把缩放拨到一个跟 autoFitZoom 明显不同的值（模拟用户滚轮缩放/平移打乱视图）
    // ——一个不改变 viewport 的 `fitToContent`（no-op）在这里会让下面的断言失败，
    // 因为读数会停在 2 而不是收敛回 autoFitZoom。
    const perturbedZoom = 2;
    expect(perturbedZoom).not.toBeCloseTo(autoFitZoom, 2);
    rerender(
      <CanvasStage
        ref={(r) => { stageRef.current = r; }}
        readOnly={false}
        tool="select"
        zoom={perturbedZoom}
        onZoomChange={onZoomChange}
        markdown={FAR_APART_MARKDOWN}
        onMarkdownChange={vi.fn()}
        fitOnLoad
      />,
    );

    // 「看到全部」reset 按钮调的就是这个方法——直接通过 ref 调用，同生产代码路径。
    stageRef.current!.fitToContent();
    await waitFor(() => expect(onZoomChange).toHaveBeenCalled());
    const resetZoom = onZoomChange.mock.calls.at(-1)![0] as number;
    expect(resetZoom).toBeCloseTo(autoFitZoom, 5);
  });

  /**
   * PR review 指出：`fitToContent` 原实现把结果夹到 `Math.max(ZOOM_MIN, ...)`，
   * 内容大到"按比例算出来该缩多少"本身就小于 `ZOOM_MIN`（0.5）时，夹到下限会让
   * 内容被裁掉一截——违反"看到所有内容"这个操作存在的唯一理由。`ZOOM_MIN` 是给
   * 用户手动缩小定的下限（那条路径缩太小确实没意义），不该被"看到全部"这个
   * 不同语义的操作借用同一个常数。
   */
  it("内容大到按比例算出来的缩放本该小于 ZOOM_MIN 时，真的会小于 ZOOM_MIN，不被夹到下限裁掉内容", async () => {
    const stageRef = { current: null as CanvasStageHandle | null };
    const onZoomChange = vi.fn();
    render(
      <CanvasStage
        ref={(r) => { stageRef.current = r; }}
        readOnly={false}
        tool="select"
        zoom={1}
        onZoomChange={onZoomChange}
        markdown={HUGE_MARKDOWN}
        onMarkdownChange={vi.fn()}
        fitOnLoad
      />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    await waitFor(() => expect(onZoomChange).toHaveBeenCalled());
    const autoFitZoom = onZoomChange.mock.calls.at(-1)![0] as number;

    // 600×400 的画布，节点隔开 5000/3000px + 自身尺寸 + 64px 留白——按比例算出来的
    // 缩放明显小于 0.5（真按内容算大约 0.1 左右），如果实现还在夹 `ZOOM_MIN`，
    // 这里会稳定拿到 0.5 而不是一个更小的数，断言会红。
    expect(autoFitZoom).toBeLessThan(ZOOM_MIN);
    expect(autoFitZoom).toBeGreaterThan(0);
  });

  it("没有 `fitOnLoad` 时（既有调用点，如正式编辑画布）——渲染完不会被自动缩放，行为不因为加了这个能力而被动改变", async () => {
    const stageRef = { current: null as CanvasStageHandle | null };
    const onZoomChange = vi.fn();
    render(
      <CanvasStage
        ref={(r) => { stageRef.current = r; }}
        readOnly={false}
        tool="select"
        zoom={1}
        onZoomChange={onZoomChange}
        markdown={FAR_APART_MARKDOWN}
        onMarkdownChange={vi.fn()}
        // 不传 fitOnLoad
      />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 20)); // 让 markdownToCanvas 的 Promise 落地
    expect(onZoomChange).not.toHaveBeenCalled();
  });
});
