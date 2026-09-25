import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canvasState = vi.hoisted(() => ({ instances: 0, activeObjectId: null as string | null, objects: [] as Array<{ data?: { boardObjectId?: string }; left: number; top: number; width: number; height: number; scaleX: number; scaleY: number }> }));

vi.mock("fabric", () => {
  class Shape {
    data?: { boardObjectId?: string };
    left = 0; top = 0; width = 100; height = 80; scaleX = 1; scaleY = 1;
    constructor(_value?: unknown, options: Record<string, unknown> = {}) { Object.assign(this, options); }
    set(value: Record<string, unknown>) { Object.assign(this, value); return this; }
    setControlsVisibility() { return this; }
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width, height: this.height }; }
  }
  class Canvas {
    viewportTransform = [1, 0, 0, 1, 0, 0]; selection = true; defaultCursor = "default"; private objects: Shape[] = []; private zoom = 1;
    constructor() { canvasState.instances += 1; }
    add(object: Shape) { this.objects.push(object); canvasState.objects.push(object); }
    getObjects() { return this.objects; }
    getActiveObject() { return undefined; }
    setActiveObject(object: Shape) { canvasState.activeObjectId = object.data?.boardObjectId ?? null; }
    on() {} dispose() {} requestRenderAll() {} setDimensions() {} setViewportTransform(value: number[]) { this.viewportTransform = value; }
    getWidth() { return 1200; } getHeight() { return 720; } getZoom() { return this.zoom; } setZoom(value: number) { this.zoom = value; }
    zoomToPoint(_point: unknown, value: number) { this.zoom = value; }
    getScenePoint() { return { x: 100, y: 100 }; }
  }
  return { Canvas, Rect: Shape, Circle: Shape, Textbox: Shape, Group: Shape, Point: Shape, Shadow: Shape };
});

class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

import { BoardFabricPreview } from "@/components/whiteboard/fabric-preview/board-fabric-preview";

describe("Board Fabric V0.1 preview", () => {
  beforeEach(() => { canvasState.instances = 0; canvasState.activeObjectId = null; canvasState.objects.length = 0; });

  it("mounts a real Fabric canvas projection instead of DOM whiteboard objects", () => {
    const { container } = render(<BoardFabricPreview />);
    expect(screen.getByTestId("board-fabric-canvas").tagName).toBe("CANVAS");
    expect(canvasState.instances).toBe(1);
    expect(canvasState.objects.length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('[data-testid^="whiteboard-object-"]')).toBeNull();
  });

  it("exposes every creation/navigation tool and the full 5%-800% zoom range", () => {
    render(<BoardFabricPreview />);
    for (const id of ["select", "hand", "sticky", "text", "rectangle", "ellipse"]) expect(screen.getByTestId(`board-tool-${id}`)).toBeVisible();
    for (let index = 0; index < 40; index += 1) fireEvent.click(screen.getByTestId("board-zoom-out"));
    expect(screen.getByTestId("board-zoom-value")).toHaveTextContent("5%");
    for (let index = 0; index < 80; index += 1) fireEvent.click(screen.getByTestId("board-zoom-in"));
    expect(screen.getByTestId("board-zoom-value")).toHaveTextContent("800%");
    expect(screen.getByTestId("board-zoom-fit")).toBeVisible();
  });

  it("publishes an accessible DOM mirror while clearly disclosing preview boundaries", () => {
    render(<BoardFabricPreview />);
    const list = screen.getByTestId("board-a11y-object-list");
    expect(list).toHaveAttribute("aria-label", "白板对象");
    expect(list.querySelectorAll("li")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("board-a11y-object-sticky-observe"));
    expect(canvasState.activeObjectId).toBe("sticky-observe");
    expect(screen.getByTestId("board-preview-disclosure")).toHaveTextContent("未连接 Yjs 或服务端");
    expect(screen.getByTestId("board-preview-badge")).toHaveTextContent("Preview");
  });
});
