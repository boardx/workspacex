// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fabricHarness = vi.hoisted(() => {
  type Handler = (event: { target?: MockFabricObject; e?: unknown }) => void;
  const state = { canvases: [] as MockCanvas[] };
  class MockFabricObject {
    data?: { boardObjectId?: string; adapterKind?: string; renderedRevision?: number };
    left = 0;
    top = 0;
    width = 100;
    height = 80;
    scaleX = 1;
    scaleY = 1;
    angle = 0;
    selectable = true;
    evented = true;
    constructor(_value?: unknown, options: Record<string, unknown> = {}) { Object.assign(this, options); }
    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility() { return this; }
    setCoords() {}
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
  }
  interface MockCanvas {
    objects: MockFabricObject[];
    handlers: Map<string, Handler[]>;
    emit(name: string, event?: { target?: MockFabricObject; e?: unknown }): void;
  }
  return { state, MockFabricObject };
});

vi.mock("fabric", () => {
  const MockFabricObject = fabricHarness.MockFabricObject;
  type Handler = (event: { target?: InstanceType<typeof MockFabricObject>; e?: unknown }) => void;
  class Canvas {
    objects: InstanceType<typeof MockFabricObject>[] = [];
    handlers = new Map<string, Handler[]>();
    viewportTransform = [1, 0, 0, 1, 0, 0];
    selection = true;
    defaultCursor = "default";
    private active?: InstanceType<typeof MockFabricObject>;
    constructor() { fabricHarness.state.canvases.push(this); }
    add(object: InstanceType<typeof MockFabricObject>) { this.objects.push(object); }
    remove(object: InstanceType<typeof MockFabricObject>) { this.objects = this.objects.filter((candidate) => candidate !== object); }
    moveObjectTo(object: InstanceType<typeof MockFabricObject>, index: number) {
      this.objects = this.objects.filter((candidate) => candidate !== object);
      this.objects.splice(index, 0, object);
    }
    getObjects() { return this.objects; }
    on(name: string, handler: Handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); }
    emit(name: string, event: { target?: InstanceType<typeof MockFabricObject>; e?: unknown } = {}) {
      for (const handler of this.handlers.get(name) ?? []) handler(event);
    }
    dispose() {}
    requestRenderAll() {}
    setDimensions() {}
    setViewportTransform(value: number[]) { this.viewportTransform = value; }
    getWidth() { return 1200; }
    getHeight() { return 720; }
    getZoom() { return this.viewportTransform[0]; }
    zoomToPoint() {}
    setActiveObject(object: InstanceType<typeof MockFabricObject>) { this.active = object; }
    discardActiveObject() { this.active = undefined; }
    getActiveObject() { return this.active; }
  }
  return {
    Canvas,
    Circle: MockFabricObject,
    Group: MockFabricObject,
    Point: MockFabricObject,
    Rect: MockFabricObject,
    Textbox: MockFabricObject,
  };
});

class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

import { BoardFabricSurface } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const base: BoardFabricObject = {
  id: "note-a",
  kind: "sticky",
  revision: 1,
  orderKey: "a",
  geometry: { x: 10, y: 20, width: 200, height: 140, rotation: 0 },
  style: { fill: "#f8d76e", textColor: "#29261e" },
  content: { text: "Remote-safe note" },
};
const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
const callbacks = () => ({
  onSelectionChange: vi.fn(),
  onObjectTransform: vi.fn(),
  onViewportChange: vi.fn(),
});
const surface = (objects: readonly BoardFabricObject[], events: ReturnType<typeof callbacks>, readOnly = false) => createElement(BoardFabricSurface, {
  objects,
  selectedObjectIds: [],
  readOnly,
  tool: "select",
  viewport,
  ...events,
});
const mountedCanvas = () => {
  const canvas = fabricHarness.state.canvases[0];
  if (!canvas) throw new Error("Fabric canvas did not mount");
  return canvas;
};
const firstProjected = (canvas: ReturnType<typeof mountedCanvas>) => {
  const projected = canvas.objects[0];
  if (!projected) throw new Error("Canonical object was not projected");
  return projected;
};

describe("Board Fabric event-to-command boundary", () => {
  beforeEach(() => { fabricHarness.state.canvases.length = 0; });

  it("emits one transform command only when a completed local Fabric gesture fires", () => {
    const events = callbacks();
    render(surface([base], events));
    const canvas = mountedCanvas();
    const projected = firstProjected(canvas);
    projected.set({ left: 45, top: 70, scaleX: 2, scaleY: 1.5, angle: 30 });

    for (let step = 0; step < 25; step += 1) canvas.emit("object:moving", { target: projected });
    expect(events.onObjectTransform).not.toHaveBeenCalled();

    canvas.emit("object:modified", { target: projected });
    expect(events.onObjectTransform).toHaveBeenCalledTimes(1);
    expect(events.onObjectTransform).toHaveBeenCalledWith("note-a", {
      x: 45,
      y: 70,
      width: 200,
      height: 120,
      rotation: 30,
    });
  });

  it("projects a remote canonical revision without echoing a local transform command", () => {
    const events = callbacks();
    const view = render(surface([base], events));
    const canvas = mountedCanvas();
    const projected = firstProjected(canvas);
    events.onObjectTransform.mockClear();

    const remote = { ...base, revision: 2, geometry: { ...base.geometry, x: 310, y: 240, rotation: 15 } };
    view.rerender(surface([remote], events));

    expect(canvas.objects[0]).toBe(projected);
    expect(projected.left).toBe(310);
    expect(projected.top).toBe(240);
    expect(projected.angle).toBe(15);
    expect(events.onObjectTransform).not.toHaveBeenCalled();

    projected.set({ left: 320 });
    canvas.emit("object:modified", { target: projected });
    expect(events.onObjectTransform).toHaveBeenCalledTimes(1);
  });

  it("restores canonical geometry and emits no command for a readonly gesture", () => {
    const events = callbacks();
    render(surface([base], events, true));
    const canvas = mountedCanvas();
    const projected = firstProjected(canvas);
    projected.set({ left: 999, top: 999, angle: 88 });

    canvas.emit("object:modified", { target: projected });

    expect(events.onObjectTransform).not.toHaveBeenCalled();
    expect(projected.left).toBe(base.geometry.x);
    expect(projected.top).toBe(base.geometry.y);
    expect(projected.angle).toBe(base.geometry.rotation);
  });
});
