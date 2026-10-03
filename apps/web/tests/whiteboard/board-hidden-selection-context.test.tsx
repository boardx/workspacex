import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, type WhiteboardObject } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";

vi.mock("@/components/whiteboard/board-comments", () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onSelectionChange }: { onSelectionChange: (ids: string[], source: "canvas") => void }) => <button onClick={() => onSelectionChange(["selected"], "canvas")}>select fixture</button> }));
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(cleanup);

it.each(["sticky", "connector"] as const)("removes hidden selected %s context and restores it when unhidden without reselection", kind => {
  const doc = createWhiteboardDocument();
  const object: WhiteboardObject = { id: "selected", schemaVersion: 1, kind, geometry: { x: 100, y: 200, width: 180, height: 120, rotation: 0 }, text: "Selected", style: {}, parentId: null, orderKey: "a", ...(kind === "connector" ? { connector: { fromPoint: { x: 100, y: 200 }, toPoint: { x: 300, y: 200 }, type: "straight" as const, label: "Selected" } } : {}) };
  executeCommands(doc, [{ type: "create", object }], "fixture");
  try {
    render(<CollaborativeEditor boardId="hidden-context" clientId="fixture" doc={doc} readOnly={false} title="Board" status="Connected" />);
    fireEvent.click(screen.getByText("select fixture"));
    expect(screen.getByTestId("board-context-toolbar")).toBeVisible();
    if (kind === "connector") expect(screen.getByTestId("board-connector-handle-to")).toBeVisible();
    act(() => executeCommands(doc, [{ type: "state", id: object.id, hidden: true }], "remote"));
    expect(screen.queryByTestId("board-context-toolbar")).toBeNull();
    expect(screen.queryByTestId("board-connector-handle-to")).toBeNull();
    expect(screen.queryByTestId("board-spatial-toolbar")).toBeNull();
    act(() => executeCommands(doc, [{ type: "state", id: object.id, hidden: false, locked: kind === "connector" }], "remote"));
    expect(screen.getByTestId("board-context-toolbar")).toBeVisible();
    if (kind === "connector") {
      expect(screen.getByTestId("board-connector-width-open")).toBeDisabled();
      expect(screen.queryByTestId("board-connector-handle-to")).toBeNull();
    }
  } finally { cleanup(); doc.destroy(); }
});
