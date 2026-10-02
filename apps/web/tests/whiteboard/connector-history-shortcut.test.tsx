import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";

vi.mock("@/components/whiteboard/board-comments", () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onCanvasClick }: { onCanvasClick: (point: { x: number; y: number }) => void }) => <div data-testid="board-fabric-surface"><canvas data-testid="history-canvas" /><button onClick={() => onCanvasClick({ x: 300, y: 200 })}>place note</button></div> }));
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(cleanup);

it.each(["ctrlKey", "metaKey"])("%s Z and Shift Z use the board's real atomic history", modifier => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="history-board" clientId="history-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
  fireEvent.click(screen.getByTestId("board-add-sticky")); fireEvent.click(screen.getByText("place note"));
  expect(readObjects(doc)).toHaveLength(1);
  fireEvent.keyDown(screen.getByTestId("history-canvas"), { key: "z", [modifier]: true });
  expect(readObjects(doc)).toHaveLength(0);
  fireEvent.keyDown(screen.getByTestId("history-canvas"), { key: "Z", [modifier]: true, shiftKey: true });
  expect(readObjects(doc)).toHaveLength(1);
  fireEvent.keyDown(screen.getByTestId("history-canvas"), { key: "z", [modifier]: true });
  fireEvent.keyDown(screen.getByTestId("history-canvas"), { key: "y", ctrlKey: true });
  expect(readObjects(doc)).toHaveLength(1);
  doc.destroy();
});

it("leaves editable text, composition, outside focus and handled events to their owner", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="history-board" clientId="history-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
  fireEvent.click(screen.getByTestId("board-add-sticky")); fireEvent.click(screen.getByText("place note"));
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "z", ctrlKey: true });
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  fireEvent.keyDown(screen.getByTestId("history-canvas"), { key: "z", ctrlKey: true, isComposing: true });
  const handled = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }); handled.preventDefault();
  fireEvent(screen.getByTestId("history-canvas"), handled);
  expect(readObjects(doc)).toHaveLength(1);
  doc.destroy();
});
