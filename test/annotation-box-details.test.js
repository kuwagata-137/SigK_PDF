'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/shape-rotation.js');
require('../renderer/annotation-box-details.js');

// 四角・丸の読み戻しを当てる純粋層（annotation-details.js から移した。当て方の全体は annotation-details.test.js が見る）。

const box = globalThis.SigK.annotationBoxDetails;

test('validDifference は 0 以上で、左右と上下の和が箱より小さい /RD だけを受け取る', () => {
  const rect = [100, 100, 200, 160];
  assert.equal(box.validDifference([5, 5, 5, 5], rect), true);
  assert.equal(box.validDifference([60, 0, 40, 0], rect), false);
  assert.equal(box.validDifference([0, 30, 0, 30], rect), false);
  assert.equal(box.validDifference([-1, 0, 0, 0], rect), false);
  assert.equal(box.validDifference([1, 2, 3], rect), false);
});

test('insideOf は /RD（左・上・右・下）を引いた内側の箱を小数 2 桁で返す', () => {
  assert.deepEqual(box.insideOf([100, 100, 200, 160], [1.111, 2, 3, 4]), [101.11, 104, 197, 158]);
});
