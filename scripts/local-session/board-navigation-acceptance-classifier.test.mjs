import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
import { assertHeldRotationFrame, rotationEntitySamplePoints } from './board-navigation-acceptance-classifier.mjs';
register();
const { scenePointFromLocal } = await import('../../packages/whiteboard-core/src/spatial-geometry.ts');
test('held rotation rejects frame-only motion, missing entities, oversized fill and missing corners', () => {
  const entities = ['a', 'b'].map(id => ({ id, insideCounts: Array(8).fill(9), outsideCounts: Array(4).fill(0) }));
  const valid = { pointerAngle: -30, entities, corners: Array.from({ length: 4 }, () => ({ bluePixels: 5 })) };
  assertHeldRotationFrame(valid);
  assert.throws(() => assertHeldRotationFrame({ ...valid, entities: entities.slice(0, 1) }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, entities: entities.map(entity => ({ ...entity, insideCounts: Array(8).fill(0) })) }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, entities: entities.map(entity => ({ ...entity, outsideCounts: Array(4).fill(9) })) }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, corners: [{ bluePixels: 5 }] }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, corners: [...valid.corners.slice(0, 3), { bluePixels: 0 }] }));
});
test('entity samples reuse canonical top-left rotation for an already rotated nonuniform baseline', () => {
  const object = { geometry: { x: 100, y: 200, width: 200, height: 80, rotation: 90 } };
  const result = rotationEntitySamplePoints(object, { x: 0, y: 0 }, -90, scenePointFromLocal);
  assert(Math.abs(result.inside[0].x - 236) < 1e-8 && Math.abs(result.inside[0].y + 85.6) < 1e-8);
  const wrongCenter = rotationEntitySamplePoints(object, { x: 100, y: 200 }, -90, scenePointFromLocal);
  assert(Math.hypot(wrongCenter.inside[0].x - 236, wrongCenter.inside[0].y + 85.6) > 100, 'using the child center as group pivot fails the independent golden coordinates');
});
import { assertHeldUncommitted, assertReleasedOnce, assertCancelled, assertEraseTransaction, assertDrawingPixels } from './board-navigation-acceptance-classifier.mjs';

const sticky = { id: 'sticky', kind: 'sticky', geometry: { x: 10 } };
const drawings = ['d1', 'd2'].map(id => ({ id, kind: 'drawing', geometry: { x: 0 }, extensionData: { contentObject: { type: 'drawing', version: 1, strokes: [{ id: `${id}-ink`, tool: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], width: 2 }] } } }));
const masked = drawings.map(drawing => ({ ...drawing, extensionData: { contentObject: { ...drawing.extensionData.contentObject, strokes: [...drawing.extensionData.contentObject.strokes, { id: 'erase-gesture', tool: 'eraser', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], width: 3, erases: [`${drawing.id}-ink`] }] } } }));
const state = (seq, objects = [sticky, ...drawings], epoch = 1) => ({ head: { epoch, seq }, objects });

test('held rejects canonical mutation and even an empty server transaction', () => {
  assertHeldUncommitted(state(5), state(5));
  assert.throws(() => assertHeldUncommitted(state(5), state(6)), /must not submit/);
  assert.throws(() => assertHeldUncommitted(state(5), state(5, [{ ...sticky, geometry: { x: 20 } }])), /canonical objects/);
  assert.throws(() => assertHeldUncommitted(state(5), state(5, undefined, 2)), /epoch/);
});

test('release requires exactly one changed transaction', () => {
  const moved = [{ ...sticky, geometry: { x: 20 } }, ...drawings];
  assertReleasedOnce(state(5), state(6, moved));
  for (const seq of [5, 7]) assert.throws(() => assertReleasedOnce(state(5), state(seq, moved)), /exactly one/);
  assert.throws(() => assertReleasedOnce(state(5), state(6)), /persist/);
});

test('cancel rejects release-time commit even when geometry looks unchanged', () => {
  assertCancelled(state(5), state(5));
  assert.throws(() => assertCancelled(state(5), state(6)), /must not submit/);
});

test('multi-drawing vector erase rejects deletion, missing masks, wrong stroke targets and partial undo', () => {
  assertEraseTransaction(state(5), state(6, [sticky, ...masked]), state(7), ['d1', 'd2']);
  assert.throws(() => assertEraseTransaction(state(5), state(6, [sticky]), state(7), ['d1', 'd2']), /preserve drawing identity/);
  assert.throws(() => assertEraseTransaction(state(5), state(6, [sticky, masked[0], drawings[1]]), state(7), ['d1', 'd2']), /exactly one mask/);
  const wrongMask = structuredClone(masked); wrongMask[0].extensionData.contentObject.strokes.at(-1).erases = ['wrong-ink'];
  assert.throws(() => assertEraseTransaction(state(5), state(6, [sticky, ...wrongMask]), state(7), ['d1', 'd2']), /actual ink/);
  assert.throws(() => assertEraseTransaction(state(5), state(6, [...masked]), state(7), ['d1', 'd2']), /non-target/);
  assert.throws(() => assertEraseTransaction(state(5), state(6, [sticky, ...masked]), state(7, [sticky, drawings[0]]), ['d1', 'd2']), /single undo/);
});

test('drawing pixels reject missing/clipped caps, shifted centres, inflated width and accumulated alpha', () => {
  const valid = { thickness: 8, expectedThickness: 8, centerOffset: 0, endcapAlpha: 89, endcapColorMatches: true, outsideInk: false, alpha: 89, expectedAlpha: 89 };
  assertDrawingPixels(valid);
  for (const patch of [{ thickness: 0 }, { thickness: 40 }, { centerOffset: 5 }, { endcapAlpha: 0 }, { endcapColorMatches: false }, { outsideInk: true }, { alpha: 147 }]) assert.throws(() => assertDrawingPixels({ ...valid, ...patch }));
});
