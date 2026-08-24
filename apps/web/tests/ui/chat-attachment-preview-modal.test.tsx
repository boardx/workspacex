/**
 * issue #1980 —— chat 附件预览弹窗新增 pptx（slides）内联渲染分支。
 *
 * 渲染库 `pptx-preview` 依赖真实 Canvas/DOM 布局，在 jsdom 下不可靠，这里 `vi.mock` 掉库
 * 本身（成功/失败两条分支各测一次），不验证库内部渲染像素——只验证组件在拿到
 * 「渲染器返回结果」/「渲染器抛错」两种情况下走对了 UI 分支。image/pdf/unsupported 三个
 * 既有分支一并保留基本回归，避免这次改动破坏原有行为。
 *
 * 2026-08-24 黑屏回归修复后新增：`init` 的 mock 现在会真的往 container 里塞一份
 * `.pptx-preview-wrapper > .pptx-preview-slide-wrapper` 骨架（`renderRealisticDom`），
 * 让组件内的渲染后体检（`sanityCheckAndPatchRender`）能在 jsdom 下走到「有内容」分支——
 * 否则体检会把「mock 只是 resolve 了一个 undefined、DOM 里什么都没有」误判成
 * 「库不抛错但没渲染出东西」，把这两个既有的成功态用例也判成 failed。
 * 新增的「resolve 但 DOM 空」用例专门验证体检本身真的生效（这正是本次黑屏 bug 的回归测试）。
 */
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatAttachmentPreviewModal } from "@/components/chat/chat-attachment-preview-modal";
import type { ChatAttachment } from "@/lib/live-chat";

const useAuthedImageSrcMock = vi.fn();
vi.mock("@/lib/use-authed-image-src", () => ({
  useAuthedImageSrc: (url: string | null) => useAuthedImageSrcMock(url),
}));

/** 往真实 container 里插入一份最小骨架，模拟库真实渲染出至少一张幻灯片的情况。 */
function renderRealisticDom(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "pptx-preview-wrapper";
  wrapper.style.setProperty("background", "#000");
  const slide = document.createElement("div");
  slide.className = "pptx-preview-slide-wrapper pptx-preview-slide-wrapper-0";
  wrapper.appendChild(slide);
  container.appendChild(wrapper);
}

const pptxPreviewMock = vi.fn();
const pptxInitMock = vi.fn();
vi.mock("pptx-preview", () => ({
  init: (...args: unknown[]) => pptxInitMock(...args),
}));

function makeAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: "att-1",
    filename: "季度汇报.pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: 4096,
    createdAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("ChatAttachmentPreviewModal", () => {
  beforeEach(() => {
    useAuthedImageSrcMock.mockReset();
    pptxPreviewMock.mockReset();
    pptxInitMock.mockReset();
    // 组件内部 `fetch(src)` 读的是本地 blob URL，不是真实网络请求——这里桩一个够用的响应。
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
  });

  it("pptx 渲染成功时走 slides 内联分支，不落回「不支持预览」", async () => {
    useAuthedImageSrcMock.mockReturnValue({ src: "blob:mock-pptx", failed: false });
    let container: HTMLElement | null = null;
    pptxInitMock.mockImplementation((el: HTMLElement) => {
      container = el;
      return { preview: pptxPreviewMock, destroy: vi.fn() };
    });
    pptxPreviewMock.mockImplementation(async () => {
      if (container) renderRealisticDom(container);
    });

    render(
      <ChatAttachmentPreviewModal threadId="thread-1" attachment={makeAttachment()} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(pptxInitMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-preview-slides-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("chat-attachment-preview-slides")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-attachment-preview-unsupported")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-attachment-preview-slides-failed")).not.toBeInTheDocument();
    await waitFor(() => expect(pptxPreviewMock).toHaveBeenCalledWith(expect.any(ArrayBuffer)));
    // 黑屏根因防线 c：wrapper 的裸黑背景应该已经被体检补丁改写成中性 token，不再是 #000。
    const wrapperEl = screen.getByTestId("chat-attachment-preview-slides").querySelector(".pptx-preview-wrapper") as HTMLElement;
    expect(wrapperEl.style.background).not.toBe("rgb(0, 0, 0)");
  });

  it("pptx 渲染库抛错时显示「预览渲染失败」而不是「不支持预览」", async () => {
    useAuthedImageSrcMock.mockReturnValue({ src: "blob:mock-pptx-bad", failed: false });
    pptxInitMock.mockReturnValue({
      preview: vi.fn().mockRejectedValue(new Error("corrupt_pptx")),
      destroy: vi.fn(),
    });

    render(
      <ChatAttachmentPreviewModal threadId="thread-1" attachment={makeAttachment()} onClose={vi.fn()} />,
    );

    const failedNode = await screen.findByTestId("chat-attachment-preview-slides-failed");
    expect(failedNode).toHaveTextContent("预览渲染失败，请下载查看。");
    expect(screen.queryByTestId("chat-attachment-preview-unsupported")).not.toBeInTheDocument();
  });

  it("2026-08-24 黑屏回归：pptx-preview 不抛错但没真的渲染出任何幻灯片时，也判定为失败（不留一块裸黑）", async () => {
    // 这是本次黑屏 bug 的真实机制：库内部某个分支没抛出会冒泡的异常，`preview()`
    // 照样 resolve，但 container 里从未被真的 append 出 `.pptx-preview-slide-wrapper`。
    useAuthedImageSrcMock.mockReturnValue({ src: "blob:mock-pptx-empty", failed: false });
    pptxInitMock.mockReturnValue({ preview: pptxPreviewMock.mockResolvedValue(undefined), destroy: vi.fn() });

    render(
      <ChatAttachmentPreviewModal threadId="thread-1" attachment={makeAttachment()} onClose={vi.fn()} />,
    );

    const failedNode = await screen.findByTestId("chat-attachment-preview-slides-failed");
    expect(failedNode).toHaveTextContent("预览渲染失败，请下载查看。");
    // 关键：不能残留一个空的、可能裸黑的 slides 容器给用户看。
    expect(screen.queryByTestId("chat-attachment-preview-slides")).not.toBeInTheDocument();
  });

  it("image 分支仍然内联渲染 <img>（既有行为回归）", async () => {
    useAuthedImageSrcMock.mockReturnValue({ src: "blob:mock-image", failed: false });

    render(
      <ChatAttachmentPreviewModal
        threadId="thread-1"
        attachment={makeAttachment({ filename: "截图.png", mime: "image/png" })}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("chat-attachment-preview-image")).toBeInTheDocument();
    expect(pptxInitMock).not.toHaveBeenCalled();
  });

  it("docx 等没有渲染器的类型仍然落到「不支持预览」（既有行为回归）", async () => {
    useAuthedImageSrcMock.mockReturnValue({ src: "blob:mock-docx", failed: false });

    render(
      <ChatAttachmentPreviewModal
        threadId="thread-1"
        attachment={makeAttachment({
          filename: "备忘录.docx",
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("chat-attachment-preview-unsupported")).toHaveTextContent(
      "该文件类型不支持预览，请下载查看。",
    );
    expect(pptxInitMock).not.toHaveBeenCalled();
  });
});
