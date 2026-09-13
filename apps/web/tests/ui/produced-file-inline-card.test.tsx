import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.unstubAllGlobals());

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

  it("keeps PDFs compact while exposing both preview and download actions", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: "blob:report", failed: false, iconKind: "pdf" });

    render(<ProducedFileInlineCard file={makeFile({ name: "report.pdf", mime: "application/pdf" })} threadId="thread-1" />);

    expect(screen.queryByTestId("chat-produced-file-inline-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-produced-file-inline-preview-trigger")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-pdf-preview-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-inline-download")).toHaveAttribute("href", "blob:report");

    fireEvent.click(screen.getByTestId("chat-produced-file-pdf-preview-trigger"));
    expect(screen.getByTestId("chat-produced-file-pdf-preview-frame")).toHaveAttribute("src", "blob:report");
    expect(screen.getByTestId("chat-produced-file-pdf-preview-download")).toHaveAttribute("download", "report.pdf");
  });

  it("recognizes the model-generated skill draft and opens its JSON in chat", async () => {
    useProducedFileDownloadMock.mockReturnValue({ src: "blob:weekly-report-skill", failed: false, iconKind: "file" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"name":"weekly-report"}', { status: 200 })));

    render(
      <ProducedFileInlineCard
        file={makeFile({ name: "weekly-report-skill-draft.json", mime: "application/json" })}
        threadId="thread-1"
      />,
    );

    expect(screen.getByTestId("chat-produced-file-skill-draft-badge")).toHaveTextContent("技能草稿");
    fireEvent.click(screen.getByTestId("chat-produced-file-skill-draft-open"));

    expect(await screen.findByTestId("chat-produced-file-skill-draft-preview")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("chat-attachment-preview-text")).toHaveTextContent('"name":"weekly-report"'));
    expect(screen.getByTestId("chat-produced-file-skill-draft-download")).toHaveAttribute("download", "weekly-report-skill-draft.json");
  });

  it("uses the same review action for canonical persisted skill filenames", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: "blob:canonical-skill", failed: false, iconKind: "file" });

    render(
      <ProducedFileInlineCard
        file={makeFile({ name: "weekly-report.skill.json", mime: "application/json; charset=utf-8" })}
        threadId="thread-1"
      />,
    );

    expect(screen.getByTestId("chat-produced-file-skill-draft-badge")).toHaveTextContent("技能草稿");
    expect(screen.getByTestId("chat-produced-file-skill-draft-open")).toBeInTheDocument();
  });

  it("keeps ordinary JSON files on the generic download-only path", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: "blob:generic-json", failed: false, iconKind: "file" });

    render(
      <ProducedFileInlineCard
        file={makeFile({ name: "analysis-data.json", mime: "application/json" })}
        threadId="thread-1"
      />,
    );

    expect(screen.queryByTestId("chat-produced-file-skill-draft-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-produced-file-skill-draft-open")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-inline-download")).toHaveAttribute("href", "blob:generic-json");
  });

  it("does not render a broken inline image when authenticated loading fails", () => {
    useProducedFileDownloadMock.mockReturnValue({ src: null, failed: true, iconKind: "image" });

    render(<ProducedFileInlineCard file={makeFile()} threadId="thread-1" />);

    expect(screen.queryByTestId("chat-produced-file-inline-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-inline-failed")).toHaveTextContent("下载失败");
  });
});
