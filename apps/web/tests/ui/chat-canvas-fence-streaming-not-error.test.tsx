/**
 * 回归测试（issue #2298，真实截图证据）：
 *
 * `pnpm run shots:chat-main` 在个人对话屏抓到——用户发「对话保真取证：请回显这句话」，
 * 产品在流式尚未结束（同一条消息「正在生成…」chip 仍在显示）时，就把半截 ```canvas
 * 围栏渲成了终态红色报错卡：「围栏格式有误：模板「ch」的围栏里没有任何「## 分区」
 * 标题」——`模板「ch」` 正是模板 key `chat-read-e2e-canvas` 流到第二个字符时的截断值。
 *
 * 根因：`checkCanvasFence` 把「围栏还没写完」（`extractMermaidBlocks` 对未闭合围栏返回
 * 「到文档结尾为止」的半截 `code`）与「围栏写完了但格式真的错」当成同一件事，逐 token
 * 流式过程中必然经历的中间态（没有模板 key / 有 key 但没有分区标题）被一律判成终态错误。
 *
 * 修法验证：
 * 1. `closed={false}`（围栏尚未闭合）时，即使当前半截内容不合法，也不应该出现
 *    `chat-canvas-error`，应该停在加载态（`chat-canvas-loading`）。
 * 2. 围栏闭合（`closed={true}`）之后，若内容确实合法，应该正常转成 `valid`。
 * 3. 围栏闭合之后，若内容确实不合法，报错逻辑必须原样保留——不能把报错功能一起删掉。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

// 只读预览建 fabric 画布这一步在 jsdom 下真的执行会撞已知的 DOM 时序问题，与本文件要验
// 的「流式中间态该不该报错」无关（同 `chat-fabric-preview-syncs-after-save.test.tsx`
// 头部注释，同款处理）。
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

describe("ChatCanvasFabric：围栏未闭合的流式中间态不应报终态错误（issue #2298）", () => {
  it("closed=false 时，半截内容（连模板 key 都没写完）保持加载态，不出现 chat-canvas-error", async () => {
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    // 复刻截图现场：模板 key 只流到「ch」，还没有任何「## 分区」标题。
    render(<ChatCanvasFabric code={"模板: ch"} lang="canvas" closed={false} />);

    // 给校验 effect 一个 tick 的机会——如果它没有被正确跳过，这里会转成 error。
    await waitFor(() => expect(screen.getByTestId("chat-canvas-loading")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
  });

  it("closed=false 时，哪怕半截内容看起来完全不像模板（无「模板:」行），依然不报错", async () => {
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    render(<ChatCanvasFabric code={""} lang="canvas" closed={false} />);

    await waitFor(() => expect(screen.getByTestId("chat-canvas-loading")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
  });

  it("closed=true 且内容合法——正常渲染为 valid（不受本次改动影响）", async () => {
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    const VALID = ["模板: persona", "姓名: 林可", "## 用户描述", "- 项目型采购"].join("\n");
    render(<ChatCanvasFabric code={VALID} lang="canvas" closed />);

    await waitFor(() =>
      expect(screen.getByTestId("chat-canvas-fabric").getAttribute("data-template-source")).toBe("builtin"),
    );
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
  });

  it("closed=true 且围栏真的写完了但格式有误——报错逻辑原样保留，不能被一起删掉", async () => {
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    // 围栏已闭合（closed=true），但内容确实没有任何「## 分区」标题——这是真实的格式错误，
    // 不是流式中间态，必须继续报错。
    render(<ChatCanvasFabric code={"模板: chat-read-e2e-canvas"} lang="canvas" closed />);

    await waitFor(() => expect(screen.getByTestId("chat-canvas-error")).toBeInTheDocument());
    expect(screen.getByTestId("chat-canvas-error").textContent).toContain("围栏格式有误");
  });

  it("默认值（不传 closed）保持改动前行为——立即校验、格式错误立即报错", async () => {
    const { ChatCanvasFabric } = await import("@/components/chat/chat-canvas-fabric");
    render(<ChatCanvasFabric code={"模板: chat-read-e2e-canvas"} lang="canvas" />);

    await waitFor(() => expect(screen.getByTestId("chat-canvas-error")).toBeInTheDocument());
  });
});
