import { expect, it } from 'vitest';
import { WHITEBOARD_CONNECTOR_LIMITS, WhiteboardConnector } from '@repo/contracts/whiteboard-document';
import { connectorLabelPlacement, connectorPathHitTest, connectorPathVisualBounds, createWhiteboardDocument, executeCommands, readObjects, resolveConnectorPath, rotatedAnchorPoint, sampleConnectorPath, SpatialRelationshipCommandPort, type ConnectorRelationship } from '../src';

type Point = { x: number; y: number };
const start = { x: 300, y: 300 };
const directions = [
  ['right', 240, 0], ['left', -240, 0], ['down', 0, 240], ['up', 0, -240],
  ['down-right', 240, 180], ['down-left', -240, 180], ['up-right', 240, -180], ['up-left', -240, -180],
] as const;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (actual: Point, expected: Point, tolerance = .08) => expect(distance(actual, expected)).toBeLessThan(tolerance);

// Independent Bernstein sampling, not the production adaptive subdivision or bounds solver.
function cubicOracle(points: readonly Point[], fraction: number) {
  const evaluate = (t: number) => {
    const u = 1 - t;
    return { x: u ** 3 * points[0]!.x + 3 * u ** 2 * t * points[1]!.x + 3 * u * t ** 2 * points[2]!.x + t ** 3 * points[3]!.x,
      y: u ** 3 * points[0]!.y + 3 * u ** 2 * t * points[1]!.y + 3 * u * t ** 2 * points[2]!.y + t ** 3 * points[3]!.y };
  };
  const rows = [{ point: points[0]!, length: 0, parameter: 0 }];
  for (let i = 1; i <= 4000; i++) {
    const point = evaluate(i / 4000), previous = rows[i - 1]!;
    rows.push({ point, length: previous.length + distance(point, previous.point), parameter: i / 4000 });
  }
  const length = rows.at(-1)!.length, index = rows.findIndex(row => row.length >= length * fraction);
  const a = rows[Math.max(0, index - 1)]!, b = rows[index]!, ratio = b.length === a.length ? 0 : (length * fraction - a.length) / (b.length - a.length);
  return { length, point: { x: a.point.x + ratio * (b.point.x - a.point.x), y: a.point.y + ratio * (b.point.y - a.point.y) }, rows };
}

for (const type of ['straight', 'elbow', 'curve'] as const) {
  it.each(directions)(`${type} has correct endpoint direction, length and label normal for %s`, (_name, dx, dy) => {
    const end = { x: start.x + dx, y: start.y + dy };
    const route = type === 'curve' ? { kind: 'curve' as const, startOffset: { x: .25 * dx - .3 * dy, y: .25 * dy + .3 * dx }, endOffset: { x: -.25 * dx - .3 * dy, y: -.25 * dy + .3 * dx } }
      : type === 'elbow' ? { kind: 'elbow' as const, waypoints: [{ x: start.x + dx / 2, y: start.y + dy / 2 }] } : undefined;
    const path = resolveConnectorPath({ start, end, type, route, fromAnchor: 'right', toAnchor: 'left' });
    near(sampleConnectorPath(path, 0).point, start, 1e-8); near(sampleConnectorPath(path, 1).point, end, 1e-8);
    if (type === 'straight') expect(path.length).toBeCloseTo(Math.hypot(dx, dy), 8);
    if (type === 'elbow') {
      expect(path.length).toBeCloseTo(Math.abs(dx) + Math.abs(dy), 8);
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1]!, b = path.points[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true); expect(a).not.toEqual(b);
      }
    }
    if (route?.kind === 'curve') {
      const controls = [{ x: start.x + route.startOffset.x, y: start.y + route.startOffset.y }, { x: end.x + route.endOffset.x, y: end.y + route.endOffset.y }];
      const oracle = cubicOracle([start, ...controls, end], .37);
      expect(Math.abs(path.length - oracle.length)).toBeLessThan(path.lengthError + .001);
      near(sampleConnectorPath(path, .37).point, oracle.point);
      for (const { point } of oracle.rows) {
        expect(point.x).toBeGreaterThanOrEqual(path.bounds.x - 1e-8); expect(point.x).toBeLessThanOrEqual(path.bounds.x + path.bounds.width + 1e-8);
        expect(point.y).toBeGreaterThanOrEqual(path.bounds.y - 1e-8); expect(point.y).toBeLessThanOrEqual(path.bounds.y + path.bounds.height + 1e-8);
      }
    }
    const sample = sampleConnectorPath(path, .37);
    expect(Math.hypot(sample.tangent.x, sample.tangent.y)).toBeCloseTo(1, 8);
    expect(sample.tangent.x * sample.normal.x + sample.tangent.y * sample.normal.y).toBeCloseTo(0, 8);
    expect(sample.tangent.x * sample.normal.y - sample.tangent.y * sample.normal.x).toBeCloseTo(1, 8);
    for (const offset of [-7, 7]) {
      const label = connectorLabelPlacement(path, { t: .37, normalOffset: offset }).point;
      const delta = { x: label.x - sample.point.x, y: label.y - sample.point.y };
      expect(delta.x * sample.normal.x + delta.y * sample.normal.y).toBeCloseTo(offset, 8);
      expect(delta.x * sample.tangent.x + delta.y * sample.tangent.y).toBeCloseTo(0, 8);
    }
  });
}

