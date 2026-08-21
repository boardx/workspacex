/**
 * design-delta chat-diagram-artifact-reference（issue #1668）的核心组件级钉死：
 *
 * 此前 G1 读回（`fetchLatestSavedDiagramSource`）只挂在「点最大化」这一个触发点上——
 * `savedSource` 在那之前恒为 `null`，只读小图（气泡里的预览）永远画消息原文 `code`。
 * 真机实测复现的现象（issue 原文）：编辑保存 → 关闭全屏 → **刷新页面** → 气泡预览
 * 回到编辑前的内容——因为刷新后组件重新挂载，用户这次没有再点一次「最大化」。
 *
 * 人类裁决（2026-08-21）：不回写消息 `text`，而是让只读预览也接上已经建好的引用
 * 解析——图表消息挂载滚入视口时就查一次该消息名下最新的落地版本，命中则预览直接画
 * 保存版，不必等用户点最大化。本文件验证：
 *
 * A. 有保存版：挂载即自动发起读回请求（不点任何按钮），只读预览校验链路吃到的是
 *    保存版内容，不是原始 `code`。
 * B. 无保存版 / 读回失败：挂载后仍然只发一次请求，预览保持原始 `code`（不因为
 *    `savedSource` 拿到 `null` 就无限重试）。
 * C. 缺 threadId/messageId/bearer 任一项（预览页/流式草稿）：不发任何读回请求，
 *    与今天完全一致。
 * D. mermaid 与工作坊画布模板两个组件（`ChatDiagramFabric`/`ChatCanvasFabric`）
 *    对称覆盖——issue 要求「两组文件一并同步修，避免只修一半」。
 */
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { listThreadArtifacts, getThreadArtifactSource } = vi.hoisted(() => ({
  listThreadArtifacts: vi.fn(),
  getThreadArtifactSource: vi.fn(),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listThreadArtifacts,
  getThreadArtifactSource,
}));

// `CanvasStage` 是 `React.forwardRef` 组件（导出画布截图的命令式句柄需要它）——
// 探针跟着换成 forwardRef，不然调用方传 `ref` 给它会撞 React 的 "Function
// components cannot be given refs" 警告（不影响这几条测试断言，纯粹是噪音）。
vi.mock("@/components/canvas/canvas-stage", () => ({
  CanvasStage: React.forwardRef(function CanvasStageProbe(props: { markdown: string }, _ref) {
    return <pre data-testid="canvas-stage-probe">{props.markdown}</pre>;
  }),
}));

const mermaidParse = vi.fn().mockResolvedValue(true);
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: (...args: unknown[]) => mermaidParse(...args),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));

const checkCanvasFence = vi.fn();
vi.mock("@/lib/canvas/canvas-fence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/canvas/canvas-fence")>();
  checkCanvasFence.mockImplementation(actual.checkCanvasFence);
  return { ...actual, checkCanvasFence };
});

// 同 `chat-fabric-preview-syncs-after-save.test.tsx` 的既有理由：只读预览重建
// FabricCanvas 这一步在 jsdom 下会撞 fabric 自建 DOM 包裹节点的拆装时序问题，
// 与本文件要验的「savedSource 有没有被自动查回来」无关，换成不碰真实 DOM 的桩。
vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return { ...actual, markdownToCanvas: vi.fn().mockResolvedValue({ model: null }), fitToContent: vi.fn() };
});
vi.mock("fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric")>();
  class StubCanvas {
    forEachObject(): void {}
    requestRenderAll(): void {}
    dispose(): void {}
  }
  return { ...actual, Canvas: StubCanvas };
});

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

const item = (over: Record<string, unknown>) => ({
  artifactId: "a-new", title: "t", mode: "draft", version: null,
  pinnedBy: null, pinnedAt: null, hasSource: false, messageId: "m-1", ...over,
});

