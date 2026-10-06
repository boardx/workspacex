// @vitest-environment jsdom
import { Group, Path } from "fabric";
import { describe, expect, it } from "vitest";
import { applyCanonicalObject, createFabricObject, geometryFromFabricSceneTransform } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

function database(width: number, height: number): BoardFabricObject {
  return {
    id: "database", kind: "shape", revision: 1, orderKey: "a",
    geometry: { x: 180, y: 195, width, height, rotation: 0 },
    style: { fill: "#FFFFFF", textColor: "#111111", stroke: "#111111", strokeWidth: 2 }, content: { text: "Storage" },
    boardContent: { version: 1, type: "shape", variant: "database", fill: "#FFFFFF", borderColor: "#111111", borderWidth: 2, borderStyle: "solid", opacity: 1, radius: 0, textColor: "#111111", horizontalAlign: "center", verticalAlign: "middle" },
  };
}

describe("database shape projection", () => {
  it("renders complete cylinder tiers after canonical serialization and rehydration", () => {
    let object = database(240, 160);
    const projected = createFabricObject(object) as Group;
    for (const [width, height] of [[240, 160], [80, 220], [320, 60]]) {
      object = JSON.parse(JSON.stringify({ ...object, geometry: { ...object.geometry, width, height } })) as BoardFabricObject;
      applyCanonicalObject(projected, object, false);
      const shell = projected.getObjects()[0] as Path;
      expect(shell).toBeInstanceOf(Path);
      expect(shell.path.filter(segment => segment[0] === "M")).toHaveLength(3);
      expect(shell.path.filter(segment => segment[0] === "C")).toHaveLength(8);
      expect(shell.strokeWidth).toBe(2);
      expect(shell.strokeUniform).toBe(true);
      const geometry = geometryFromFabricSceneTransform(projected);
      expect(geometry.width).toBeCloseTo(width!, 5);
      expect(geometry.height).toBeCloseTo(height!, 5);
      expect(geometry.x).toBeCloseTo(180, 5);
      expect(geometry.y).toBeCloseTo(195, 5);
      const reloaded = createFabricObject(object) as Group;
      const reloadedShell = reloaded.getObjects()[0] as Path;
      expect(shell.width * shell.scaleX).toBeCloseTo(reloadedShell.width * reloadedShell.scaleX, 5);
      expect(shell.height * shell.scaleY).toBeCloseTo(reloadedShell.height * reloadedShell.scaleY, 5);
      // A live resize scales its original path; a reload regenerates it. Compare
      // the rendered path coordinates, rather than their intrinsic coordinates.
      shell.path.forEach((segment, index) => {
        const expected = reloadedShell.path[index]!;
        expect(segment[0]).toBe(expected[0]);
        segment.slice(1).forEach((coordinate, offset) => {
          const axis = offset % 2 === 0 ? "scaleX" : "scaleY";
          expect(Number(coordinate) * shell[axis]).toBeCloseTo(Number(expected[offset + 1]) * reloadedShell[axis], 5);
        });
      });
      reloaded.dispose();
    }
    projected.dispose();
  });
});
