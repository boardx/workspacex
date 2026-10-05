import assert from 'node:assert/strict';

export function expectedSourceOver(background, color, opacity, layers) {
  assert(Array.isArray(background) && background.length === 4 && background.every(n => Number.isFinite(n) && n >= 0 && n <= 255));
  assert(/^#[0-9a-f]{6}$/i.test(color));
  assert(Number.isFinite(opacity) && opacity > 0 && opacity <= 1);
  assert(Number.isInteger(layers) && layers > 0);
  const rgb = color.slice(1).match(/../g).map(hex => parseInt(hex, 16));
  let result = background.slice();
  for (let index = 0; index < layers; index++) {
    const alpha = result[3] / 255;
    const output = opacity + alpha * (1 - opacity);
    result = [...rgb.map((channel, i) => (channel * opacity + result[i] * alpha * (1 - opacity)) / output), output * 255];
  }
  return result;
}

export function assertBlendingPixels({ background, color, opacity, sameStroke, crossStroke }) {
  assert(opacity < 1, 'Blending needs a nonopaque instrument');
  const single = expectedSourceOver(background, color, opacity, 1);
  const double = expectedSourceOver(background, color, opacity, 2);
  for (const [samples, expected] of [[sameStroke, single], [crossStroke, double]]) {
    assert(Array.isArray(samples) && samples.length >= 3, 'Measure multiple independent interior pixels');
    for (const rgba of samples) {
      assert(Array.isArray(rgba) && rgba.length === 4 && rgba.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
      assert(expected.every((channel, i) => Math.abs(rgba[i] - channel) <= 10), 'Real pixels must match the independent source-over layer count');
    }
  }
  return { single, double };
}