describe("挂载滚入视口即读回（不必先点最大化）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mermaidParse.mockClear().mockResolvedValue(true);
  });

  describe("A · mermaid 图 · ChatDiagramFabric", () => {
    it("有保存版：挂载即自动查回，只读预览校验吃到的是保存版内容", async () => {
      listThreadArtifacts.mockResolvedValue({ items: [item({})] });
      getThreadArtifactSource.mockResolvedValue({
        markdown: "flowchart TD\n  a-->保存版新节点", version: null,
        savedAt: "2026-08-21T01:00:00.000Z", savedBy: "u1",
      });

      const { ChatDiagramFabric } = await import("@/components/chat/chat-diagram-fabric");
      render(
        <ChatDiagramFabric
          code={"flowchart TD\n  a-->b"}
          threadId="t" messageId="m-1" bearer="b" projectId="p"
        />,
      );

      // 关键断言：没有任何点击，读回请求自动发出，预览吃到保存版内容。
      await waitFor(() => expect(listThreadArtifacts).toHaveBeenCalledWith("t", "p", "b"));
      await waitFor(() => expect(getThreadArtifactSource).toHaveBeenCalledWith("t", "a-new", "p", "b"));
      await waitFor(() =>
        expect(mermaidParse).toHaveBeenLastCalledWith("flowchart TD\n  a-->保存版新节点"));

      // 只发一次（`savedSource` 拿到值后 effect 依赖不再触发第二轮）。
      expect(listThreadArtifacts).toHaveBeenCalledTimes(1);
    });

    it("无保存版：挂载查一次即可，预览保持原始消息内容，不重复发请求", async () => {
      listThreadArtifacts.mockResolvedValue({ items: [] });

      const { ChatDiagramFabric } = await import("@/components/chat/chat-diagram-fabric");
      render(
        <ChatDiagramFabric
          code={"flowchart TD\n  a-->b"}
          threadId="t" messageId="m-1" bearer="b" projectId="p"
        />,
      );

      await waitFor(() => expect(listThreadArtifacts).toHaveBeenCalledTimes(1));
      expect(getThreadArtifactSource).not.toHaveBeenCalled();
      await waitFor(() => expect(mermaidParse).toHaveBeenLastCalledWith("flowchart TD\n  a-->b"));

      // 给 effect 一轮 microtask 机会看它是否会因为 savedSource 仍是 null 而重复触发。
      await new Promise((r) => setTimeout(r, 0));
      expect(listThreadArtifacts).toHaveBeenCalledTimes(1);
    });

    it("threadId/messageId/bearer 任一缺失：不发读回请求（预览页/流式草稿，与今天一致）", async () => {
      const { ChatDiagramFabric } = await import("@/components/chat/chat-diagram-fabric");
      render(<ChatDiagramFabric code={"flowchart TD\n  a-->b"} />);

      await waitFor(() => expect(screen.getByTestId("chat-diagram-fabric")).toBeInTheDocument());
      expect(listThreadArtifacts).not.toHaveBeenCalled();
      expect(getThreadArtifactSource).not.toHaveBeenCalled();
    });
  });

  describe("D · 工作坊画布模板 · ChatCanvasFabric（对称覆盖）", () => {
    it("有保存版：挂载即自动查回，只读预览校验吃到的是保存版内容", async () => {
      listThreadArtifacts.mockResolvedValue({ items: [item({})] });
      const SAVED_BODY = ["模板: persona", "姓名: 保存版用户", "## 用户描述", "- 保存版内容"].join("\n");
      getThreadArtifactSource.mockResolvedValue({
        markdown: SAVED_BODY, version: null,
        savedAt: "2026-08-21T01:00:00.000Z", savedBy: "u1",
      });

      const ORIGINAL_BODY = ["模板: persona", "姓名: 林可", "## 用户描述", "- 项目型采购"].join("\n");
      const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
      render(
        <ChatCanvasFabric
          code={ORIGINAL_BODY} lang="canvas"
          threadId="t" messageId="m-1" bearer="b" projectId="p"
        />,
      );

      await waitFor(() => expect(listThreadArtifacts).toHaveBeenCalledWith("t", "p", "b"));
      await waitFor(() => expect(getThreadArtifactSource).toHaveBeenCalledWith("t", "a-new", "p", "b"));
      await waitFor(() => expect(checkCanvasFence).toHaveBeenLastCalledWith(SAVED_BODY, "canvas"));
    });
  });
});
