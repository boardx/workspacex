import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects, SpatialRelationshipCommandPort } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import { boardToolbarPosition } from "@/components/whiteboard/use-board-toolbar-position";
import type { BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

let camera: BoardViewport;
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onViewportChange,onCanvasClick }: { onCanvasClick:(point:{x:number;y:number})=>void;onViewportChange: (viewport: BoardViewport) => void }) => <><button data-testid="test-create" onClick={()=>onCanvasClick({x:400,y:300})}>place</button><button data-testid="test-camera" onClick={() => onViewportChange(camera)}>camera</button></> }));
class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverMock); vi.stubGlobal("innerWidth", 1024); vi.stubGlobal("innerHeight", 768); camera = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const cases = [
  { edge: "below viewport", x: 300, y: 900, zoom: 1 },
  { edge: "above viewport", x: 300, y: -900, zoom: 1 },
  { edge: "left of viewport", x: -900, y: 300, zoom: 1 },
  { edge: "right of viewport", x: 1900, y: 300, zoom: 1 },
  { edge: "zoomed lower right", x: 700, y: 500, zoom: 8 },
  { edge: "zoomed upper left", x: -700, y: -500, zoom: 8 },
];
for (const kind of ["sticky", "shape"] as const) {
  it.each(cases)(`${kind} toolbar stays fully inside the safe area at $edge`, ({ x, y, zoom }) => {
    const doc = createWhiteboardDocument();
    render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
    fireEvent.click(screen.getByTestId(`board-add-${kind}`));
    if(kind === "sticky")fireEvent.click(screen.getByTestId("test-create"));
    const object = readObjects(doc)[0]!;
    act(() => { new SpatialRelationshipCommandPort(doc).dispatch({ boardId: "board", clientId: "test", gestureId: "edge", command: { type: "transform", items: [{ id: object.id, geometry: { ...object.geometry, x, y } }] } }); });
    camera = { ...camera, zoom };
    fireEvent.click(screen.getByTestId("test-camera"));
    const toolbar = screen.getByTestId("board-context-toolbar");
    expect(Number.parseFloat(toolbar.style.left)).toBeGreaterThanOrEqual(16);
    expect(Number.parseFloat(toolbar.style.left) + 460).toBeLessThanOrEqual(1024 - 16);
    expect(Number.parseFloat(toolbar.style.top)).toBeGreaterThanOrEqual(72);
    expect(Number.parseFloat(toolbar.style.top) + 54).toBeLessThanOrEqual(768 - 112);
    // Resize must update both toolbar paths without waiting for any document mutation.
    act(() => { vi.stubGlobal("innerWidth", 640); vi.stubGlobal("innerHeight", 480); window.dispatchEvent(new Event("resize")); });
    expect(Number.parseFloat(toolbar.style.left) + 460).toBeLessThanOrEqual(640 - 16);
    expect(Number.parseFloat(toolbar.style.top) + 54).toBeLessThanOrEqual(480 - 112);
    doc.destroy();
  });
}

it("places the full measured toolbar above an object or below it when the header prevents that", () => {
  const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
  const object = { x: 400, y: 300, width: 180, height: 180 };
  const size = { width: 1024, height: 768 }, toolbar = { width: 370, height: 54 };
  const above = boardToolbarPosition(object, viewport, size, toolbar);
  expect(Number(above.top) + toolbar.height).toBeLessThan(object.y);
  const below = boardToolbarPosition({ ...object, y: 80 }, viewport, size, toolbar);
  expect(Number(below.top)).toBeGreaterThan(80 + object.height);
});

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const controls = [{ x: 16, y: 64, width: 264, height: 54 }, { x: 16, y: 128, width: 264, height: 54 }];
it.each([{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }])("keeps Fit/Undo and object text clear in $width × $height", (size) => {
  const geometry = { x: 160, y: 200, width: 320, height: 96 }, viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
  const style = boardToolbarPosition(geometry, viewport, size, { width: 440, height: 54 }, controls);
  const rect = { x: Number(style.left), y: Number(style.top), width: 440, height: 54 };
  for (const obstacle of [...controls, geometry]) expect(intersects(rect, obstacle)).toBe(false);
});

for (const kind of ["sticky", "shape"] as const) it(`${kind} reads measured chrome in offset-parent coordinates and avoids it`, () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const chrome = this.dataset.boardChrome;
    if (chrome) { const control = controls[chrome === "header" ? 0 : 1]!; return DOMRect.fromRect({ x: control.x + 80, y: control.y + 40, width: control.width, height: control.height }); }
    if (this.dataset.testid === "collaborative-editor") return DOMRect.fromRect({ x: 80, y: 40, width: 1024, height: 768 });
    if (this.dataset.testid === "board-context-toolbar") return DOMRect.fromRect({ width: 440, height: 54 });
    return DOMRect.fromRect({});
  });
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId(`board-add-${kind}`));
    if(kind === "sticky")fireEvent.click(screen.getByTestId("test-create"));
  const object = readObjects(doc)[0]!, geometry = { ...object.geometry, x: 160, y: 200 };
  act(() => { new SpatialRelationshipCommandPort(doc).dispatch({ boardId: "board", clientId: "test", gestureId: "chrome", command: { type: "transform", items: [{ id: object.id, geometry }] } }); });
  const toolbar = screen.getByTestId("board-context-toolbar");
  const rect = { x: Number.parseFloat(toolbar.style.left), y: Number.parseFloat(toolbar.style.top), width: 440, height: 54 };
  for (const obstacle of [...controls, geometry]) expect(intersects(rect, obstacle)).toBe(false);
  doc.destroy();
});
