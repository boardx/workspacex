import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type WhiteboardObject } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange, onObjectsTransform }: {
    objects: readonly BoardFabricObject[];
    onSelectionChange: (ids: readonly string[], source: "canvas") => void;
    onObjectsTransform?: (items: readonly { id: string; geometry: BoardFabricObject["geometry"] }[], options?: { duplicate: boolean }) => boolean;
  }) => <div data-testid="board-fabric-surface">
    {objects.map((object) => <button key={object.id} data-testid={`select-${object.id}`} onClick={() => onSelectionChange([object.id], "canvas")}>{object.id}</button>)}
    <button data-testid="marquee-all" onClick={() => onSelectionChange(objects.map((object) => object.id), "canvas")}>marquee</button>
    <button data-testid="transform-selection" onClick={(event) => { event.currentTarget.dataset.accepted = String(onObjectsTransform?.(objects.map((object) => ({ id: object.id, geometry: { ...object.geometry, x: object.geometry.x + 40, rotation: 15 } })))); }}>transform</button>
    <button data-testid="alt-drag-selection" onClick={(event) => { event.currentTarget.dataset.accepted = String(onObjectsTransform?.(objects.map((object) => ({ id: object.id, geometry: { ...object.geometry, x: object.geometry.x + 40 } })), { duplicate: true })); }}>alt-drag</button>
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

it("Option/Alt drag duplicates only unlocked members with canonical ids and the drag offset", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("free", 10) }, { type: "create", object: note("locked", 240) }], "seed");
  act(() => { new SpatialRelationshipCommandPort(doc).dispatch({ boardId: "board", clientId: "seed", gestureId: "lock", command: { type: "set-locked", objectIds: ["locked"], locked: true } }); });
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("marquee-all"));
  fireEvent.click(screen.getByTestId("alt-drag-selection"));
  expect(screen.getByTestId("alt-drag-selection")).toHaveAttribute("data-accepted", "true");
  const values = readObjects(doc);
  expect(values).toHaveLength(3);
  expect(new Set(values.map((object) => object.id)).size).toBe(3);
  expect(values.find((object) => !["free", "locked"].includes(object.id))?.geometry).toMatchObject({ x: 50, y: 20 });
  expect(values.find((object) => object.id === "locked")?.geometry).toMatchObject({ x: 240, y: 20 });
  doc.destroy();
});

it("transforms unlocked members in one undoable operation while locked members stay unchanged", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("free", 10) }, { type: "create", object: note("locked", 240) }], "seed");
  act(() => { new SpatialRelationshipCommandPort(doc).dispatch({ boardId: "board", clientId: "seed", gestureId: "lock", command: { type: "set-locked", objectIds: ["locked"], locked: true } }); });
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("marquee-all"));
  const before = new Map(readObjects(doc).map((object) => [object.id, object.geometry]));
  fireEvent.click(screen.getByTestId("transform-selection"));
  expect(screen.getByTestId("transform-selection")).toHaveAttribute("data-accepted", "true");
  expect(screen.getByText("已用一次操作更新 1 个对象；跳过 1 个锁定对象。", { exact: true })).toBeVisible();
  expect(readObjects(doc).find((object) => object.id === "free")?.geometry).toMatchObject({ x: 50, rotation: 15 });
  expect(readObjects(doc).find((object) => object.id === "locked")?.geometry).toEqual(before.get("locked"));
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(readObjects(doc).find((object) => object.id === "free")?.geometry).toEqual(before.get("free"));
  expect(readObjects(doc).find((object) => object.id === "locked")?.geometry).toEqual(before.get("locked"));
  doc.destroy();
});
