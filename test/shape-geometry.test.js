'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-geometry.js');

// 図形・ペンの幾何（spec-4-3 確定事項4・9・10・12・30）。DOM に触れない純関数。

const geo = globalThis.SigK.shapeGeometry;

function near(actual, expected, eps = 0.02) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);
}

test('boxOf は 2 点を min/max の箱にし、辺は最低 1pt', () => {
  assert.deepEqual(geo.boxOf([10, 20], [5, 2]), [5, 2, 10, 20]);
  assert.deepEqual(geo.boxOf([5, 2], [10, 20]), [5, 2, 10, 20]);
  assert.deepEqual(geo.boxOf([10, 10], [10, 10]), [10, 10, 11, 11]);
  assert.deepEqual(geo.boxOf([10, 10], [30, 10.4]), [10, 10, 30, 11]);
  assert.deepEqual(geo.boxOf([1.234, 2.345], [3.456, 4.567]), [1.23, 2.35, 3.46, 4.57]);
});

test('boxOf は Shift で正方形にし、引いた向きへ伸ばす', () => {
  assert.deepEqual(geo.boxOf([0, 0], [10, 4], { square: true }), [0, 0, 10, 10]);
  assert.deepEqual(geo.boxOf([0, 0], [-10, 4], { square: true }), [-10, 0, 0, 10]);
  assert.deepEqual(geo.boxOf([0, 0], [3, -10], { square: true }), [0, -10, 10, 0]);
  assert.deepEqual(geo.boxOf([0, 0], [-3, -10], { square: true }), [-10, -10, 0, 0]);
});

test('snapAngle は 45° 刻みに吸着し、長さを保つ', () => {
  let to = geo.snapAngle([0, 0], [10, 1]);
  near(to[0], 10.05); near(to[1], 0);
  to = geo.snapAngle([0, 0], [7, 8]);
  near(to[0], 7.52); near(to[1], 7.52);
  to = geo.snapAngle([0, 0], [-1, 10]);
  near(to[0], 0); near(to[1], 10.05);
  to = geo.snapAngle([5, 5], [-4, -5]);
  near(to[0], -4.51); near(to[1], -4.51);
  assert.deepEqual(geo.snapAngle([3, 3], [3, 3]), [3, 3]);
});

test('arrowHead は終点に開いた 2 つの翼を返す（長さは max(9, 線幅×6)・開き 30°）', () => {
  assert.equal(geo.ARROW_MIN_LENGTH, 9);
  assert.equal(geo.ARROW_LENGTH_RATIO, 6);
  near(geo.ARROW_ANGLE, Math.PI / 6, 1e-9);
  const [a, b] = geo.arrowHead([0, 0], [100, 0], 2);
  near(a[0], 89.61); near(a[1], 6);
  near(b[0], 89.61); near(b[1], -6);
  // 細い線でも 9pt を下回らない
  const [c] = geo.arrowHead([0, 0], [0, 50], 1);
  near(c[0], -4.5); near(c[1], 42.21);
  // 向きに追従する（上向き）
  const [d, e] = geo.arrowHead([10, 10], [10, -20], 3);
  near(d[0], 19); near(d[1], -4.41);
  near(e[0], 1); near(e[1], -4.41);
});

test('rectOfShape は矩形・楕円は箱そのもの、線は点と翼の外接に線幅の半分を足す', () => {
  const box = geo.rectOfShape({ kind: 'square', rect: [10, 20, 30, 40], lineWidth: 3 });
  assert.deepEqual(box, { rect: [10, 20, 30, 40], quads: [[10, 40, 30, 40, 10, 20, 30, 20]] });
  assert.deepEqual(geo.rectOfShape({ kind: 'circle', rect: [10, 20, 30, 40], lineWidth: 3 }).rect, [10, 20, 30, 40]);
  const line = geo.rectOfShape({ kind: 'line', paths: [[[100, 600], [300, 550]]], lineWidth: 3 });
  assert.deepEqual(line.rect, [98.5, 548.5, 301.5, 601.5]);
  assert.deepEqual(line.quads, [[98.5, 601.5, 301.5, 601.5, 98.5, 548.5, 301.5, 548.5]]);
  const arrow = geo.rectOfShape({ kind: 'arrow', paths: [[[100, 600], [300, 550]]], lineWidth: 3 });
  assert.deepEqual(arrow.rect, [98.5, 543.55, 301.5, 601.5]);
  const ink = geo.rectOfShape({ kind: 'ink', paths: [[[100, 500], [120, 480], [150, 510]], [[90, 505], [95, 506]]], lineWidth: 2 });
  assert.deepEqual(ink.rect, [89, 479, 151, 511]);
});

