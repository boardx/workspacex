import { describe, expect, it } from 'vitest';
import { connectorLabelPlacement, connectorPathHandles, connectorPathHitTest, connectorPathToSvg, connectorPathVisualBounds, editConnectorPathHandle, nearestConnectorPoint, resolveConnectorPath, sampleConnectorPath } from '../src/connector-path';

const evaluate = (p: readonly { x: number; y: number }[], t: number) => { const u = 1 - t; return { x: u ** 3 * p[0]!.x + 3 * u * u * t * p[1]!.x + 3 * u * t * t * p[2]!.x + t ** 3 * p[3]!.x, y: u ** 3 * p[0]!.y + 3 * u * u * t * p[1]!.y + 3 * u * t * t * p[2]!.y + t ** 3 * p[3]!.y }; };
const denseOracle = (p: readonly { x: number; y: number }[], fraction: number) => { const table = [{ point: evaluate(p, 0), length: 0 }]; for (let i = 1; i <= 50000; i++) { const point = evaluate(p, i / 50000), before = table[i - 1]!; table.push({ point, length: before.length + Math.hypot(point.x - before.point.x, point.y - before.point.y) }); } const length = table[50000]!.length, target = fraction * length; const index = table.findIndex(row => row.length >= target); const a = table[Math.max(0, index - 1)]!, b = table[index]!; const t = b.length === a.length ? 0 : (target - a.length) / (b.length - a.length); return { length, point: { x: a.point.x + (b.point.x - a.point.x) * t, y: a.point.y + (b.point.y - a.point.y) * t } }; };

