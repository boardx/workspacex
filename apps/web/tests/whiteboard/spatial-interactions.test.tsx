import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import { createWhiteboardDocument, readObjects, SpatialRelationshipCommandPort, WhiteboardCommandOrigin, type PanelMetadata } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onCanvasClick, onCanvasDoubleClick, onSelectionChange, onObjectTransform, onObjectReparent, onPanelHoverChange }: {
    objects: readonly BoardFabricObject[];
    onCanvasClick?: (point: { x: number; y: number }) => void;
    onCanvasDoubleClick?: (point: { x: number; y: number }) => void;
    onSelectionChange: (ids: readonly string[], source: "canvas") => void;
    onObjectTransform: (id: string, geometry: BoardFabricObject["geometry"]) => boolean;
    onObjectReparent?: (id: string, panelId: string | null) => void;
    onPanelHoverChange?: (id: string | null) => void;
  }) => <div data-testid="board-fabric-surface">
    <button data-testid="mock-create-a" onClick={() => onCanvasDoubleClick?.({ x: 100, y: 100 })}>A</button>
    <button data-testid="mock-create-b" onClick={() => onCanvasDoubleClick?.({ x: 420, y: 120 })}>B</button>
    <button data-testid="mock-canvas-click" onClick={() => onCanvasClick?.({ x: 300, y: 240 })}>click</button>
    {objects.map((object) => <button key={object.id} data-testid={`mock-select-${object.id}`} onClick={() => onSelectionChange([object.id], "canvas")}>{object.id}</button>)}
    <button data-testid="mock-select-stickies" onClick={() => onSelectionChange(objects.filter((object) => object.kind === "sticky").map((object) => object.id), "canvas")}>all</button>
    <button data-testid="mock-transform-selected" onClick={() => { const object = objects.find((candidate) => candidate.kind === "sticky"); if (object) onObjectTransform(object.id, { ...object.geometry, x: object.geometry.x + 80, y: object.geometry.y + 40 }); }}>move</button>
    <button data-testid="mock-panel-hover" onClick={() => onPanelHoverChange?.(objects.find((candidate) => candidate.kind === "panel")?.id ?? null)}>hover</button>
    <button data-testid="mock-reparent" onClick={() => { const sticky = objects.find((candidate) => candidate.kind === "sticky"), panel = objects.find((candidate) => candidate.kind === "panel"); if (sticky && panel) onObjectReparent?.(sticky.id, panel.id); }}>reparent</button>
  </div>,
}));

class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => cleanup());

function openActions() { const properties = screen.queryByTestId("board-inspector-expand"); if (properties) fireEvent.click(properties); const trigger = screen.getByTestId("board-inspector-actions"); if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger); const tab = screen.getByRole("button", { name: "操作" }); fireEvent.click(tab); }
function openProperties() { openActions(); fireEvent.click(screen.getByTestId("board-properties-open")); }

function mount() {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="spatial-board" clientId="web" doc={doc} readOnly={false} title="Spatial" status="已连接" />);
  return doc;
}

function createPanelAndSticky() {
  fireEvent.click(screen.getByTestId("board-add-more"));
  fireEvent.click(screen.getByTestId("board-add-panel"));
  fireEvent.keyDown(window,{key:"n"});
}

it("creates and edits a semantic Panel, highlights a drop target, and reparents through the spatial port", () => {
  const doc = mount();
  createPanelAndSticky();
  const panel = readObjects(doc).find((object) => object.kind === "frame")!;
  const sticky = readObjects(doc).find((object) => object.kind === "sticky")!;
  expect(panel.extensionData?.spatial).toMatchObject({ mode: "freeform", autoExpand: true, clipContent: false });
  fireEvent.click(screen.getByTestId(`mock-select-${panel.id}`));
  openProperties();
  fireEvent.change(screen.getByLabelText("区域标题"), { target: { value: "Research findings" } });
  fireEvent.change(screen.getByLabelText("区域布局"), { target: { value: "flow" } });
  expect(readObjects(doc).find((object) => object.id === panel.id)?.text).toBe("Research findings");
  expect((readObjects(doc).find((object) => object.id === panel.id)?.extensionData?.spatial as PanelMetadata).mode).toBe("flow");
  fireEvent.click(screen.getByTestId("mock-panel-hover"));
  expect(screen.getByTestId(`panel-drop-highlight-${panel.id}`)).toBeVisible();
  fireEvent.click(screen.getByTestId("mock-reparent"));
  expect(readObjects(doc).find((object) => object.id === sticky.id)?.parentId).toBe(panel.id);
  doc.destroy();
});

