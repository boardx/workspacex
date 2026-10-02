import { render } from "@testing-library/react";
import { Canvas } from "fabric";
import { describe, expect, it, vi } from "vitest";
import type { WhiteboardObject } from "@repo/whiteboard-core";
import { BoardFabricSurface } from "@/components/whiteboard/fabric/board-fabric-surface";
import { toBoardFabricObjects } from "@/components/whiteboard/whiteboard-fabric-projection";

const probe = vi.hoisted(() => ({ canvas: null as Canvas | null }));
vi.mock("fabric", async () => {
  const actual = await vi.importActual<typeof import("fabric")>("fabric");
  return { ...actual, Canvas: class extends actual.Canvas {
    constructor(...args: ConstructorParameters<typeof actual.Canvas>) { super(...args); probe.canvas = this; }
  } };
});
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

describe("independent hidden connector Fabric projection", () => {
  it("honors initial and remote hidden changes for a connector without opacity hacks or selectable hidden objects", () => {
    const kind = "connector" as const;
    const canonical: WhiteboardObject = {
      id: "target", schemaVersion: 1, kind, text: "", parentId: null, orderKey: "a", style: { fill: "#000000", stroke: "#000000" },
      geometry: { x: 150, y: 150, width: 200, height: 100, rotation: 0 },
      ...(kind === "connector" ? { connector: { fromPoint: { x: 150, y: 200 }, toPoint: { x: 350, y: 200 }, type: "straight" as const, strokeWidth: 8 } } : {}),
    };
    const props = { selectedObjectIds: ["target"], readOnly: false, tool: "select" as const,
      viewport: { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }, onSelectionChange: vi.fn(), onObjectTransform: vi.fn(), onViewportChange: vi.fn() };
    const view = render(<BoardFabricSurface {...props} objects={toBoardFabricObjects([{ ...canonical, hidden: true }])} />);
    const canvas = probe.canvas!;
    const pixel = () => { canvas.renderAll(); return [...canvas.getContext().getImageData(248, 198, 5, 5).data].filter((_, index) => index % 4 === 3).reduce((sum, alpha) => sum + alpha, 0); };
    const hidden = () => {
      expect(canvas.getObjects()).toHaveLength(1);
      expect(canvas.getObjects()[0]).toMatchObject({ visible: false, selectable: false, evented: false, opacity: 1 });
      expect(canvas.getActiveObject()).toBeUndefined();
      expect(pixel()).toBe(0);
    };
    try {
      hidden();
      view.rerender(<BoardFabricSurface {...props} objects={toBoardFabricObjects([{ ...canonical, hidden: false, locked: true }])} />);
      expect(canvas.getObjects()[0]).toMatchObject({ visible: true, selectable: true, evented: true, opacity: 1, lockMovementX: true });
      expect(pixel()).toBeGreaterThan(0);
      view.rerender(<BoardFabricSurface {...props} objects={toBoardFabricObjects([{ ...canonical, hidden: true }])} />);
      hidden();
      view.rerender(<BoardFabricSurface {...props} tool="hand" objects={toBoardFabricObjects([{ ...canonical, hidden: true }])} />);
      view.rerender(<BoardFabricSurface {...props} objects={toBoardFabricObjects([{ ...canonical, hidden: true }])} />);
      hidden();
      expect(props.onObjectTransform).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
});
