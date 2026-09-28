import { Group, Path, Point, util } from "fabric";
import { describe, expect, it } from "vitest";
import { applyCanonicalObject, createFabricObject } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";
import { geometryForAppendedDrawingStroke, worldStrokeToDrawingSpace } from "@/components/whiteboard/drawing-coordinate-space";
import type { DrawingStroke } from "@repo/whiteboard-core";

const firstStroke = {
  id: "stroke-1",
  tool: "pen" as const,
  points: [{ x: 10, y: 20, pressure: .4 }, { x: 50, y: 60, pressure: .6 }],
  color: "#18181B",
  width: 3,
  opacity: 1,
};

function drawing(geometry: BoardFabricObject["geometry"], appended = false): BoardFabricObject {
  return {
    id: "drawing",
    kind: "drawing",
    revision: appended ? 2 : 1,
    orderKey: "a",
    geometry,
    style: { fill: "transparent", textColor: "#18181B" },
    content: { text: "" },
    boardContent: {
      version: 1,
      type: "drawing",
      strokes: appended ? [firstStroke, { ...firstStroke, id: "stroke-2", points: [{ x: 20, y: 30, pressure: .4 }, { x: 40, y: 50, pressure: .6 }] }] : [firstStroke],
    },
  };
}

function render(record: BoardFabricObject): Group {
  const projected = createFabricObject(record) as Group;
  applyCanonicalObject(projected, record, false);
  return projected;
}

function pathScenePoint(path: Path, commandIndex: 0 | 1): Point {
  const command = path.path[commandIndex]!;
  const local = new Point(Number(command[1]) - path.pathOffset.x, Number(command[2]) - path.pathOffset.y);
  return util.transformPoint(local, path.calcTransformMatrix());
}

function expectedWorldPoint(geometry: BoardFabricObject["geometry"], point: { x: number; y: number }): Point {
  const localX = (point.x - 10) * geometry.width / 40;
  const localY = (point.y - 20) * geometry.height / 40;
  const radians = geometry.rotation * Math.PI / 180;
  return new Point(
    geometry.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    geometry.y + localX * Math.sin(radians) + localY * Math.cos(radians),
  );
}

describe("real Fabric drawing coordinate projection", () => {
  it.each([
    { label: "move", geometry: { x: 110, y: 100, width: 40, height: 40, rotation: 0 } },
    { label: "resize", geometry: { x: 10, y: 20, width: 80, height: 20, rotation: 0 } },
    { label: "rotate", geometry: { x: 10, y: 20, width: 40, height: 40, rotation: 90 } },
  ])("keeps historical vectors at their transformed scene position after $label and append", ({ geometry }) => {
    const before = render(drawing(geometry));
    const after = render(drawing(geometry, true));
    const beforePath = before.getObjects()[0] as Path;
    const afterPath = after.getObjects()[0] as Path;
    expect(beforePath.path).toEqual([["M", 0, 0], ["L", 40, 40]]);

    for (const index of [0, 1] as const) {
      const expected = expectedWorldPoint(geometry, firstStroke.points[index]!);
      const beforePoint = pathScenePoint(beforePath, index);
      const afterPoint = pathScenePoint(afterPath, index);
      expect(afterPoint.x).toBeCloseTo(beforePoint.x, 5);
      expect(afterPoint.y).toBeCloseTo(beforePoint.y, 5);
      // Fabric includes half the vector stroke in Group bounds. The vector
      // centreline therefore remains within one rendered stroke width of the
      // mathematical geometry transform.
      expect(Math.abs(beforePoint.x - expected.x)).toBeLessThanOrEqual(firstStroke.width);
      expect(Math.abs(beforePoint.y - expected.y)).toBeLessThanOrEqual(firstStroke.width);
    }
  });

  it("expands a rotated drawing around an out-of-bounds world stroke without moving history or losing rotation", () => {
    const geometry = { x: 10, y: 20, width: 40, height: 40, rotation: 90 };
    const captured: DrawingStroke = {
      ...firstStroke,
      id: "outside",
      points: [{ x: 30, y: 0, pressure: .4 }, { x: 0, y: 40, pressure: .6 }],
    };
    const intrinsic = worldStrokeToDrawingSpace(geometry, [firstStroke], captured);
    const expanded = geometryForAppendedDrawingStroke(geometry, [firstStroke], intrinsic);
    expect(intrinsic.points).toEqual([{ x: -10, y: 0, pressure: .4 }, { x: 30, y: 30, pressure: .6 }]);
    expect(expanded).toEqual({ x: 30, y: 0, width: 60, height: 60, rotation: 90 });

    const before = render(drawing(geometry));
    const afterRecord = drawing(expanded);
    if (afterRecord.boardContent?.type !== "drawing") throw new Error("DRAWING_FIXTURE_INVALID");
    afterRecord.boardContent = { ...afterRecord.boardContent, strokes: [firstStroke, intrinsic] };
    const after = render(afterRecord);
    const beforePath = before.getObjects()[0] as Path;
    const historicalPath = after.getObjects()[0] as Path;
    const appendedPath = after.getObjects()[1] as Path;

    for (const index of [0, 1] as const) {
      const historicalBefore = pathScenePoint(beforePath, index);
      const historicalAfter = pathScenePoint(historicalPath, index);
      expect(historicalAfter.x).toBeCloseTo(historicalBefore.x, 5);
      expect(historicalAfter.y).toBeCloseTo(historicalBefore.y, 5);
      const appended = pathScenePoint(appendedPath, index);
      expect(Math.abs(appended.x - captured.points[index]!.x)).toBeLessThanOrEqual(firstStroke.width);
      expect(Math.abs(appended.y - captured.points[index]!.y)).toBeLessThanOrEqual(firstStroke.width);
    }
  });
});
