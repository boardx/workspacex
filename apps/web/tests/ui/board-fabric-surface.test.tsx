import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_FABRIC_VISUAL } from "@/components/whiteboard/fabric/board-fabric-visual";
import { drawingToolStyle } from "@/components/whiteboard/drawing-tool-style";
import type { BoardFabricObject, BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

interface MockProjectedObject {
  data?: { boardObjectId?: string; adapterKind?: string; stickyVariant?: string; sizingMode?: string; drawingPreview?: boolean };
  left: number; top: number; width: number; height: number; scaleX: number; scaleY: number; angle: number;
  selectable: boolean; evented: boolean;
  mockKind?: string; children?: MockProjectedObject[]; controls?: Record<string, boolean>;
  fontFamily?: string; fontSize?: number; fontWeight?: number; fontStyle?: string; underline?: boolean; textAlign?: string; lineHeight?: number; fill?: string; hoverCursor?: string; lockScalingX?: boolean; lockScalingY?: boolean;
  clipPath?: unknown;
  matrix?: number[];
  text?: string; stroke?: string; strokeWidth?: number; opacity?: number;
  calcTransformMatrix: () => number[];
}

const probe = vi.hoisted(() => ({
  instances: 0,
  objects: [] as MockProjectedObject[],
  handlers: new Map<string, (event: { target?: MockProjectedObject; e?: MouseEvent }) => void>(),
  activeId: null as string | null,
  emitSelectionOnSet: false,
  zoom: 1,
  clearCalls: 0,
  renderCalls: 0,
  moveCalls: 0,
  active: null as MockProjectedObject | null,
  primitiveKinds: [] as string[],
  imageSources: [] as string[],
  imageOptions: [] as Record<string, unknown>[],
  canvas: null as { _currentTransform: unknown } | null,
  canvasWidth: 1200,
  canvasHeight: 800,
  resize: null as (() => void) | null,

}));

vi.mock("fabric", async () => {
  const actual = await vi.importActual<typeof import("fabric")>("fabric");
  class MockObject implements MockProjectedObject {
    data?: { boardObjectId?: string; adapterKind?: string; stickyVariant?: string; sizingMode?: string };
    left = 0; top = 0; width = 100; height = 80; scaleX = 1; scaleY = 1; angle = 0;
    selectable = true; evented = true;
    controls?: Record<string, boolean>;
    constructor(first?: unknown, second: Record<string, unknown> = {}) { if (first && typeof first === "object" && !Array.isArray(first)) Object.assign(this, first); if (typeof first === "string") Object.assign(this, { text: first }); Object.assign(this, second); }
    matrix?: number[];
    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility(values: Record<string, boolean>) { this.controls = { ...values }; return this; }
    setCoords() {}
    getPositionByOrigin() { return new actual.Point(this.left, this.top); }
    setPositionByOrigin(point: { x: number; y: number }) { this.left = point.x; this.top = point.y; }
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
    getTotalAngle() { return this.angle; }
    calcTransformMatrix() {
      if (this.matrix) return this.matrix;
      const radians = this.angle * Math.PI / 180, width = this.width * this.scaleX, height = this.height * this.scaleY;
      return [Math.cos(radians) * this.scaleX, Math.sin(radians) * this.scaleX, -Math.sin(radians) * this.scaleY, Math.cos(radians) * this.scaleY,
        this.left + Math.cos(radians) * width / 2 - Math.sin(radians) * height / 2,
        this.top + Math.sin(radians) * width / 2 + Math.cos(radians) * height / 2];
    }
  }
  class MockRect extends MockObject { mockKind = "rect"; constructor(first?: unknown, second?: Record<string, unknown>) { super(undefined, second ?? (first as Record<string, unknown>)); probe.primitiveKinds.push("Rect"); } }
  class MockCircle extends MockObject { mockKind = "circle"; constructor(first?: unknown, second?: Record<string, unknown>) { super(first, second); probe.primitiveKinds.push("Circle"); } }
  class MockTextbox extends MockObject {
    mockKind = "textbox";
    text?: string; fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeight?: number;
    initDimensions() {}
    calcTextWidth() {
      return new actual.Textbox(this.text ?? "", { width: this.width, fontFamily: this.fontFamily, fontSize: this.fontSize,
        fontWeight: this.fontWeight, lineHeight: this.lineHeight, splitByGrapheme: true }).calcTextWidth();
    }
  }
  class MockPath extends MockObject { constructor(first?: unknown, second?: Record<string, unknown>) { super(first, second); probe.primitiveKinds.push("Path"); } }
  class MockImage extends MockObject { constructor(first?: unknown, second: Record<string, unknown> = {}) { super(first, second); probe.primitiveKinds.push("Image"); probe.imageOptions.push(second); } setElement() {} }
  class MockGroup extends MockObject {
    mockKind = "group";
    children: MockProjectedObject[];
    constructor(children: MockProjectedObject[], second?: Record<string, unknown>) { super(children, second); this.children = children; probe.primitiveKinds.push("Group"); }
    getObjects() { return this.children; }
  }
  class Canvas {
    selection = true; defaultCursor = "default"; viewportTransform = [1, 0, 0, 1, 0, 0];
    upperCanvasEl = document.createElement("canvas");
    _currentTransform: unknown = null;
    constructor() { probe.instances += 1; probe.canvas = this; }
    add(object: MockProjectedObject) { probe.objects.push(object); }
    remove(object: MockProjectedObject) {
      probe.objects.splice(probe.objects.indexOf(object), 1);
      if (probe.active === object || probe.activeId === object.data?.boardObjectId) {
        probe.active = null;
        probe.activeId = null;
        probe.handlers.get("selection:cleared")?.({ target: object });
      }
    }
    getObjects() { return probe.objects as Array<MockObject>; }
    on(name: string, handler: (event: { target?: MockProjectedObject }) => void) { probe.handlers.set(name, handler); }
    dispose() {} requestRenderAll() { probe.renderCalls += 1; } setDimensions() {}
    moveObjectTo(object: MockProjectedObject, index: number) {
      probe.moveCalls += 1;
      const current = probe.objects.indexOf(object);
      if (current >= 0) probe.objects.splice(current, 1);
      probe.objects.splice(index, 0, object);
    }
    setViewportTransform(value: number[]) { this.viewportTransform = value; probe.zoom = value[0] ?? 1; }
    getWidth() { return probe.canvasWidth; } getHeight() { return probe.canvasHeight; } getZoom() { return probe.zoom; }
    zoomToPoint(_point: unknown, value: number) { probe.zoom = value; }
    getScenePoint(event?: MouseEvent) { return event && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : { x: 123, y: 234 }; }
    setActiveObject(object: MockProjectedObject) { probe.active = object; probe.activeId = object.data?.boardObjectId ?? null; if (probe.emitSelectionOnSet) probe.handlers.get("selection:updated")?.({ target: object }); }
    discardActiveObject() { probe.active = null; probe.activeId = null; }
    getActiveObject() { return probe.active ?? probe.objects.find((object) => object.data?.boardObjectId === probe.activeId); }
    clear() { probe.clearCalls += 1; }
  }
  class ActiveSelection extends MockObject {
    constructor(public objects: MockProjectedObject[]) { super(); }
    getObjects() { return this.objects; }
    removeAll() { const previous = this.objects; this.objects = []; return previous; }
    add(...objects: MockProjectedObject[]) { this.objects.push(...objects); return this.objects.length; }
    setControlsVisibility() { return this; }
  }
  const util = { qrDecompose: (matrix: number[] & { angle?: number }) => ({ angle: matrix.angle ?? Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1) * 180 / Math.PI, scaleX: Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0), scaleY: Math.hypot(matrix[2] ?? 0, matrix[3] ?? 1), translateX: matrix[4] ?? 0, translateY: matrix[5] ?? 0, skewX: 0, skewY: 0 }) };
  return { ActiveSelection, Canvas, Rect: MockRect, Circle: MockCircle, Line: MockObject, Path: MockPath, FabricImage: MockImage, Triangle: MockObject, Textbox: MockTextbox, Group: MockGroup, Point: MockObject, util };

});

class ResizeObserverMock { constructor(callback: () => void) { probe.resize = callback; } observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.stubGlobal("Image", class {
  alt = ""; onload: (() => void) | null = null; private value = "";
  set src(value: string) { this.value = value; probe.imageSources.push(value); }
  get src() { return this.value; }
});

import { BoardFabricSurface, connectorTipAngles } from "@/components/whiteboard/fabric/board-fabric-surface";

const OBJECTS: readonly BoardFabricObject[] = [
  { id: "s-1", kind: "sticky", revision: 1, orderKey: "a", geometry: { x: 40, y: 60, width: 220, height: 180, rotation: 0 }, style: { fill: "#F8D76E", textColor: "#29261E" }, content: { text: "一个观察" } },
  { id: "r-1", kind: "rectangle", revision: 1, orderKey: "b", geometry: { x: 360, y: 80, width: 240, height: 140, rotation: 5 }, style: { fill: "#D9CDF7", textColor: "#29261E" }, content: { text: "一个主题" } },
];
const VIEWPORT: BoardViewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };

function renderSurface(overrides: Partial<React.ComponentProps<typeof BoardFabricSurface>> = {}) {
  return render(<BoardFabricSurface objects={OBJECTS} selectedObjectIds={[]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} {...overrides} />);
}

