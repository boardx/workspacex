import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects, SpatialRelationshipCommandPort } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import { boardToolbarPosition } from "@/components/whiteboard/use-board-toolbar-position";
import type { BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

let camera: BoardViewport;
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onViewportChange }: { onViewportChange: (viewport: BoardViewport) => void }) => <button data-testid="test-camera" onClick={() => onViewportChange(camera)}>camera</button> }));
class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverMock); vi.stubGlobal("innerWidth", 1024); vi.stubGlobal("innerHeight", 768); camera = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
