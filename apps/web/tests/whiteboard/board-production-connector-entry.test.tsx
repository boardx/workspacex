import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createWhiteboardDocument, readObjects } from "@repo/whiteboard-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/whiteboard/board-comments", () => ({
  listBoardCommentThreads: async () => [],
  dispatchBoardCommentCommand: vi.fn(),
}));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: () => <div data-testid="board-fabric-surface" />,
}));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("mounts the approved Connector entry in production without enabling Frame or read-only writes", async () => {
  expect(process.env.NODE_ENV).toBe("production");
  const { CollaborativeEditor } = await import("@/components/whiteboard/collaborative-editor");
  const doc = createWhiteboardDocument();
  const props = { boardId: "production-board", clientId: "production-client", doc, title: "Board", status: "Connected" };
  const view = render(<CollaborativeEditor {...props} readOnly={false} />);
  try {
    const connector = screen.getByTestId("board-add-connector");
    expect(screen.getAllByTestId("board-add-connector")).toHaveLength(1);
    expect(connector).toBeEnabled();
    expect(connector).toHaveAttribute("aria-expanded", "false");
    const chevron = screen.getByTestId("board-add-connector-submenu");
    expect(chevron).toHaveClass("lucide-chevron-up");
    expect(chevron).toHaveAttribute("data-state", "closed");
    expect(chevron).not.toHaveClass("rotate-180");
    expect(screen.queryByTestId("board-add-frame")).toBeNull();
    fireEvent.keyDown(window, { key: "f" });
    expect(readObjects(doc)).toHaveLength(0);
    expect(screen.getByTestId("board-tool-select")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(connector);
    expect(connector).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("board-tool-picker")).toBeVisible();
    expect(connector).toHaveAttribute("aria-expanded", "true");
    expect(chevron).toHaveAttribute("data-state", "open");
    expect(chevron).toHaveClass("rotate-180");
    fireEvent.click(connector);
    expect(screen.queryByTestId("board-tool-picker")).toBeNull();
    expect(connector).toHaveAttribute("aria-expanded", "false");
    expect(chevron).toHaveAttribute("data-state", "closed");
    expect(chevron).not.toHaveClass("rotate-180");
    expect(readObjects(doc)).toHaveLength(0);

    view.rerender(<CollaborativeEditor {...props} readOnly />);
    expect(screen.getByTestId("board-add-connector")).toBeDisabled();
    fireEvent.click(screen.getByTestId("board-add-connector"));
    fireEvent.keyDown(window, { key: "f" });
    expect(readObjects(doc)).toHaveLength(0);
    expect(screen.queryByTestId("board-add-frame")).toBeNull();
  } finally {
    view.unmount();
    doc.destroy();
  }
});
