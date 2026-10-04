import assert from 'node:assert/strict';

export function assertPanelCompression({ before, after }) {
  for (const sample of [before, after]) {
    assert(sample && /^[a-f0-9]{40}$/.test(sample.sourceHead));
    assert(/^[a-f0-9]{64}$/.test(sample.screenshotSha256));
    assert(sample.viewport && Number.isInteger(sample.viewport.width) && sample.viewport.width > 0);
    assert(Number.isInteger(sample.viewport.height) && sample.viewport.height > 0);
    assert(typeof sample.fontFamily === 'string' && sample.fontFamily.length > 0);
    assert.equal(sample.fontsReady, true);
    assert(sample.box && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(sample.box[key])));
    assert(sample.box.width > 0 && sample.box.height > 0);
    assert(sample.box.x >= 0 && sample.box.y >= 0);
    assert(sample.box.x + sample.box.width <= sample.viewport.width);
    assert(sample.box.y + sample.box.height <= sample.viewport.height);
  }
  assert.notEqual(before.sourceHead, after.sourceHead, 'Baseline must be an independently identified old source');
  assert.deepEqual(before.viewport, after.viewport, 'Measure both panels at the same viewport');
  assert.equal(before.fontFamily, after.fontFamily, 'Font context must remain the same');
  const ratio = after.box.height / before.box.height;
  assert(ratio >= .45 && ratio <= .55, 'D01 requires 45-55% of the actually measured baseline height');
  return { ratio, baselineSource: before.sourceHead, candidateSource: after.sourceHead };
}
