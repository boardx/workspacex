import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProducedFilePdfPreview } from "@/components/chat/produced-file-pdf-preview";
import type { ActiveFile } from "@/lib/agui-file-events";

const pdfFile: ActiveFile = {
  uri: "vfs://attachment/attachment-pdf",
  name: "team-collaboration.pdf",
  mime: "application/pdf",
  source: "agent_run_output",
  bytes: 4_272_039,
  messageId: "message-1",
  content: "",
  nextSequence: 0,
};

describe("ProducedFilePdfPreview", () => {
  it("opens the authenticated PDF in a browser viewer and keeps the download action", () => {
    render(<ProducedFilePdfPreview file={pdfFile} src="blob:team-collaboration" />);

    fireEvent.click(screen.getByTestId("chat-produced-file-pdf-preview-trigger"));

    expect(screen.getByTestId("chat-produced-file-pdf-preview-portal")).toBeInTheDocument();
    expect(screen.getByTestId("chat-produced-file-pdf-preview-frame")).toHaveAttribute("src", "blob:team-collaboration");
    expect(screen.getByTestId("chat-produced-file-pdf-preview-frame")).toHaveAttribute(
      "title",
      "team-collaboration.pdf PDF 预览",
    );
    expect(screen.getByTestId("chat-produced-file-pdf-preview-download")).toHaveAttribute("href", "blob:team-collaboration");
    expect(screen.getByTestId("chat-produced-file-pdf-preview-download")).toHaveAttribute("download", "team-collaboration.pdf");

    fireEvent.click(screen.getByTestId("chat-produced-file-pdf-preview-dismiss"));
    expect(screen.queryByTestId("chat-produced-file-pdf-preview-portal")).not.toBeInTheDocument();
  });
});
