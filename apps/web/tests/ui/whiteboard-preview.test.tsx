import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WhiteboardScreen } from "@/components/whiteboard/whiteboard-screen";
import { NAV_SEGMENTS } from "@/lib/navigation";

describe("Studio Board UI contract", () => {
  it("has a top-level Studio entry", () => {
    expect(NAV_SEGMENTS.find((s) => s.label === "STUDIO")?.items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: "whiteboard", label: "Board", href: "/studio/board" })]));
  });
  it("creates and edits a sticky, and undoes creation without fake persistence", () => {
    render(<WhiteboardScreen state="empty" />);
    expect(screen.getByTestId("whiteboard-preview-notice")).toHaveTextContent("未保存");
    fireEvent.click(screen.getByTestId("whiteboard-add-sticky"));
    fireEvent.change(screen.getByTestId("whiteboard-object-text"), { target: { value: "团队共同讨论" } });
    fireEvent.blur(screen.getByTestId("whiteboard-object-text"));
    expect(screen.getByTestId("whiteboard-surface")).toHaveTextContent("团队共同讨论");
    fireEvent.click(screen.getByTestId("whiteboard-undo"));
    expect(screen.getByTestId("whiteboard-surface")).not.toHaveTextContent("团队共同讨论");
    fireEvent.click(screen.getByTestId("whiteboard-undo"));
    expect(screen.getByTestId("empty")).toBeVisible();
  });
  it("requires confirmation before deleting selected content", () => {
    render(<WhiteboardScreen state="empty" />);
    fireEvent.click(screen.getByTestId("whiteboard-add-sticky"));
    fireEvent.click(screen.getByTestId("whiteboard-delete"));
    expect(screen.getByTestId("whiteboard-delete-confirm")).toBeVisible();
    fireEvent.click(screen.getByTestId("whiteboard-delete-cancel"));
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
  });
  it("keeps denied and dependency-failed screens non-editable", () => {
    const { rerender } = render(<WhiteboardScreen state="denied" />);
    expect(screen.getByTestId("denied")).toBeVisible();
    expect(screen.queryByTestId("whiteboard-add-sticky")).not.toBeInTheDocument();
    rerender(<WhiteboardScreen state="dep-failed" />);
    expect(screen.getByTestId("dep-failed")).toBeVisible();
    expect(screen.queryByTestId("whiteboard-add-sticky")).not.toBeInTheDocument();
  });
});
