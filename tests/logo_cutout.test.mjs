import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateEdgeBackground, removeEdgeConnectedBackground, logoAlphaBounds, squareLogoGeometry } from '../logo_cutout.mjs';

const image = (width, height, [r, g, b, a = 255]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) data.set([r, g, b, a], index * 4);
  return data;
};
const paint = (data, width, x, y, [r, g, b, a = 255]) => data.set([r, g, b, a], (y * width + x) * 4);
const alpha = (data, width, x, y) => data[(y * width + x) * 4 + 3];

test('remove fundo branco conectado à borda e preserva o escudo', () => {
  const width = 9, height = 9, data = image(width, height, [250, 250, 248, 255]);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) paint(data, width, x, y, [190, 20, 25, 255]);
  const result = removeEdgeConnectedBackground(data, width, height);
  assert.ok(result.removed > 0);
  assert.equal(alpha(data, width, 0, 0), 0);
  assert.equal(alpha(data, width, 4, 4), 255);
});

test('remove fundo preto conectado à borda', () => {
  const width = 7, height = 7, data = image(width, height, [8, 9, 10, 255]);
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) paint(data, width, x, y, [35, 220, 90, 255]);
  removeEdgeConnectedBackground(data, width, height);
  assert.equal(alpha(data, width, 0, 3), 0);
  assert.equal(alpha(data, width, 3, 3), 255);
});

test('detalhe interno igual ao fundo não é apagado', () => {
  const width = 9, height = 9, data = image(width, height, [255, 255, 255, 255]);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) paint(data, width, x, y, [20, 70, 190, 255]);
  paint(data, width, 4, 4, [255, 255, 255, 255]);
  removeEdgeConnectedBackground(data, width, height);
  assert.equal(alpha(data, width, 4, 4), 255);
});

test('perímetro sem cor dominante não sofre remoção agressiva', () => {
  const width = 8, height = 8, data = image(width, height, [255, 255, 255, 255]);
  for (let x = 0; x < width; x++) {
    paint(data, width, x, 0, x % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    paint(data, width, x, height - 1, x % 2 ? [0, 255, 0, 255] : [255, 255, 0, 255]);
  }
  for (let y = 1; y < height - 1; y++) {
    paint(data, width, 0, y, y % 2 ? [255, 0, 255, 255] : [0, 255, 255, 255]);
    paint(data, width, width - 1, y, y % 2 ? [30, 60, 90, 255] : [180, 60, 30, 255]);
  }
  assert.equal(estimateEdgeBackground(data, width, height), null);
  assert.equal(removeEdgeConnectedBackground(data, width, height).removed, 0);
});

test('geometria final cria margem transparente e tela quadrada', () => {
  const data = image(12, 8, [0, 0, 0, 0]);
  for (let y = 2; y <= 5; y++) for (let x = 4; x <= 8; x++) paint(data, 12, x, y, [240, 80, 30, 255]);
  const bounds = logoAlphaBounds(data, 12, 8);
  assert.deepEqual(bounds, { left: 4, top: 2, right: 8, bottom: 5 });
  const geometry = squareLogoGeometry(bounds);
  assert.equal(geometry.side, 9);
  assert.ok(geometry.destinationX > 0);
  assert.ok(geometry.destinationY > 0);
});
