import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, type WhiteboardObject } from "@repo/whiteboard-core";
import { ObjectContextToolbar } from "@/components/whiteboard/object-context-toolbar";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange }: { objects: readonly BoardFabricObject[]; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => <div>
    <button data-testid="select-one" onClick={() => onSelectionChange(objects.slice(0, 1).map((object) => object.id), "canvas")}>one</button>
    <button data-testid="select-two" onClick={() => onSelectionChange(objects.slice(0, 2).map((object) => object.id), "canvas")}>two</button>
  </div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

const sticky: WhiteboardObject = { id: "sticky", schemaVersion: 1, kind: "sticky", geometry: { x: 20, y: 80, width: 180, height: 180, rotation: 0 }, text: "Idea", style: {}, parentId: null, orderKey: "a", extensionData: { thinkingInput: { sticky: { variant: "square", color: "#F8D76E", sizing: "auto-height" } } } };

it("shows Sticky-only direct controls and makes every mutating control unavailable in readonly mode", () => {
  const onStickyChange = vi.fn(), onExperienceChange = vi.fn();
  const { rerender } = render(<ObjectContextToolbar object={sticky} viewport={{ zoom: 1, panX: 0, panY: 0, fitRequest: 0 }} readOnly={false} actorId="me" onStickyChange={onStickyChange} onTextChange={vi.fn()} onExperienceChange={onExperienceChange} onFutureAction={vi.fn()} />);
  const toolbar = screen.getByRole("complementary", { name: "便利贴快捷工具" });
  expect(within(toolbar).getByTestId("sticky-color-yellow")).toBeEnabled();
  expect(within(toolbar).getByTestId("context-sticky-circle")).toBeEnabled();
  expect(within(toolbar).queryByLabelText("字号")).toBeNull();
  fireEvent.click(within(toolbar).getByTestId("context-sticky-circle"));
  expect(onStickyChange).toHaveBeenCalledWith({ variant: "circle" });

  rerender(<ObjectContextToolbar object={sticky} viewport={{ zoom: 1, panX: 0, panY: 0, fitRequest: 0 }} readOnly actorId="me" onStickyChange={onStickyChange} onTextChange={vi.fn()} onExperienceChange={onExperienceChange} onFutureAction={vi.fn()} />);
  expect(screen.getByTestId("context-sticky-circle")).toBeDisabled();
  expect(screen.getByLabelText("便利贴自定义颜色")).toBeDisabled();
});

it("derives command availability from selection count and hides single-object controls for a mixed selection", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: sticky }, { type: "create", object: { ...sticky, id: "sticky-2", orderKey: "b", geometry: { ...sticky.geometry, x: 240 } } }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-one"));
  expect(screen.getByTestId("board-context-toolbar")).toBeVisible();
  expect(within(screen.getByTestId("board-spatial-toolbar")).getByRole("button", { name: "组合" })).toBeDisabled();
  fireEvent.click(screen.getByTestId("select-two"));
  expect(screen.queryByTestId("board-context-toolbar")).toBeNull();
  expect(within(screen.getByTestId("board-spatial-toolbar")).getByRole("button", { name: "组合" })).toBeEnabled();
  doc.destroy();
});
