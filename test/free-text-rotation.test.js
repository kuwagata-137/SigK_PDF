'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freeTextRotationOf } = require('../worker/free-text-rotation.js');
const { matrixOf, rectOf } = require('../worker/shape-rotation.js');

// 回した FreeText の箱と角度の読み（spec-4b-4b 確定事項H2）。

const BOX = [100.25, 674.5, 224.37, 720.5];

const near = (actual, expected, tolerance = 0.011) => {
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${actual} ≠ ${expected}`);
};

test('自前の書き方（/Rect が /BBox の写しの外接）なら、/BBox をそのまま回す前の箱にする', () => {
  for (const angle of [1, 30, 90, 200, 359]) {
    const answer = freeTextRotationOf({ rect: rectOf(BOX, angle), bbox: BOX, matrix: matrixOf(BOX, angle) });
    assert.deepEqual(answer, { box: BOX, angle }, `${angle}°`);
  }
});

test('吹き出しは、/BBox を /RD で縮めた箱（inner）をそのまま使う', () => {
  const inner = [110, 690, 200, 710];
  const answer = freeTextRotationOf({ rect: rectOf(BOX, 30), bbox: BOX, matrix: matrixOf(BOX, 30), inner });
  assert.deepEqual(answer, { box: inner, angle: 30 });
});

test('他のアプリが /Rect を動かしていたら、その分だけ箱をずらす', () => {
  const rect = rectOf(BOX, 30).map((value, index) => value + (index % 2 === 0 ? 5 : -3));
  const answer = freeTextRotationOf({ rect, bbox: BOX, matrix: matrixOf(BOX, 30) });
  assert.equal(answer.angle, 30);
  near(answer.box, [BOX[0] + 5, BOX[1] - 3, BOX[2] + 5, BOX[3] - 3]);
  const inner = [110, 690, 200, 710];
  const moved = freeTextRotationOf({ rect, bbox: BOX, matrix: matrixOf(BOX, 30), inner });
  near(moved.box, [115, 687, 205, 707]);
});

test('回っていない外観は null、ゆがんだ外観は skewed、形の崩れたものは null', () => {
  assert.equal(freeTextRotationOf({ rect: BOX, bbox: BOX, matrix: [1, 0, 0, 1, 0, 0] }), null);
  assert.equal(freeTextRotationOf({ rect: BOX, bbox: BOX, matrix: [1, 0, 0.5, 1, 0, 0] }), 'skewed');
  assert.equal(freeTextRotationOf({ rect: BOX, bbox: null, matrix: [1, 0, 0, 1, 0, 0] }), null);
});