describe("BoardFabricSurface", () => {
  beforeEach(() => { probe.canvasWidth = 1200; probe.canvasHeight = 800; probe.resize = null; });
  beforeEach(() => { probe.instances = 0; probe.objects.length = 0; probe.handlers.clear(); probe.active = null; probe.activeId = null; probe.emitSelectionOnSet = false; probe.zoom = 1; probe.clearCalls = 0; probe.renderCalls = 0; probe.moveCalls = 0; probe.primitiveKinds.length = 0; probe.imageSources.length = 0; probe.imageOptions.length = 0; });


  it.each(["hand", "draw-pen", "erase"] as const)("keeps %s projections noninteractive after canonical updates and additions", tool => {
    const callbacks = { onSelectionChange: vi.fn(), onObjectTransform: vi.fn(), onViewportChange: vi.fn() };
    const props = { objects: OBJECTS, selectedObjectIds: [], readOnly: false, tool, viewport: VIEWPORT, ...callbacks };
    const view = render(<BoardFabricSurface {...props} />);
    expect(probe.objects.every(item => !item.selectable && !item.evented)).toBe(true);
    view.rerender(<BoardFabricSurface {...props} objects={[
      ...OBJECTS.map(item => ({ ...item, revision: item.revision + 1 })),
      { ...OBJECTS[0]!, id: "remote-sticky" },
    ]} />);
    expect(probe.objects).toHaveLength(3);
    expect(probe.objects.every(item => !item.selectable && !item.evented)).toBe(true);
    view.rerender(<BoardFabricSurface {...props} tool="select" />);
    expect(probe.objects.every(item => item.selectable && item.evented)).toBe(true);
  });

  it("cancels a stale Fabric transform before a hand pan can move its target", () => {
    const onViewportChange = vi.fn(), onObjectTransform = vi.fn();
    renderSurface({ tool: "hand", onViewportChange, onObjectTransform });
    probe.canvas!._currentTransform = { target: probe.objects[0], action: "drag" };
    probe.handlers.get("mouse:down")?.({ target: probe.objects[0], e: new MouseEvent("mousedown", { clientX: 400, clientY: 300 }) });
    expect(probe.canvas!._currentTransform).toBeNull();
    probe.handlers.get("mouse:move")?.({ e: new MouseEvent("mousemove", { clientX: 510, clientY: 340 }) });
    probe.handlers.get("mouse:up")?.({ e: new MouseEvent("mouseup", { clientX: 510, clientY: 340 }) });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ panX: 110, panY: 40 }), "pan");
    expect(onObjectTransform).not.toHaveBeenCalled();
  });

  it("pans with two-finger wheel in select mode and reserves control-wheel for pinch zoom", () => {
    const onViewportChange = vi.fn();
    renderSurface({ onViewportChange });
    probe.handlers.get("mouse:wheel")?.({ e: new WheelEvent("wheel", { deltaX: 31, deltaY: 48, cancelable: true }) });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 1, panX: -31, panY: -48 }), "pan");
    probe.handlers.get("mouse:wheel")?.({ e: new WheelEvent("wheel", { deltaY: -80, ctrlKey: true, cancelable: true }) });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: expect.any(Number) }), "wheel");
    expect(probe.zoom).toBeGreaterThan(1);
  });

  it.each([1, 2])("pans with mouse button %s over an object without a create or transform", button => {
    const onViewportChange = vi.fn(), onCanvasClick = vi.fn(), onObjectTransform = vi.fn();
    renderSurface({ onViewportChange, onCanvasClick, onObjectTransform });
    probe.handlers.get("mouse:down")?.({ target: probe.objects[0], e: new MouseEvent("mousedown", { button, clientX: 100, clientY: 100 }) });
    probe.handlers.get("mouse:move")?.({ e: new MouseEvent("mousemove", { buttons: button === 1 ? 4 : 2, clientX: 135, clientY: 125 }) });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ panX: 35, panY: 25 }), "pan");
    probe.handlers.get("mouse:up")?.({ e: new MouseEvent("mouseup", { button, clientX: 135, clientY: 125 }) });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ panX: 35, panY: 25 }), "pan");
    expect(onCanvasClick).not.toHaveBeenCalled();
    expect(onObjectTransform).not.toHaveBeenCalled();
  });

  it.each([
    { tool: "select" as const, button: 1 },
    { tool: "select" as const, button: 2 },
    { tool: "hand" as const, button: 0 },
  ])("restores the published viewport when $tool button $button panning is cancelled", ({ tool, button }) => {
    const onViewportChange = vi.fn();
    const initial = { ...VIEWPORT, zoom: 2, panX: 12, panY: -8 };
    renderSurface({ tool, viewport: initial, onViewportChange });
    probe.handlers.get("mouse:down")?.({ e: new MouseEvent("mousedown", { button, clientX: 100, clientY: 100 }) });
    probe.handlers.get("mouse:move")?.({ e: new MouseEvent("mousemove", { clientX: 135, clientY: 125 }) });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 2, panX: 47, panY: 17 }), "pan");
    const cancel = new Event("pointercancel");
    Object.defineProperties(cancel, { pointerId: { value: 1 }, pointerType: { value: "mouse" }, isPrimary: { value: true } });
    act(() => document.dispatchEvent(cancel));
    expect(onViewportChange).toHaveBeenLastCalledWith(initial, "pan");
    const callsAfterCancel = onViewportChange.mock.calls.length;
    probe.handlers.get("mouse:move")?.({ e: new MouseEvent("mousemove", { clientX: 200, clientY: 200 }) });
    probe.handlers.get("mouse:up")?.({ e: new MouseEvent("mouseup", { button, clientX: 200, clientY: 200 }) });
    expect(onViewportChange).toHaveBeenCalledTimes(callsAfterCancel);
  });

  it("publishes transient snapped geometry during a move and clears it at completion", () => {
    const onTransformPreview = vi.fn(), onObjectTransform = vi.fn(() => true);
    renderSurface({ onTransformPreview, onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left += 77; sticky.top += 33;
    probe.handlers.get("object:moving")?.({ target: sticky });
    expect(onTransformPreview).toHaveBeenLastCalledWith([expect.objectContaining({ id: "s-1", geometry: expect.objectContaining({ x: 117, y: 93 }) })]);
    expect(onObjectTransform).not.toHaveBeenCalled();
    probe.handlers.get("object:modified")?.({ target: sticky });
    expect(onObjectTransform).toHaveBeenCalledWith("s-1", expect.objectContaining({ x: 117, y: 93 }));
    expect(onTransformPreview).toHaveBeenLastCalledWith([]);
  });

  it("preserves imported non-square Sticky dimensions during held movement and release", () => {
    const canonical: BoardFabricObject = { ...OBJECTS[0]!, geometry: { x: 150, y: 240, width: 120, height: 100, rotation: 0 }, sticky: { variant: "square", sizingMode: "fixed" } };
    const onTransformPreview = vi.fn(), onObjectTransform = vi.fn(() => true);
    renderSurface({ objects: [canonical], onTransformPreview, onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left += 70; sticky.top += 40;
    act(() => probe.handlers.get("object:moving")?.({ target: sticky }));
    expect(onTransformPreview).toHaveBeenLastCalledWith([{ id: canonical.id, geometry: { x: 220, y: 280, width: 120, height: 100, rotation: 0 } }]);
    expect(onObjectTransform).not.toHaveBeenCalled();
    expect(canonical.geometry).toEqual({ x: 150, y: 240, width: 120, height: 100, rotation: 0 });
    act(() => probe.handlers.get("object:modified")?.({ target: sticky }));
    expect(onObjectTransform).toHaveBeenCalledTimes(1);
    expect(onObjectTransform).toHaveBeenCalledWith(canonical.id, { x: 220, y: 280, width: 120, height: 100, rotation: 0 });
    onObjectTransform.mockClear();
    sticky.angle = 90;
    act(() => probe.handlers.get("object:rotating")?.({ target: sticky }));
    expect(onTransformPreview).toHaveBeenLastCalledWith([{ id: canonical.id, geometry: { x: 220, y: 280, width: 120, height: 100, rotation: 90 } }]);
    act(() => probe.handlers.get("object:modified")?.({ target: sticky }));
    expect(onObjectTransform).toHaveBeenCalledTimes(1);
    expect(onObjectTransform).toHaveBeenCalledWith(canonical.id, { x: 220, y: 280, width: 120, height: 100, rotation: 90 });
  });

  it("updates attached arrows in the local drag preview without committing per frame", () => {
    const arrow: BoardFabricObject = { id: "edge", kind: "connector", revision: 1, orderKey: "z", geometry: { x: 260, y: 150, width: 100, height: 1, rotation: 0 }, style: { fill: "", textColor: "#222" }, content: { text: "" }, connector: { from: "s-1", to: "r-1", fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "", start: { x: 260, y: 150 }, end: { x: 360, y: 150 } } };
    const onObjectTransform = vi.fn(() => true);
    renderSurface({ objects: [...OBJECTS, arrow], onObjectTransform });
    const sticky = probe.objects.find(item => item.data?.boardObjectId === "s-1")!;
    const originalArrow = probe.objects.find(item => item.data?.boardObjectId === "edge")!;
    sticky.left += 40;
    probe.handlers.get("object:moving")?.({ target: sticky });
    const movedArrow = probe.objects.find(item => item.data?.boardObjectId === "edge")!;
    expect(movedArrow).not.toBe(originalArrow);
    expect(movedArrow.children?.[0]?.text).toBe("M 300 150 L 360 150");
    expect(onObjectTransform).not.toHaveBeenCalled();
  });

  it("rotates an attached arrow offset with its object during the live preview", () => {
    const arrow: BoardFabricObject = { id: "edge", kind: "connector", revision: 1, orderKey: "z", geometry: { x: 270, y: 155, width: 90, height: 1, rotation: 0 }, style: { fill: "", textColor: "#222" }, content: { text: "" }, connector: { from: "s-1", to: "r-1", fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "", start: { x: 270, y: 155 }, end: { x: 360, y: 155 } } };
    renderSurface({ objects: [...OBJECTS, arrow] });
    const sticky = probe.objects.find(item => item.data?.boardObjectId === "s-1")!;
    sticky.angle = 90;
    probe.handlers.get("object:rotating")?.({ target: sticky });
    // Right anchor (220,90) plus local offset (10,5) rotates about (40,60).
    const edge = probe.objects.find(item => item.data?.boardObjectId === "edge")!;
    expect(edge.children?.[0]?.text).toBe("M -55 290 L 360 155");
  });

  it("retains an active multi-selection instance across equivalent controlled updates", () => {
    const selection = ["s-1", "r-1"];
    const view = renderSurface({ selectedObjectIds: selection });
    const active = probe.active;
    view.rerender(<BoardFabricSurface objects={[...OBJECTS]} selectedObjectIds={[...selection]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn(() => true)} onViewportChange={vi.fn()} />);
    expect(probe.active).toBe(active);
  });

  it("renders sticky paper, blue corners and a world-anchored grid without changing persisted appearance", () => {
    renderSurface({ objects: [{ ...OBJECTS[0]!, sticky: { variant: "square", sizingMode: "auto-height" } }], selectedObjectIds: ["s-1"] });
    const sticky = probe.objects[0]!;
    expect(sticky).toMatchObject(BOARD_FABRIC_VISUAL.selection);
    expect(sticky.controls).toMatchObject({ tl: true, tr: true, bl: true, br: true, ml: false, mr: false });
    expect(sticky.children![0]).toMatchObject({ fill: "#F8D76E", rx: 3, shadow: BOARD_FABRIC_VISUAL.sticky.shadow, strokeUniform: true });
    expect(sticky.children![1]).toMatchObject({ fontFamily: BOARD_FABRIC_VISUAL.fontFamily, width: 172 });
    expect(screen.getByTestId("board-fabric-surface")).toHaveStyle({ backgroundColor: "#FCFCFB", backgroundSize: "20px 20px", backgroundPosition: "-10px -10px" });
    expect(probe.objects).toHaveLength(1);
  });

  it("cancels a held node preview on blur and ignores the late modified event", () => {
    const onTransformPreview = vi.fn(), onObjectTransform = vi.fn(() => true);
    renderSurface({ selectedObjectIds: ["s-1"], onTransformPreview, onObjectTransform });
    const sticky = probe.objects.find(object => object.data?.boardObjectId === "s-1")!;
    act(() => probe.handlers.get("mouse:down")?.({ target: sticky, e: new MouseEvent("mousedown", { clientX: 50, clientY: 80 }) }));
    sticky.left += 77;
    act(() => probe.handlers.get("object:moving")?.({ target: sticky }));
    act(() => window.dispatchEvent(new Event("blur")));
    expect(sticky.left).toBe(40);
    expect(onTransformPreview).toHaveBeenLastCalledWith([]);
    act(() => probe.handlers.get("object:modified")?.({ target: sticky }));
    expect(onObjectTransform).not.toHaveBeenCalled();
  });

  it("orients connector tips from each final path tangent", () => {
    expect(connectorTipAngles("straight", -50, -30, 50, 30)).toEqual({ start: expect.any(Number), end: expect.any(Number) });
    const elbow = connectorTipAngles("elbow", -50, -30, 50, 30);
    expect(elbow.start % 360).not.toBe(elbow.end % 360);
    const curve = connectorTipAngles("curve", -50, -30, 50, 30);
    expect(curve.start % 360).toBe(270);
    expect(curve.end % 360).toBe(90);
  });


  it("projects canonical-like objects into one Fabric Canvas without DOM object replicas", () => {
    const { container } = renderSurface();
    expect(screen.getByTestId("board-fabric-canvas").tagName).toBe("CANVAS");
    expect(probe.instances).toBe(1);
    expect(probe.objects.map((object) => object.data?.boardObjectId)).toEqual(["s-1", "r-1"]);
    expect(container.querySelector('[data-testid^="whiteboard-object-"]')).toBeNull();
    expect(probe.clearCalls).toBe(0);
  });

  it("renders a pressure-aware Fabric draft while drawing and clears it on cancel or completion", () => {
    const onDrawingComplete = vi.fn();
    renderSurface({ tool: "draw-pen", onDrawingComplete });
    const pointer = (type: string, x: number, y: number, pressure: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y });
      Object.defineProperty(event, "pressure", { value: pressure });
      return event;
    };

    probe.handlers.get("mouse:down")?.({ e: pointer("pointerdown", 10, 20, .2) } as never);
    probe.handlers.get("mouse:move")?.({ e: pointer("pointermove", 30, 40, .5) } as never);
    probe.handlers.get("mouse:move")?.({ e: pointer("pointermove", 60, 80, .9) } as never);

    const preview = probe.objects.filter((object) => object.data?.drawingPreview);
    expect(preview).toHaveLength(1);
    expect(screen.getByTestId("board-fabric-surface")).toHaveAttribute("data-drawing-preview-segments", "2");
    expect(preview[0]).toMatchObject({ fill: drawingToolStyle("pen").color, strokeWidth: 0, opacity: 1 });
    const radii = [...preview[0]!.text!.matchAll(/A ([\d.]+) [\d.]+/g)].map(match => Number(match[1]));
    expect(radii).toHaveLength(4);
    expect(radii[2]).toBeGreaterThan(radii[0]!);
    expect(onDrawingComplete).not.toHaveBeenCalled();

    fireEvent.pointerCancel(screen.getByTestId("board-fabric-surface"), { pointerType: "mouse", isPrimary: true });
    expect(probe.objects.some((object) => object.data?.drawingPreview)).toBe(false);
    expect(screen.getByTestId("board-fabric-surface")).toHaveAttribute("data-drawing-preview-segments", "0");
    expect(onDrawingComplete).not.toHaveBeenCalled();

    probe.handlers.get("mouse:down")?.({ e: pointer("pointerdown", 100, 120, .3) } as never);
    probe.handlers.get("mouse:move")?.({ e: pointer("pointermove", 140, 160, .8) } as never);
    expect(probe.objects.some((object) => object.data?.drawingPreview)).toBe(true);
    expect(screen.getByTestId("board-fabric-surface")).toHaveAttribute("data-drawing-preview-segments", "1");
    probe.handlers.get("mouse:up")?.({ e: pointer("pointerup", 140, 160, 0) } as never);
    expect(probe.objects.some((object) => object.data?.drawingPreview)).toBe(false);
    expect(screen.getByTestId("board-fabric-surface")).toHaveAttribute("data-drawing-preview-segments", "0");
    expect(onDrawingComplete).toHaveBeenCalledOnce();
    expect(onDrawingComplete).toHaveBeenCalledWith({ tool: "pen", appearance: drawingToolStyle("pen"), points: [
      { x: 100, y: 120, pressure: .3 },
      { x: 140, y: 160, pressure: .8 },
    ] });
  });

  it("uses one selected appearance for both the live preview and completed stroke", () => {
    const onDrawingComplete = vi.fn();
    const appearance = { color: "#7C3AED", width: 1.25, opacity: .58 };
    renderSurface({ tool: "draw-pen", drawingAppearance: appearance, onDrawingComplete });
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y });
      Object.defineProperties(event, { pressure: { value: 1 }, pointerType: { value: "mouse" } });
      return event;
    };
    probe.handlers.get("mouse:down")?.({ e: pointer("pointerdown", 20, 30) } as never);
    probe.handlers.get("mouse:move")?.({ e: pointer("pointermove", 60, 70) } as never);
    expect(probe.objects.find((object) => object.data?.drawingPreview)).toMatchObject({ fill: appearance.color, strokeWidth: 0, opacity: appearance.opacity });
    probe.handlers.get("mouse:up")?.({ e: pointer("pointerup", 60, 70) } as never);
    expect(onDrawingComplete).toHaveBeenCalledWith({ tool: "pen", appearance, points: [
      { x: 20, y: 30, pressure: 1 },
      { x: 60, y: 70, pressure: 1 },
    ] });
  });

  it("eraser only reports hit drawing vectors and never paints a white preview over other objects", () => {
    const drawing: BoardFabricObject = { ...OBJECTS[0]!, id: "ink", kind: "drawing", geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, boardContent: { version: 1, type: "drawing", strokes: [{ id: "stroke", tool: "pen", points: [{ x: 0, y: 0, pressure: 1 }, { x: 100, y: 100, pressure: 1 }], color: "#111111", width: 3, opacity: 1 }] } };
    const onDrawingComplete = vi.fn();
    renderSurface({ objects: [...OBJECTS, drawing, { ...drawing, id: "locked", locked: true }], tool: "erase", onDrawingComplete });
    probe.handlers.get("mouse:down")?.({ e: new MouseEvent("mousedown", { clientX: 40, clientY: 60 }) });
    probe.handlers.get("mouse:move")?.({ e: new MouseEvent("mousemove", { clientX: 60, clientY: 40 }) });
    expect(probe.objects.some(object => object.data?.drawingPreview)).toBe(false);
    probe.handlers.get("mouse:up")?.({ e: new MouseEvent("mouseup", { clientX: 60, clientY: 40 }) });
    expect(onDrawingComplete).toHaveBeenCalledWith(expect.objectContaining({ tool: "eraser", targetObjectIds: ["ink"] }));
  });

  it.each([
    ["draw-pen", "pen"],
    ["draw-marker", "marker"],
    ["draw-highlighter", "highlighter"],
  ] as const)("uses the persisted %s style for its live preview", (tool, drawingTool) => {
    renderSurface({ tool });
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y });
      Object.defineProperty(event, "pressure", { value: 1 });
      return event;
    };
    probe.handlers.get("mouse:down")?.({ e: pointer("pointerdown", 10, 20) } as never);
    probe.handlers.get("mouse:move")?.({ e: pointer("pointermove", 30, 40) } as never);
    const preview = probe.objects.find((object) => object.data?.drawingPreview)!;
    expect(preview).toMatchObject({
      fill: drawingToolStyle(drawingTool).color,
      strokeWidth: 0,
      opacity: drawingToolStyle(drawingTool).opacity,
    });
  });

  it("constructs dedicated Fabric projections for shape, vector drawing, image state, and structured card", () => {
    const contentObjects: BoardFabricObject[] = [
      { ...OBJECTS[0]!, id: "shape", kind: "shape", boardContent: { version: 1, type: "shape", variant: "diamond", fill: "#FFFFFF", borderColor: "#111111", borderWidth: 1, borderStyle: "solid", opacity: 1, radius: 0, textColor: "#111111", horizontalAlign: "center", verticalAlign: "middle" } },
      { ...OBJECTS[0]!, id: "drawing", kind: "drawing", boardContent: { version: 1, type: "drawing", strokes: [{ id: "stroke", tool: "pen", points: [{ x: 1, y: 2, pressure: .2 }, { x: 4, y: 6, pressure: .9 }], color: "#111111", width: 3, opacity: 1 }] } },
      { ...OBJECTS[0]!, id: "image", kind: "image", boardContent: { version: 1, type: "image", status: "uploading", assetId: null, sourceUrl: null, mimeType: "image/png", intrinsicWidth: 0, intrinsicHeight: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: "#FFFFFF", borderWidth: 0, cornerRadius: 0, fileName: "photo.png", replacementOf: null, failureCode: null, byteSize: 0, contentDigest: null, magicMimeType: null, retryCount: 0 } },
      { ...OBJECTS[0]!, id: "tile", kind: "card", content: { text: "用户访谈" }, boardContent: { version: 1, type: "tile", tileType: "document", title: "用户访谈", description: "研究材料", icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] } },
    ];
    renderSurface({ objects: contentObjects });
    expect(probe.objects.map((object) => object.data?.adapterKind)).toEqual(["shape", "drawing", "image", "card"]);
    expect(probe.primitiveKinds).toEqual(expect.arrayContaining(["Path", "Group", "Rect"]));
    expect(probe.objects.find((object) => object.data?.boardObjectId === "shape")?.children?.[0]).toMatchObject({ strokeUniform: true });
    expect(probe.objects.find((object) => object.data?.boardObjectId === "image")?.children?.[0]).toMatchObject({ fill: "#FFFFFF", strokeUniform: true, rx: 10 });
    expect(probe.objects.find((object) => object.data?.boardObjectId === "tile")?.children?.[0]).toMatchObject({ strokeUniform: true, rx: 12 });
  });

  it("renders canonical Panel shapes and non-interactive template guides with legacy defaults", () => {
    const panel = (id: string, shape?: "rectangle" | "rounded" | "circle", template?: "blank" | "section" | "grid" | "timeline"): BoardFabricObject => ({
      ...OBJECTS[0]!, id, kind: "panel", orderKey: id, geometry: { x: 20, y: 30, width: 360, height: 240, rotation: 0 },
      panel: { title: id, mode: "freeform", autoExpand: true, clipContent: false, shape, template },
    });
    renderSurface({ objects: [panel("legacy"), panel("rounded", "rounded", "section"), panel("circle", "circle", "grid"), panel("timeline", "rectangle", "timeline")] });
    const byId = (id: string) => probe.objects.find((object) => object.data?.boardObjectId === id)!;
    expect(byId("legacy").children).toHaveLength(2);
    expect(byId("legacy").children?.[0]).toMatchObject({ mockKind: "rect", rx: 0 });
    expect(byId("rounded").children?.[0]).toMatchObject({ mockKind: "rect", rx: 16 });
    expect(byId("circle").children?.[0]).toMatchObject({ mockKind: "circle" });
    expect(byId("rounded").children).toHaveLength(3);
    expect(byId("circle").children).toHaveLength(6);
    expect(byId("timeline").children).toHaveLength(6);
    for (const id of ["rounded", "circle", "timeline"]) {
      expect(byId(id).children?.[1]).toMatchObject({ text: id });
      for (const guide of byId(id).children!.slice(2)) expect(guide).toMatchObject({ selectable: false, evented: false, strokeUniform: true });
    }
  });

  it("renders verified bytes through the session object URL with intrinsic crop and rounded clipping", () => {
    const ready: BoardFabricObject = { ...OBJECTS[0]!, id: "verified-image", kind: "image", imageAssetUrl: "blob:verified-image", geometry: { x: 20, y: 30, width: 200, height: 120, rotation: 0 }, boardContent: { version: 1, type: "image", status: "ready", assetId: "local-session-1", sourceUrl: "https://assets.example.com/changed.png", mimeType: "image/png", intrinsicWidth: 400, intrinsicHeight: 300, crop: { x: .25, y: .1, width: .5, height: .8 }, opacity: .7, borderColor: "#112233", borderWidth: 2, cornerRadius: 16, fileName: "verified.png", replacementOf: null, failureCode: null, byteSize: 24, contentDigest: `sha256:${"a".repeat(64)}`, magicMimeType: "image/png", persistence: "local-session" } };
    renderSurface({ objects: [ready] });
    expect(probe.imageSources).toEqual(["blob:verified-image"]);
    expect(probe.imageSources).not.toContain(ready.boardContent?.type === "image" ? ready.boardContent.sourceUrl : "");
    expect(probe.imageOptions[0]).toMatchObject({ cropX: 100, cropY: 30, width: 200, height: 240, opacity: .7, clipPath: expect.objectContaining({ rx: expect.any(Number), ry: expect.any(Number) }) });
  });

  it.each(["needs", ""])("renders endpoint-driven connector with label %j and transparent hit testing", (label) => {
    const panel: BoardFabricObject = { ...OBJECTS[0]!, id: "panel", kind: "panel", zIndex: -1, panel: { title: "Research", mode: "grid", autoExpand: true, clipContent: false } };
    const edge: BoardFabricObject = { ...OBJECTS[0]!, id: "edge", kind: "connector", zIndex: 2, content: { text: "needs" }, connector: { from: "s-1", to: "r-1", fromAnchor: "right", toAnchor: "left", type: "curve", startStyle: "none", endStyle: "arrow", lineStyle: "dashed", label, semanticRelation: "needs", start: { x: 260, y: 150 }, end: { x: 360, y: 150 } } };
    renderSurface({ objects: [OBJECTS[0]!, OBJECTS[1]!, panel, edge] });
    expect(probe.objects.map((object) => object.data?.boardObjectId)).toEqual(["panel", "s-1", "r-1", "edge"]);
    expect(probe.objects.find((object) => object.data?.boardObjectId === "edge")?.children?.filter(child => child.mockKind === "textbox")).toHaveLength(label ? 1 : 0);
    expect(probe.objects.find((object) => object.data?.boardObjectId === "edge")).toMatchObject({ selectable: true, evented: true, perPixelTargetFind: true, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false, hasBorders: false });
  });

  it("highlights and reparents nested Panels at the completed Fabric gesture boundary", () => {
    const parent: BoardFabricObject = { ...OBJECTS[0]!, id: "parent", kind: "panel", geometry: { x: 0, y: 0, width: 500, height: 400, rotation: 0 }, panel: { title: "Parent", mode: "freeform", autoExpand: true, clipContent: false } };
    const child: BoardFabricObject = { ...OBJECTS[0]!, id: "child", kind: "panel", geometry: { x: 600, y: 0, width: 180, height: 140, rotation: 0 }, panel: { title: "Child", mode: "flow", autoExpand: true, clipContent: false } };
    const onPanelHoverChange = vi.fn(), onObjectReparent = vi.fn();
    renderSurface({ objects: [parent, child], onObjectTransform: vi.fn(() => true), onPanelHoverChange, onObjectReparent });
    const projected = probe.objects.find((object) => object.data?.boardObjectId === "child")!;
    projected.left = 120; projected.top = 100;
    probe.handlers.get("object:moving")?.({ target: projected });
    expect(onPanelHoverChange).toHaveBeenCalledWith("parent");
    probe.handlers.get("object:modified")?.({ target: projected });
    expect(onObjectReparent).toHaveBeenCalledWith("child", "parent");
    expect(onPanelHoverChange).toHaveBeenLastCalledWith(null);
  });

  it("converts a dragged dock tool drop into world coordinates without creating renderer-owned state", () => {
    const onToolDrop = vi.fn();
    renderSurface({ viewport: { ...VIEWPORT, zoom: 2, panX: 10, panY: 20 }, onToolDrop });
    const payload = JSON.stringify({ kind: "sticky", variant: "circle" });
    const event = createEvent.drop(screen.getByTestId("board-fabric-surface"));
    Object.defineProperties(event, {
      clientX: { value: 210 }, clientY: { value: 220 },
      dataTransfer: { value: { getData: (type: string) => type === "application/x-workspacex-board-tool" ? payload : "", types: ["application/x-workspacex-board-tool"] } },
    });
    fireEvent(screen.getByTestId("board-fabric-surface"), event);
    expect(onToolDrop).toHaveBeenCalledWith({ x: 100, y: 100 }, payload);
    expect(probe.objects.map((object) => object.data?.boardObjectId)).toEqual(["s-1", "r-1"]);
  });

  it("separates Fabric object double-click editing from blank-canvas quick creation", () => {
    const onObjectDoubleClick = vi.fn(), onCanvasDoubleClick = vi.fn();
    renderSurface({ onObjectDoubleClick, onCanvasDoubleClick });
    probe.handlers.get("mouse:dblclick")?.({ target: probe.objects[0], e: new MouseEvent("dblclick") });
    expect(onObjectDoubleClick).toHaveBeenCalledWith("s-1");
    expect(onCanvasDoubleClick).not.toHaveBeenCalled();
    probe.handlers.get("mouse:dblclick")?.({ e: new MouseEvent("dblclick") });
    expect(onCanvasDoubleClick).toHaveBeenCalledWith({ x: 123, y: 234 });
  });

  it("consumes sticky variants, rich text styles, link affordance, and sizing controls", () => {
    const variants: readonly BoardFabricObject[] = [
      { ...OBJECTS[0]!, id: "circle", revision: 2, sticky: { variant: "circle", sizingMode: "fixed" }, style: { ...OBJECTS[0]!.style, fontFamily: "Noto Serif SC", fontSize: 22, bold: true, italic: true, underline: true, alignment: "right", lineHeight: 1.7, link: "https://example.com" } },
      { ...OBJECTS[0]!, id: "rectangle", revision: 3, sticky: { variant: "rectangle", sizingMode: "auto-height" }, geometry: { ...OBJECTS[0]!.geometry, width: 260, height: 140 } },
      { ...OBJECTS[0]!, id: "auto", revision: 4, sticky: { variant: "square", sizingMode: "auto-size" } },
      { ...OBJECTS[1]!, id: "rich-text", revision: 5, kind: "text", style: { ...OBJECTS[1]!.style, fontFamily: "Noto Serif SC", fontSize: 48, bold: true, italic: true, underline: false, alignment: "center", lineHeight: 1.15, link: "https://example.com" } },
    ];
    renderSurface({ objects: variants });
    const circle = probe.objects.find((item) => item.data?.boardObjectId === "circle")!;
    const rectangle = probe.objects.find((item) => item.data?.boardObjectId === "rectangle")!;
    const auto = probe.objects.find((item) => item.data?.boardObjectId === "auto")!;
    const text = probe.objects.find((item) => item.data?.boardObjectId === "rich-text")!;
    expect(circle.children?.[0]?.mockKind).toBe("circle");
    expect(rectangle.children?.[0]?.mockKind).toBe("rect");
    expect(circle.children?.[1]).toMatchObject({ fontFamily: "Noto Serif SC", fontSize: 22, fontWeight: 700, fontStyle: "italic", underline: true, textAlign: "right", lineHeight: 1.7, fill: OBJECTS[0]!.style.textColor, hoverCursor: "pointer" });
    expect(text).toMatchObject({ fontFamily: "Noto Serif SC", fontSize: 48, fontWeight: 700, fontStyle: "italic", underline: true, textAlign: "center", lineHeight: 1.15, hoverCursor: "pointer" });
    expect(circle.controls).toMatchObject({ ml: false, mr: false, mt: false, mb: false, tl: true, br: true, mtr: true });
    expect(rectangle.controls).toMatchObject({ ml: true, mr: true, mt: false, mb: false, tl: false, br: false, mtr: true });
    expect(auto).toMatchObject({ lockScalingX: true, lockScalingY: true });
    expect(auto.controls).toMatchObject({ ml: false, mr: false, mt: false, mb: false, tl: false, br: false, mtr: true });
  });

  it("normalizes sticky transforms according to circle and sizing-mode invariants", () => {
    const onObjectTransform = vi.fn();
    const variants: readonly BoardFabricObject[] = [
      { ...OBJECTS[0]!, id: "circle", revision: 2, sticky: { variant: "circle", sizingMode: "fixed" }, geometry: { x: 10, y: 20, width: 180, height: 180, rotation: 0 } },
      { ...OBJECTS[0]!, id: "height", revision: 3, sticky: { variant: "rectangle", sizingMode: "auto-height" }, geometry: { x: 220, y: 20, width: 240, height: 150, rotation: 0 } },
      { ...OBJECTS[0]!, id: "auto", revision: 4, sticky: { variant: "rectangle", sizingMode: "auto-size" }, geometry: { x: 500, y: 20, width: 210, height: 160, rotation: 0 } },
    ];
    renderSurface({ objects: variants, onObjectTransform });
    const circle = probe.objects.find((item) => item.data?.boardObjectId === "circle")!;
    circle.scaleX *= 2;
    probe.handlers.get("object:modified")?.({ target: circle });
    expect(onObjectTransform).toHaveBeenLastCalledWith("circle", expect.objectContaining({ width: 360, height: 360 }));
    const height = probe.objects.find((item) => item.data?.boardObjectId === "height")!;
    height.scaleX *= 1.5; height.scaleY *= 4;
    probe.handlers.get("object:modified")?.({ target: height });
    expect(onObjectTransform).toHaveBeenLastCalledWith("height", expect.objectContaining({ width: 360, height: 150 }));
    const auto = probe.objects.find((item) => item.data?.boardObjectId === "auto")!;
    auto.scaleX *= 4; auto.scaleY *= 4;
    probe.handlers.get("object:modified")?.({ target: auto });
    expect(onObjectTransform).toHaveBeenLastCalledWith("auto", expect.objectContaining({ width: 210, height: 160 }));
  });

  it("replaces the Fabric projection when a sticky changes visual variant", () => {
    const square: BoardFabricObject = { ...OBJECTS[0]!, sticky: { variant: "square", sizingMode: "fixed" } };
    const view = renderSurface({ objects: [square] });
    const prior = probe.objects[0]!;
    view.rerender(<BoardFabricSurface objects={[{ ...square, revision: 2, sticky: { variant: "circle", sizingMode: "fixed" } }]} selectedObjectIds={[]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    const replacement = probe.objects.find((item) => item.data?.boardObjectId === square.id)!;
    expect(replacement).not.toBe(prior);
    expect(replacement.children?.[0]?.mockKind).toBe("circle");
  });

  it("preserves controlled selection while replacing an updated Panel projection", () => {
    const panel: BoardFabricObject = { ...OBJECTS[0]!, id: "selected-panel", kind: "panel", panel: { title: "Frame", mode: "freeform", autoExpand: true, clipContent: false } };
    const onSelectionChange = vi.fn();
    const view = renderSurface({ objects: [panel], selectedObjectIds: [panel.id], onSelectionChange });
    expect(probe.activeId).toBe(panel.id);
    onSelectionChange.mockClear();

    view.rerender(<BoardFabricSurface objects={[{ ...panel, revision: 2, panel: { ...panel.panel!, autoExpand: false } }]} selectedObjectIds={[panel.id]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={onSelectionChange} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);

    expect(onSelectionChange).not.toHaveBeenCalledWith([], "canvas");
    expect(probe.activeId).toBe(panel.id);
    expect(screen.getByTestId(`board-a11y-object-${panel.id}`)).toHaveAttribute("aria-pressed", "true");
  });

  it("patches a remote rich-text style revision onto the existing Fabric object", () => {
    const initial: BoardFabricObject = { ...OBJECTS[1]!, id: "styled", kind: "text", style: { ...OBJECTS[1]!.style, fontSize: 18, fontFamily: "Noto Sans SC", alignment: "left" } };
    const view = renderSurface({ objects: [initial] });
    const projected = probe.objects[0]!;
    view.rerender(<BoardFabricSurface objects={[{ ...initial, revision: 2, style: { ...initial.style, fontFamily: "Noto Serif SC", fontSize: 32, bold: true, italic: true, underline: true, alignment: "right", lineHeight: 1.8, textColor: "#123456", link: "https://example.com" } }]} selectedObjectIds={[]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    expect(probe.objects[0]).toBe(projected);
    expect(projected).toMatchObject({ fontFamily: "Noto Serif SC", fontSize: 32, fontWeight: 700, fontStyle: "italic", underline: true, textAlign: "right", lineHeight: 1.8, fill: "#123456", hoverCursor: "pointer" });
  });

  it("shares controlled selection with the accessible mirror", () => {
    const onSelectionChange = vi.fn();
    const { rerender } = renderSurface({ selectedObjectIds: ["s-1"], onSelectionChange });
    expect(probe.activeId).toBe("s-1");
    fireEvent.click(screen.getByTestId("board-a11y-object-r-1"));
    expect(onSelectionChange).toHaveBeenCalledWith(["r-1"], "outline");
    rerender(<BoardFabricSurface objects={OBJECTS} selectedObjectIds={["r-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={onSelectionChange} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    expect(screen.getByTestId("board-a11y-object-r-1")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps Fabric ActiveSelection callbacks in canonical controlled-selection order", () => {
    const onSelectionChange = vi.fn();
    renderSurface({ selectedObjectIds: ["r-1", "s-1"], onSelectionChange });
    expect(probe.active).not.toBeNull();
    probe.handlers.get("selection:updated")?.({ target: probe.active! });
    expect(onSelectionChange).toHaveBeenCalledWith(["r-1", "s-1"], "canvas");
  });

  it("styles a Fabric-created ActiveSelection without replacing its gesture or rotation control on echo", async () => {
    const { ActiveSelection } = await import("fabric");
    const { Control } = await vi.importActual<typeof import("fabric")>("fabric");
    const onSelectionChange = vi.fn();
    const { rerender } = renderSurface({ selectedObjectIds: [], onSelectionChange });
    const automatic = new ActiveSelection(probe.objects as never[]);
    automatic.set({ borderColor: "#B2CCFF" });
    automatic.controls = { mtr: new Control({ x: 0, y: -.5, offsetX: 0, offsetY: -40 }) };
    const visibility = vi.spyOn(automatic, "setControlsVisibility");
    const gesture = { target: automatic };
    probe.active = automatic as unknown as MockProjectedObject;
    act(() => probe.handlers.get("selection:created")?.({ target: probe.active! }));
    expect(automatic.borderColor).toBe(BOARD_FABRIC_VISUAL.selection.borderColor);
    expect(automatic.controls.mtr).toMatchObject(BOARD_FABRIC_VISUAL.rotationControl);
    expect(visibility).toHaveBeenCalledWith({ ml: false, mr: false, mt: false, mb: false });
    const rotation = automatic.controls.mtr;
    rerender(<BoardFabricSurface objects={OBJECTS} selectedObjectIds={["s-1", "r-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={onSelectionChange} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    expect(probe.active).toBe(automatic);
    expect(probe.active).toBe(gesture.target);
    expect(automatic.controls.mtr).toBe(rotation);
    expect(automatic).toMatchObject(BOARD_FABRIC_VISUAL.selection);
  });

  it("preserves held multi-object rotation, scale and local coordinates across preview array echoes", () => {
    const { rerender } = renderSurface({ selectedObjectIds: ["s-1", "r-1"] });
    const selection = probe.active!;
    const members = [...probe.objects];
    for (const member of members) Object.assign(member, { group: selection });
    Object.assign(selection, { angle: 35, scaleX: 1.4, scaleY: .8 });
    const local = members.map(member => ({ left: member.left, top: member.top, scaleX: member.scaleX, scaleY: member.scaleY }));
    rerender(<BoardFabricSurface objects={OBJECTS.map(object => ({ ...object }))} selectedObjectIds={["s-1", "r-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    expect(probe.active).toBe(selection);
    expect(selection).toMatchObject({ angle: 35, scaleX: 1.4, scaleY: .8 });
    expect(members.map(member => ({ left: member.left, top: member.top, scaleX: member.scaleX, scaleY: member.scaleY }))).toEqual(local);
    const remote = OBJECTS.map(object => object.id === "s-1" ? { ...object, revision: object.revision + 1, geometry: { ...object.geometry, x: 500 } } : object);
    rerender(<BoardFabricSurface objects={remote} selectedObjectIds={["s-1", "r-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    expect(probe.objects.find(object => object.data?.boardObjectId === "s-1")?.left).toBe(500);
    expect(selection).toMatchObject({ angle: 0, scaleX: 1, scaleY: 1 });
  });

  it("renders alignment guides and equal 24 px spacing while an object moves", async () => {
    const spaced: BoardFabricObject[] = [
      { ...OBJECTS[0]!, id: "left", geometry: { x: 0, y: 60, width: 100, height: 80, rotation: 0 } },
      { ...OBJECTS[0]!, id: "moving", geometry: { x: 124, y: 60, width: 100, height: 80, rotation: 0 } },
      { ...OBJECTS[0]!, id: "right", geometry: { x: 248, y: 60, width: 100, height: 80, rotation: 0 } },
    ];
    renderSurface({ objects: spaced, selectedObjectIds: ["moving"] });
    const moving = probe.objects.find((object) => object.data?.boardObjectId === "moving")!;
    act(() => probe.handlers.get("mouse:down")?.({ target: moving, e: new MouseEvent("mousedown", { button: 0 }) }));
    act(() => probe.handlers.get("object:moving")?.({ target: moving }));
    expect(await screen.findByTestId("board-smart-guides")).toBeVisible();
    expect(screen.getAllByTestId("board-spacing-measurement").map((node) => node.textContent)).toContain("24 px");
    act(() => probe.handlers.get("mouse:up")?.({ target: moving, e: new MouseEvent("mouseup", { button: 0 }) }));
    expect(screen.queryByTestId("board-smart-guides")).toBeNull();
  });

  it("commits one normalized geometry callback at gesture end and blocks viewer writes", () => {
    const onObjectTransform = vi.fn();
    const writable = renderSurface({ onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left = 90; sticky.top = 110; sticky.scaleX = 1.5; sticky.angle = 12;
    probe.handlers.get("object:modified")?.({ target: sticky });
    expect(onObjectTransform).toHaveBeenCalledTimes(1);
    expect(onObjectTransform).toHaveBeenCalledWith("s-1", expect.objectContaining({ x: 90, y: 110, rotation: 12 }));
    writable.unmount();

    probe.objects.length = 0; probe.handlers.clear(); onObjectTransform.mockClear();
    renderSurface({ readOnly: true, onObjectTransform });
    probe.handlers.get("object:modified")?.({ target: probe.objects[0]! });
    expect(onObjectTransform).not.toHaveBeenCalled();
    expect(probe.objects.every((object) => !object.selectable && !object.evented)).toBe(true);
  });

  it("commits ActiveSelection move/resize/rotate as one canonical batch", () => {
    const onObjectsTransform = vi.fn(() => true);
    renderSurface({ selectedObjectIds: ["s-1", "r-1"], onObjectsTransform });
    expect(probe.active).not.toBeNull();
    probe.objects[0]!.left = 120; probe.objects[0]!.top = 140; probe.objects[0]!.scaleX = 1.5;
    probe.objects[1]!.left = 420; probe.objects[1]!.top = 180; probe.objects[1]!.scaleY = 1.25;
    probe.handlers.get("object:modified")?.({ target: probe.active! });
    expect(onObjectsTransform).toHaveBeenCalledOnce();
    expect(onObjectsTransform).toHaveBeenCalledWith([
      expect.objectContaining({ id: "s-1", geometry: expect.objectContaining({ x: 120, y: 140, width: OBJECTS[0]!.geometry.width * 1.5 }) }),
      expect.objectContaining({ id: "r-1", geometry: expect.objectContaining({ height: OBJECTS[1]!.geometry.height * 1.25, rotation: 5 }) }),
    ], { duplicate: false });
  });

  it("exposes read-only per-object Fabric scene bounds for pointer acceptance probes", () => {
    renderSurface();
    const scenes = JSON.parse(screen.getByTestId("board-fabric-surface").getAttribute("data-object-scenes")!) as Array<{ id: string; left: number; top: number; width: number; height: number }>;
    expect(scenes.find(value => value.id === "s-1")).toEqual({ id: "s-1", left: 40, top: 60, width: expect.closeTo(220), height: 180 });
    expect(scenes.find(value => value.id === "r-1")).toEqual({ id: "r-1", left: 360, top: 80, width: 240, height: 140 });
  });

  it("shows guides for resize and ActiveSelection, with Alt bypass", async () => {
    const target = { ...OBJECTS[0]!, id: "target", geometry: { ...OBJECTS[0]!.geometry, x: 100, y: 0 } };
    renderSurface({ objects: [...OBJECTS, target], selectedObjectIds: ["s-1", "r-1"] });
    probe.objects[0]!.left = 140;
    act(() => probe.handlers.get("object:scaling")?.({ target: probe.objects[0] }));
    expect(await screen.findByTestId("board-smart-guides")).toBeVisible();
    act(() => probe.handlers.get("object:scaling")?.({ target: probe.objects[0], e: new MouseEvent("mousemove", { altKey: true }) }));
    expect(screen.queryByTestId("board-smart-guides")).toBeNull();
    probe.active!.scaleX = 1.7; probe.active!.scaleY = .6;
    act(() => probe.handlers.get("object:scaling")?.({ target: probe.active! }));
    expect(probe.active!.scaleX).toBe(probe.active!.scaleY);
    act(() => probe.handlers.get("object:moving")?.({ target: probe.active! }));
    expect(screen.getByTestId("board-smart-guides")).toBeVisible();
  });

  it("snaps rotation angles and keeps distance threshold in screen pixels", async () => {
    const first = renderSurface({ selectedObjectIds: ["s-1"], viewport: { ...VIEWPORT, zoom: 2 } });
    const moving = probe.objects[0]!;
    moving.left = 136; moving.angle = 44;
    act(() => probe.handlers.get("object:moving")?.({ target: moving }));
    expect(screen.queryByTestId("board-smart-guides")).toBeNull();
    act(() => probe.handlers.get("object:rotating")?.({ target: moving }));
    expect(moving.angle).toBe(45);
    first.unmount();

    probe.objects.length = 0; probe.handlers.clear();
    renderSurface({ selectedObjectIds: ["s-1"], viewport: { ...VIEWPORT, zoom: .5 } });
    const zoomedOut = probe.objects[0]!;
    zoomedOut.left = 136;
    act(() => probe.handlers.get("object:moving")?.({ target: zoomedOut }));
    expect(await screen.findByTestId("board-smart-guides")).toBeVisible();
  });

  it.each(["single", "group"])("keeps the real Fabric %s rotation pivot fixed instead of axis-snapping its position", async mode => {
    const { Rect, ActiveSelection } = await vi.importActual<typeof import("fabric")>("fabric");
    const child = new Rect({ left: 40, top: 60, width: 100, height: 80, strokeWidth: 0, originX: "left", originY: "top" });
    Object.assign(child, { data: { boardObjectId: "s-1" } });
    const other = new Rect({ left: 200, top: 60, width: 100, height: 80, strokeWidth: 0, originX: "left", originY: "top" });
    Object.assign(other, { data: { boardObjectId: "r-1" } });
    const target = mode === "single" ? child : new ActiveSelection([child, other]);
    target.set({ angle: 14 }); target.setCoords();
    const pivot = target.getCenterPoint(), bounds = target.getBoundingRect();
    const axisTarget: BoardFabricObject = { ...OBJECTS[1]!, id: "axis", geometry: { x: bounds.left + 3, y: bounds.top + 3, width: bounds.width, height: bounds.height, rotation: 0 } };
    renderSurface({ objects: [...OBJECTS, axisTarget], selectedObjectIds: [] });
    act(() => probe.handlers.get("object:rotating")?.({ target: target as unknown as MockProjectedObject }));
    expect(target.angle).toBe(15);
    expect(target.getCenterPoint().x).toBeCloseTo(pivot.x, 8);
    expect(target.getCenterPoint().y).toBeCloseTo(pivot.y, 8);
    expect(screen.queryByTestId("board-smart-guides")).toBeNull();
    target.set({ angle: 29 });
    const customPivot = target.getPositionByOrigin("right", "bottom");
    act(() => probe.handlers.get("object:rotating")?.({ target, transform: { target, originX: "right", originY: "bottom" } } as never));
    expect(target.angle).toBe(30);
    expect(target.getPositionByOrigin("right", "bottom").x).toBeCloseTo(customPivot.x, 8);
    expect(target.getPositionByOrigin("right", "bottom").y).toBeCloseTo(customPivot.y, 8);
    target.set({ angle: 44 });
    const altPivot = target.getCenterPoint();
    act(() => probe.handlers.get("object:rotating")?.({ target, e: new MouseEvent("mousemove", { altKey: true }) } as never));
    expect(target.angle).toBe(44);
    expect(target.getCenterPoint()).toEqual(altPivot);
    expect(screen.queryByTestId("board-smart-guides")).toBeNull();
    target.dispose();
  });

  it("commits an ActiveSelection as one batch and restores every member when rejected", () => {
    const onObjectsTransform = vi.fn((_items: readonly unknown[]) => false);
    renderSurface({ selectedObjectIds: ["s-1", "r-1"], onObjectsTransform });
    const [sticky, rectangle] = probe.objects;
    sticky!.left = 500; rectangle!.left = 700;
    probe.handlers.get("object:modified")?.({ target: { getObjects: () => [sticky, rectangle] } as unknown as MockProjectedObject });
    expect(onObjectsTransform).toHaveBeenCalledOnce();
    expect(onObjectsTransform.mock.calls[0]?.[0]).toHaveLength(2);
    expect(sticky!.left).toBe(OBJECTS[0]!.geometry.x);
    expect(rectangle!.left).toBe(OBJECTS[1]!.geometry.x);
  });

  it("keeps locked ActiveSelection members selectable but excludes them from the canonical transform", () => {
    const locked = { ...OBJECTS[1]!, id: "locked", locked: true };
    const onObjectsTransform = vi.fn(() => true);
    const onSelectionChange = vi.fn();
    probe.emitSelectionOnSet = true;
    renderSurface({ objects: [OBJECTS[0]!, locked], selectedObjectIds: ["s-1", "locked"], onObjectsTransform, onSelectionChange });
    const free = probe.objects.find((object) => object.data?.boardObjectId === "s-1")!;
    const frozen = probe.objects.find((object) => object.data?.boardObjectId === "locked")!;
    expect(frozen).toMatchObject({ selectable: true, evented: true, lockMovementX: true, lockScalingX: true, lockRotation: true });
    expect(probe.activeId).toBe("s-1");
    expect(onSelectionChange).not.toHaveBeenCalled();
    free.left = 500; frozen.left = 800;
    probe.handlers.get("object:modified")?.({ target: { getObjects: () => [free, frozen] } as unknown as MockProjectedObject });
    expect(onObjectsTransform).toHaveBeenCalledWith([expect.objectContaining({ id: "s-1" })], { duplicate: false });
    expect(frozen.left).toBe(locked.geometry.x);
  });

  it("writes ActiveSelection members from their total scene matrix and total angle", () => {
    const onObjectsTransform = vi.fn(() => true);
    renderSurface({ selectedObjectIds: ["s-1", "r-1"], onObjectsTransform });
    const [sticky, rectangle] = probe.objects;
    const rotation = 30, radians = rotation * Math.PI / 180, width = sticky!.width * 2, height = sticky!.height * 2;
    const x = 300, y = 200;
    sticky!.angle = rotation;
    sticky!.matrix = [Math.cos(radians) * 2, Math.sin(radians) * 2, -Math.sin(radians) * 2, Math.cos(radians) * 2,
      x + Math.cos(radians) * width / 2 - Math.sin(radians) * height / 2,
      y + Math.sin(radians) * width / 2 + Math.cos(radians) * height / 2];
    rectangle!.matrix = rectangle!.calcTransformMatrix();
    probe.handlers.get("object:modified")?.({ target: { getObjects: () => [sticky, rectangle] } as unknown as MockProjectedObject });
    expect(onObjectsTransform).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "s-1", geometry: { x, y, width, height, rotation } })]), { duplicate: false });
  });

  it("chooses the visually topmost overlapping Panel as the reparent target", () => {
    const lower: BoardFabricObject = { ...OBJECTS[0]!, id: "lower", kind: "panel", zIndex: 1, geometry: { x: 0, y: 0, width: 500, height: 400, rotation: 0 }, panel: { title: "Lower", mode: "freeform", autoExpand: false, clipContent: false } };
    const upper: BoardFabricObject = { ...lower, id: "upper", zIndex: 9, panel: { ...lower.panel!, title: "Upper" } };
    const child: BoardFabricObject = { ...OBJECTS[0]!, id: "child", zIndex: 10, geometry: { x: 600, y: 20, width: 100, height: 80, rotation: 0 } };
    const onObjectsTransform = vi.fn(() => true);
    renderSurface({ objects: [upper, child, lower], onObjectsTransform });
    const projected = probe.objects.find((object) => object.data?.boardObjectId === "child")!;
    projected.left = 100; projected.top = 100;
    probe.handlers.get("object:modified")?.({ target: projected });
    expect(onObjectsTransform).toHaveBeenCalledWith([expect.objectContaining({ id: "child", parentId: "upper" })], { duplicate: false });
  });

  it("marks an Option/Alt completed drag as a canonical duplicate gesture", () => {
    const onObjectsTransform = vi.fn(() => true);
    renderSurface({ onObjectsTransform });
    const sticky = probe.objects[0]!;
    sticky.left += 24; sticky.top += 24;
    probe.handlers.get("object:modified")?.({ target: sticky, e: new MouseEvent("mouseup", { altKey: true }) });
    expect(onObjectsTransform).toHaveBeenCalledWith([expect.objectContaining({ id: "s-1" })], { duplicate: true });
  });

  it("captures an Alt ActiveSelection at pointer-down and duplicates every member even when Fabric omits object:modified", () => {
    const onObjectsTransform = vi.fn(() => true);
    renderSurface({ selectedObjectIds: ["s-1", "r-1"], onObjectsTransform });
    const original = probe.objects.map(object => ({ left: object.left, top: object.top }));
    probe.handlers.get("mouse:down")?.({ target: probe.active!, e: new MouseEvent("mousedown", { altKey: true, clientX: 100, clientY: 120 }) } as never);
    probe.handlers.get("mouse:move")?.({ target: probe.active!, e: new MouseEvent("mousemove", { clientX: 142, clientY: 148 }) } as never);
    probe.handlers.get("mouse:up")?.({ target: probe.active!, e: new MouseEvent("mouseup", { clientX: 142, clientY: 148 }) } as never);
    expect(onObjectsTransform).toHaveBeenCalledOnce();
    expect(onObjectsTransform).toHaveBeenCalledWith([
      expect.objectContaining({ id: "s-1", geometry: expect.objectContaining({ x: OBJECTS[0]!.geometry.x + 42, y: OBJECTS[0]!.geometry.y + 28 }) }),
      expect.objectContaining({ id: "r-1", geometry: expect.objectContaining({ x: OBJECTS[1]!.geometry.x + 42, y: OBJECTS[1]!.geometry.y + 28 }) }),
    ], { duplicate: true });
    expect(probe.objects.map(object => ({ left: object.left, top: object.top }))).toEqual(original);
  });

  it("applies an absolute Fabric clipPath only to children of clip-enabled Panels", () => {
    const panel: BoardFabricObject = { ...OBJECTS[0]!, id: "panel", kind: "panel", geometry: { ...OBJECTS[0]!.geometry, rotation: 30 }, panel: { title: "Clip", mode: "freeform", autoExpand: false, clipContent: true } };
    const child: BoardFabricObject = { ...OBJECTS[1]!, id: "child", parentId: "panel" };
    renderSurface({ objects: [panel, child] });
    expect(probe.objects.find((object) => object.data?.boardObjectId === "child")?.clipPath).toBeTruthy();
    expect(probe.objects.find((object) => object.data?.boardObjectId === "child")?.clipPath).toMatchObject({ angle: 30, originX: "left", originY: "top", absolutePositioned: true });
    expect(probe.objects.find((object) => object.data?.boardObjectId === "panel")?.clipPath).toBeUndefined();

  });

  it("rolls a rejected transform back to canonical geometry without losing selection", () => {
    const onObjectTransform = vi.fn(() => false);
    renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform });
    const sticky = probe.objects[0]!;
    expect(probe.activeId).toBe("s-1");
    const rendersBeforeGesture = probe.renderCalls;

    sticky.left = 777;
    sticky.top = 888;
    sticky.scaleX = 4;
    sticky.scaleY = 3;
    sticky.angle = 42;
    probe.handlers.get("object:modified")?.({ target: sticky });

    expect(onObjectTransform).toHaveBeenCalledOnce();
    expect(sticky.left).toBe(OBJECTS[0]!.geometry.x);
    expect(sticky.top).toBe(OBJECTS[0]!.geometry.y);
    expect(sticky.angle).toBe(OBJECTS[0]!.geometry.rotation);
    expect(sticky.width * sticky.scaleX).toBeCloseTo(OBJECTS[0]!.geometry.width);
    expect(sticky.height * sticky.scaleY).toBeCloseTo(OBJECTS[0]!.geometry.height);
    expect(probe.activeId).toBe("s-1");
    expect(probe.renderCalls).toBeGreaterThan(rendersBeforeGesture);
  });

  it("rolls an asynchronously rejected transform back to the latest canonical geometry", async () => {
    const onObjectTransform = vi.fn(async () => false);
    renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left = 777;
    sticky.top = 888;

    probe.handlers.get("object:modified")?.({ target: sticky });

    await waitFor(() => expect(sticky.left).toBe(OBJECTS[0]!.geometry.x));
    expect(sticky.top).toBe(OBJECTS[0]!.geometry.y);
    expect(probe.activeId).toBe("s-1");
  });

  it("rolls a transform back when the command callback throws synchronously", () => {
    const onObjectTransform = vi.fn(() => { throw new Error("command failed"); });
    renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left = 777;
    sticky.top = 888;

    probe.handlers.get("object:modified")?.({ target: sticky });

    expect(onObjectTransform).toHaveBeenCalledOnce();
    expect(sticky.left).toBe(OBJECTS[0]!.geometry.x);
    expect(sticky.top).toBe(OBJECTS[0]!.geometry.y);
    expect(probe.activeId).toBe("s-1");
  });

  it("rolls a transform back when the command promise rejects", async () => {
    const onObjectTransform = vi.fn(() => Promise.reject(new Error("command failed")));
    renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left = 777;
    sticky.top = 888;

    probe.handlers.get("object:modified")?.({ target: sticky });

    await waitFor(() => expect(sticky.left).toBe(OBJECTS[0]!.geometry.x));
    expect(sticky.top).toBe(OBJECTS[0]!.geometry.y);
    expect(probe.activeId).toBe("s-1");
  });

  it("restores the latest canonical revision when rejection settles after a remote update", async () => {
    let settle!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { settle = resolve; });
    const onObjectTransform = vi.fn(() => pending);
    const view = renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform });
    const sticky = probe.objects[0]!;
    sticky.left = 777;
    probe.handlers.get("object:modified")?.({ target: sticky });
    expect(sticky.left).toBe(777);

    const remote = { ...OBJECTS[0]!, revision: 2, geometry: { ...OBJECTS[0]!.geometry, x: 222, y: 333 } };
    view.rerender(<BoardFabricSurface objects={[remote, OBJECTS[1]!]} selectedObjectIds={["s-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={onObjectTransform} onViewportChange={vi.fn()} />);
    expect(sticky.left).toBe(222);
    expect(sticky.top).toBe(333);

    await act(async () => { settle(false); await pending; });

    expect(sticky.left).toBe(222);
    expect(sticky.top).toBe(333);
    expect(probe.activeId).toBe("s-1");
  });

  it("does not roll a rejected gesture into a replacement object with the same id", async () => {
    let settle!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { settle = resolve; });
    const onObjectTransform = vi.fn(() => pending);
    const view = renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform });
    const originalProjection = probe.objects[0]!;
    originalProjection.left = 777;
    probe.handlers.get("object:modified")?.({ target: originalProjection });

    const replacementCanonical: BoardFabricObject = {
      ...OBJECTS[0]!, revision: 2, kind: "ellipse", geometry: { ...OBJECTS[0]!.geometry, x: 456, y: 321 },
    };
    view.rerender(<BoardFabricSurface objects={[replacementCanonical, OBJECTS[1]!]} selectedObjectIds={["s-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={onObjectTransform} onViewportChange={vi.fn()} />);
    const replacementProjection = probe.objects.find((candidate) => candidate.data?.boardObjectId === "s-1");
    expect(replacementProjection).toBeDefined();
    expect(replacementProjection).not.toBe(originalProjection);

    await act(async () => { settle(false); await pending; });

    expect(replacementProjection?.data?.adapterKind).toBe("ellipse");
    expect(replacementProjection?.left).toBe(456);
    expect(replacementProjection?.top).toBe(321);
    expect(probe.activeId).toBe("s-1");
  });

  it("settles a pending rejected gesture safely after the surface unmounts", async () => {
    let settle!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { settle = resolve; });
    const view = renderSurface({ selectedObjectIds: ["s-1"], onObjectTransform: vi.fn(() => pending) });
    const sticky = probe.objects[0]!;
    sticky.left = 777;
    probe.handlers.get("object:modified")?.({ target: sticky });
    view.unmount();
    const rendersAfterUnmount = probe.renderCalls;

    await act(async () => { settle(false); await pending; });

    expect(probe.renderCalls).toBe(rendersAfterUnmount);
  });

  it("never emits a transform command from a projection placeholder", () => {
    const onObjectTransform = vi.fn();
    const placeholder: BoardFabricObject = {
      ...OBJECTS[0]!,
      id: "future",
      kind: "placeholder",
      locked: true,
      content: { text: "暂不支持“frame”对象，内容已安全保留。" },
      projectionIssue: { code: "BOARD_OBJECT_UNSUPPORTED", sourceKind: "frame", message: "暂不支持“frame”对象，内容已安全保留。" },
    };
    renderSurface({ objects: [OBJECTS[0]!, placeholder, OBJECTS[1]!], onObjectTransform });
    const projected = probe.objects.find((object) => object.data?.boardObjectId === "future");
    if (!projected) throw new Error("Unsupported object placeholder was not rendered");
    expect(projected.selectable).toBe(false);
    expect(projected.evented).toBe(false);
    probe.handlers.get("object:modified")?.({ target: projected });
    expect(onObjectTransform).not.toHaveBeenCalled();
    expect(screen.getByTestId("board-a11y-object-future")).toBeDisabled();
    const valid = probe.objects.find((object) => object.data?.boardObjectId === "s-1");
    if (!valid) throw new Error("Valid neighbor was not rendered");
    valid.left = 120;
    probe.handlers.get("object:modified")?.({ target: valid });
    expect(onObjectTransform).toHaveBeenCalledOnce();
    expect(onObjectTransform).toHaveBeenCalledWith("s-1", expect.objectContaining({ x: 120 }));
  });

  it("does not replay Fit when selection chrome changes, but fits new requests and real resizes", () => {
    const onViewportChange = vi.fn();
    const props = { objects: OBJECTS, selectedObjectIds: [] as string[], readOnly: false, tool: "select" as const,
      viewport: { ...VIEWPORT, fitRequest: 1 }, onSelectionChange: vi.fn(), onObjectTransform: vi.fn(), onViewportChange };
    const initialInsets = { left: 48, right: 48, top: 48, bottom: 48 };
    const selectedInsets = { ...initialInsets, top: 120 };
    const view = render(<BoardFabricSurface {...props} fitInsets={initialInsets} />);
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    const initialFit = onViewportChange.mock.calls[0]![0];
    view.rerender(<BoardFabricSurface {...props} selectedObjectIds={["r-1"]} fitInsets={selectedInsets} />);
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    view.rerender(<BoardFabricSurface {...props} selectedObjectIds={["r-1"]} fitInsets={selectedInsets} viewport={{ ...VIEWPORT, fitRequest: 2 }} />);
    expect(onViewportChange).toHaveBeenCalledTimes(2);
    expect(onViewportChange.mock.calls[1]![0]).not.toEqual(initialFit);
    probe.canvasWidth = 900;
    const host = screen.getByTestId("board-fabric-surface");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 900 });
    act(() => probe.resize?.());
    expect(onViewportChange).toHaveBeenCalledTimes(3);
    expect(onViewportChange.mock.calls[2]![0].zoom).toBeLessThan(onViewportChange.mock.calls[1]![0].zoom);
    act(() => probe.resize?.());
    expect(onViewportChange).toHaveBeenCalledTimes(3);
  });

  it("clamps viewport to 5%-800% and fits canonical content locally", () => {
    const onViewportChange = vi.fn();
    const { rerender } = renderSurface({ viewport: { ...VIEWPORT, zoom: 0.001 }, onViewportChange });
    expect(probe.zoom).toBe(.05);
    rerender(<BoardFabricSurface objects={OBJECTS} selectedObjectIds={[]} readOnly={false} tool="select" viewport={{ ...VIEWPORT, zoom: 99 }} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={onViewportChange} />);
    expect(probe.zoom).toBe(8);
    rerender(<BoardFabricSurface objects={OBJECTS} selectedObjectIds={[]} readOnly={false} tool="select" viewport={{ ...VIEWPORT, fitRequest: 1 }} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={onViewportChange} />);
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.any(Number) }), "fit");
    expect(probe.clearCalls).toBe(0);
  });

  it("reorders the Fabric stack and accessibility mirror from the same orderKey", () => {
    const reversed = [
      { ...OBJECTS[0]!, revision: 2, orderKey: "z" },
      { ...OBJECTS[1]!, revision: 2, orderKey: "a" },
    ];
    renderSurface({ objects: reversed });
    expect(probe.objects.map((object) => object.data?.boardObjectId)).toEqual(["r-1", "s-1"]);
    const mirrorIds = [...screen.getByTestId("board-a11y-mirror").querySelectorAll("li")].map((node) => node.getAttribute("data-object-id"));
    expect(mirrorIds).toEqual(["r-1", "s-1"]);
    expect(probe.moveCalls).toBeGreaterThan(0);
  });

  it("coalesces canonical projection and controlled selection into one frame render", async () => {
    const view = renderSurface({ selectedObjectIds: ["s-1"] });
    await waitFor(() => expect(probe.renderCalls).toBeGreaterThan(0));
    probe.renderCalls = 0;
    view.rerender(<BoardFabricSurface objects={[{ ...OBJECTS[0]!, revision: 2, geometry: { ...OBJECTS[0]!.geometry, x: 88 } }, OBJECTS[1]!]} selectedObjectIds={["s-1"]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} />);
    await waitFor(() => expect(probe.renderCalls).toBe(1));
  });

  it("distinguishes fit selection from fit board and ignores an empty selection fit", () => {
    const onViewportChange = vi.fn();
    const selected = renderSurface({ selectedObjectIds: ["s-1"], viewport: { ...VIEWPORT, fitRequest: 1, fitMode: "selection" }, onViewportChange });
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ fitMode: "selection" }), "fit");
    selected.unmount();
    probe.objects.length = 0; probe.handlers.clear(); onViewportChange.mockClear();
    renderSurface({ selectedObjectIds: [], viewport: { ...VIEWPORT, fitRequest: 2, fitMode: "selection" }, onViewportChange });
    expect(onViewportChange).not.toHaveBeenCalled();
  });
});

it('focuses the real surface DOM from canvas pointerdown so keyboard all-selection reaches the editor',async()=>{
 const {CollaborativeEditor}=await import('@/components/whiteboard/collaborative-editor');
 const {createWhiteboardDocument,executeCommands}=await import('@repo/whiteboard-core');
 const doc=createWhiteboardDocument();executeCommands(doc,[0,1].map(i=>({type:'create' as const,object:{id:`focus-${i}`,schemaVersion:1 as const,kind:'sticky' as const,geometry:{x:i*200,y:0,width:180,height:140,rotation:0},text:`focus ${i}`,style:{},parentId:null,orderKey:String(i)}})),'seed');
 render(<CollaborativeEditor boardId="board-focus" clientId="client-focus" doc={doc} readOnly={false} title="白板" status="已连接"/>);
 const surface=screen.getByTestId('board-fabric-surface'),canvas=screen.getByTestId('board-fabric-canvas');
 (document.activeElement as HTMLElement).blur();expect(document.activeElement).toBe(document.body);
 fireEvent.pointerDown(canvas,{button:0});expect(document.activeElement).toBe(surface);
 expect(fireEvent.keyDown(document.activeElement!,{key:'a',ctrlKey:true})).toBe(false);
 expect(screen.getByTestId('board-a11y-selection-announcement')).toHaveTextContent('已选择 2 个对象');
 const upper=document.createElement('canvas');upper.className='upper-canvas';surface.append(upper);(document.activeElement as HTMLElement).blur();fireEvent.pointerDown(upper,{button:0});expect(document.activeElement).toBe(surface);upper.remove();
 const input=document.createElement('textarea');surface.append(input);input.focus();fireEvent.pointerDown(input,{button:0});
 expect(document.activeElement).toBe(input);expect(fireEvent.keyDown(document.activeElement!,{key:'a',ctrlKey:true})).toBe(true);input.remove();doc.destroy();
});
