'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { placementMatrix, noRotateMatrix, bakeMatrix } = require('../worker/flatten-geometry.js');
const { IDENTITY, multiply, transformPoint } = require('../worker/pdf-matrix.js');

function nearPoint(actual, expected, message) {
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9, `${message ?? ''} ${actual} ≠ ${expected}`);
}

// 外観の /BBox の四隅を、/Matrix と A を当てて紙へ写した外接の箱（ISO 32000-1 12.5.5 の検算）。
function paperBoxOf(bbox, matrix, a) {
  const all = multiply(matrix, a);
  const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map((p) => transformPoint(p, all));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

test('placementMatrix は /BBox と /Rect が同じなら何もしない行列を返す', () => {
  assert.deepEqual(placementMatrix([100, 700, 120, 720], IDENTITY, [100, 700, 120, 720]), [1, 0, 0, 1, 0, 0]);
});

test('placementMatrix は原点のずれた大きな /BBox を /Rect へ縮めて合わせる', () => {
  const a = placementMatrix([100, 100, 220, 220], IDENTITY, [200, 450, 260, 510]);
  assert.deepEqual(a, [0.5, 0, 0, 0.5, 150, 400]);
  assert.deepEqual(paperBoxOf([100, 100, 220, 220], IDENTITY, a), [200, 450, 260, 510]);
});

test('placementMatrix は /Matrix で 90° 回した外観も、写した箱が /Rect に重なるようにする', () => {
  const matrix = [0, 1, -1, 0, 0, 0];
  const a = placementMatrix([0, 0, 100, 50], matrix, [100, 600, 150, 700]);
  assert.deepEqual(a, [1, 0, 0, 1, 150, 600]);
  assert.deepEqual(paperBoxOf([0, 0, 100, 50], matrix, a), [100, 600, 150, 700]);
});

test('placementMatrix は左右・上下が逆に書かれた /Rect も受け、幅か高さが 0 の箱は拡大しない', () => {
  assert.deepEqual(placementMatrix([0, 0, 10, 10], IDENTITY, [20, 30, 0, 10]), [2, 0, 0, 2, 0, 10]);
  assert.deepEqual(placementMatrix([0, 0, 0, 10], IDENTITY, [5, 5, 5, 25]), [1, 0, 0, 2, 5, 5]);
});

test('placementMatrix は形が違えば null', () => {
  assert.equal(placementMatrix([0, 0, 10], IDENTITY, [0, 0, 10, 10]), null);
  assert.equal(placementMatrix([0, 0, 10, 10], [1, 0, 0, 1], [0, 0, 10, 10]), null);
  assert.equal(placementMatrix([0, 0, 10, 10], IDENTITY, [0, 0, Number.NaN, 10]), null);
});

test('noRotateMatrix は回転の無いページでは何もしない', () => {
  assert.deepEqual(noRotateMatrix([100, 680, 120, 700], 0), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(noRotateMatrix([100, 680, 120, 700], 45), [1, 0, 0, 1, 0, 0]);
});

test('noRotateMatrix は /Rect の左上を軸に /Rotate ぶん反時計回りに回す（表示で上向きのまま）', () => {
  const rect = [100, 680, 120, 700];
  for (const rotate of [90, 180, 270, -90]) {
    const m = noRotateMatrix(rect, rotate);
    // 左上は動かない。
    nearPoint(transformPoint([100, 700], m), [100, 700], `r${rotate}`);
  }
  // /Rotate 90: 上の辺（右へ 20）は紙の上で上へ 20 になる（表示では右へ 20）。
  nearPoint(transformPoint([120, 700], noRotateMatrix(rect, 90)), [100, 720]);
  // /Rotate 180: 右へ 20 は左へ 20。
  nearPoint(transformPoint([120, 700], noRotateMatrix(rect, 180)), [80, 700]);
  // /Rotate 270（-90 も同じ）: 右へ 20 は下へ 20。
  nearPoint(transformPoint([120, 700], noRotateMatrix(rect, 270)), [100, 680]);
  nearPoint(transformPoint([120, 700], noRotateMatrix(rect, -90)), [100, 680]);
});

test('bakeMatrix は A に、NoRotate のときだけ回転を重ねる', () => {
  const args = { bbox: [0, 0, 20, 20], matrix: IDENTITY, rect: [100, 680, 120, 700], rotate: 90 };
  const a = placementMatrix(args.bbox, args.matrix, args.rect);
  assert.deepEqual(bakeMatrix({ ...args, noRotate: false }), a);
  assert.deepEqual(bakeMatrix({ ...args, noRotate: true }), multiply(a, noRotateMatrix(args.rect, 90)));
  assert.equal(bakeMatrix({ ...args, rect: [0, 0] }), null);
  // /Matrix を省けば何もしない行列として扱う。
  assert.deepEqual(bakeMatrix({ bbox: [0, 0, 20, 20], rect: [100, 680, 120, 700] }), [1, 0, 0, 1, 100, 680]);
});
