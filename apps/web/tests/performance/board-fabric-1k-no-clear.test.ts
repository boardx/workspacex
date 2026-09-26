// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fabricHarness = vi.hoisted(() => {
  const state = { canvases: [] as MockCanvas[], fabricObjectsCreated: 0 };
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
    constructor(_value?: unknown, options: Record<string, unknown> = {}) {
      state.fabricObjectsCreated += 1;
      Object.assign(this, options);
    }
    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility() { return this; }
    setCoords() {}
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
  }
  interface MockCanvas {
    objects: MockFabricObject[];
    clear: ReturnType<typeof vi.fn>;
    loadFromJSON: ReturnType<typeof vi.fn>;
    requestRenderAll: ReturnType<typeof vi.fn>;
  }
  return { state, MockFabricObject };
});

vi.mock("fabric", () => {
  const MockFabricObject = fabricHarness.MockFabricObject;
  class Canvas {
    objects: InstanceType<typeof MockFabricObject>[] = [];
    viewportTransform = [1, 0, 0, 1, 0, 0];
    selection = true;
    defaultCursor = "default";
    clear = vi.fn(() => { this.objects = []; });
    loadFromJSON = vi.fn();
    requestRenderAll = vi.fn();
    constructor() { fabricHarness.state.canvases.push(this); }
    add(object: InstanceType<typeof MockFabricObject>) { this.objects.push(object); }
    remove(object: InstanceType<typeof MockFabricObject>) { this.objects = this.objects.filter((candidate) => candidate !== object); }
    moveObjectTo(object: InstanceType<typeof MockFabricObject>, index: number) {
      this.objects = this.objects.filter((candidate) => candidate !== object);
      this.objects.splice(index, 0, object);
    }
    getObjects() { return this.objects; }
    on() {}
    dispose() {}
    setDimensions() {}
    setViewportTransform(value: number[]) { this.viewportTransform = value; }
    getWidth() { return 1200; }
    getHeight() { return 720; }
    getZoom() { return this.viewportTransform[0]; }
    zoomToPoint() {}
    setActiveObject() {}
    discardActiveObject() {}
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
let nextFrameId = 1;
const renderFrames = new Map<number, FrameRequestCallback>();
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  const id = nextFrameId;
  nextFrameId += 1;
  renderFrames.set(id, callback);
  return id;
});
vi.stubGlobal("cancelAnimationFrame", (id: number) => { renderFrames.delete(id); });
const flushRenderFrames = () => {
  const pending = [...renderFrames.entries()];
  renderFrames.clear();
  for (const [, callback] of pending) callback(performance.now());
};

import { BoardFabricSurface } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const makeObject = (index: number): BoardFabricObject => ({
  id: `note-${index}`,
  kind: "sticky",
  revision: 1,
  orderKey: String(index).padStart(5, "0"),
  geometry: { x: index % 50 * 220, y: Math.floor(index / 50) * 160, width: 200, height: 140, rotation: 0 },
  style: { fill: "#f8d76e", textColor: "#29261e" },
  content: { text: `Note ${index}` },
});
const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
const callbacks = {
  onSelectionChange: vi.fn(),
  onObjectTransform: vi.fn(),
  onViewportChange: vi.fn(),
};
const surface = (objects: readonly BoardFabricObject[]) => createElement(BoardFabricSurface, {
  objects,
  selectedObjectIds: [],
  readOnly: false,
  tool: "select",
  viewport,
  ...callbacks,
});
const mountedCanvas = () => {
  const canvas = fabricHarness.state.canvases[0];
  if (!canvas) throw new Error("Fabric canvas did not mount");
  return canvas;
};

describe("Board Fabric 1k incremental projection boundary", () => {
  beforeEach(() => {
    fabricHarness.state.canvases.length = 0;
    fabricHarness.state.fabricObjectsCreated = 0;
    vi.clearAllMocks();
    renderFrames.clear();
    nextFrameId = 1;
  });

  it("patches 1000 entries in place without clear, loadFromJSON, canvas replacement, or extra frame renders", () => {
    const initial = Array.from({ length: 1001 }, (_, index) => makeObject(index));
    const view = render(surface(initial));
    const canvas = mountedCanvas();
    expect(canvas.objects).toHaveLength(1001);
    const references = new Map(canvas.objects.map((item) => [item.data?.boardObjectId, item]));
    const createdAtInitialProjection = fabricHarness.state.fabricObjectsCreated;
    flushRenderFrames();
    canvas.requestRenderAll.mockClear();

    const patched = initial.map((item, index) => index === 1000 ? item : {
      ...item,
      revision: 2,
      geometry: { ...item.geometry, x: item.geometry.x + 7, y: item.geometry.y + 11 },
    });
    view.rerender(surface(patched));
    expect(renderFrames.size).toBe(1);
    flushRenderFrames();

    expect(fabricHarness.state.canvases).toHaveLength(1);
    expect(fabricHarness.state.fabricObjectsCreated).toBe(createdAtInitialProjection);
    expect(canvas.clear).not.toHaveBeenCalled();
    expect(canvas.loadFromJSON).not.toHaveBeenCalled();
    expect(canvas.objects).toHaveLength(1001);
    for (const item of canvas.objects) {
      expect(item).toBe(references.get(item.data?.boardObjectId));
      const index = Number(item.data?.boardObjectId?.slice("note-".length));
      expect(item.data?.renderedRevision).toBe(index === 1000 ? 1 : 2);
    }
    expect(canvas.objects[1000]).toBe(references.get("note-1000"));
    expect(canvas.requestRenderAll).toHaveBeenCalledTimes(1);
  });
});
