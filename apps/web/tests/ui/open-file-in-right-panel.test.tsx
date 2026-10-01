/**
 * E4 —— **文件也能在右栏预览**（人类 2026-09-24 原话：「现在可以在 chat 右边预览文件吗」）。
 *
 * 当时的答案是：markdown 产物与文本结果可以，**上传的材料与生成的文件仍然只弹模态**。
 * 模态挡住对话，正是「对标 Claude Code」要消灭的那件事。
 *
 * 渲染本身早就齐了（image/pdf/pptx/text/不支持），只是焊死在模态里；这一轮把它抽成
 * `ChatAttachmentView`，右栏与模态共用同一份。这里钉的是**摆位与接线**，
 * 渲染判据本身在 `chat-attachment-preview-modal` 那几条既有用例里。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import {
  OPEN_FILE_IN_RIGHT_PANEL_EVENT, requestOpenFileInRightPanel,
} from "@/lib/chat-workbench/panel-document";

vi.mock("@/components/chat/workbench/agent-artifact-versions-panel", () => ({
  AgentArtifactVersionsPanel: () => null,
}));
/** 取字节走鉴权 fetch，这里只关心「摆在哪」，把取字节替身掉。 */
vi.mock("@/lib/use-authed-image-src", () => ({
  useAuthedImageSrc: () => ({ src: "blob:fake", failed: false }),
}));

function props(): ChatTaskInspectorProps {
  return {
    hasSelection: true, threadId: "t-1", artifacts: null, materials: null, loading: false,
    artifactsError: null, materialsError: null, onRetry: () => {}, pendingMaterialsCount: 0,
    planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null,
  };
}

const file = (over: Partial<Parameters<typeof requestOpenFileInRightPanel>[0]> = {}) => ({
  id: "material:a1", title: "季度报告.pdf", threadId: "t-1", attachmentId: "a1",
  mime: "application/pdf", ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("文件在右栏打开", () => {
  it("PDF 在右栏里真的渲染出来（不是一句「请下载」）", () => {
    render(<ChatTaskInspector {...props()} />);
    expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-collapsed", "true");
    act(() => { requestOpenFileInRightPanel(file()); });
    // 收到就展开——否则事件生效了用户也看不见。
    expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("chat-inspector-file-view")).toBeInTheDocument();
    expect(screen.getByTestId("chat-attachment-preview-pdf")).toBeInTheDocument();
  });

  it("图片走 img，不走「不支持预览」那条降级", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => { requestOpenFileInRightPanel(file({ id: "material:i1", mime: "image/png", title: "图.png" })); });
    expect(screen.getByTestId("chat-attachment-preview-image")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-attachment-preview-unsupported")).toBeNull();
  });

  it("默认在右栏预览，明确放大后可下载同一个附件，关闭不丢右栏", () => {
    const attachment = { id: "a1", messageId: "m-1", filename: "季度报告.pdf", mime: "application/pdf", bytes: 4096, createdAt: "2026-01-01T00:00:00.000Z" };
    render(<ChatTaskInspector {...props()} materials={{ items: [attachment] }} />);
    act(() => { requestOpenFileInRightPanel(file()); });
    expect(screen.queryByTestId("chat-attachment-preview-portal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
    expect(screen.getByTestId("chat-attachment-preview-portal")).toBeVisible();
    // Radix portals DialogContent separately from the outer wrapper. Browser
    // preview locators must scope to this real content, not the empty wrapper.
    expect(within(screen.getByTestId("chat-attachment-preview")).getByTestId("chat-attachment-preview-pdf")).toBeVisible();
    expect(screen.getByTestId("chat-attachment-preview-download")).toHaveAttribute("download", attachment.filename);
    expect(screen.getByTestId("chat-attachment-preview-download")).toHaveAttribute("href", "blob:fake");
    fireEvent.click(screen.getByTestId("chat-attachment-preview-dismiss"));
    expect(screen.queryByTestId("chat-attachment-preview-portal")).toBeNull();
    expect(screen.getByTestId("chat-inspector-file-view")).toBeVisible();
  });

  it("切换对话关闭放大预览，缺少附件元数据时不画死按钮", () => {
    const attachment = { id: "a1", messageId: "m-1", filename: "季度报告.pdf", mime: "application/pdf", bytes: 4096, createdAt: "2026-01-01T00:00:00.000Z" };
    const view = render(<ChatTaskInspector {...props()} materials={{ items: [attachment] }} />);
    act(() => { requestOpenFileInRightPanel(file()); });
    fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
    view.rerender(<ChatTaskInspector {...props()} threadId="t-2" />);
    expect(screen.queryByTestId("chat-attachment-preview-portal")).toBeNull();
    act(() => { requestOpenFileInRightPanel(file({ threadId: "t-2" })); });
    expect(screen.queryByRole("button", { name: "放大查看" })).toBeNull();
  });

  it("浏览器打不开的类型：诚实说不支持，而不是画一个空白预览", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => { requestOpenFileInRightPanel(file({ id: "material:d1", mime: "application/msword", title: "合同.doc" })); });
    expect(screen.getByTestId("chat-attachment-preview-unsupported")).toBeInTheDocument();
  });

  /*
   * 文件是二进制：「复制全文」「下载 .md」两个动作对它没有意义。
   * 禁用而不是画一个点了会存出坏文件的按钮。
   */
  it("文件详情里的复制/下载是禁用的", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => { requestOpenFileInRightPanel(file()); });
    expect(screen.getByTestId("chat-inspector-artifact-copy")).toBeDisabled();
    expect(screen.getByTestId("chat-inspector-artifact-download")).toBeDisabled();
  });

  it("文件与结果共用同一条页签，不另起一排", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => { requestOpenFileInRightPanel(file({ id: "f1", title: "甲.pdf" })); });
    expect(screen.queryByTestId("chat-inspector-artifact-tabs")).not.toBeInTheDocument();
    act(() => { requestOpenFileInRightPanel(file({ id: "f2", title: "乙.pdf", attachmentId: "a2" })); });
    expect(screen.getByTestId("chat-inspector-artifact-tabs")).toBeVisible();
    expect(screen.getAllByTestId("chat-inspector-artifact-tab")).toHaveLength(2);
  });

  it("字段不全的事件整条丢弃", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_FILE_IN_RIGHT_PANEL_EVENT, { detail: { id: "x", title: "缺字段" } }));
    });
    expect(screen.queryByTestId("chat-inspector-file-view")).toBeNull();
  });
});
