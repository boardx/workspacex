import { localPointFromScene, rotatedAnchorPoint, rotatedGeometryCorners, type ConnectorPathInput, type WhiteboardObject } from "@repo/whiteboard-core";

type Obstacle = Pick<WhiteboardObject, "id" | "geometry" | "hidden"> & { kind: string };
type Point = ConnectorPathInput["start"];
const edges = ["top", "right", "bottom", "left"] as const;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function crosses(a: Point, b: Point, { geometry }: Obstacle) {
  const start = localPointFromScene(geometry, a);
  const end = localPointFromScene(geometry, b);
  let low = 0;
  let high = 1;
  // Test the open interior so a segment can touch its attachment boundary.
  for (const axis of ["x", "y"] as const) {
    const min = 0.001;
    const max = (axis === "x" ? geometry.width : geometry.height) - min;
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-9) {
      if (start[axis] <= min || start[axis] >= max) return false;
      continue;
    }
    const first = (min - start[axis]) / delta;
    const last = (max - start[axis]) / delta;
    low = Math.max(low, Math.min(first, last));
    high = Math.min(high, Math.max(first, last));
    if (low >= high) return false;
  }
  return low < high;
}

export function automaticConnectorRoute(
  input: ConnectorPathInput,
  objects: readonly Obstacle[],
  fromId?: string,
  toId?: string,
  lockFrom = false,
  lockTo = false,
): ConnectorPathInput {
  if (input.route || (input.type !== "straight" && input.type !== "elbow") || (!fromId && !toId)) return input;
  const from = objects.find(object => object.id === fromId);
  const to = objects.find(object => object.id === toId);
  const blocks = objects.filter(object => !object.hidden && object.kind !== "connector" &&
    (object.id === fromId || object.id === toId || !["frame", "group"].includes(object.kind)));
  const clear = (a: Point, b: Point) => !blocks.some(object => crosses(a, b, object));
  function candidates(point: Point, object?: Obstacle, locked?: boolean) {
    return object && !locked ? [point, ...edges.map(edge => rotatedAnchorPoint(object, edge))] : [point];
  }
  const starts = candidates(input.start, from, lockFrom);
  const ends = candidates(input.end, to, lockTo);
  if (input.type === "straight") {
    if (clear(input.start, input.end)) return input;
    const direct = starts.flatMap(start => ends.map(end => ({ start, end })))
      .filter(({ start, end }) => clear(start, end))
      .sort((a, b) => distance(a.start, a.end) - distance(b.start, b.end))[0];
    if (direct) return { ...input, ...direct };
  }

  let best: ConnectorPathInput | undefined;
  let bestLength = Infinity;
  for (const start of starts) for (const end of ends) {
    const bends: Point[][] = [[{ x: end.x, y: start.y }], [{ x: start.x, y: end.y }]];
    const blocking = blocks.filter(block => crosses(start, end, block));
    if (blocking.length) {
      const corners = blocking.flatMap(block => rotatedGeometryCorners(block.geometry));
      const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
      for (const x of [Math.min(...xs) - 12, Math.max(...xs) + 12]) bends.push([{ x, y: start.y }, { x, y: end.y }]);
      for (const y of [Math.min(...ys) - 12, Math.max(...ys) + 12]) bends.push([{ x: start.x, y }, { x: end.x, y }]);
    }
    for (const waypoints of bends) {
      if (waypoints.some(point => Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6)) continue;
      const path = [start, ...waypoints, end];
      let length = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!;
        if (!clear(a, b)) { length = Infinity; break; }
        length += distance(a, b);
      }
      if (length >= bestLength) continue;
      bestLength = length;
      // These waypoints describe an already orthogonal path; no extra bends are needed.
      best = { start, end, type: "elbow", route: { kind: "elbow", waypoints } };
    }
  }
  return best ?? input;
}
