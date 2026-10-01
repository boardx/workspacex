import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects, SpatialRelationshipCommandPort } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange }: { objects: readonly BoardFabricObject[]; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => <div>{objects.map((object) => <button key={object.id} data-testid={`select-${object.id}`} onClick={() => onSelectionChange([object.id], "canvas")}>{object.id}</button>)}<button data-testid="select-all" onClick={() => onSelectionChange(objects.map((object) => object.id), "canvas")}>all</button></div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

function seed() {
  const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
  port.dispatch({ boardId: "board", clientId: "seed", gestureId: "panel", command: { type: "create-panel", id: "panel", text: "Research", geometry: { x: 0, y: 0, width: 500, height: 350, rotation: 0 }, panel: { version: 1, mode: "grid", autoExpand: true, clipContent: false, padding: 24, gap: 24, columns: 3, flowDirection: "horizontal" } } });
  port.dispatch({ boardId: "board", clientId: "seed", gestureId: "edge", command: { type: "create-connector", id: "edge", relationship: { fromPoint: { x: 20, y: 20 }, toPoint: { x: 200, y: 120 }, fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "needs", semanticRelation: "needs" } } });
  return { doc, port };
}

it("edits canonical Panel properties and enforces mutually exclusive layout controls", () => {
  const { doc } = seed();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-panel"));
  expect(screen.queryByTestId("board-shared-properties")).toBeNull();
  fireEvent.click(screen.getByTestId("board-inspector-expand"));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "精确属性" }));
  expect(screen.getByTestId("board-panel-properties")).toBeVisible();
  expect(screen.getByLabelText("区域布局")).toHaveValue("grid");
  expect(screen.getByLabelText("区域裁剪内容")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("区域标题"), { target: { value: "Findings" } });
  expect(readObjects(doc).find((object) => object.id === "panel")?.text).toBe("Findings");
  doc.destroy();
});

it("shows relationship-specific fields and disables precise edits after locking", () => {
  const { doc, port } = seed();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-edge"));
  expect(screen.queryByTestId("board-shared-properties")).toBeNull();
  fireEvent.click(screen.getByTestId("board-inspector-expand"));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "精确属性" }));
  expect(screen.getByTestId("board-connector-properties")).toBeVisible();
  expect(screen.getByLabelText("连接标签")).toHaveValue("needs");
  expect(screen.queryByTestId("board-panel-properties")).toBeNull();
  fireEvent.change(screen.getByLabelText("语义关系"), { target: { value: "depends_on" } });
  expect(readObjects(doc).find((object) => object.id === "edge")?.connector?.semanticRelation).toBe("depends_on");
  act(() => { port.dispatch({ boardId: "board", clientId: "seed", gestureId: "lock", command: { type: "set-locked", objectIds: ["edge"], locked: true } }); });
  expect(screen.getByLabelText("连接标签")).toBeDisabled();
  expect(screen.getByLabelText("连接路径")).toBeDisabled();
  doc.destroy();
});

it("shows shared geometry and explicit mixed values for heterogeneous selections", () => {
  const { doc } = seed();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-all"));
  expect(screen.queryByTestId("board-shared-properties")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "精确属性" }));
  expect(screen.getByTestId("board-shared-properties")).toHaveAccessibleName("所选对象共有属性");
  expect(screen.getByLabelText("共有属性 类型")).toHaveValue("混合");
  expect(screen.getByLabelText("共有属性 X")).toHaveValue("混合");
  expect(screen.queryByTestId("board-panel-properties")).toBeNull();
  expect(screen.queryByTestId("board-connector-properties")).toBeNull();
  doc.destroy();
});