it("locks objects against transform and exposes both explicit Panel deletion outcomes", () => {
  const doc = mount();
  createPanelAndSticky();
  const panel = readObjects(doc).find((object) => object.kind === "frame")!, sticky = readObjects(doc).find((object) => object.kind === "sticky")!;
  fireEvent.click(screen.getByTestId("mock-reparent"));
  fireEvent.click(screen.getByTestId(`mock-select-${sticky.id}`));
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("锁定"));
  const before = readObjects(doc).find((object) => object.id === sticky.id)!.geometry;
  fireEvent.click(screen.getByTestId("mock-transform-selected"));
  expect(readObjects(doc).find((object) => object.id === sticky.id)?.geometry).toEqual(before);
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("解锁"));
  fireEvent.click(screen.getByTestId(`mock-select-${panel.id}`));
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("删除"));
  fireEvent.click(screen.getByTestId("board-panel-delete-preserve"));
  expect(readObjects(doc).find((object) => object.id === panel.id)).toBeUndefined();
  expect(readObjects(doc).find((object) => object.id === sticky.id)?.parentId).toBeNull();

  const port = new SpatialRelationshipCommandPort(doc), panel2 = "panel2";
  act(() => { port.dispatch({ boardId: "spatial-board", clientId: "fixture", gestureId: "p2", command: { type: "create-panel", id: panel2, geometry: { x: 0, y: 0, width: 400, height: 300, rotation: 0 }, panel: { version: 1, mode: "freeform", autoExpand: false, clipContent: false, padding: 24, gap: 24, columns: 3, flowDirection: "horizontal" } } }); port.dispatch({ boardId: "spatial-board", clientId: "fixture", gestureId: "r2", command: { type: "reparent", id: sticky.id, parentId: panel2 } }); });
  fireEvent.click(screen.getByTestId(`mock-select-${panel2}`));
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("锁定"));
  expect(readObjects(doc).find((object) => object.id === panel2)?.locked).toBe(true);
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("解锁"));
  expect(readObjects(doc).find((object) => object.id === panel2)?.locked).toBe(false);
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("删除"));
  fireEvent.click(screen.getByTestId("board-panel-delete-cascade"));
  expect(readObjects(doc).find((object) => object.id === sticky.id)).toBeUndefined();
  doc.destroy();
});

it("creates a semantic connector from handles, updates its label/styles, and follows endpoint movement", () => {
  const doc = mount();
  fireEvent.click(screen.getByTestId("mock-create-a"));
  const a = readObjects(doc)[0]!;
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("mock-create-b"));
  const b = readObjects(doc).find((object) => object.id !== a.id)!;
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId(`mock-select-${a.id}`));
  act(() => new SpatialRelationshipCommandPort(doc).dispatch({ boardId: "spatial-board", clientId: "fixture", gestureId: "rotate-a", command: { type: "transform", items: [{ id: a.id, geometry: { ...a.geometry, rotation: 90 } }] } }));
  expect(screen.getByTestId(`connector-handle-${a.id}-right`)).toHaveStyle({ left: `${a.geometry.x - a.geometry.height / 2}px`, top: `${a.geometry.y + a.geometry.width}px` });
  let payload = "";
  fireEvent.dragStart(screen.getByTestId(`connector-handle-${a.id}-right`), { dataTransfer: { setData: (_type: string, value: string) => { payload = value; } } });
  fireEvent.click(screen.getByTestId(`mock-select-${b.id}`));
  fireEvent.drop(screen.getByTestId(`connector-handle-${b.id}-left`), { dataTransfer: { getData: () => payload } });
  const edge = readObjects(doc).find((object) => object.kind === "connector")!;
  expect(edge.connector).toMatchObject({ from: a.id, to: b.id, fromAnchor: "right", toAnchor: "left" });
  const before = edge.geometry;
  fireEvent.click(screen.getByTestId("mock-transform-selected"));
  expect(readObjects(doc).find((object) => object.id === edge.id)?.geometry).not.toEqual(before);
  fireEvent.click(screen.getByTestId(`mock-select-${edge.id}`));
  openProperties();
  fireEvent.change(screen.getByLabelText("连接标签"), { target: { value: "depends on" } });
  fireEvent.change(screen.getByLabelText("语义关系"), { target: { value: "depends_on" } });
  fireEvent.change(screen.getByLabelText("连接路径"), { target: { value: "curve" } });
  fireEvent.change(screen.getByLabelText("连接线型"), { target: { value: "dotted" } });
  fireEvent.change(screen.getByLabelText("连接起点"), { target: { value: "circle" } });
  fireEvent.change(screen.getByLabelText("连接终点"), { target: { value: "diamond" } });
  expect(readObjects(doc).find((object) => object.id === edge.id)?.connector).toMatchObject({ label: "depends on", semanticRelation: "depends_on", type: "curve", lineStyle: "dotted", startStyle: "circle", endStyle: "diamond" });
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("锁定"));
  openProperties();
  expect(screen.getByLabelText("连接标签")).toBeDisabled();
  expect(screen.getByLabelText("连接路径")).toBeDisabled();
  expect(screen.getByLabelText("连接线型")).toBeDisabled();
  expect(screen.getByLabelText("连接起点")).toBeDisabled();
  expect(screen.getByLabelText("连接终点")).toBeDisabled();
  doc.destroy();
});

