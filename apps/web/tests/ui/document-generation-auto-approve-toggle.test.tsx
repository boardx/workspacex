/**
 * issue #3440 —— composer 开关组件：默认关闭渲染、读到已开启状态、点击调用 PUT
 * 且状态随后端响应更新（不是纯前端乐观值）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const getMock = vi.fn();
const setMock = vi.fn();
vi.mock("@/lib/document-generation-auto-approve", () => ({
  getDocumentGenerationAutoApprove: (...args: unknown[]) => getMock(...args),
  setDocumentGenerationAutoApprove: (...args: unknown[]) => setMock(...args),
}));

import { DocumentGenerationAutoApproveToggle } from "@/components/chat/document-generation-auto-approve-toggle";

describe("DocumentGenerationAutoApproveToggle", () => {
  beforeEach(() => {
    getMock.mockReset();
    setMock.mockReset();
  });

  it("默认关闭渲染，直到读到后端状态", async () => {
    getMock.mockResolvedValue({ enabled: false });
    render(<DocumentGenerationAutoApproveToggle />);
    const toggle = await screen.findByTestId("chat-document-generation-auto-approve-toggle");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("后端已开启时渲染为开启", async () => {
    getMock.mockResolvedValue({ enabled: true });
    render(<DocumentGenerationAutoApproveToggle />);
    const toggle = await screen.findByTestId("chat-document-generation-auto-approve-toggle");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("点击调用 PUT，并按响应（不是本地猜测）更新常驻状态", async () => {
    getMock.mockResolvedValue({ enabled: false });
    setMock.mockResolvedValue({ enabled: true });
    render(<DocumentGenerationAutoApproveToggle />);
    const toggle = await screen.findByTestId("chat-document-generation-auto-approve-toggle");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(toggle);

    await waitFor(() => expect(setMock).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("写失败时回滚，不留一个假状态", async () => {
    getMock.mockResolvedValue({ enabled: false });
    setMock.mockRejectedValue(new Error("network"));
    render(<DocumentGenerationAutoApproveToggle />);
    const toggle = await screen.findByTestId("chat-document-generation-auto-approve-toggle");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(toggle);

    await waitFor(() => expect(setMock).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });
});
