/**
 * issue #1980 —— chat 附件预览弹窗新增 pptx（slides）内联渲染分支。
 *
 * 渲染库 `pptx-preview` 依赖真实 Canvas/DOM 布局，在 jsdom 下不可靠，这里 `vi.mock` 掉库
 * 本身（成功/失败两条分支各测一次），不验证库内部渲染像素——只验证组件在拿到
 * 「渲染器返回结果」/「渲染器抛错」两种情况下走对了 UI 分支。image/pdf/unsupported 三个
 * 既有分支一并保留基本回归，避免这次改动破坏原有行为。
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
    pptxInitMock.mockReturnValue({ preview: pptxPreviewMock.mockResolvedValue(undefined), destroy: vi.fn() });

    render(
      <ChatAttachmentPreviewModal threadId="thread-1" attachment={makeAttachment()} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(pptxInitMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("chat-attachment-preview-slides")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-attachment-preview-unsupported")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-attachment-preview-slides-failed")).not.toBeInTheDocument();
    await waitFor(() => expect(pptxPreviewMock).toHaveBeenCalledWith(expect.any(ArrayBuffer)));
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
