import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardFabricObject, BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

interface MockProjectedObject {
  data?: { boardObjectId?: string; adapterKind?: string };
  left: number; top: number; width: number; height: number; scaleX: number; scaleY: number; angle: number;
  selectable: boolean; evented: boolean;
}

const probe = vi.hoisted(() => ({
  instances: 0,
  objects: [] as MockProjectedObject[],
  handlers: new Map<string, (event: { target?: MockProjectedObject }) => void>(),
  activeId: null as string | null,
  zoom: 1,
  clearCalls: 0,
  renderCalls: 0,
  moveCalls: 0,
}));

vi.mock("fabric", () => {
  class MockObject implements MockProjectedObject {
    data?: { boardObjectId?: string; adapterKind?: string };
    left = 0; top = 0; width = 100; height = 80; scaleX = 1; scaleY = 1; angle = 0;
    selectable = true; evented = true;
    constructor(_first?: unknown, second: Record<string, unknown> = {}) { Object.assign(this, second); }
    set(values: Record<string, unknown>) { Object.assign(this, values); return this; }
    setControlsVisibility() { return this; }
    setCoords() {}
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width * this.scaleX, height: this.height * this.scaleY }; }
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
    setActiveObject(object: MockProjectedObject) { probe.activeId = object.data?.boardObjectId ?? null; }
    discardActiveObject() { probe.activeId = null; }
    getActiveObject() { return probe.objects.find((object) => object.data?.boardObjectId === probe.activeId); }
    clear() { probe.clearCalls += 1; }
  }
  return { Canvas, Rect: MockObject, Circle: MockObject, Textbox: MockObject, Group: MockObject, Point: MockObject };
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