describe('shared canonical connector paths', () => {
  it('keeps legacy line, elbow and cubic paint and unset label placement', () => {
    for (const type of ['straight', 'elbow', 'curve'] as const) { const path = resolveConnectorPath({ start: { x: 10, y: 20 }, end: { x: 110, y: 220 }, type }); expect(connectorLabelPlacement(path).point).toEqual({ x: 60, y: 120 }); expect(connectorPathToSvg(path)).toMatch(/^M 10 20/); }
    expect(connectorPathHandles(resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }))).toEqual([]);
  });
  it.each(['top', 'bottom'] as const)('preserves the old Surface x-first elbow oracle for absent route and %s anchor', fromAnchor => {
    const start = { x: 10, y: 20 }, end = { x: 110, y: 220 };
    // The pre-route Surface used this exact one-corner path for every anchor.
    const oldPaint = `M ${start.x} ${start.y} L ${end.x} ${start.y} L ${end.x} ${end.y}`;
    expect(connectorPathToSvg(resolveConnectorPath({ start, end, type: 'elbow', fromAnchor }))).toBe(oldPaint);
  });
  it('keeps elbow guides orthogonal, removes zero segments and chooses outgoing corner normal', () => {
    const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 30, y: 30 }, type: 'elbow', fromAnchor: 'bottom', toAnchor: 'left', route: { kind: 'elbow', waypoints: [{ x: 10, y: 10 }, { x: 10, y: 10 }] } });
    for (let i = 1; i < path.points.length; i++) { const a = path.points[i - 1]!, b = path.points[i]!; expect(a.x === b.x || a.y === b.y).toBe(true); expect(a).not.toEqual(b); }
    expect(path.points[1]).toEqual({ x: 0, y: 10 });
    const simple = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, type: 'elbow' });
    expect(sampleConnectorPath(simple, .5)).toEqual({ point: { x: 10, y: 0 }, tangent: { x: 0, y: 1 }, normal: { x: -1, y: 0 } });
  });
  it('edits endpoint-relative controls without moving endpoint identities', () => {
    const input = { start: { x: 20, y: 40 }, end: { x: 120, y: 140 }, type: 'curve' as const };
    const route = editConnectorPathHandle(input, 'curve-start', { x: 50, y: -20 });
    expect(route).toMatchObject({ kind: 'curve', startOffset: { x: 30, y: -60 } });
    const moved = resolveConnectorPath({ ...input, start: { x: 30, y: 60 }, route });
    expect(moved.controls![0]).toEqual({ x: 60, y: 0 }); expect(moved.controls![1]).toEqual({ x: 70, y: 140 });
    expect(() => editConnectorPathHandle({ start: input.start, end: input.end }, 'curve-start', input.start)).toThrow('HANDLE_INVALID');
  });
  it('edits elbow guides through the same route used for paint', () => {
    const input = { start: { x: 0, y: 0 }, end: { x: 100, y: 80 }, type: 'elbow' as const };
    const route = editConnectorPathHandle(input, 'elbow-0', { x: 40, y: 30 });
    expect(route).toEqual({ kind: 'elbow', waypoints: [{ x: 40, y: 30 }] });
    expect(resolveConnectorPath({ ...input, route }).points).toContainEqual({ x: 40, y: 30 });
  });
  it.each([0, .1, .25, .5, .8, 1])('samples true cubic arc length with independent dense oracle at %s', fraction => {
    const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 500, y: 300 }, type: 'curve', route: { kind: 'curve', startOffset: { x: -120, y: 900 }, endOffset: { x: 800, y: -400 } } });
    const oracle = denseOracle(path.points, fraction), sample = sampleConnectorPath(path, fraction);
    expect(Math.abs(path.length - oracle.length)).toBeLessThanOrEqual(path.lengthError + .001); expect(path.lengthError).toBeLessThanOrEqual(.125);
    expect(Math.hypot(sample.point.x - oracle.point.x, sample.point.y - oracle.point.y)).toBeLessThan(.1);
    for (let i = 0; i <= 100; i++) { const p = evaluate(path.points, i / 100); expect(p.x).toBeGreaterThanOrEqual(path.bounds.x - 1e-8); expect(p.x).toBeLessThanOrEqual(path.bounds.x + path.bounds.width + 1e-8); expect(p.y).toBeGreaterThanOrEqual(path.bounds.y - 1e-8); expect(p.y).toBeLessThanOrEqual(path.bounds.y + path.bounds.height + 1e-8); }
  });
  it('does not confuse collinear Bezier parameter with arc-length fraction', () => {
    const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, type: 'curve', route: { kind: 'curve', startOffset: { x: 0, y: 0 }, endOffset: { x: -100, y: 0 } } });
    expect(sampleConnectorPath(path, .5).point.x).toBeCloseTo(50, 1);
  });
  it('translates and reverses endpoint-relative curves without label drift', () => {
    const input = { start: { x: 10, y: 20 }, end: { x: 310, y: 220 }, type: 'curve' as const, route: { kind: 'curve' as const, startOffset: { x: 40, y: -80 }, endOffset: { x: -30, y: 90 } } };
    const path = resolveConnectorPath(input), moved = resolveConnectorPath({ ...input, start: { x: 80, y: 60 }, end: { x: 380, y: 260 } });
    const reverse = resolveConnectorPath({ ...input, start: input.end, end: input.start, route: { kind: 'curve', startOffset: input.route.endOffset, endOffset: input.route.startOffset } });
    const originalLabel = connectorLabelPlacement(path, { t: .3, normalOffset: 12 }).point, movedLabel = connectorLabelPlacement(moved, { t: .3, normalOffset: 12 }).point, reverseLabel = connectorLabelPlacement(reverse, { t: .7, normalOffset: -12 }).point;
    expect(movedLabel.x - originalLabel.x).toBeCloseTo(70, 8); expect(movedLabel.y - originalLabel.y).toBeCloseTo(40, 8);
    expect(Math.hypot(reverseLabel.x - originalLabel.x, reverseLabel.y - originalLabel.y)).toBeLessThan(.05);
  });
  it('matches an independent nearest-point oracle rather than an empty path rectangle', () => {
    const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 200, y: 50 }, type: 'curve', route: { kind: 'curve', startOffset: { x: 50, y: 200 }, endOffset: { x: -20, y: -100 } } }), query = { x: 83, y: 65 };
    let closest = Infinity;
    for (let i = 0; i <= 50000; i++) { const p = evaluate(path.points, i / 50000); closest = Math.min(closest, Math.hypot(p.x - query.x, p.y - query.y)); }
    expect(Math.abs(nearestConnectorPoint(path, query).distance - closest)).toBeLessThan(.001);
    expect(connectorPathHitTest(path, { x: path.bounds.x, y: path.bounds.y + path.bounds.height }, { tolerance: 0 })).toBe(false);
  });
  it('handles loops, reversed paths and collapsed paths without NaN', () => {
    const loop = resolveConnectorPath({ start: { x: 10, y: 20 }, end: { x: 10, y: 20 }, type: 'curve', route: { kind: 'curve', startOffset: { x: 100, y: -80 }, endOffset: { x: -100, y: -80 } } }); expect(loop.length).toBeGreaterThan(0); expect(loop.bounds.width).toBeGreaterThan(0);
    const line = resolveConnectorPath({ start: { x: 100, y: 0 }, end: { x: 0, y: 0 } }); expect(sampleConnectorPath(line, .2).point).toEqual({ x: 80, y: 0 });
    for (const type of ['straight', 'elbow', 'curve'] as const) { const path = resolveConnectorPath({ start: { x: 2, y: 3 }, end: { x: 2, y: 3 }, type }); expect(sampleConnectorPath(path, .5)).toEqual({ point: { x: 2, y: 3 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } }); expect(connectorLabelPlacement(path, { t: .7, normalOffset: 4 }).point).toEqual({ x: 2, y: 7 }); }
  });
  it('shares nearest point, label normal, width and zoom hit convention', () => {
    const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }); expect(nearestConnectorPoint(path, { x: 40, y: 5 })).toEqual({ arcLengthT: .4, point: { x: 40, y: 0 }, distance: 5, normalOffset: 5 });
    expect(connectorLabelPlacement(path, { t: .4, normalOffset: 5 }).point).toEqual({ x: 40, y: 5 });
    expect(connectorPathHitTest(path, { x: 50, y: 5 }, { strokeWidth: 2, zoom: 1, tolerance: 6 })).toBe(true); expect(connectorPathHitTest(path, { x: 50, y: 5 }, { strokeWidth: 2, zoom: 2, tolerance: 6 })).toBe(false);
    expect(connectorPathVisualBounds(path, 10)).toEqual({ x: -5, y: -5, width: 110, height: 10 });
    const curve = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, type: 'curve' }); const point = sampleConnectorPath(curve, .3).point; expect(nearestConnectorPoint(curve, point).distance).toBeLessThan(.001);
  });
  it('accepts legal extreme world curves without relaxing the global error budget', () => {
    for (const input of [
      { start: { x: -1e6, y: 0 }, end: { x: 1e6, y: 0 }, startOffset: { x: 0, y: 1e6 }, endOffset: { x: 0, y: -1e6 } },
      { start: { x: -1e6, y: -1e6 }, end: { x: 1e6, y: 1e6 }, startOffset: { x: 0, y: 1e6 }, endOffset: { x: 0, y: -1e6 } },
      { start: { x: -1e6, y: -1e6 }, end: { x: -1e6, y: -1e6 }, startOffset: { x: 1e6, y: 1e6 }, endOffset: { x: 1e6, y: 0 } },
    ]) {
      const path = resolveConnectorPath({ start: input.start, end: input.end, type: 'curve', route: { kind: 'curve', startOffset: input.startOffset, endOffset: input.endOffset } });
      expect(path.lengthError).toBeLessThanOrEqual(.125); expect(path.arcLengthTable.length).toBeLessThanOrEqual(65537);
      expect(Number.isFinite(sampleConnectorPath(path, .3).point.x)).toBe(true); expect(nearestConnectorPoint(path, sampleConnectorPath(path, .3).point).distance).toBeLessThan(.001);
    }
  });
  it('fails closed for invalid route and resolved control coordinates', () => {
    expect(() => resolveConnectorPath({ start: { x: Infinity, y: 0 }, end: { x: 0, y: 0 } })).toThrow();
    expect(() => resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, route: { kind: 'elbow', waypoints: [{ x: 1, y: 1 }] } })).toThrow('ROUTE_INVALID');
    expect(() => resolveConnectorPath({ start: { x: 1e6, y: 0 }, end: { x: 0, y: 0 }, type: 'curve', route: { kind: 'curve', startOffset: { x: 1, y: 0 }, endOffset: { x: 0, y: 0 } } })).toThrow('COORDINATE_INVALID');
  });
});

 describe('free clicked-node spline',()=>{
 it('passes nodes, includes curved extrema, and exposes editable nodes',()=>{const input={start:{x:0,y:0},end:{x:300,y:0},type:'free' as const,route:{kind:'free' as const,waypoints:[{x:100,y:100},{x:200,y:100}]}};const path=resolveConnectorPath(input);expect(path.points).toContainEqual({x:100,y:100});expect(path.points).toContainEqual({x:200,y:100});expect(path.bounds.height).toBeGreaterThan(100);expect(connectorPathHandles(path)).toHaveLength(2);expect(editConnectorPathHandle(input,'free-0',{x:80,y:120})).toEqual({kind:'free',waypoints:[{x:80,y:120},{x:200,y:100}]});expect(connectorPathHitTest(path,{x:100,y:100})).toBe(true);});
 it('two points degenerate to straight arrow with no middle handle',()=>{const path=resolveConnectorPath({start:{x:0,y:0},end:{x:100,y:0},type:'free'});expect(path.length).toBeCloseTo(100);expect(path.bounds.height).toBe(0);expect(connectorPathHandles(path)).toEqual([]);expect(sampleConnectorPath(path,1).tangent).toEqual({x:1,y:0});});
 });
