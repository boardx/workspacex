import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProducedFileInlineCard } from "@/components/chat/produced-file-inline-card";
import type { ActiveFile } from "@/lib/agui-file-events";

const useProducedFileDownloadMock = vi.fn();
vi.mock("@/lib/use-produced-file-download", () => ({
  useProducedFileDownload: (...args: unknown[]) => useProducedFileDownloadMock(...args),
}));

function makeFile(overrides: Partial<ActiveFile> = {}): ActiveFile {
  return {
    uri: "vfs://attachment/attachment-1",
    name: "gov-cn-homepage.png",
    mime: "image/png",
    source: "agent_run_output",
    bytes: 463_053,
    messageId: "message-1",
    content: "",
    nextSequence: 0,
    ...overrides,
  };
}

describe("ProducedFileInlineCard", () => {
  beforeEach(() => {
    useProducedFileDownloadMock.mockReset();
  });

  it("renders a generated image inline and opens the same bytes in an enlarged preview", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: "blob:gov-homepage", failed: false, iconKind: "image" });

    render(<ProducedFileInlineCard file={makeFile()} threadId="thread-1" />);

    const inlineImage = screen.getByTestId("chat-produced-file-inline-image");
    expect(inlineImage).toHaveAttribute("src", "blob:gov-homepage");
    expect(inlineImage).toHaveAttribute("alt", "gov-cn-homepage.png");
    expect(screen.getByTestId("chat-produced-file-inline-download")).toHaveAttribute("href", "blob:gov-homepage");

    fireEvent.click(screen.getByTestId("chat-produced-file-inline-preview-trigger"));

    expect(screen.getByTestId("chat-produced-file-preview-portal")).toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-preview-image")).toHaveAttribute("src", "blob:gov-homepage");
    expect(screen.getByTestId("chat-produced-file-preview-download")).toHaveAttribute("download", "gov-cn-homepage.png");

    fireEvent.click(screen.getByTestId("chat-produced-file-preview-dismiss"));
    expect(screen.queryByTestId("chat-produced-file-preview-portal")).not.toBeInTheDocument();
  });

  it("keeps non-image outputs on the compact download card", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: "blob:report", failed: false, iconKind: "pdf" });

    render(<ProducedFileInlineCard file={makeFile({ name: "report.pdf", mime: "application/pdf" })} threadId="thread-1" />);

    expect(screen.queryByTestId("chat-produced-file-inline-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-produced-file-inline-preview-trigger")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-inline-download")).toHaveAttribute("href", "blob:report");
  });

  it("does not render a broken inline image when authenticated loading fails", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: null, failed: true, iconKind: "image" });

    render(<ProducedFileInlineCard file={makeFile()} threadId="thread-1" />);

    expect(screen.queryByTestId("chat-produced-file-inline-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-inline-failed")).toHaveTextContent("下载失败");
  });
});
