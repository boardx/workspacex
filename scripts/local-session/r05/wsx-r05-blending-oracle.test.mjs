import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedSourceOver, assertBlendingPixels } from './wsx-r05-blending-oracle.mjs';
const background = [255, 255, 255, 255], color = '#FACC15', opacity = .35;
const single = [253,237,173,255];
const double = [252,226,120,255];
const repeat = pixel => [pixel, pixel, pixel];
test('one continuous stroke has one alpha layer while independent cross strokes blend twice', () => {
  assert.deepEqual(expectedSourceOver(background,color,opacity,1).map(Math.round),single);
  assert.deepEqual(expectedSourceOver(background,color,opacity,2).map(Math.round),double);
  assertBlendingPixels({ background, color, opacity, sameStroke: repeat(single), crossStroke: repeat(double) });
});
test('blank canvas, dark same-stroke seams and missing cross-stroke blending must fail', () => {
  for (const samples of [repeat(background), repeat(double), [[NaN, 0, 0, 255]], []]) {
    assert.throws(() => assertBlendingPixels({ background, color, opacity, sameStroke: samples, crossStroke: repeat(double) }));
  }
  assert.throws(() => assertBlendingPixels({ background, color, opacity, sameStroke: repeat(single), crossStroke: repeat(single) }));
});
