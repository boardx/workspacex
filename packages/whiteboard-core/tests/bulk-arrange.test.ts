import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  buildArrangeCommands,
  buildFormatCommands,
  cloneDocument,
  createWhiteboardDocument,
  executeCommands,
  prepareWhiteboardUpdate,
  readObjects,
  WHITEBOARD_UPDATE_LIMITS,
  WhiteboardUndo,
  type ArrangeOperation,
  type WhiteboardObject,
} from '../src';

function object(id: string, x: number, y: number, width = 100, height = 80, over: Partial<WhiteboardObject> = {}): WhiteboardObject {
  return { id, schemaVersion: 1, kind: 'sticky', geometry: { x, y, width, height, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id, ...over };
}
function commands(result: ReturnType<typeof buildArrangeCommands>) {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.commands;
}
function seed(objects: WhiteboardObject[]) {
  const doc = createWhiteboardDocument();
  executeCommands(doc, objects.map(value => ({ type: 'create' as const, object: value })), 'seed');
  return doc;
}

describe('bulk arrange builder', () => {
  const modes: Array<[ArrangeOperation, 'x' | 'y', number]> = [
    ['align-left', 'x', 10], ['align-center', 'x', 165], ['align-right', 'x', 320],
    ['align-top', 'y', 20], ['align-middle', 'y', 130], ['align-bottom', 'y', 240],
  ];
  for (const [mode, axis, expected] of modes) it(`builds ${mode} geometry commands`, () => {
    const values = [object('b', 10, 20, 100, 80), object('a', 220, 160, 100, 80)];
    const doc = seed(values); executeCommands(doc, commands(buildArrangeCommands(values, ['b', 'a'], mode)), 'bulk');
    const result = readObjects(doc);
    const coordinate = (value: WhiteboardObject) => axis === 'x'
      ? mode === 'align-center' ? value.geometry.x + value.geometry.width / 2 : mode === 'align-right' ? value.geometry.x + value.geometry.width : value.geometry.x
      : mode === 'align-middle' ? value.geometry.y + value.geometry.height / 2 : mode === 'align-bottom' ? value.geometry.y + value.geometry.height : value.geometry.y;
    expect(result.map(coordinate)).toEqual([expected, expected]); doc.destroy();
  });

  it('distributes horizontally and vertically with outer anchors and stable id ties', () => {
    const horizontal = [object('z', 0, 0, 10, 10), object('b', 40, 0, 20, 10), object('a', 40, 0, 10, 10), object('x', 100, 0, 10, 10)];
    const h = seed(horizontal); executeCommands(h, commands(buildArrangeCommands(horizontal, ['x', 'a', 'z', 'b'], 'distribute-horizontal')), 'bulk');
    const hById = new Map(readObjects(h).map(value => [value.id, value]));
    expect(hById.get('z')!.geometry.x).toBe(0); expect(hById.get('x')!.geometry.x).toBe(100);
    expect(hById.get('a')!.geometry.x).toBe(30); expect(hById.get('b')!.geometry.x).toBe(60);
    const vertical = horizontal.map((value, index) => ({ ...value, geometry: { ...value.geometry, x: 0, y: [0, 40, 40, 100][index]! } }));
    const v = seed(vertical); executeCommands(v, commands(buildArrangeCommands(vertical, ['x', 'a', 'z', 'b'], 'distribute-vertical')), 'bulk');
    const vById = new Map(readObjects(v).map(value => [value.id, value]));
    expect(vById.get('z')!.geometry.y).toBe(0); expect(vById.get('x')!.geometry.y).toBe(100);
    h.destroy(); v.destroy();
  });

  it('supports 500 objects and rejects undersized, oversized, connector and locked selections', () => {
    const many = Array.from({ length: 500 }, (_, index) => object(`o-${String(index).padStart(3, '0')}`, index, index));
    expect(buildArrangeCommands(many, many.map(value => value.id), 'align-left')).toMatchObject({ ok: true });
    expect(buildArrangeCommands(many, ['o-000'], 'align-left')).toMatchObject({ ok: false, code: 'SELECTION_SIZE' });
    expect(buildArrangeCommands([...many, object('extra', 0, 0)], [...many.map(value => value.id), 'extra'], 'align-left')).toMatchObject({ ok: false, code: 'SELECTION_SIZE' });
    const edge = object('edge', 0, 0, 1, 1, { kind: 'connector', connector: { from: 'o-000', to: 'o-001' } });
    expect(buildArrangeCommands([...many, edge], ['edge', 'o-000'], 'align-left')).toMatchObject({ ok: false, code: 'UNSUPPORTED_OBJECT' });
    const locked = object('locked', 0, 0, 10, 10, { extensionData: { locked: true } });
    expect(buildArrangeCommands([locked, many[0]!], ['locked', 'o-000'], 'align-left')).toMatchObject({ ok: false, code: 'LOCKED_OBJECT' });
  });

  it('commits the exact 500-object geometry delta as one bounded update and one undo item', () => {
    const values = Array.from({ length: 500 }, (_, index) => object(`g-${index}`, index + 1, index));
    const doc = createWhiteboardDocument();
    for (const value of values) executeCommands(doc, [{ type: 'create', object: value }], 'seed');
    const remote = cloneDocument(doc);
    const result = buildArrangeCommands(values, values.map(value => value.id), 'align-left');
    if (!result.ok) throw new Error(result.code);
    const undo = new WhiteboardUndo(doc), updates: Uint8Array[] = [];
    doc.on('update', update => updates.push(update));
    undo.execute(result.commands);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThanOrEqual(WHITEBOARD_UPDATE_LIMITS.bytes);
    const accepted = prepareWhiteboardUpdate(remote, updates[0]!);
    expect(accepted).toEqual(updates[0]);
    Y.applyUpdate(remote, accepted);
    expect(readObjects(remote)).toEqual(readObjects(doc));
    expect(readObjects(doc).every(value => value.geometry.x === 1)).toBe(true);
    expect(undo.undo()).toBe('undone');
    undo.destroy(); doc.destroy(); remote.destroy();
  });

  it('does not charge a small geometry transaction for a long-lived document delete set', () => {
    const seeded = seed([object('aged', 0, 0)]);
    const doc = cloneDocument(seeded), baseGeometry = object('aged', 0, 0).geometry;
    seeded.destroy();
    const baseline = Y.encodeStateAsUpdate(doc);
    for (let index = 1; index <= 12_000; index++) {
      const peer = createWhiteboardDocument();
      Y.applyUpdate(peer, baseline);
      const overwrite = executeCommands(peer, [
        { type: 'geometry', id: 'aged', geometry: { ...baseGeometry, x: index } },
      ], 'history');
      Y.applyUpdate(doc, overwrite);
      peer.destroy();
    }
    const beforeBytes = Y.encodeStateAsUpdate(doc).byteLength;
    expect(beforeBytes).toBeGreaterThan(WHITEBOARD_UPDATE_LIMITS.bytes);
    expect(beforeBytes).toBeLessThanOrEqual(WHITEBOARD_UPDATE_LIMITS.documentBytes);

    const beforeX = readObjects(doc)[0]!.geometry.x;
    const remote = cloneDocument(doc), undo = new WhiteboardUndo(doc), updates: Uint8Array[] = [];
    doc.on('update', update => updates.push(update));
    undo.execute([{ type: 'geometry', id: 'aged', geometry: { ...baseGeometry, x: 12_001 } }]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThanOrEqual(WHITEBOARD_UPDATE_LIMITS.bytes);
    const accepted = prepareWhiteboardUpdate(remote, updates[0]!);
    expect(accepted).toEqual(updates[0]);
    Y.applyUpdate(remote, accepted);
    expect(readObjects(remote)).toEqual(readObjects(doc));
    expect(readObjects(doc)[0]!.geometry.x).toBe(12_001);
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc)[0]!.geometry.x).toBe(beforeX);
    undo.destroy(); doc.destroy(); remote.destroy();
  });

  it('moves Frame descendants once and rejects a locked descendant atomically', () => {
    const frame = object('frame', 0, 0, 200, 200, { kind: 'frame' });
    const child = object('child', 20, 20, 30, 30, { parentId: 'frame' });
    const other = object('other', 300, 0, 100, 100);
    const result = buildArrangeCommands([frame, child, other], ['frame', 'child', 'other'], 'align-right');
    expect(result).toMatchObject({ ok: true, affectedIds: ['child', 'frame', 'other'] });
    if (result.ok) expect(result.commands.filter(command => command.type === 'geometry' && command.id === 'child')).toHaveLength(1);
    expect(buildArrangeCommands([frame, { ...child, extensionData: { locked: true } }, other], ['frame', 'other'], 'align-right')).toMatchObject({ ok: false, code: 'LOCKED_OBJECT' });
  });

  it('uses rotated visual bounds and rejects geometry or expanded container batches beyond limits', () => {
    const rotated = object('rotated', 0, 0, 100, 40, { geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 90 } });
    const plain = object('plain', 100, 0, 40, 40);
    const aligned = buildArrangeCommands([rotated, plain], ['plain', 'rotated'], 'align-left');
    expect(aligned).toMatchObject({ ok: true });
    if (aligned.ok) expect(aligned.commands).toContainEqual({ type: 'geometry', id: 'plain', geometry: { ...plain.geometry, x: 30 } });
    const edge = object('edge-limit', -1_000_000, 0, 100_000, 100_000, { geometry: { x: -1_000_000, y: 0, width: 100_000, height: 100_000, rotation: 45 } });
    expect(buildArrangeCommands([edge, plain], ['edge-limit', 'plain'], 'align-left')).toMatchObject({ ok: false, code: 'INVALID_FORMAT' });
    const frame = object('big-frame', 0, 0, 100, 100, { kind: 'frame' });
    const children = Array.from({ length: 500 }, (_, index) => object(`child-${index}`, index, 0, 10, 10, { parentId: frame.id }));
    expect(buildArrangeCommands([frame, plain, ...children], [frame.id, plain.id], 'align-right')).toMatchObject({ ok: false, code: 'BATCH_LIMIT' });
  });

  it('builds one width, height, fill, text alignment or font size choice and validates geometry', () => {
    const values = [object('b', 0, 0), object('a', 20, 20)];
    for (const format of [{ width: 240 }, { height: 160 }, { fill: 'hsl(var(--warning-tint))' }, { textAlign: 'center' as const }, { fontSize: 24 }]) {
      const result = buildFormatCommands(values, ['b', 'a'], format);
      expect(result).toMatchObject({ ok: true, affectedIds: ['a', 'b'] });
    }
    expect(buildFormatCommands(values, ['a', 'b'], { width: Number.NaN })).toMatchObject({ ok: false, code: 'INVALID_FORMAT' });
    expect(buildFormatCommands(values, ['a', 'b'], { width: 100, height: 100 })).toMatchObject({ ok: false, code: 'INVALID_FORMAT' });
    expect(buildFormatCommands([values[0]!, { ...values[1]!, kind: 'drawing' }], ['a', 'b'], { textAlign: 'center' })).toMatchObject({ ok: false, code: 'UNSUPPORTED_OBJECT' });
  });

  it('commits one remote-visible update, converges, and creates one undo item', () => {
    const values = [object('a', 0, 0), object('b', 70, 20), object('c', 200, 70)];
    const local = seed(values), remote = cloneDocument(local), undo = new WhiteboardUndo(local), updates: Uint8Array[] = [];
    local.on('update', update => updates.push(update));
    undo.execute(commands(buildArrangeCommands(values, ['a', 'b', 'c'], 'align-top')));
    expect(updates).toHaveLength(1);
    Y.applyUpdate(remote, updates[0]!);
    expect(readObjects(remote)).toEqual(readObjects(local));
    expect(undo.undo()).toBe('undone');
    expect(readObjects(local).map(value => value.geometry)).toEqual(values.map(value => value.geometry));
    undo.destroy(); local.destroy(); remote.destroy();
  });
});
