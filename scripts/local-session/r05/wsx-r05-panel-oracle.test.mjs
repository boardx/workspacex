import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPanelCompression } from './wsx-r05-panel-oracle.mjs';

const sample = (sourceHead, height) => ({ sourceHead, screenshotSha256: 'c'.repeat(64), viewport: { width: 390, height: 844 }, fontFamily: 'Arial', fontsReady: true, box: { x: 10, y: 100, width: 370, height } });
const before = sample('a'.repeat(40), 400);
const after = sample('b'.repeat(40), 200);
test('panel comparison uses distinct sources and the actual same-viewport bbox ratio', () => {
  assert.equal(assertPanelCompression({ before, after }).ratio, .5);
});
test('unknown, nonfinite, clipped, stale and differently rendered baselines cannot pass', () => {
  for (const bad of [
    { ...after, sourceHead: before.sourceHead },
    { ...after, fontsReady: false },
    { ...after, screenshotSha256: '' },
    { ...after, fontFamily: 'other' },
    { ...after, viewport: { width: 1440, height: 900 } },
    { ...after, box: { ...after.box, height: NaN } },
    { ...after, box: { ...after.box, x: 30 } },
    { ...after, box: { ...after.box, height: 179 } },
    { ...after, box: { ...after.box, height: 221 } },
  ]) assert.throws(() => assertPanelCompression({ before, after: bad }));
});
