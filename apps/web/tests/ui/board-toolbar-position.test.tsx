import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import { boardToolbarPosition } from "@/components/whiteboard/use-board-toolbar-position";
import type { BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

let camera: BoardViewport;
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onViewportChange,onCanvasClick }: { onCanvasClick:(point:{x:number;y:number})=>void;onViewportChange: (viewport: BoardViewport) => void }) => <><button data-testid="test-create" onClick={()=>onCanvasClick({x:400,y:300})}>place</button><button data-testid="test-camera" onClick={() => onViewportChange(camera)}>camera</button></> }));
class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverMock); vi.stubGlobal("innerWidth", 1024); vi.stubGlobal("innerHeight", 768); camera = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps selection compact until properties are opened, then keyboard-resizes the inspector", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("board-add-sticky"));
  fireEvent.click(screen.getByTestId("test-create"));
  const panel = screen.getByTestId("board-context-toolbar");
  expect(panel).toHaveAttribute("data-board-selected-object-panel", "true");
  expect(panel).toHaveAttribute("data-expanded", "false");
  expect(panel).toHaveClass("max-w-[min(27rem,calc(100vw-2rem))]");
  expect(screen.queryByTestId("board-inspector-expand")).toBeNull();
  expect(screen.queryByTestId("board-inspector-close")).toBeNull();
  fireEvent.click(screen.getByTestId("board-inspector-actions"));
  fireEvent.click(screen.getByTestId("board-properties-open"));
  expect(panel.style.left).toMatch(/px$/);
  expect(panel.style.top).toMatch(/px$/);
  const resize = screen.getByTestId("board-inspector-resize");
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(resize).toHaveAttribute("aria-valuenow", "296");
  fireEvent.click(screen.getByTestId("board-inspector-close"));
  expect(screen.queryByTestId("board-context-toolbar")).toBeNull();
  doc.destroy();
});

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
