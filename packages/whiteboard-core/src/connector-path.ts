import { WHITEBOARD_CONNECTOR_LIMITS, WhiteboardPoint, WhiteboardConnectorLabelPosition, WhiteboardConnectorRoute, type WhiteboardConnector } from '@repo/contracts/whiteboard-document';
import type { SpatialAnchor, SpatialPoint } from './spatial-geometry';

export type ConnectorPathPoint = SpatialPoint;
export interface ConnectorPathInput { start: SpatialPoint; end: SpatialPoint; type?: WhiteboardConnector['type']; route?: WhiteboardConnector['route']; fromAnchor?: SpatialAnchor; toAnchor?: SpatialAnchor }
export interface ConnectorPathBounds { x: number; y: number; width: number; height: number }
export interface ConnectorArcSample { parameter: number; length: number; point: SpatialPoint }
export interface ResolvedConnectorPath { kind: 'line' | 'polyline' | 'cubic'; start: SpatialPoint; end: SpatialPoint; points: readonly SpatialPoint[]; controls?: readonly [SpatialPoint, SpatialPoint]; bounds: ConnectorPathBounds; length: number; lengthError: number; arcLengthTable: readonly ConnectorArcSample[]; route?: WhiteboardConnector['route'] }
export interface ConnectorPathSample { point: SpatialPoint; tangent: SpatialPoint; normal: SpatialPoint }
export interface ConnectorPathHandle { id: string; kind: 'curve' | 'elbow'; point: SpatialPoint }
const distance = (a: SpatialPoint, b: SpatialPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: SpatialPoint, b: SpatialPoint, t: number): SpatialPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a: SpatialPoint, b: SpatialPoint): SpatialPoint => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a: SpatialPoint, b: SpatialPoint): SpatialPoint => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (p: SpatialPoint): SpatialPoint => { const n = Math.hypot(p.x, p.y); return n > 1e-12 ? { x: p.x / n, y: p.y / n } : { x: 1, y: 0 }; };
const checkedPoint = (p: SpatialPoint): SpatialPoint => { const parsed = WhiteboardPoint.safeParse(p); if (!parsed.success) throw new Error('CONNECTOR_PATH_COORDINATE_INVALID'); return parsed.data; };
function bounds(points: readonly SpatialPoint[]): ConnectorPathBounds { const xs = points.map(p => p.x), ys = points.map(p => p.y); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }; }
function cubic(points: readonly SpatialPoint[], t: number): SpatialPoint { const a = mix(points[0]!, points[1]!, t), b = mix(points[1]!, points[2]!, t), c = mix(points[2]!, points[3]!, t); return mix(mix(a, b, t), mix(b, c, t), t); }
function derivative(points: readonly SpatialPoint[], t: number): SpatialPoint { const u = 1 - t; return { x: 3 * (u * u * (points[1]!.x - points[0]!.x) + 2 * u * t * (points[2]!.x - points[1]!.x) + t * t * (points[3]!.x - points[2]!.x)), y: 3 * (u * u * (points[1]!.y - points[0]!.y) + 2 * u * t * (points[2]!.y - points[1]!.y) + t * t * (points[3]!.y - points[2]!.y)) }; }
function cubicBounds(points: readonly SpatialPoint[]): ConnectorPathBounds {
  const extrema = [points[0]!, points[3]!];
  for (const axis of ['x', 'y'] as const) {
    const [p0, p1, p2, p3] = points.map(p => p[axis]) as [number, number, number, number];
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) : b * b - 4 * a * c < 0 ? [] : [(-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a), (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)];
    for (const t of roots) if (t > 0 && t < 1) extrema.push(cubic(points, t));
  }
  return bounds(extrema);
}
interface Leaf { points: readonly SpatialPoint[]; start: number; end: number; upper: number; lower: number; gap: number; depth: number }
function leaf(points: readonly SpatialPoint[], start: number, end: number, depth: number): Leaf { const upper = distance(points[0]!, points[1]!) + distance(points[1]!, points[2]!) + distance(points[2]!, points[3]!); const lower = distance(points[0]!, points[3]!); return { points, start, end, upper, lower, gap: Math.max(0, upper - lower), depth }; }
function split(value: Leaf): [Leaf, Leaf] { const p = value.points, a = mix(p[0]!, p[1]!, .5), b = mix(p[1]!, p[2]!, .5), c = mix(p[2]!, p[3]!, .5), d = mix(a, b, .5), e = mix(b, c, .5), f = mix(d, e, .5), middle = (value.start + value.end) / 2; return [leaf([p[0]!, a, d, f], value.start, middle, value.depth + 1), leaf([f, e, c, p[3]!], middle, value.end, value.depth + 1)]; }
function cubicTable(points: readonly SpatialPoint[]): { table: ConnectorArcSample[]; error: number } {
  const leaves: Leaf[] = [], pending = [leaf(points, 0, 1, 0)];
  // Sum of polygon-minus-chord gaps bounds the entire length error, not just
  // each leaf. The geometric flatness bound also protects nearest-point paint.
  while (pending.length) {
    const l = pending.pop()!;
    const flat = Math.max(pointSegment(l.points[1]!, l.points[0]!, l.points[3]!).distance, pointSegment(l.points[2]!, l.points[0]!, l.points[3]!).distance);
    // A collinear cubic can still have nonuniform parameter speed. Bound its
    // deviation from linear parameter interpolation as well as spatial flatness.
    const parameterError = Math.max(...[.25, .5, .75].map(t => distance(cubic(l.points, t), mix(l.points[0]!, l.points[3]!, t))));
    if (l.gap <= Math.min(.05, .25 * (l.end - l.start)) && flat <= .025 && parameterError <= .025) { leaves.push(l); continue; }
    if (leaves.length + pending.length >= 65536 || l.depth >= 24) throw new Error('CONNECTOR_PATH_ACCURACY_LIMIT');
    const [left, right] = split(l); pending.push(right, left);
  }
  let length = 0; const table: ConnectorArcSample[] = [{ parameter: 0, length: 0, point: { ...points[0]! } }];
  for (const l of leaves) { length += (l.upper + l.lower) / 2; table.push({ parameter: l.end, length, point: { ...l.points[3]! } }); }
  return { table, error: leaves.reduce((sum, l) => sum + l.gap, 0) / 2 };
}
function horizontal(anchor?: SpatialAnchor) { return anchor !== 'top' && anchor !== 'bottom'; }
export function resolveConnectorPath(input: ConnectorPathInput): ResolvedConnectorPath {
  const start = checkedPoint(input.start), end = checkedPoint(input.end), type = input.type ?? 'straight', route = input.route ? WhiteboardConnectorRoute.parse(input.route) : undefined;
  if (!['straight', 'elbow', 'curve'].includes(type) || (route && route.kind !== type)) throw new Error('CONNECTOR_PATH_ROUTE_INVALID');
  if (type === 'curve') {
    const controls: [SpatialPoint, SpatialPoint] = route?.kind === 'curve' ? [checkedPoint(add(start, route.startOffset)), checkedPoint(add(end, route.endOffset))] : [{ x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }];
    const points = [start, ...controls, end], measured = cubicTable(points), table = measured.table;
    return { kind: 'cubic', start, end, points, controls, bounds: cubicBounds(points), length: table[table.length - 1]!.length, lengthError: measured.error, arcLengthTable: table, route };
  }
  const points: SpatialPoint[] = [start];
  if (type === 'elbow') {
    const guides = route?.kind === 'elbow' ? route.waypoints : [];
    // Absent route is legacy paint, regardless of endpoint anchor. Side-aware
    // routing applies only to explicitly persisted manual guide constraints.
    if (!guides.length) points.push({ x: end.x, y: start.y });
    else {
      const targets = [...guides, end];
      for (let i = 0; i < targets.length; i++) { const a = points[points.length - 1]!, b = targets[i]!; const xFirst = i === 0 ? horizontal(input.fromAnchor) : i === targets.length - 1 && input.toAnchor && input.toAnchor !== 'center' ? !horizontal(input.toAnchor) : true; points.push(xFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, { ...b }); }
    }
  }
  points.push(end);
  const unique = points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 0);
  let length = 0; const table = unique.map((point, i) => { if (i) length += distance(unique[i - 1]!, point); return { parameter: i, length, point }; });
  return { kind: type === 'straight' ? 'line' : 'polyline', start, end, points: unique, bounds: bounds(unique), length, lengthError: 0, arcLengthTable: table, route };
}
function sampleAtParameter(path: ResolvedConnectorPath, t: number): ConnectorPathSample { const point = cubic(path.points, t); let direction = derivative(path.points, t); if (Math.hypot(direction.x, direction.y) < 1e-12) direction = subtract(cubic(path.points, Math.min(1, t + 1e-6)), cubic(path.points, Math.max(0, t - 1e-6))); const tangent = unit(direction); return { point, tangent, normal: { x: -tangent.y, y: tangent.x } }; }
export function sampleConnectorPath(path: ResolvedConnectorPath, arcLengthT: number): ConnectorPathSample {
  if (!Number.isFinite(arcLengthT) || arcLengthT < 0 || arcLengthT > 1) throw new Error('CONNECTOR_PATH_SAMPLE_INVALID');
  const target = arcLengthT * path.length, table = path.arcLengthTable;
  if (path.length === 0) return { point: { ...path.start }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
  let index = 1; while (index < table.length - 1 && table[index]!.length <= target) index++;
  const a = table[index - 1]!, b = table[index]!, ratio = (target - a.length) / (b.length - a.length);
  if (path.kind === 'cubic') return sampleAtParameter(path, a.parameter + (b.parameter - a.parameter) * ratio);
  const tangent = unit(subtract(b.point, a.point)); return { point: mix(a.point, b.point, ratio), tangent, normal: { x: -tangent.y, y: tangent.x } };
}
function pointSegment(point: SpatialPoint, a: SpatialPoint, b: SpatialPoint) { const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy, t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)); const projected = mix(a, b, t); return { point: projected, t, distance: distance(point, projected) }; }
export function nearestConnectorPoint(path: ResolvedConnectorPath, scenePoint: SpatialPoint): { arcLengthT: number; point: SpatialPoint; distance: number; normalOffset: number } {
  checkedPoint(scenePoint);
  let best = { arcLengthT: 0, point: { ...path.start }, distance: distance(scenePoint, path.start), normalOffset: 0 };
  const table = path.arcLengthTable;
  if (path.kind === 'cubic') {
    // Seed from the closest flattened segment before expensive refinement.
    // Each leaf lies within .025 world units of its chord, so other leaves
    // can be excluded conservatively without changing the distance oracle.
    let nearest = Infinity, index = 1, ratio = 0;
    for (let i = 1; i < table.length; i++) { const projected = pointSegment(scenePoint, table[i - 1]!.point, table[i]!.point); if (projected.distance < nearest) { nearest = projected.distance; index = i; ratio = projected.t; } }
    if (table.length > 1) { const a = table[index - 1]!, b = table[index]!, t = a.parameter + (b.parameter - a.parameter) * ratio, point = cubic(path.points, t); best = { arcLengthT: path.length ? (a.length + (b.length - a.length) * ratio) / path.length : 0, point, distance: distance(scenePoint, point), normalOffset: 0 }; }
  }
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1]!, b = table[i]!; let ratio: number, point: SpatialPoint;
    if (path.kind === 'cubic') {
      if (pointSegment(scenePoint, a.point, b.point).distance - .025 > best.distance) continue;
      let lo = a.parameter, hi = b.parameter;
      for (let n = 0; n < 32; n++) { const x = lo + (hi - lo) / 3, y = hi - (hi - lo) / 3; if (distance(cubic(path.points, x), scenePoint) <= distance(cubic(path.points, y), scenePoint)) hi = y; else lo = x; }
      const candidates = [a.parameter, (lo + hi) / 2, b.parameter]; const t = candidates.reduce((best, candidate) => distance(cubic(path.points, candidate), scenePoint) < distance(cubic(path.points, best), scenePoint) ? candidate : best, candidates[0]!);
      ratio = (t - a.parameter) / (b.parameter - a.parameter); point = cubic(path.points, t);
    } else { const projected = pointSegment(scenePoint, a.point, b.point); ratio = projected.t; point = projected.point; }
    const d = distance(scenePoint, point), arcLengthT = path.length ? (a.length + (b.length - a.length) * ratio) / path.length : 0;
    if (d < best.distance) best = { arcLengthT, point, distance: d, normalOffset: 0 };
  }
  const sample = sampleConnectorPath(path, best.arcLengthT); const delta = subtract(scenePoint, best.point); best.normalOffset = delta.x * sample.normal.x + delta.y * sample.normal.y; return best;
}
export function connectorLabelPlacement(path: ResolvedConnectorPath, position?: WhiteboardConnector['labelPosition']): ConnectorPathSample {
  if (!position) return { point: { x: path.bounds.x + path.bounds.width / 2, y: path.bounds.y + path.bounds.height / 2 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
  const parsed = WhiteboardConnectorLabelPosition.parse(position), sample = sampleConnectorPath(path, parsed.t); return { ...sample, point: add(sample.point, { x: sample.normal.x * parsed.normalOffset, y: sample.normal.y * parsed.normalOffset }) };
}
export function connectorPathHandles(path: ResolvedConnectorPath): readonly ConnectorPathHandle[] {
  if (path.kind === 'cubic') return path.controls!.map((point, i) => ({ id: i ? 'curve-end' : 'curve-start', kind: 'curve', point: { ...point } }));
  if (path.kind === 'polyline') return (path.route?.kind === 'elbow' ? path.route.waypoints : [path.points[1] ?? path.start]).map((point, i) => ({ id: `elbow-${i}`, kind: 'elbow', point: { ...point } }));
  return [];
}
export function editConnectorPathHandle(input: ConnectorPathInput, handleId: string, scenePoint: SpatialPoint): WhiteboardConnector['route'] {
  const path = resolveConnectorPath(input), handle = connectorPathHandles(path).find(h => h.id === handleId); if (!handle) throw new Error('CONNECTOR_PATH_HANDLE_INVALID'); checkedPoint(scenePoint);
  if (path.kind === 'cubic') { const offsets = { kind: 'curve' as const, startOffset: subtract(path.controls![0], path.start), endOffset: subtract(path.controls![1], path.end) }; if (handleId === 'curve-start') offsets.startOffset = subtract(scenePoint, path.start); else offsets.endOffset = subtract(scenePoint, path.end); return WhiteboardConnectorRoute.parse(offsets); }
  const waypoints = connectorPathHandles(path).map(h => h.id === handleId ? { ...scenePoint } : { ...h.point }); return WhiteboardConnectorRoute.parse({ kind: 'elbow', waypoints });
}
export function connectorPathHitTest(path: ResolvedConnectorPath, point: SpatialPoint, options: { strokeWidth?: number; zoom?: number; tolerance?: number } = {}): boolean {
  const { strokeWidth = WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth, zoom = 1, tolerance = 6 } = options;
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(strokeWidth) || strokeWidth < WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin || strokeWidth > WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax) throw new Error('CONNECTOR_PATH_HIT_INVALID');
  return nearestConnectorPoint(path, point).distance <= strokeWidth / 2 + tolerance / zoom;
}
export function connectorPathVisualBounds(path: ResolvedConnectorPath, strokeWidth: number = WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth): ConnectorPathBounds { if (!Number.isFinite(strokeWidth) || strokeWidth < WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin || strokeWidth > WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax) throw new Error('CONNECTOR_PATH_WIDTH_INVALID'); return { x: path.bounds.x - strokeWidth / 2, y: path.bounds.y - strokeWidth / 2, width: path.bounds.width + strokeWidth, height: path.bounds.height + strokeWidth }; }
export function connectorPathToSvg(path: ResolvedConnectorPath): string { const start = `M ${path.start.x} ${path.start.y}`; return path.kind === 'cubic' ? `${start} C ${path.controls![0].x} ${path.controls![0].y} ${path.controls![1].x} ${path.controls![1].y} ${path.end.x} ${path.end.y}` : `${start}${path.points.slice(1).map(p => ` L ${p.x} ${p.y}`).join('')}`; }
