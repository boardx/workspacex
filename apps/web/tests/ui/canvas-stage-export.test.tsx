/**
 * 画布导出（人类要求："要可以下载，画布在前端要有 pdf，png 的导出"）。
 *
 * ① `CanvasStage.exportPNG()`（通过 ref 暴露的命令式方法）——真实 fabric.Canvas
 *    集成测试（同 `canvas-stage-edge-editability.test.tsx` 同款手法：markdownToCanvas
 *    换成同一个包导出的真实 `renderToCanvas`，跳过内部会走 `mermaid.render()` 的
 *    text→model 那一跳，`CanvasStage` 本身/fabric 状态全部真实，不是浅层 mock）：
 *    空画布返回 null，非空画布返回真实 PNG data URL + 像素尺寸。
 * ② `ChatDiagramCanvasModal`/`ChatCanvasModal` 的「导出 PNG」「导出 PDF」按钮真的
 *    调用了导出/下载工具函数（`downloadDataUrl`/`exportPngAsPdf` mock 掉，这里验证
 *    的是"接线对不对"，不是重新测 jsPDF 库本身怎么生成字节）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Canvas as FabricCanvasType } from "fabric";
import type { DiagramModel } from "@repo/fabric-markdown";

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

const FLOWCHART_MARKDOWN = "```mermaid\nflowchart TD\n  X --> Y\n```";
const EMPTY_MARKDOWN = "```mermaid\nflowchart TD\n```";

vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return {
    ...actual,
    markdownToCanvas: async (markdown: string, canvas: FabricCanvasType) => {
      const model: DiagramModel =
        markdown === EMPTY_MARKDOWN
          ? { kind: "flowchart", direction: "TD", nodes: [], edges: [] }
          : flowchartModel();
      actual.renderToCanvas(model, canvas);
      return { model, block: { code: markdown, lang: "mermaid", start: 0, end: markdown.length, fence: "```" } };
    },
  };
});

const { downloadDataUrl, exportPngAsPdf } = vi.hoisted(() => ({
  downloadDataUrl: vi.fn(),
  exportPngAsPdf: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/canvas/export-image", () => ({ downloadDataUrl, exportPngAsPdf }));

import { CanvasStage, type CanvasStageHandle } from "@/components/canvas/canvas-stage";
import { ChatDiagramCanvasModal } from "@/components/chat/chat-diagram-canvas-modal";
import { ChatCanvasModal } from "@/components/chat/chat-canvas-modal";

describe("画布导出", () => {
  beforeEach(() => {
    downloadDataUrl.mockClear();
    exportPngAsPdf.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  describe("① CanvasStage.exportPNG()", () => {
    it("空画布返回 null，不产出一张空白 PNG 冒充导出成功", async () => {
      const stageRef = { current: null as CanvasStageHandle | null };
      render(
        <CanvasStage
          ref={(r) => { stageRef.current = r; }}
          readOnly={false}
          tool="select"
          zoom={1}
          markdown={EMPTY_MARKDOWN}
          onMarkdownChange={vi.fn()}
        />,
      );
      await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 10)); // 让 markdownToCanvas 的 Promise 落地
      expect(stageRef.current?.exportPNG()).toBeNull();
    });

    it("非空画布返回真实 PNG data URL 与像素尺寸", async () => {
      const stageRef = { current: null as CanvasStageHandle | null };
      render(
        <CanvasStage
          ref={(r) => { stageRef.current = r; }}
          readOnly={false}
          tool="select"
          zoom={1}
          markdown={FLOWCHART_MARKDOWN}
          onMarkdownChange={vi.fn()}
        />,
      );
      await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
      await waitFor(() => {
        const result = stageRef.current?.exportPNG();
        expect(result).not.toBeNull();
      });
      const result = stageRef.current!.exportPNG()!;
      expect(result.dataUrl.startsWith("data:image/png")).toBe(true);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });
  });

  describe("② 全屏编辑器的导出按钮", () => {
    it("mermaid 图编辑器：点「导出为 PNG」调用 downloadDataUrl，点「导出为 PDF」调用 exportPngAsPdf", async () => {
      render(<ChatDiagramCanvasModal code="flowchart TD\n  X --> Y" onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
      await waitFor(() => {
        // 等 fabric 真的渲出节点，导出才有内容可截——不然点导出按钮时 exportPNG() 仍是 null。
        expect(screen.queryByTestId("chat-diagram-export-error")).toBeNull();
      });

      fireEvent.click(screen.getByTestId("chat-diagram-export-png"));
      await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledTimes(1));
      expect(downloadDataUrl.mock.calls[0]![0]).toMatch(/^data:image\/png/);
      expect(downloadDataUrl.mock.calls[0]![1]).toMatch(/\.png$/);

      fireEvent.click(screen.getByTestId("chat-diagram-export-pdf"));
      await waitFor(() => expect(exportPngAsPdf).toHaveBeenCalledTimes(1));
      expect(exportPngAsPdf.mock.calls[0]![0]).toMatch(/^data:image\/png/);
      expect(exportPngAsPdf.mock.calls[0]![3]).toMatch(/\.pdf$/);
    });

    it("工作坊画布模板编辑器：同一套导出按钮存在且能触发", async () => {
      render(<ChatCanvasModal code={"模板: persona\n姓名: 林可\n## 用户描述\n- 项目型采购"} lang="canvas" onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByTestId("chat-canvas-export-png")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("chat-canvas-export-png"));
      await waitFor(() => expect(downloadDataUrl).toHaveBeenCalledTimes(1));
    });
  });
});
