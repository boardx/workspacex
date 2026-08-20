/**
 * 回归测试（人类实测反馈，2026-08-21）：
 *
 * 「最大化」编辑一张 mermaid 图 / 工作坊画布模板，点「保存」（真实落库或本地演示皆算），
 * 再关闭全屏 —— 气泡里那张只读预览小图应该跟着变，不该原地不动。
 *
 * 根因：`ChatDiagramFabric`/`ChatCanvasFabric` 的只读预览渲染此前恒读原始消息 prop
 * `code`，从不看 `savedSource`；`onClose` 也是 `() => void`，不带任何编辑结果——modal
 * 关闭时编辑内容随 unmount 一起丢弃，没有任何回传路径。两个组件是同一套代码结构复制出
 * 来的，同一个 bug 各自独立发生一次。
 *
 * 修法：`onClose(result?: { markdown })` 在「点过保存」时把最新源带回去；调用方把它写进
 * `savedSource`，只读预览改用 `savedSource?.markdown ?? code`（`previewCode`）驱动。
 * 这里不测真实 fabric 像素（jsdom 建不出，既有测试头注已写明），只验证：只读预览这条
 * 校验/渲染链路，关闭全屏后确实吃到了编辑后的内容，而不是原始 `code`——用 mermaid.parse /
 * checkCanvasFence 这两个纯函数闸门的调用参数做直接证据。
 *
 * 个人线程（本文件两条用例都不传 threadId/messageId/bearer/projectId）是人类实测报告
 * 复现的确切场景——「保存」只会走本地演示分支（不会真的调 landAsArtifact），但即使
 * 是本地演示，关闭全屏后气泡预览也应该反映这次编辑，不是「点了保存却什么都没变」。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/components/canvas/canvas-stage", () => ({
  CanvasStage: (props: { markdown: string; onMarkdownChange: (next: string) => void }) => (
    <div>
      <pre data-testid="canvas-stage-probe">{props.markdown}</pre>
      {/* 探针按钮的 onClick 直接闭包捕获调用方传来的新 markdown 字面量（下面每条用例各自
          传一个 data-next-markdown 属性充当"这次要吐给 onMarkdownChange 的内容"）。 */}
      <button
        type="button"
        data-testid="canvas-stage-probe-edit"
        onClick={(e) => props.onMarkdownChange(e.currentTarget.dataset.nextMarkdown ?? "")}
      />
    </div>
  ),
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

// 只读预览重新建 fabric 画布这一步（`markdownToCanvas`/`fitToContent`）在 jsdom 里
// 真的执行会撞上既有已知问题：编辑后 `previewCode` 变了 → 阶段二 effect 清理旧
// FabricCanvas（`dispose()`）再建一个新的，这个「同一个 <canvas> DOM 节点上先拆后建」
// 的时序在 jsdom（不是真浏览器）下会抛 `NotFoundError: removeChild ... not a child`
// ——与本文件要验的「previewCode 有没有正确更新」无关（那是 checkCanvasFence /
// mermaid.parse 这两道纯函数闸门的入参，在此之前就已经能验证到），保留其余真实逻辑
// （`parseTemplateText`/`extractMermaidBlocks`/`wrapAsMermaidBlock` 等），只把这两个
// 真正会碰 DOM 的函数换成空实现。
vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return { ...actual, markdownToCanvas: vi.fn().mockResolvedValue({ model: null }), fitToContent: vi.fn() };
});

// 同上一条注释：`new FabricCanvas(el, …)` 本身就会在 el 外面包一层 fabric 自建的
// DOM 节点，`dispose()` 时拆掉——这层 DOM 管理是 fabric 在真浏览器里才稳的行为，
// jsdom 撞的正是这个（不是 markdownToCanvas 的问题，光把它换成空实现还是会崩，
// 实测确认过）。只读预览这条读的是「构造/清理时序」，不是「fabric 画了什么」，
// 所以这里换一个不碰真实 DOM 的最小 stub，其余（`util`/`Point` 等）保持真实导出。
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

function clickEditProbe(nextMarkdown: string) {
  const btn = screen.getByTestId("canvas-stage-probe-edit");
  btn.setAttribute("data-next-markdown", nextMarkdown);
  fireEvent.click(btn);
}

