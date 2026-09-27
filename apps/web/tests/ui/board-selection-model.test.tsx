import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type WhiteboardObject } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange, onObjectsTransform }: {
    objects: readonly BoardFabricObject[];
    onSelectionChange: (ids: readonly string[], source: "canvas") => void;
    onObjectsTransform?: (items: readonly { id: string; geometry: BoardFabricObject["geometry"] }[]) => boolean;
  }) => <div data-testid="board-fabric-surface">
    {objects.map((object) => <button key={object.id} data-testid={`select-${object.id}`} onClick={() => onSelectionChange([object.id], "canvas")}>{object.id}</button>)}
    <button data-testid="marquee-all" onClick={() => onSelectionChange(objects.map((object) => object.id), "canvas")}>marquee</button>
    <button data-testid="transform-selection" onClick={(event) => { event.currentTarget.dataset.accepted = String(onObjectsTransform?.(objects.map((object) => ({ id: object.id, geometry: { ...object.geometry, x: object.geometry.x + 40, rotation: 15 } })))); }}>transform</button>
  </div>,
}));

class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

const note = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: "sticky", geometry: { x, y: 20, width: 180, height: 180, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });

it("keeps canvas, marquee, and accessible outline selection controlled by canonical ids", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("a", 10) }, { type: "create", object: note("b", 240) }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);

  fireEvent.click(screen.getByTestId("select-a"));
  expect(screen.getByText("1 个已选对象", { exact: true })).toBeVisible();
  fireEvent.click(screen.getByTestId("marquee-all"));
  expect(screen.getByText("2 个已选对象", { exact: true })).toBeVisible();
  expect(screen.getByTestId("board-zoom-fit-selection")).toBeEnabled();
  doc.destroy();
});

it("rejects a mixed transform atomically when the selection contains a locked object", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("free", 10) }, { type: "create", object: note("locked", 240) }], "seed");
  act(() => { new SpatialRelationshipCommandPort(doc).dispatch({ boardId: "board", clientId: "seed", gestureId: "lock", command: { type: "set-locked", objectIds: ["locked"], locked: true } }); });
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("marquee-all"));
  const before = readObjects(doc).map((object) => object.geometry);
  fireEvent.click(screen.getByTestId("transform-selection"));
  expect(screen.getByTestId("transform-selection")).toHaveAttribute("data-accepted", "false");
  expect(screen.getByText("选择中有对象已锁定，整次变换未应用。", { exact: true })).toBeVisible();
  expect(readObjects(doc).map((object) => object.geometry)).toEqual(before);
  doc.destroy();
});
