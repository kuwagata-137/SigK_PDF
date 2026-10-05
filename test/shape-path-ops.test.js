'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { point, dashOps, pathOps, lineOps, arrowOps, inkOps } = require('../worker/shape-path-ops.js');
const { arrowHead } = require('../worker/arrow-head.js');

// 線の図形（直線・矢印・ペン）の外観の命令（spec-4-3 確定事項20〜22、spec-4b-1b 確定事項32）。shape-appearance.js から移した（spec-4b-5a a0）。

const SOLID = { stroke: [1, 0, 0], dash: null };
const DASHED = { stroke: [0, 0, 1], dash: [6, 4] };

test('点・破線・折れ線の命令は小数 2 桁までの数で書く', () => {
  assert.equal(point([1.234, 5]), '1.23 5');
  assert.equal(dashOps([6, 4.5]), '[6 4.5] 0 d');
  assert.equal(pathOps([[0, 0], [10, 0], [10, 5]]), '0 0 m 10 0 l 10 5 l S');
});

test('直線は実線なら丸い端、破線なら間隔を書く', () => {
  assert.equal(lineOps([[0, 0], [10, 0]], 2, SOLID), '1 0 0 RG\n2 w 1 J 0 0 m 10 0 l S');
  assert.equal(lineOps([[0, 0], [10, 0]], 2, DASHED), '0 0 1 RG\n2 w [6 4] 0 d 0 0 m 10 0 l S');
});

test('矢印は軸のあとに翼 2 本を引き、破線でも翼は実線', () => {
  const [left, right] = arrowHead([0, 0], [100, 0], 2);
  const wings = pathOps([left, [100, 0], right]);
  assert.equal(arrowOps([[0, 0], [100, 0]], 2, SOLID), ['1 0 0 RG', '2 w 1 J 1 j', '0 0 m 100 0 l S', wings].join('\n'));
  const dashed = arrowOps([[0, 0], [100, 0]], 2, DASHED).split('\n');
  assert.equal(dashed[1], '2 w [6 4] 0 d');
  assert.equal(dashed[3], '[] 0 d 1 J 1 j');
  assert.equal(dashed[4], wings);
});

test('ペンは path ごとに折れ線を引く', () => {
  assert.equal(inkOps([[[0, 0], [1, 1]], [[2, 2], [3, 3]]], 1.5, SOLID), '1 0 0 RG\n1.5 w 1 J 1 j\n0 0 m 1 1 l S\n2 2 m 3 3 l S');
});
