const assert = require('node:assert/strict');
const { test } = require('node:test');
const { processPixels, render } = require('../public/image-effects.js');

test('original mode preserves every channel without mutating its input', () => {
  const source = new Uint8ClampedArray([20, 90, 160, 127]);
  const result = processPixels(source, 1, 1, 'original');
  assert.deepEqual(result, source);
  assert.notEqual(result, source);
});

test('enhanced view softens an isolated bright speckle and preserves opacity', () => {
  const source = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < source.length; i += 4) source.set([90, 90, 90, 128], i);
  source.set([255, 255, 255, 128], 16);
  const original = source.slice();
  const enhanced = processPixels(source, 3, 3, 'enhanced');
  assert.ok(enhanced[16] < 255);
  for (let i = 3; i < enhanced.length; i += 4) assert.equal(enhanced[i], 128);
  assert.deepEqual(source, original);
});

test('simple view uses distinct green, sand and blue palettes', () => {
  for (const [input, dominant] of [
    [[30, 190, 50, 255], 1], [[200, 40, 20, 255], 0], [[10, 15, 20, 255], 2],
  ]) {
    const output = processPixels(new Uint8ClampedArray(input), 1, 1, 'simple');
    assert.ok(output[dominant] > output[(dominant + 1) % 3]);
    assert.ok(output[dominant] > output[(dominant + 2) % 3]);
    assert.equal(output[3], 255);
  }
});

test('transparent image regions stay transparent in every view', () => {
  for (const mode of ['original', 'enhanced', 'simple']) {
    assert.equal(processPixels(new Uint8ClampedArray([20, 40, 60, 0]), 1, 1, mode)[3], 0);
  }
});

test('invalid modes and dimensions are rejected', () => {
  assert.throws(() => processPixels(new Uint8ClampedArray(4), 1, 1, 'unknown'));
  assert.throws(() => processPixels(new Uint8ClampedArray(4), 2, 1, 'enhanced'));
});

test('original image rendering does not fetch or process another copy', async () => {
  assert.equal(await render('/public/data/run/january.png', 'original'), '/public/data/run/january.png');
});
