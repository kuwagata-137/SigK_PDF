'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { IDENTITY, multiply, transformPoint, normalizeRotation, num4, matrixText } = require('../worker/pdf-matrix.js');

test('multiply は左を当ててから右を当てる行列を返す', () => {
  const scale = [2, 0, 0, 3, 0, 0];
  const move = [1, 0, 0, 1, 10, 20];
  // 拡大してから移動: (1, 1) → (2, 3) → (12, 23)
  assert.deepEqual(transformPoint([1, 1], multiply(scale, move)), [12, 23]);
  // 移動してから拡大: (1, 1) → (11, 21) → (22, 63)
  assert.deepEqual(transformPoint([1, 1], multiply(move, scale)), [22, 63]);
  assert.deepEqual(multiply(IDENTITY, move), move);
  assert.deepEqual(multiply(move, IDENTITY), move);
});

test('transformPoint は 90° の回転を反時計回りに当てる（y は上向き）', () => {
  const [x, y] = transformPoint([1, 0], [0, 1, -1, 0, 0, 0]);
  assert.equal(x, 0);
  assert.equal(y, 1);
});

test('normalizeRotation は /Rotate を 90 の倍数に寄せ、そうでなければ 0', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(180), 180);
  assert.equal(normalizeRotation(45), 0);
  assert.equal(normalizeRotation(undefined), 0);
});

test('num4 は小数 4 桁で書き、末尾の 0 と -0 の符号を落とす', () => {
  assert.equal(num4(Math.SQRT1_2), '0.7071');
  assert.equal(num4(-0.00001), '0');
  assert.equal(num4(-1.23456), '-1.2346');
  assert.equal(num4(12), '12');
  assert.equal(num4(1.5), '1.5');
  assert.equal(num4(1e-7), '0');
  assert.equal(matrixText([Math.SQRT1_2, 0, -0, 1, 297.64, 420.945]), '0.7071 0 0 1 297.64 420.945');
});
