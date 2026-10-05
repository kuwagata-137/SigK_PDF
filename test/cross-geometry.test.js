'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/cross-geometry.js');

// ×印の形（spec-4b-5a 確定事項2・9・21・35・39）。対角線・保存の箱・2 本の線から箱と角度を読む見分け・当たり。

const cross = globalThis.SigK.crossGeometry;
const rotation = globalThis.SigK.shapeRotation;

function near(actual, expected, eps = 0.011) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);
}

// pdf.js が /InkList を返す形（Float32Array の平たい並び）を通して点列に戻す。
function throughPdfjs(paths) {
  return paths.map((path) => {
    const flat = Float32Array.from(path.flat());
    const points = [];
    for (let index = 0; index < flat.length; index += 2)
      points.push([flat[index], flat[index + 1]]);
    return points;
  });
}

test('localDiagonals は 左上→右下、右上→左下（紙の座標は y が上）', () => {
  assert.deepEqual(cross.localDiagonals([10, 20, 50, 80]), [[[10, 80], [50, 20]], [[50, 80], [10, 20]]]);
});

test('diagonalsOf は回した位置の対角線を小数 4 桁で返し、0° なら回さない', () => {
  assert.deepEqual(cross.diagonalsOf([10, 20, 50, 80], 0), cross.localDiagonals([10, 20, 50, 80]));
  const turned = cross.diagonalsOf([0, 0, 40, 20], 90);
  // 中心 (20, 10) まわりに画面で時計回り 90°: 左上 (0, 20) → (30, 30)
  assert.deepEqual(turned[0][0], [30, 30]);
  for (const point of cross.diagonalsOf([100, 200, 173.33, 251.7], 30).flat())
    point.forEach((value) => assert.equal(Math.round(value * 10000) / 10000, value));
});

test('savedRectOf は回した 4 隅の外接に線幅の半分を足す', () => {
  assert.deepEqual(cross.savedRectOf([10, 20, 50, 80], 0, 4), [8, 18, 52, 82]);
  const [x1, y1, x2, y2] = rotation.boundsOf([10, 20, 50, 80], 30);
  assert.deepEqual(cross.savedRectOf([10, 20, 50, 80], 30, 2), [x1 - 1, y1 - 1, x2 + 1, y2 + 1].map((value) => Math.round(value * 100) / 100));
});

test('crossOf は保存した対角線から、pdf.js を通しても同じ箱と角度を読む（0・30・90・200・359°）', () => {
  for (const angle of [0, 30, 90, 200, 359, 45]) {
    for (const rect of [[100, 200, 173.33, 251.7], [10, 10, 14, 30], [300.5, 400.25, 500, 401.5]]) {
      const read = cross.crossOf(throughPdfjs(cross.diagonalsOf(rect, angle)));
      assert.notEqual(read, null, `${angle}° ${rect}`);
      assert.equal(read.angle, angle, `${angle}° ${rect}`);
      read.rect.forEach((value, index) => near(value, rect[index]));
    }
  }
});

test('crossOf は 2 本・2 点・同じ長さ・同じ中点・辺 1pt 以上でなければ null', () => {
  const base = cross.diagonalsOf([0, 0, 40, 20], 0);
  assert.equal(cross.crossOf(base.slice(0, 1)), null);
  assert.equal(cross.crossOf([...base, [[0, 0], [1, 1]]]), null);
  assert.equal(cross.crossOf([[...base[0], [5, 5]], base[1]]), null, '3 点の線');
  assert.equal(cross.crossOf([base[0], [[40, 20], [0, 0.5]]]), null, '長さが違う（中点もずれる）');
  assert.equal(cross.crossOf([[[0, 20], [40, 0]], [[40, 20.05], [0, 0.05]]]), null, '中点が 0.05pt ずれる');
  assert.equal(cross.crossOf(cross.diagonalsOf([0, 0, 40, 0.5], 0)), null, '高さ 0.5pt');
  assert.equal(cross.crossOf(null), null);
  // 許しの内（長さの差 0.5% 以内・中点の差 0.02pt 以内）は ×印
  assert.notEqual(cross.crossOf([[[0, 20], [40, 0]], [[40, 20.01], [0, 0.01]]]), null);
});

test('crossOf は線の並びが逆（右上→左下が先）でも同じ 4 隅の箱を読む', () => {
  const [first, second] = cross.diagonalsOf([0, 0, 40, 20], 0);
  const read = cross.crossOf([second, first]);
  const corners = (rect, angle) => rotation.cornersOf(rect, angle).map((point) => point.map((value) => Math.round(value * 100) / 100)).sort().join(' ');
  assert.equal(corners(read.rect, read.angle), corners([0, 0, 40, 20], 0));
});

test('distanceTo は対角線からの距離で、回した ×印は回す前の座標へ戻して測る', () => {
  const entry = { kind: 'cross', rect: [0, 0, 40, 40], lineWidth: 2 };
  near(cross.distanceTo(entry, [20, 20]), 0);
  near(cross.distanceTo(entry, [20, 0]), 20 / Math.SQRT2, 0.02);
  assert.ok(cross.distanceTo(entry, [20, 2]) > 1);
  const turned = { ...entry, angle: 45 };
  // 45° 回すと対角線は縦と横になる
  near(cross.distanceTo(turned, [20, 35]), 0, 0.02);
  near(cross.distanceTo(turned, [5, 20]), 0, 0.02);
});
