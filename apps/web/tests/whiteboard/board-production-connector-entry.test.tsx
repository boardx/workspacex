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
    expect(connector.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(screen.queryByTestId("board-add-frame")).toBeNull();
    fireEvent.keyDown(window, { key: "f" });
    expect(readObjects(doc)).toHaveLength(0);
    expect(screen.getByTestId("board-tool-select")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(connector);
    expect(connector).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("board-tool-picker")).toBeVisible();
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
