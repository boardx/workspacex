import { expect, it } from "vitest";
import { resolveConnectorPath } from "@repo/whiteboard-core";
import { automaticConnectorRoute } from "@/components/whiteboard/automatic-connector-route";

const box = (id: string, x: number, y: number) => ({
  id, kind: "rectangle", geometry: { x, y, width: 100, height: 100, rotation: 0 },
});

it("moves a backward anchor to the outside edge for a direct connection", () => {
  const input = { type: "straight", start: { x: 50, y: 100 }, end: { x: 250, y: 0 } } as const;
  const path = automaticConnectorRoute(input, [box("from", 0, 0), box("to", 200, -100)], "from", "to");
  expect(path.type).toBe("straight");
  expect(path.start).not.toEqual(input.start);
});

it("detours around a blocker while retaining locked endpoints", () => {
  const input = { type: "straight", start: { x: 100, y: 50 }, end: { x: 400, y: 50 } } as const;
  const path = resolveConnectorPath(automaticConnectorRoute(input,
    [box("from", 0, 0), box("block", 200, 0), box("to", 400, 0)], "from", "to", true, true));
  expect(path.kind).toBe("polyline");
  expect(path.start).toEqual(input.start);
  expect(path.end).toEqual(input.end);
  expect(path.points.some(point => point.y < 0 || point.y > 100)).toBe(true);
});
