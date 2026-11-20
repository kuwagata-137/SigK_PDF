'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-size.js');

// 四角・丸・×印の大きさ（幅・高さ）の数値欄の計算（spec-7-9 確定事項D1〜D3）。

const size = globalThis.SigK.shapeSize;
const SQUARE = { kind: 'square', rect: [100, 600, 300, 700], lineWidth: 2 };

test('対象は四角・丸・×印だけ', () => {
  assert.deepEqual([...size.BOX_KINDS], ['square', 'circle', 'cross']);
  assert.equal(size.sizedTo({ ...SQUARE, kind: 'line', paths: [[[0, 0], [10, 10]]] }, 'width', 50), null);
  assert.equal(size.sizedTo({ ...SQUARE, kind: 'polygon', paths: [[[0, 0], [10, 10], [0, 10]]] }, 'width', 50), null);
});

test('幅と高さは回す前の箱の大きさで、表示は小数 1 桁', () => {
  assert.deepEqual(size.sizeOf(SQUARE), { width: 200, height: 100 });
  assert.equal(size.shownOf(123.456), '123.5');
  assert.equal(size.shownOf(100), '100');
  assert.equal(size.shownOf(650.3 - 420.05), '230.3', '引き算の誤差で 230.2 にしない');
});

test('入力した側だけを変え、箱の中心は動かさない', () => {
  assert.deepEqual(size.sizedTo(SQUARE, 'width', 300).rect, [50, 600, 350, 700]);
  assert.deepEqual(size.sizedTo(SQUARE, 'height', 40).rect, [100, 630, 300, 670]);
  assert.deepEqual(size.sizedTo(SQUARE, 'width', 120.456).rect, [139.77, 600, 260.23, 700]);
});

test('keep の時は、入力していない側を今の縦横比で変える', () => {
  assert.deepEqual(size.sizedTo(SQUARE, 'width', 300, { keep: true }).rect, [50, 575, 350, 725]);
  assert.deepEqual(size.sizedTo(SQUARE, 'height', 50, { keep: true }).rect, [150, 625, 250, 675]);
});

test('範囲（1〜14400pt）の外になる値は当てない', () => {
  assert.equal(size.sizedTo(SQUARE, 'width', 0.99), null);
  assert.equal(size.sizedTo(SQUARE, 'width', 14401), null);
  assert.equal(size.sizedTo(SQUARE, 'width', Number.NaN), null);
  assert.notEqual(size.sizedTo(SQUARE, 'width', 1), null);
  // keep で、もう一方が範囲の外になる時も当てない
  assert.equal(size.sizedTo(SQUARE, 'width', 1.5, { keep: true }), null);
  assert.equal(size.sizedTo(SQUARE, 'height', 10000, { keep: true }), null);
});

test('回した図形は角度を保ち、四角（quads）も回した 4 隅にする', () => {
  const turned = { ...SQUARE, kind: 'circle', angle: 30 };
  const patch = size.sizedTo(turned, 'width', 100);
  assert.deepEqual(patch.rect, [150, 600, 250, 700]);
  assert.deepEqual(patch.quads, [globalThis.SigK.shapeRotation.quadOf([150, 600, 250, 700], 30)]);
});
