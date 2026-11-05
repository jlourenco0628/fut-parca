import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaBounds, confidenceToAlpha, paddedCropGeometry } from '../photo_cutout.mjs';

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

test('recorte preserva fios suaves do cabelo', () => {
  const pixels = new Uint8ClampedArray(3 * 3 * 4);
  pixels[(0 * 3 + 1) * 4 + 3] = 9;
  pixels[(2 * 3 + 1) * 4 + 3] = 255;
  assert.deepEqual(alphaBounds(pixels, 3, 3), { left: 1, top: 0, right: 1, bottom: 2 });
});

test('recorte cria espaço transparente acima quando o cabelo toca a borda', () => {
  const geometry = paddedCropGeometry({ left: 0, top: 0, right: 9, bottom: 19 }, 10, 20);
  assert.equal(geometry.outputWidth, 12);
  assert.equal(geometry.outputHeight, 24);
  assert.equal(geometry.destinationX, 1);
  assert.equal(geometry.destinationY, 3);
  assert.equal(geometry.sourceLeft, 0);
  assert.equal(geometry.sourceTop, 0);
});
