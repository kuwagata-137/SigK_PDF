'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/imported-values.js');

// pdf.js が返す値を自前の entry の部品にする層（spec-4-1 確定事項17、spec-4-4 確定事項20）。
// imported-entry.test.js から移した（spec-4b-1a 確定事項36）。

const values = globalThis.SigK.importedValues;

test('hexOf は 0〜255 の RGB を #rrggbb にし、無ければ黒', () => {
  assert.equal(values.hexOf(new Uint8ClampedArray([255, 230, 51])), '#ffe633');
  assert.equal(values.hexOf([0, 0, 0]), '#000000');
  assert.equal(values.hexOf(null), '#000000');
  assert.equal(values.hexOf([1]), '#000000');
});

test('quadsOf は 8 つずつ四角に切り、端数は捨てる', () => {
  assert.deepEqual(values.quadsOf(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16]]);
  assert.deepEqual(values.quadsOf([1, 2, 3]), []);
  assert.deepEqual(values.quadsOf(undefined), []);
  assert.deepEqual(values.quadsOf([1.234567, 2, 3, 4, 5, 6, 7, 8]), [[1.23, 2, 3, 4, 5, 6, 7, 8]]);
});

test('roundRect は小数 2 桁に丸め、isRect は有限の数 4 つだけを箱と見る', () => {
  assert.deepEqual(values.roundRect([1.234, 5.678, 9, 10.005]), [1.23, 5.68, 9, 10.01]);
  assert.equal(values.isRect([0, 0, 1, 1]), true);
  assert.equal(values.isRect([0, 0, 1]), false);
  assert.equal(values.isRect([0, 0, 1, Number.NaN]), false);
  assert.equal(values.isRect(null), false);
});

test('contentsOf は本文の改行を LF に揃え、無ければ空', () => {
  assert.equal(values.contentsOf({ contentsObj: { str: '1\r\n2\r3' } }), '1\n2\n3');
  assert.equal(values.contentsOf({}), '');
});