describe("退出全屏后，气泡只读预览要跟着最后一次保存变（不是原地不动）", () => {
  beforeEach(() => {
    mermaidParse.mockClear();
    checkCanvasFence.mockClear();
  });

  describe("mermaid 图 · ChatDiagramFabric", () => {
    it("最大化→改内容→保存（本地演示）→关闭 —— 只读预览重新校验时吃到的是编辑后的内容", async () => {
      const { ChatDiagramFabric } = await import("@/components/chat/chat-diagram-fabric");
      const ORIGINAL = "flowchart TD\n  A --> B";
      const EDITED_FENCED = "```mermaid\nflowchart TD\n  A --> B\n  B --> C[新增节点]\n```";
      const EDITED_BODY = "flowchart TD\n  A --> B\n  B --> C[新增节点]";

      render(<ChatDiagramFabric code={ORIGINAL} />);
      await waitFor(() => expect(screen.getByTestId("chat-diagram-fabric")).toBeInTheDocument());
      expect(mermaidParse).toHaveBeenLastCalledWith(ORIGINAL);

      fireEvent.click(screen.getByTestId("chat-diagram-maximize"));
      await waitFor(() => expect(screen.getByTestId("chat-diagram-canvas-modal")).toBeInTheDocument());

      clickEditProbe(EDITED_FENCED);

      // 无 threadId/messageId/bearer：canPersist=false，「保存」走本地演示分支，同步生效。
      fireEvent.click(screen.getByTestId("chat-diagram-save"));
      await waitFor(() => expect(screen.getByTestId("chat-diagram-saved")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("chat-diagram-close"));
      await waitFor(() => expect(screen.queryByTestId("chat-diagram-canvas-modal")).toBeNull());

      // 关键断言：关闭后只读预览重新校验，用的是编辑后的内容，不是原始 `code`。
      await waitFor(() => expect(mermaidParse).toHaveBeenLastCalledWith(EDITED_BODY));
    });

    it("最大化后不点保存直接关闭 —— 只读预览保持原样，不把未保存的编辑当成已保存", async () => {
      const { ChatDiagramFabric } = await import("@/components/chat/chat-diagram-fabric");
      const ORIGINAL = "flowchart TD\n  A --> B";

      render(<ChatDiagramFabric code={ORIGINAL} />);
      await waitFor(() => expect(screen.getByTestId("chat-diagram-fabric")).toBeInTheDocument());
      mermaidParse.mockClear();

      fireEvent.click(screen.getByTestId("chat-diagram-maximize"));
      await waitFor(() => expect(screen.getByTestId("chat-diagram-canvas-modal")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("chat-diagram-close"));
      await waitFor(() => expect(screen.queryByTestId("chat-diagram-canvas-modal")).toBeNull());

      // 没点过「保存」：只读预览不应该重新触发校验（`previewCode` 没变，effect 不重跑）。
      expect(mermaidParse).not.toHaveBeenCalled();
    });
  });

  describe("工作坊画布模板 · ChatCanvasFabric", () => {
    it("最大化→改内容→保存（本地演示）→关闭 —— 只读预览重新校验时吃到的是编辑后的内容", async () => {
      const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
      const ORIGINAL_BODY = ["模板: persona", "姓名: 林可", "## 用户描述", "- 项目型采购"].join("\n");
      // 用 ```canvas 围栏（跟 ORIGINAL_BODY 同一种「模板: xxx」写法），匹配组件 prop
      // `lang="canvas"`——```persona 围栏隐含 key、不需要「模板:」行，混用会让
      // checkCanvasFence 在 lang="canvas" 下判「缺少模板行」，那是测试数据没对齐，
      // 不是本条要验的东西。
      const EDITED_FENCED = ["```canvas", "模板: persona", "姓名: 新用户", "## 用户描述", "- 编辑后的新内容", "```"].join("\n");
      const EDITED_BODY = ["模板: persona", "姓名: 新用户", "## 用户描述", "- 编辑后的新内容"].join("\n");

      render(<ChatCanvasFabric code={ORIGINAL_BODY} lang="canvas" />);
      await waitFor(() =>
        expect(screen.getByTestId("chat-canvas-fabric").getAttribute("data-template-source")).toBe("builtin"),
      );
      expect(checkCanvasFence).toHaveBeenLastCalledWith(ORIGINAL_BODY, "canvas");

      fireEvent.click(screen.getByTestId("chat-canvas-maximize"));
      await waitFor(() => expect(screen.getByTestId("chat-canvas-modal")).toBeInTheDocument());

      clickEditProbe(EDITED_FENCED);

      fireEvent.click(screen.getByTestId("chat-canvas-save"));
      await waitFor(() => expect(screen.getByTestId("chat-canvas-saved")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("chat-canvas-close"));
      await waitFor(() => expect(screen.queryByTestId("chat-canvas-modal")).toBeNull());

      // 关键断言：关闭后只读预览重新校验，用的是编辑后的正文，不是原始 `code`。
      await waitFor(() => expect(checkCanvasFence).toHaveBeenLastCalledWith(EDITED_BODY, "canvas"));
    });
  });
});
