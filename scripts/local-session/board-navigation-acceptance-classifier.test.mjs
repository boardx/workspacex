import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHeldRotationFrame } from './board-navigation-acceptance-classifier.mjs';
test('held rotation rejects frame resets and wrong or missing expected corners', () => {
  const valid = { pointerAngle: -30, childDeltas: [-30, -30], corners: Array.from({ length: 4 }, () => ({ bluePixels: 5 })) };
  assertHeldRotationFrame(valid);
  assert.throws(() => assertHeldRotationFrame({ ...valid, childDeltas: [0, 0] }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, childDeltas: [-30, -60] }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, corners: [{ bluePixels: 5 }] }));
  assert.throws(() => assertHeldRotationFrame({ ...valid, corners: [...valid.corners.slice(0, 3), { bluePixels: 0 }] }));
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
