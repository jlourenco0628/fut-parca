import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaBounds, confidenceToAlpha } from '../photo_cutout.mjs';

test('matte da pessoa remove fundo com baixa confiança e preserva o interior', () => {
  assert.equal(confidenceToAlpha(0), 0);
  assert.equal(confidenceToAlpha(.05), 0);
  assert.equal(confidenceToAlpha(.95), 255);
  assert.equal(confidenceToAlpha(1), 255);
});

test('matte mantém alfa suave nas bordas de cabelo e corpo', () => {
  const hairEdge = confidenceToAlpha(.32);
  const bodyEdge = confidenceToAlpha(.62);
  assert.ok(hairEdge > 0 && hairEdge < 255);
  assert.ok(bodyEdge > hairEdge && bodyEdge < 255);
});

test('recorte encontra somente a caixa ocupada pela pessoa', () => {
  const pixels = new Uint8ClampedArray(5 * 4 * 4);
  for (const [x, y] of [[1, 1], [3, 1], [2, 2], [1, 3]]) pixels[(y * 5 + x) * 4 + 3] = 255;
  assert.deepEqual(alphaBounds(pixels, 5, 4), { left: 1, top: 1, right: 3, bottom: 3 });
});
