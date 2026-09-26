import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardFabricObject, BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

interface MockProjectedObject {
  data?: { boardObjectId?: string; adapterKind?: string; stickyVariant?: string; sizingMode?: string };
  left: number; top: number; width: number; height: number; scaleX: number; scaleY: number; angle: number;
  selectable: boolean; evented: boolean;
  mockKind?: string; children?: MockProjectedObject[]; controls?: Record<string, boolean>;
  fontFamily?: string; fontSize?: number; fontWeight?: number; fontStyle?: string; underline?: boolean; textAlign?: string; lineHeight?: number; fill?: string; hoverCursor?: string; lockScalingX?: boolean; lockScalingY?: boolean;
}

const probe = vi.hoisted(() => ({
  instances: 0,
  objects: [] as MockProjectedObject[],
  handlers: new Map<string, (event: { target?: MockProjectedObject; e?: MouseEvent }) => void>(),
  activeId: null as string | null,
  zoom: 1,
  clearCalls: 0,
  renderCalls: 0,
  moveCalls: 0,
}));

vi.mock("fabric", () => {
  class MockObject implements MockProjectedObject {
    data?: { boardObjectId?: string; adapterKind?: string; stickyVariant?: string; sizingMode?: string };
    left = 0; top = 0; width = 100; height = 80; scaleX = 1; scaleY = 1; angle = 0;
    selectable = true; evented = true;
    controls?: Record<string, boolean>;
    constructor(first?: unknown, second: Record<string, unknown> = {}) { if (first && typeof first === "object" && !Array.isArray(first)) Object.assign(this, first); if (typeof first === "string") Object.assign(this, { text: first }); Object.assign(this, second); }
    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility(values: Record<string, boolean>) { this.controls = { ...values }; return this; }
    setCoords() {}
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
  }
  class MockRect extends MockObject { mockKind = "rect"; }
  class MockCircle extends MockObject { mockKind = "circle"; }
  class MockTextbox extends MockObject { mockKind = "textbox"; }
  class MockGroup extends MockObject {
    mockKind = "group";
    children: MockProjectedObject[];
    constructor(children: MockProjectedObject[]) { super(); this.children = children; }
    getObjects() { return this.children; }
  }
  class Canvas {
    selection = true; defaultCursor = "default"; viewportTransform = [1, 0, 0, 1, 0, 0];
    constructor() { probe.instances += 1; }
    add(object: MockProjectedObject) { probe.objects.push(object); }
    remove(object: MockProjectedObject) { probe.objects.splice(probe.objects.indexOf(object), 1); }
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
    getWidth() { return 1200; } getHeight() { return 800; } getZoom() { return probe.zoom; }
    zoomToPoint(_point: unknown, value: number) { probe.zoom = value; }
    getScenePoint() { return { x: 123, y: 234 }; }
    setActiveObject(object: MockProjectedObject) { probe.activeId = object.data?.boardObjectId ?? null; }
    discardActiveObject() { probe.activeId = null; }
    getActiveObject() { return probe.objects.find((object) => object.data?.boardObjectId === probe.activeId); }
    clear() { probe.clearCalls += 1; }
  }
  return { Canvas, Rect: MockRect, Circle: MockCircle, Textbox: MockTextbox, Group: MockGroup, Point: MockObject };
});

class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

import { BoardFabricSurface } from "@/components/whiteboard/fabric/board-fabric-surface";

const OBJECTS: readonly BoardFabricObject[] = [
  { id: "s-1", kind: "sticky", revision: 1, orderKey: "a", geometry: { x: 40, y: 60, width: 220, height: 180, rotation: 0 }, style: { fill: "#F8D76E", textColor: "#29261E" }, content: { text: "一个观察" } },
  { id: "r-1", kind: "rectangle", revision: 1, orderKey: "b", geometry: { x: 360, y: 80, width: 240, height: 140, rotation: 5 }, style: { fill: "#D9CDF7", textColor: "#29261E" }, content: { text: "一个主题" } },
];
const VIEWPORT: BoardViewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };

function renderSurface(overrides: Partial<React.ComponentProps<typeof BoardFabricSurface>> = {}) {
  return render(<BoardFabricSurface objects={OBJECTS} selectedObjectIds={[]} readOnly={false} tool="select" viewport={VIEWPORT} onSelectionChange={vi.fn()} onObjectTransform={vi.fn()} onViewportChange={vi.fn()} {...overrides} />);
}

describe("BoardFabricSurface", () => {
  beforeEach(() => { probe.instances = 0; probe.objects.length = 0; probe.handlers.clear(); probe.activeId = null; probe.zoom = 1; probe.clearCalls = 0; probe.renderCalls = 0; probe.moveCalls = 0; });

  it("projects canonical-like objects into one Fabric Canvas without DOM object replicas", () => {
    const { container } = renderSurface();
    expect(screen.getByTestId("board-fabric-canvas").tagName).toBe("CANVAS");
    expect(probe.instances).toBe(1);
    expect(probe.objects.map((object) => object.data?.boardObjectId)).toEqual(["s-1", "r-1"]);
    expect(container.querySelector('[data-testid^="whiteboard-object-"]')).toBeNull();
    expect(probe.clearCalls).toBe(0);
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
