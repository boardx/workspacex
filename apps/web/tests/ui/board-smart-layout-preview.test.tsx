import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WhiteboardCommandOrigin, createWhiteboardDocument, executeCommands, readObjects, type WhiteboardObject } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange }: { objects: readonly BoardFabricObject[]; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => <div data-testid="mock-surface" data-geometries={JSON.stringify(objects.map(object => ({ id: object.id, geometry: object.geometry })))}>
    <button data-testid="select-all" onClick={() => onSelectionChange(objects.map(object => object.id), "canvas")}>select all</button>
  </div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

const note = (id: string, x: number, y: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: "sticky", geometry: { x, y, width: 100, height: 80, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });
const geometry = (doc: ReturnType<typeof createWhiteboardDocument>) => readObjects(doc).map(object => ({ id: object.id, geometry: object.geometry }));
const projected = () => JSON.parse(screen.getByTestId("mock-surface").getAttribute("data-geometries") ?? "[]") as ReturnType<typeof geometry>;

it("renders deterministic before/after preview, cancels without mutation, and confirms in one operation", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("a", 0, 0) }, { type: "create", object: note("b", 320, 180) }, { type: "create", object: note("c", 80, 360) }, { type: "create", object: note("d", 500, 40) }], "seed");
  const before = geometry(doc);
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-all"));
  fireEvent.click(screen.getByTestId("board-layout-smart-preview"));
  expect(screen.getByTestId("board-layout-preview")).toHaveTextContent("Grid 预览");
  expect(geometry(doc)).toEqual(before);
  const firstPreview = projected();
  expect(firstPreview).not.toEqual(before);
  fireEvent.click(screen.getByTestId("board-layout-preview-cancel"));
  expect(geometry(doc)).toEqual(before);
  expect(projected()).toEqual(before);

  fireEvent.click(screen.getByTestId("board-layout-smart-preview"));
  expect(projected()).toEqual(firstPreview);
  let transactions = 0;
  doc.on("afterTransaction", transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions += 1; });
  fireEvent.click(screen.getByTestId("board-layout-preview-apply"));
  expect(geometry(doc)).toEqual(firstPreview);
  expect(transactions).toBe(1);
  expect(screen.getByText("智能布局已应用。", { exact: true })).toBeVisible();
  doc.destroy();
});

it("blocks all other mutation controls while a preview is pending", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("a", 0, 0) }, { type: "create", object: note("b", 320, 180) }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-all"));
  fireEvent.click(screen.getByTestId("board-smart-timeline"));
  expect(screen.getByTestId("board-layout-preview")).toHaveTextContent("Timeline 预览");
  expect(screen.getByText("撤销", { exact: true })).toBeDisabled();
  expect(screen.getByText("粘贴", { exact: true })).toBeDisabled();
  expect(screen.getByTestId("board-layout-row")).toBeDisabled();
  doc.destroy();
});