test('distanceToSegment は線分への最短距離で、端の外は端からの距離', () => {
  assert.equal(geo.distanceToSegment([5, 5], [0, 0], [10, 0]), 5);
  assert.equal(geo.distanceToSegment([15, 0], [0, 0], [10, 0]), 5);
  assert.equal(geo.distanceToSegment([-3, 4], [0, 0], [10, 0]), 5);
  assert.equal(geo.distanceToSegment([3, 4], [0, 0], [0, 0]), 5);
  near(geo.distanceToSegment([0, 10], [0, 0], [10, 10]), 7.07);
});

test('hitsPath は線分からの距離が許容以内なら当たり、矢印は翼も見る', () => {
  const paths = [[[0, 0], [100, 0]]];
  assert.equal(geo.hitsPath(paths, [50, 2], 3), true);
  assert.equal(geo.hitsPath(paths, [50, 4], 3), false);
  assert.equal(geo.hitsPath(paths, [-2, 0], 3), true);
  assert.equal(geo.hitsPath(paths, [-4, 0], 3), false);
  // 矢じり: 翼は (89.61, ±6) へ伸びる（線幅 2）
  assert.equal(geo.hitsPath(paths, [92, 5], 1, { arrow: true, lineWidth: 2 }), true);
  assert.equal(geo.hitsPath(paths, [92, 5], 1), false);
  // 複数の path のどれかに当たれば当たり
  assert.equal(geo.hitsPath([[[0, 0], [10, 0]], [[0, 50], [10, 50]]], [5, 51], 2), true);
  assert.equal(geo.hitsPath([[[0, 0], [10, 0]], [[0, 50], [10, 50]]], [5, 25], 2), false);
});

test('hitTolerance は線幅の半分に 3px 相当を足す', () => {
  assert.equal(geo.HIT_SLACK, 3);
  assert.equal(geo.hitTolerance(2, 1), 4);
  assert.equal(geo.hitTolerance(4, 2), 3.5);
  assert.equal(geo.hitTolerance(1, 0), 3.5);
});

test('thinPoints は直前の点から minStep 未満の点を捨て、最後の点は残す', () => {
  assert.equal(geo.MIN_STEP, 2);
  assert.deepEqual(geo.thinPoints([[0, 0], [0.5, 0], [1, 0], [3, 0], [3.5, 0], [10, 0]], 2), [[0, 0], [3, 0], [10, 0]]);
  assert.deepEqual(geo.thinPoints([[0, 0], [1, 0]], 2), [[0, 0], [1, 0]]);
  assert.deepEqual(geo.thinPoints([[0, 0]], 2), [[0, 0]]);
  assert.deepEqual(geo.thinPoints([], 2), []);
  // 1 点を足すだけの口（描きながら使う）
  assert.equal(geo.farEnough([0, 0], [1.9, 0], 2), false);
  assert.equal(geo.farEnough([0, 0], [2, 0], 2), true);
});

test('simplifyPath は Douglas–Peucker で許容以内の点を落とす', () => {
  assert.equal(geo.SIMPLIFY_TOLERANCE, 1);
  const straight = Array.from({ length: 11 }, (_, i) => [i * 10, i * 5 + (i % 2) * 0.3]);
  assert.deepEqual(geo.simplifyPath(straight, 1), [[0, 0], [100, 50]]);
  assert.deepEqual(geo.simplifyPath([[0, 0], [5, 0.1], [10, 0], [10, 5], [10, 10]], 1), [[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(geo.simplifyPath([[0, 0], [10, 10]], 1), [[0, 0], [10, 10]]);
  assert.deepEqual(geo.simplifyPath([[3, 3]], 1), [[3, 3]]);
  // 閉じた輪（始点＝終点）でも角が残る
  const loop = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.deepEqual(geo.simplifyPath(loop, 1), loop);
});

test('roundPoint は小数 2 桁に丸める', () => {
  assert.deepEqual(geo.roundPoint([1.234, 5.678]), [1.23, 5.68]);
});