it.each([
  [0, { top: [90, 50], right: [140, 80], bottom: [90, 110], left: [40, 80], center: [90, 80] }],
  [90, { top: [40, 100], right: [10, 150], bottom: [-20, 100], left: [10, 50], center: [10, 100] }],
  [180, { top: [-10, 50], right: [-60, 20], bottom: [-10, -10], left: [40, 20], center: [-10, 20] }],
  [270, { top: [40, 0], right: [70, -50], bottom: [100, 0], left: [70, 50], center: [70, 0] }],
] as const)('uses independent known rotated anchor coordinates at %s degrees', (rotation, anchors) => {
  const target = { geometry: { x: 40, y: 50, width: 100, height: 60, rotation } };
  for (const anchor of ['top', 'right', 'bottom', 'left'] as const) near(rotatedAnchorPoint(target, anchor), { x: anchors[anchor][0], y: anchors[anchor][1] }, 1e-8);
  near(rotatedAnchorPoint(target, 'center'), { x: anchors.center[0], y: anchors.center[1] }, 1e-8);
});

it('uses object-local endpoint offsets under a 90 degree target rotation', () => {
  const target = { geometry: { x: 40, y: 50, width: 100, height: 60, rotation: 90 } };
  near(rotatedAnchorPoint(target, 'right', { x: 10, y: 20 }), { x: -10, y: 160 }, 1e-8);
});

it.each([WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin, WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax])('matches legal width %s paint and zero-tolerance hit boundaries without altering geometry', strokeWidth => {
  const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }), before = structuredClone(path.bounds);
  expect(WhiteboardConnector.safeParse({ fromPoint: path.start, toPoint: path.end, strokeWidth }).success).toBe(true);
  expect(connectorPathHitTest(path, { x: 50, y: strokeWidth / 2 }, { strokeWidth, tolerance: 0 })).toBe(true);
  expect(connectorPathHitTest(path, { x: 50, y: strokeWidth / 2 + .001 }, { strokeWidth, tolerance: 0 })).toBe(false);
  const paint = connectorPathVisualBounds(path, strokeWidth);
  expect(paint.height).toBe(strokeWidth); expect(paint.width - path.bounds.width).toBe(strokeWidth);
  expect(path.bounds).toEqual(before);
});

