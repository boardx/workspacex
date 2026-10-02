// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    constructor(value?: unknown, options: Record<string, unknown> = {}) { this.children = Array.isArray(value) ? value : []; Object.assign(this, options); }
    getObjects() { return this.children; }
    private children: MockFabricObject[] = [];
    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility() { return this; }
    setCoords() {}
    // Fabric matrices use the object's center; left/top remain the top-left
    // origin used by this fixture. Retain the real qrDecompose implementation.
    calcTransformMatrix() {
      const radians = this.angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
      const width = this.width * this.scaleX, height = this.height * this.scaleY;
      return [cos * this.scaleX, sin * this.scaleX, -sin * this.scaleY, cos * this.scaleY,
        this.left + cos * width / 2 - sin * height / 2, this.top + sin * width / 2 + cos * height / 2];
    }
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
  }
  interface MockCanvas {
    objects: MockFabricObject[];
    _currentTransform: { target: MockFabricObject } | null;
    handlers: Map<string, Handler[]>;
    emit(name: string, event?: { target?: MockFabricObject; e?: unknown }): void;
  }
  return { state, MockFabricObject };
});

vi.mock("fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric")>();
  const MockFabricObject = fabricHarness.MockFabricObject;
  type Handler = (event: { target?: InstanceType<typeof MockFabricObject>; e?: unknown }) => void;
  class Canvas {
    objects: InstanceType<typeof MockFabricObject>[] = [];
    handlers = new Map<string, Handler[]>();
    viewportTransform = [1, 0, 0, 1, 0, 0];
    _currentTransform: { target: InstanceType<typeof MockFabricObject> } | null = null;
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
    _onTouchEnd() {}
    dispose() {}
    requestRenderAll() {}
    setDimensions() {}
    getScenePoint(event: {clientX?:number;clientY?:number;touches?:Array<{clientX:number;clientY:number}>;changedTouches?:Array<{clientX:number;clientY:number}>}) { const p=event.changedTouches?.[0]??event.touches?.[0]??event;return {x:p.clientX,y:p.clientY}; }
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
    ...actual,
    Canvas,
    Line: MockFabricObject,
    Path: MockFabricObject,
    Triangle: MockFabricObject,
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
  onObjectTransform: vi.fn(() => false),
  onTransformPreview: vi.fn(),
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

  it("previews attached connectors and chrome after snapping without committing, then restores rejection", () => {
    const events = callbacks();
    const edge: BoardFabricObject = { ...base, id: "edge", kind: "connector", orderKey: "b", geometry: { x: 210, y: 90, width: 290, height: 10, rotation: 0 }, connector: { from: base.id, fromAnchor: "right", toAnchor: "left", fromOffset: { x: 5, y: 0 }, type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "", start: { x: 215, y: 90 }, end: { x: 500, y: 100 } } };
    render(surface([base, edge], events));
    const canvas = mountedCanvas(), target = canvas.objects.find(item => item.data?.boardObjectId === base.id)!;
    target.set({ left: 80, top: 130 });
    act(() => canvas.emit("object:moving", { target, e: new MouseEvent("mousemove", { altKey: true }) }));
    expect(events.onTransformPreview).toHaveBeenLastCalledWith([{ id: base.id, geometry: { x: 80, y: 130, width: 200, height: 140, rotation: 0 } }]);
    expect(events.onObjectTransform).not.toHaveBeenCalled();
    expect(canvas.objects.find(item => item.data?.boardObjectId === "edge")?.left).toBe(285);
    act(() => canvas.emit("object:modified", { target }));
    expect(events.onObjectTransform).toHaveBeenCalledTimes(1);
    expect(events.onTransformPreview).toHaveBeenLastCalledWith([]);
    expect(target.left).toBe(base.geometry.x);
    expect(canvas.objects.find(item => item.data?.boardObjectId === "edge")?.left).toBe(215);
  });

  it("reports rotated and scaled geometry and clears preview on native cancellation", () => {
    const events = callbacks(); render(surface([base], events));
    const canvas = mountedCanvas(), target = firstProjected(canvas);
    target.set({ angle: 90, scaleX: 2, scaleY: 2 });
    act(() => canvas.emit("object:rotating", { target, e: new MouseEvent("mousemove", { altKey: true }) }));
    expect(events.onTransformPreview.mock.calls.at(-1)?.[0][0]?.geometry).toMatchObject({ width: 400, height: 280, rotation: 90 });
    canvas._currentTransform = { target };
    act(() => canvas.emit("mouse:down", { target, e: new MouseEvent("mousedown", { clientX: 20, clientY: 30 }) }));
    const cancel = new Event("pointercancel", { bubbles: true }); Object.assign(cancel, { pointerType: "mouse", isPrimary: true });
    fireEvent(screen.getByTestId("board-fabric-canvas"), cancel);
    expect(events.onTransformPreview).toHaveBeenLastCalledWith([]);
    expect(events.onObjectTransform).not.toHaveBeenCalled();
  });

  it("pans unmodified wheel input without publishing an object command", () => {
    const events = callbacks();
    render(surface([base], events));
    act(() => mountedCanvas().emit("mouse:wheel", { e: new WheelEvent("wheel", { deltaX: 12, deltaY: 30 }) }));
    expect(events.onViewportChange).toHaveBeenCalledWith({ ...viewport, panX: -12, panY: -30 }, "wheel");
    expect(events.onObjectTransform).not.toHaveBeenCalled();
  });

  it.each([1, 2])("pans button %i outside the canvas and cancels on Escape or blur", (button) => {
    const events = callbacks();
    render(surface([base], events));
    const element = screen.getByTestId("board-fabric-canvas");
    fireEvent.mouseDown(element, { button, clientX: 100, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 150 });
    fireEvent.keyDown(document, { key: "Escape" });
    expect((mountedCanvas() as unknown as { viewportTransform: number[] }).viewportTransform).toEqual([1, 0, 0, 1, 0, 0]);
    fireEvent.mouseDown(element, { button, clientX: 100, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 150 });
    fireEvent.blur(window);
    expect(events.onViewportChange).not.toHaveBeenCalled();
    fireEvent.mouseDown(element, { button, clientX: 100, clientY: 120 });
    fireEvent.mouseUp(document, { button, clientX: 140, clientY: 150 });
    expect(events.onViewportChange).toHaveBeenCalledWith({ ...viewport, panX: 40, panY: 30 }, "pan");
    expect(events.onObjectTransform).not.toHaveBeenCalled();
  });

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
      width: base.geometry.width * 2,
      height: base.geometry.height * 1.5,
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

const finger=(x:number,y:number,id=7,force=.6)=>({identifier:id,clientX:x,clientY:y,force});
it("pans the Fabric default touch path with finite screen delta and only primary release",()=>{
 fabricHarness.state.canvases.length=0;const events=callbacks();render(createElement(BoardFabricSurface,{objects:[],selectedObjectIds:[],readOnly:false,tool:"hand",viewport,...events}));const canvas=mountedCanvas();
 canvas.emit("mouse:down",{e:{type:"touchstart",touches:[finger(100,120)]}});
 canvas.emit("mouse:move",{e:{type:"touchmove",touches:[finger(140,150)]}});
 expect(events.onViewportChange).toHaveBeenCalledTimes(1);
 expect(events.onViewportChange).toHaveBeenLastCalledWith({...viewport,panX:40,panY:30},"pan");
 canvas.emit("mouse:up",{e:{type:"touchend",changedTouches:[finger(1,2,8)]}});
 expect(events.onViewportChange).toHaveBeenCalledTimes(1);
 expect(events.onViewportChange).toHaveBeenLastCalledWith({...viewport,panX:40,panY:30},"pan");
 canvas.emit("mouse:up",{e:{type:"touchend",touches:[],changedTouches:[finger(140,150)]}});
 expect(events.onViewportChange).toHaveBeenCalledTimes(2);
 expect(events.onViewportChange).toHaveBeenLastCalledWith({...viewport,panX:40,panY:30},"pan");
});
it("cancel discards drawing and permits a subsequent touch gesture",()=>{
 fabricHarness.state.canvases.length=0;const events=callbacks(),onDrawingComplete=vi.fn();render(createElement(BoardFabricSurface,{objects:[],selectedObjectIds:[],readOnly:false,tool:"draw-pen",viewport,...events,onDrawingComplete}));const canvas=mountedCanvas();
 canvas.emit("mouse:down",{e:{type:"touchstart",touches:[finger(1,2)]}});canvas.emit("mouse:move",{e:{type:"touchmove",touches:[finger(3,4)]}});
 const cancel=new Event("touchcancel");Object.defineProperty(cancel,"changedTouches",{value:[finger(3,4)]});document.dispatchEvent(cancel);
 canvas.emit("mouse:up",{e:{type:"touchend",changedTouches:[finger(3,4)]}});expect(onDrawingComplete).not.toHaveBeenCalled();
 canvas.emit("mouse:down",{e:{type:"touchstart",touches:[finger(10,20,9,.8)]}});canvas.emit("mouse:move",{e:{type:"touchmove",touches:[finger(30,40,9,.9)]}});canvas.emit("mouse:up",{e:{type:"touchend",changedTouches:[finger(30,40,9)]}});
 expect(onDrawingComplete).toHaveBeenCalledTimes(1);expect(onDrawingComplete).toHaveBeenCalledWith(expect.objectContaining({tool:"pen",points:[{x:10,y:20,pressure:.8},{x:30,y:40,pressure:.9}]}));
});

it("reads real pen pressure alongside compatibility mouse events without changing Fabric mode",()=>{
 fabricHarness.state.canvases.length=0;const onDrawingComplete=vi.fn();const view=render(createElement(BoardFabricSurface,{objects:[],selectedObjectIds:[],readOnly:false,tool:"draw-pen",viewport,...callbacks(),onDrawingComplete}));const canvas=mountedCanvas(),element=view.container.querySelector("canvas")!;
 const pen=(type:string,x:number,y:number,pressure:number)=>{const event=new Event(type,{bubbles:true});Object.assign(event,{pointerType:"pen",pointerId:3,isPrimary:true,clientX:x,clientY:y,pressure});element.dispatchEvent(event);};
 pen("pointerdown",10,20,.25);canvas.emit("mouse:down",{e:{type:"mousedown",clientX:10,clientY:20}});pen("pointermove",30,40,.75);canvas.emit("mouse:move",{e:{type:"mousemove",clientX:30,clientY:40}});canvas.emit("mouse:up",{e:{type:"mouseup",clientX:30,clientY:40}});
 expect(onDrawingComplete).toHaveBeenCalledWith(expect.objectContaining({tool:"pen",points:[{x:10,y:20,pressure:.25},{x:30,y:40,pressure:.75}]}));view.unmount();
});
it("native two-finger input owns anchored zoom until all fingers lift",()=>{
 fabricHarness.state.canvases.length=0;const events=callbacks();const view=render(createElement(BoardFabricSurface,{objects:[],selectedObjectIds:[],readOnly:false,tool:"hand",viewport,...events}));const canvas=mountedCanvas(),element=view.container.querySelector("canvas")!;
 const dispatch=(type:string,touches:ReturnType<typeof finger>[])=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{touches,changedTouches:touches});element.dispatchEvent(event);};
 canvas.emit("mouse:down",{e:{type:"touchstart",touches:[finger(100,100)]}});
 dispatch("touchstart",[finger(100,100),finger(200,100,8)]);
 dispatch("touchmove",[finger(50,100),finger(250,100,8)]);
 expect(events.onViewportChange).toHaveBeenLastCalledWith({...viewport,zoom:2,panX:-150,panY:-100},"pan");
 const count=events.onViewportChange.mock.calls.length;
 dispatch("touchend",[finger(50,100)]);canvas.emit("mouse:move",{e:{type:"touchmove",touches:[finger(90,100)]}});expect(events.onViewportChange).toHaveBeenCalledTimes(count);
 dispatch("touchend",[]);
 canvas.emit("mouse:down",{e:{type:"touchstart",touches:[finger(10,20,9)]}});canvas.emit("mouse:move",{e:{type:"touchmove",touches:[finger(30,50,9)]}});canvas.emit("mouse:up",{e:{type:"touchend",changedTouches:[finger(30,50,9)]}});
 expect(events.onViewportChange).toHaveBeenLastCalledWith({...viewport,zoom:2,panX:-130,panY:-70},"pan");view.unmount();
});

it("touchcancel restores a dragged object projection without committing geometry", () => {
  fabricHarness.state.canvases.length = 0;
  const events = callbacks();
  render(surface([base], events));
  const canvas = mountedCanvas(), projected = firstProjected(canvas);
  canvas.emit("mouse:down", { target: projected, e: { type: "touchstart", touches: [finger(30, 40)] } });
  projected.set({ left: 50, top: 40, scaleX: 2, scaleY: 2 });
  canvas._currentTransform = { target: projected };
  expect(projected.left).not.toBe(base.geometry.x);
  const cancel = new Event("touchcancel");
  Object.defineProperty(cancel, "changedTouches", { value: [finger(70, 60)] });
  document.dispatchEvent(cancel);
  expect(canvas._currentTransform).toBeNull();
  expect(projected.left).toBe(base.geometry.x);
  expect(projected.top).toBe(base.geometry.y);
  expect(projected.scaleX).toBe(1);
  expect(projected.scaleY).toBe(1);
  expect(events.onObjectTransform).not.toHaveBeenCalled();
});
