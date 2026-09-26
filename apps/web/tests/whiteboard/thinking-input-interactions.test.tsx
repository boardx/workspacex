import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects, WhiteboardCommandOrigin } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop }: {
    objects: readonly BoardFabricObject[];
    onCanvasClick?: (point: { x: number; y: number }) => void;
    onCanvasDoubleClick?: (point: { x: number; y: number }) => void;
    onObjectDoubleClick?: (id: string) => void;
    onToolDrop?: (point: { x: number; y: number }, payload: string) => void;
  }) => <div data-testid="board-fabric-surface">
    <canvas data-testid="board-fabric-canvas" />
    <button data-testid="mock-canvas-click" onClick={() => onCanvasClick?.({ x: 100, y: 120 })}>canvas click</button>
    <button data-testid="mock-canvas-double" onClick={() => onCanvasDoubleClick?.({ x: 200, y: 220 })}>canvas double</button>
    <button data-testid="mock-object-double" onClick={() => objects[0] && onObjectDoubleClick?.(objects[0].id)}>object double</button>
    <button data-testid="mock-tool-drop" onClick={() => onToolDrop?.({ x: 300, y: 320 }, JSON.stringify({ kind: "sticky", variant: "circle" }))}>tool drop</button>
  </div>,
}));

class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const editor = (readOnly = false) => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="thinking-board" clientId="thinking-client" doc={doc} readOnly={readOnly} title="想法板" status="已连接" />);
  return doc;
};

it("double-clicks blank Fabric space into an immediately focused, IME-safe sticky editor", () => {
  const doc = editor();
  fireEvent.click(screen.getByTestId("mock-canvas-double"));
  const input = screen.getByLabelText("对象文字");
  expect(input).toHaveFocus();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "中文想法" } });
  expect(readObjects(doc)[0]?.text).toBe("");
  fireEvent.compositionEnd(input, { data: "中文想法" });
  fireEvent.change(input, { target: { value: "中文想法" } });
  expect(readObjects(doc)[0]?.text).toBe("中文想法");
  expect(screen.queryByLabelText("未应用的输入草稿")).toBeNull();
  doc.destroy();
});

it("creates twenty 24px-spaced stickies by typing and pressing Tab without opening a menu", () => {
  const doc = editor();
  fireEvent.click(screen.getByTestId("mock-canvas-double"));
  for (let index = 0; index < 19; index++) {
    const input = screen.getByLabelText("对象文字");
    fireEvent.change(input, { target: { value: `想法 ${index + 1}` } });
    fireEvent.keyDown(input, { key: "Tab" });
  }
  fireEvent.change(screen.getByLabelText("对象文字"), { target: { value: "想法 20" } });
  const notes = readObjects(doc);
  expect(notes).toHaveLength(20);
  expect(notes.every((note) => note.kind === "sticky")).toBe(true);
  const xPositions = notes.map((note) => note.geometry.x).sort((left, right) => left - right);
  for (let index = 1; index < xPositions.length; index++) expect(xPositions[index]! - xPositions[index - 1]!).toBe(204);
  doc.destroy();
});

it("guards shortcuts inside inputs and creates from N/T only when canvas context owns the key", () => {
  const doc = editor();
  const title = screen.getByLabelText("白板名称");
  fireEvent.keyDown(title, { key: "n" });
  expect(readObjects(doc)).toHaveLength(0);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })));
  expect(readObjects(doc)).toHaveLength(1);
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "t" });
  expect(readObjects(doc)).toHaveLength(1);
  doc.destroy();
});

it("exposes three sticky shapes and five text presets from the touch dock", () => {
  const doc = editor();
  fireEvent.click(screen.getByTestId("board-add-sticky"));
  expect(screen.getByTestId("board-sticky-square")).toBeVisible();
  expect(screen.getByTestId("board-sticky-rectangle")).toBeVisible();
  expect(screen.getByTestId("board-sticky-circle")).toBeVisible();
  const setData = vi.fn();
  fireEvent.dragStart(screen.getByTestId("board-sticky-circle"), { dataTransfer: { setData, effectAllowed: "" } });
  expect(setData).toHaveBeenCalledWith("application/x-workspacex-board-tool", JSON.stringify({ kind: "sticky", variant: "circle" }));
  fireEvent.click(screen.getByTestId("board-add-text"));
  for (const preset of ["title", "heading", "subheading", "body", "caption"]) expect(screen.getByTestId(`board-text-${preset}`)).toBeVisible();
  fireEvent.click(screen.getByTestId("board-text-title"));
  fireEvent.click(screen.getByTestId("mock-canvas-click"));
  const created = readObjects(doc).find((item) => item.kind === "text" && item.style.fontSize === 48)!;
  expect(created.kind).toBe("text");
  expect(created.style.fontSize).toBe(48);
  doc.destroy();
});

it("dispatches Shift+N bulk creation as one command transaction for up to 100 rows", () => {
  const doc = editor();
  const origins: WhiteboardCommandOrigin[] = [];
  doc.on("afterTransaction", (transaction) => { if (transaction.origin instanceof WhiteboardCommandOrigin) origins.push(transaction.origin); });
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true, bubbles: true })));
  fireEvent.change(screen.getByTestId("board-bulk-text"), { target: { value: "研究\n设计\n验证" } });
  fireEvent.click(screen.getByTestId("board-bulk-apply"));
  expect(readObjects(doc).map((item) => item.text)).toEqual(["研究", "设计", "验证"]);
  expect(origins).toHaveLength(1);
  expect(new Set(origins.map((origin) => origin.operationId)).size).toBe(1);
  doc.destroy();
});

it("offers intelligent multiline paste and creates the chosen stickies in one operation", () => {
  const doc = editor();
  fireEvent.paste(screen.getByTestId("collaborative-editor"), { clipboardData: { getData: () => "发现\n定义\n交付" } });
  expect(screen.getByText("如何放入这些内容？")).toBeVisible();
  fireEvent.click(screen.getByTestId("board-paste-stickies"));
  expect(readObjects(doc).map((item) => item.text)).toEqual(["发现", "定义", "交付"]);
  doc.destroy();
});

it("accepts dock drag payloads at the Fabric drop point and rejects every read-only creation path", () => {
  const writable = editor();
  fireEvent.click(screen.getByTestId("mock-tool-drop"));
  expect(readObjects(writable)[0]?.geometry).toMatchObject({ x: 210, y: 230, width: 180, height: 180 });
  writable.destroy(); cleanup();

  const readonly = editor(true);
  fireEvent.click(screen.getByTestId("mock-canvas-double"));
  fireEvent.click(screen.getByTestId("mock-tool-drop"));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })));
  expect(readObjects(readonly)).toEqual([]);
  expect(screen.getByTestId("board-add-sticky")).toBeDisabled();
  readonly.destroy();
});
