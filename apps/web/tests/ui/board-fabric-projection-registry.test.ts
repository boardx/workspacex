// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fabricHarness = vi.hoisted(() => {
  let created = 0;
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
      created += 1;
      Object.assign(this, options);
    }

    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility() { return this; }
    setCoords() {}
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
  }
  const state = {
    canvases: [] as Array<{
      objects: MockFabricObject[];
      add: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      loadFromJSON: ReturnType<typeof vi.fn>;
      requestRenderAll: ReturnType<typeof vi.fn>;
    }>,
    get created() { return created; },
    set created(value: number) { created = value; },
  };
  return { state, MockFabricObject };
});
vi.mock("fabric", () => {
  const MockFabricObject = fabricHarness.MockFabricObject;
  type Shape = InstanceType<typeof MockFabricObject>;
  class Canvas {
    objects: Shape[] = [];
    viewportTransform = [1, 0, 0, 1, 0, 0];
    selection = true;
    defaultCursor = "default";
    add = vi.fn((object: Shape) => { this.objects.push(object); });
    remove = vi.fn((object: Shape) => { this.objects = this.objects.filter((candidate) => candidate !== object); });
    moveObjectTo = vi.fn((object: Shape, index: number) => {
      this.objects = this.objects.filter((candidate) => candidate !== object);
      this.objects.splice(index, 0, object);
    });
    clear = vi.fn(() => { this.objects = []; });
    loadFromJSON = vi.fn();
    requestRenderAll = vi.fn();
    constructor() { fabricState.canvases.push(this); }
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

const { state: fabricState, MockFabricObject } = fabricHarness;

class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

import { BoardFabricSurface } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const geometry = { x: 10, y: 20, width: 200, height: 140, rotation: 0 };
const object = (id: string, orderKey: string, revision = 1): BoardFabricObject => ({
  id,
  kind: "sticky",
  revision,
  orderKey,
  geometry: { ...geometry },
  style: { fill: "#f8d76e", textColor: "#29261e" },
  content: { text: id },
});
const callbacks = () => ({
  onSelectionChange: vi.fn(),
  onObjectTransform: vi.fn(),
  onViewportChange: vi.fn(),
});
const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
type MockShape = InstanceType<typeof MockFabricObject>;
const ids = (items: MockShape[]) => items.map((item) => item.data?.boardObjectId);
const surface = (objects: readonly BoardFabricObject[], events: ReturnType<typeof callbacks>) => createElement(BoardFabricSurface, {
  objects,
  selectedObjectIds: [],
  readOnly: false,
  tool: "select",
  viewport,
  ...events,
});

describe("Board Fabric incremental projection registry", () => {
  beforeEach(() => {
    fabricState.canvases.length = 0;
    fabricState.created = 0;
  });

  it("patches by stable object id, adds and removes only the changed entries, and never reloads the canvas", () => {
    const events = callbacks();
    const initial = [object("a", "a"), object("b", "b")];
    const view = render(surface(initial, events));
    const canvas = fabricState.canvases[0];
    if (!canvas) throw new Error("Fabric canvas did not mount");
    expect(ids(canvas.objects)).toEqual(["a", "b"]);
    const a = canvas.objects[0];
    const b = canvas.objects[1];
    if (!a || !b) throw new Error("Initial canonical objects were not projected");
    canvas.add.mockClear();
    canvas.remove.mockClear();

    view.rerender(surface([{ ...initial[0]!, revision: 2, geometry: { ...geometry, x: 75 } }, initial[1]!], events));

    expect(canvas.objects[0]).toBe(a);
    expect(canvas.objects[1]).toBe(b);
    expect(a.left).toBe(75);
    expect(canvas.add).not.toHaveBeenCalled();
    expect(canvas.remove).not.toHaveBeenCalled();

    view.rerender(surface([{ ...initial[0]!, revision: 2, geometry: { ...geometry, x: 75 } }, object("c", "c")], events));

    expect(canvas.remove).toHaveBeenCalledTimes(1);
    expect(canvas.remove).toHaveBeenCalledWith(b);
    expect(canvas.add).toHaveBeenCalledTimes(1);
    expect(ids(canvas.objects)).toEqual(["a", "c"]);
    expect(canvas.objects[0]).toBe(a);
    expect(canvas.clear).not.toHaveBeenCalled();
    expect(canvas.loadFromJSON).not.toHaveBeenCalled();
    expect(fabricState.canvases).toHaveLength(1);
  });

  it("keeps Fabric stacking order equal to canonical orderKey without recreating objects", () => {
    const events = callbacks();
    const initial = [object("a", "a"), object("b", "b"), object("c", "c")];
    const view = render(surface(initial, events));
    const canvas = fabricState.canvases[0];
    if (!canvas) throw new Error("Fabric canvas did not mount");
    const references = new Map(canvas.objects.map((item) => [item.data?.boardObjectId, item]));

    view.rerender(surface([{ ...initial[0]!, orderKey: "z" }, { ...initial[1]!, orderKey: "y" }, { ...initial[2]!, orderKey: "x" }], events));

    expect(ids(canvas.objects)).toEqual(["c", "b", "a"]);
    for (const item of canvas.objects) expect(item).toBe(references.get(item.data?.boardObjectId));
    expect(canvas.clear).not.toHaveBeenCalled();
    expect(canvas.loadFromJSON).not.toHaveBeenCalled();
  });
});