it.each([WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin - .001, WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax + .001, Infinity, NaN])('rejects out-of-contract width %s at schema and geometry boundaries', strokeWidth => {
  const path = resolveConnectorPath({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  expect(WhiteboardConnector.safeParse({ fromPoint: path.start, toPoint: path.end, strokeWidth }).success).toBe(false);
  expect(() => connectorPathVisualBounds(path, strokeWidth)).toThrow('WIDTH_INVALID');
  expect(() => connectorPathHitTest(path, path.start, { strokeWidth })).toThrow('HIT_INVALID');
});

const relationship = (type: 'curve' | 'elbow'): ConnectorRelationship => ({ from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type, startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: 'path', semanticRelation: '', strokeWidth: 7,
  route: type === 'curve' ? { kind: 'curve', startOffset: { x: 40, y: -80 }, endOffset: { x: -30, y: 90 } } : { kind: 'elbow', waypoints: [{ x: 200, y: 120 }] }, labelPosition: { t: .37, normalOffset: 7 } });
const nodeGeometry = { x: 40, y: 50, width: 100, height: 60, rotation: 0 };

for (const type of ['curve', 'elbow'] as const) {
  it.each([
    ['move', { ...nodeGeometry, x: 140 }, { x: 240, y: 80 }],
    ['resize', { ...nodeGeometry, width: 160, height: 100 }, { x: 200, y: 100 }],
    ['rotate', { ...nodeGeometry, rotation: 90 }, { x: 10, y: 150 }],
  ] as const)(`${type} keeps a manually edited route while following node %s`, (_name, geometry, expectedStart) => {
    const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
    try {
      executeCommands(doc, ['a', 'b'].map(id => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: id === 'a' ? nodeGeometry : { ...nodeGeometry, x: 400, y: 200 }, text: id, style: {}, parentId: null, orderKey: id } })), 'fixture');
      const base = relationship(type);
      port.dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship: base } });
      const edited = { ...base, route: type === 'curve' ? { kind: 'curve' as const, startOffset: { x: 70, y: -100 }, endOffset: { x: -60, y: 130 } } : { kind: 'elbow' as const, waypoints: [{ x: 200, y: 120 }, { x: 300, y: 170 }] } };
      port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'edit-route', command: { type: 'update-connector', id: 'edge', relationship: edited } });
      port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'target-transform', command: { type: 'transform', items: [{ id: 'a', geometry }] } });
      const edge = readObjects(doc).find(item => item.id === 'edge')!;
      expect(edge.connector).toEqual(edited);
      const expectedEnd = { x: 400, y: 230 };
      const path = resolveConnectorPath({ start: expectedStart, end: expectedEnd, type, route: edge.connector!.route, fromAnchor: 'right', toAnchor: 'left' });
      near(sampleConnectorPath(path, 0).point, expectedStart, 1e-8); near(sampleConnectorPath(path, 1).point, expectedEnd, 1e-8);
      if (type === 'curve') {
        const expectedControls = [{ x: expectedStart.x + 70, y: expectedStart.y - 100 }, { x: 340, y: 360 }];
        expect(path.controls).toEqual(expectedControls);
        const oracle = cubicOracle([expectedStart, ...expectedControls, expectedEnd], .37);
        expect(Math.abs(path.length - oracle.length)).toBeLessThan(path.lengthError + .001);
        near(sampleConnectorPath(path, .37).point, oracle.point);
        const xs = oracle.rows.map(row => row.point.x), ys = oracle.rows.map(row => row.point.y);
        expect(edge.geometry.x).toBeCloseTo(Math.min(...xs), 2); expect(edge.geometry.y).toBeCloseTo(Math.min(...ys), 2);
        expect(edge.geometry.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 2); expect(edge.geometry.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 2);
      } else {
        // Explicit fixture legs are independent of the production elbow router.
        const expectedPoints = [expectedStart, { x: 200, y: expectedStart.y }, { x: 200, y: 120 }, { x: 300, y: 120 }, { x: 300, y: 170 }, { x: 300, y: 230 }, expectedEnd];
        expect(path.points).toEqual(expectedPoints.filter((point, index) => index === 0 || distance(point, expectedPoints[index - 1]!) > 0));
        const expectedLength = expectedPoints.slice(1).reduce((sum, point, index) => sum + distance(point, expectedPoints[index]!), 0);
        expect(path.length).toBe(expectedLength);
        const expectedBounds = _name === 'move' ? { x: 200, y: 80, width: 200, height: 150, rotation: 0 }
          : _name === 'resize' ? { x: 200, y: 100, width: 200, height: 130, rotation: 0 } : { x: 10, y: 120, width: 390, height: 110, rotation: 0 };
        expect(edge.geometry).toEqual(expectedBounds);
      }
    } finally { doc.destroy(); }
  });

  it(`${type} translates a fully free manually edited path once without changing label parameters or relative curve controls`, () => {
    const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
    try {
      const free = { ...relationship(type), from: undefined, to: undefined, fromPoint: { x: 140, y: 80 }, toPoint: { x: 400, y: 230 } };
      port.dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship: free } });
      const before = readObjects(doc)[0]!;
      port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'translate', command: { type: 'move', id: 'edge', x: before.geometry.x + 30, y: before.geometry.y - 15 } });
      const edge = readObjects(doc)[0]!;
      expect(edge.connector?.fromPoint).toEqual({ x: 170, y: 65 }); expect(edge.connector?.toPoint).toEqual({ x: 430, y: 215 });
      expect(edge.connector?.labelPosition).toEqual(free.labelPosition); expect(edge.connector?.strokeWidth).toBe(7);
      expect(edge.connector?.route).toEqual(type === 'curve' ? free.route : { kind: 'elbow', waypoints: [{ x: 230, y: 105 }] });
      expect(edge.geometry.x - before.geometry.x).toBeCloseTo(30, 8); expect(edge.geometry.y - before.geometry.y).toBeCloseTo(-15, 8);
      expect(edge.geometry.width).toBeCloseTo(before.geometry.width, 8); expect(edge.geometry.height).toBeCloseTo(before.geometry.height, 8);
    } finally { doc.destroy(); }
  });
}

it.each([0, .13, .5, .87, 1])('matches an independent label arc-length point at t=%s and reversed signed normal', t => {
  const input = { start: { x: 10, y: 20 }, end: { x: 310, y: 170 }, type: 'curve' as const, route: { kind: 'curve' as const, startOffset: { x: 60, y: -100 }, endOffset: { x: -80, y: 120 } } };
  const expectedPoints = [input.start, { x: 70, y: -80 }, { x: 230, y: 290 }, input.end];
  const oracle = cubicOracle(expectedPoints, t), path = resolveConnectorPath(input);
  near(connectorLabelPlacement(path, { t, normalOffset: 0 }).point, oracle.point);
  const reverse = resolveConnectorPath({ start: input.end, end: input.start, type: 'curve', route: { kind: 'curve', startOffset: input.route.endOffset, endOffset: input.route.startOffset } });
  for (const offset of [-12, 12]) near(connectorLabelPlacement(path, { t, normalOffset: offset }).point, connectorLabelPlacement(reverse, { t: 1 - t, normalOffset: -offset }).point);
});
