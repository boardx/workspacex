// @vitest-environment jsdom
import { Path, StaticCanvas } from "fabric";
import { describe, expect, it, vi } from "vitest";
vi.mock("fabric", async () => await import("fabric/node"));
import { databaseShapePath } from "@/components/whiteboard/fabric/database-shape-path";

describe("database cylinder geometry", () => {
  it("keeps the top and middle arc interiors filled under the nonzero fill rule", async () => {
    const canvas = new StaticCanvas(undefined, { width: 300, height: 240, enableRetinaScaling: false });
    try {
      const shell = new Path(databaseShapePath(240, 160), { left: 150, top: 120, originX: "center", originY: "center", fill: "#2563EB", stroke: "#18181B", strokeWidth: 1 });
      canvas.add(shell); canvas.renderAll();
      const context = canvas.lowerCanvasEl.getContext("2d")!;
      for (const y of [65, 128]) {
        expect([...context.getImageData(150, y, 1, 1).data]).toEqual([37, 99, 235, 255]);
      }
    } finally { await canvas.dispose(); }
  });
  it.each([[240, 160], [80, 220], [320, 60]])("retains the complete %s × %s canonical frame", (width, height) => {
    const path = new Path(databaseShapePath(width, height));
    expect(path.width).toBeCloseTo(width, 5);
    expect(path.height).toBeCloseTo(height, 5);
    expect(path.pathOffset.x).toBeCloseTo(0, 5);
    expect(path.pathOffset.y).toBeCloseTo(0, 5);
    // Fabric decomposes each semicircle to two cubic curves. Three separate
    // subpaths preserve the filled shell, front top, and middle tier.
    expect(path.path.filter(segment => segment[0] === "M")).toHaveLength(3);
    expect(path.path.filter(segment => segment[0] === "C")).toHaveLength(8);
  });
});