it("groups, layers, duplicates the full subgraph, and ungroups through canonical spatial commands", () => {
  const doc = mount();
  fireEvent.click(screen.getByTestId("mock-create-a")); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("mock-create-b")); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("mock-select-stickies"));
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("组合"));
  const original = readObjects(doc).find((object) => object.kind === "group")!;
  expect(readObjects(doc).filter((object) => object.kind === "sticky").every((object) => object.parentId === original.id)).toBe(true);
  openActions();
  fireEvent.click(screen.getByTestId("board-spatial-duplicate"));
  expect(readObjects(doc).filter((object) => object.kind === "group")).toHaveLength(2);
  expect(readObjects(doc).filter((object) => object.kind === "sticky")).toHaveLength(4);
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("置于顶层"));
  const duplicate = readObjects(doc).filter((object) => object.kind === "group").find((object) => object.id !== original.id)!;
  expect(duplicate.zIndex).toBeGreaterThanOrEqual(original.zIndex ?? 0);
  openActions();
  fireEvent.click(within(screen.getByTestId("board-spatial-toolbar")).getByText("取消组合"));
  expect(readObjects(doc).filter((object) => object.kind === "group")).toHaveLength(1);
  expect(readObjects(doc).filter((object) => object.kind === "sticky" && object.parentId === null)).toHaveLength(2);
  doc.destroy();
});

it("preflights multi-delete and commits preserve-free endpoints in one UI transaction", () => {
  const doc = mount();
  fireEvent.click(screen.getByTestId("mock-create-a")); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("mock-create-b")); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  const [a, b] = readObjects(doc), port = new SpatialRelationshipCommandPort(doc);
  act(() => {
    port.dispatch({ boardId: "spatial-board", clientId: "fixture", gestureId: "edge", command: { type: "create-connector", id: "edge", relationship: { from: a!.id, to: b!.id, fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "" } } });
    port.dispatch({ boardId: "spatial-board", clientId: "fixture", gestureId: "lock-edge", command: { type: "set-locked", objectIds: ["edge"], locked: true } });
  });
  fireEvent.click(screen.getByTestId("mock-select-stickies"));
  const before = readObjects(doc);
  fireEvent.click(screen.getByLabelText("更多白板操作"));
  fireEvent.click(screen.getByRole("button", { name: "删除选中" }));
  fireEvent.keyDown(document,{key:"Escape"});
  expect(readObjects(doc)).toEqual(before);
  act(() => port.dispatch({ boardId: "spatial-board", clientId: "fixture", gestureId: "unlock-edge", command: { type: "set-locked", objectIds: ["edge"], locked: false } }));
  const transactions: Y.Transaction[] = [];
  doc.on("afterTransaction", transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction); });
  openActions();
  fireEvent.click(screen.getByTestId("board-delete-preserve-connectors"));
  expect(readObjects(doc)).toHaveLength(1);
  expect(readObjects(doc)[0]).toMatchObject({ id: "edge", connector: { fromPoint: expect.any(Object), toPoint: expect.any(Object) } });
  expect(transactions).toHaveLength(1);
  doc.destroy();
});

it("keeps multi-selection quiet and restores handles for touch single-selection", () => {
  const doc=mount();fireEvent.click(screen.getByTestId("mock-create-a"));
  fireEvent.keyDown(screen.getByLabelText("对象文字"),{key:"Escape"});
  fireEvent.click(screen.getByTestId("mock-create-b"));fireEvent.keyDown(screen.getByLabelText("对象文字"),{key:"Escape"});
  fireEvent.click(screen.getByTestId("mock-select-stickies"));
  expect(screen.queryAllByTestId(/^connector-handle-/)).toHaveLength(0);
  const a=readObjects(doc)[0]!;fireEvent.click(screen.getByTestId(`mock-select-${a.id}`));
  expect(screen.getAllByTestId(/^connector-handle-/)).toHaveLength(4);
  const handle=screen.getByTestId(`connector-handle-${a.id}-right`);expect(handle).toHaveClass("h-11","w-11");
  fireEvent.click(handle);const b=readObjects(doc).find(object=>object.id!==a.id)!;
  fireEvent.click(screen.getByTestId(`mock-select-${b.id}`));fireEvent.click(screen.getByTestId(`connector-handle-${b.id}-left`));
  expect(readObjects(doc).find(object=>object.kind==='connector')?.connector).toMatchObject({from:a.id,to:b.id});
});

it("keeps sync text on one line and keeps history in the header and view controls separate from the bottom dock",()=>{
 mount();expect(screen.getByTestId('board-sync-status')).toHaveClass('whitespace-nowrap');
 expect(screen.getByTestId('board-editor-header')).not.toContainElement(screen.getByTestId('board-zoom-fit-board'));
 expect(screen.getByTestId('board-navigation-controls')).toContainElement(screen.getByTestId('board-zoom-fit-board'));
});
