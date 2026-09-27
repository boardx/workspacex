import { expect, it } from "vitest";
import { calculateRotationSnap, calculateSnapGuides, type WhiteboardObject } from "@repo/whiteboard-core";

const target = (id: string, x: number, y: number, width = 100, height = 80): Pick<WhiteboardObject, "id" | "geometry" | "hidden"> => ({ id, geometry: { x, y, width, height, rotation: 0 }, hidden: false });

it.each([[0.5, 8], [1, 4], [2, 2]] as const)("keeps the snap hit target at five screen pixels at zoom %s", (zoom, worldOffset) => {
  const moving = { x: 200 + worldOffset, y: 100, width: 100, height: 80, rotation: 0 };
  const result = calculateSnapGuides(moving, [target("anchor", 200, 300)], 5 / zoom);
  expect(result.geometry.x).toBe(200);
  expect(Math.abs(result.delta.x * zoom)).toBeLessThanOrEqual(5);
  expect(result.guides).toEqual(expect.arrayContaining([expect.objectContaining({ axis: "x", position: 200, targetId: "anchor" })]));
});

it("reports equal spacing without mutating world geometry or hidden targets", () => {
  const moving = { x: 150, y: 20, width: 100, height: 80, rotation: 0 }, frozen = structuredClone(moving);
  const result = calculateSnapGuides(moving, [target("left", 0, 20), target("right", 300, 20), { ...target("hidden", 150, 20), hidden: true }]);
  expect(result.measurements).toHaveLength(2);
  expect(result.measurements.every(value => value.equalSpacing && value.size === 50)).toBe(true);
  expect(moving).toEqual(frozen);
});

it("snaps rotation deterministically to object angles and 15 degree increments", () => {
  const moving = { x: 0, y: 0, width: 100, height: 80, rotation: 32.5 };
  expect(calculateRotationSnap(moving, [{ ...target("peer", 200, 0), geometry: { x: 200, y: 0, width: 100, height: 80, rotation: 33 } }], 4)).toMatchObject({ snapped: true, targetAngle: 33, geometry: { rotation: 33 } });
  expect(calculateRotationSnap({ ...moving, rotation: 44 }, [], 4)).toMatchObject({ snapped: true, targetAngle: 45 });
});
