'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/ink-cut.js');

// ペン・マーカーの線を、なぞった跡で切る純粋層（spec-4b-5b 確定事項19・20）。

const { MIN_PIECE, capsuleInterval, cutPaths } = globalThis.SigK.inkCut;

const near = (actual, expected, eps = 0.011) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

test('capsuleInterval は線分がカプセルに入る区間を返す（両端の円・帯・入らない）', () => {
  // 横の線分 (0,0)→(100,0) と、縦のなぞり (50,-20)→(50,20)・半径 5 → x が 45〜55
  const [t0, t1] = capsuleInterval([0, 0], [100, 0], [50, -20], [50, 20], 5);
  near(t0, 0.45, 1e-9);
  near(t1, 0.55, 1e-9);
  // なぞりの端の円だけがかかる: (50,8) の 1 点（円）・半径 10 → x が 44〜56
  const disk = capsuleInterval([0, 0], [100, 0], [50, 8], [50, 8], 10);
  near(disk[0], 0.44, 1e-9);
  near(disk[1], 0.56, 1e-9);
  assert.equal(capsuleInterval([0, 0], [100, 0], [50, 20], [60, 20], 5), null);
  // 線分の外に出る分は 0〜1 に切る
  assert.deepEqual(capsuleInterval([0, 0], [10, 0], [0, -5], [0, 5], 30), [0, 1]);
});

test('なぞった所だけを切り取り、1 本が 2 本になる。切った点は小数 2 桁', () => {
  const paths = [[[0, 0], [100, 0]]];
  const { paths: next, changed } = cutPaths(paths, [[50, -20], [50, 20]], 5);
  assert.equal(changed, true);
  assert.deepEqual(next, [[[0, 0], [45, 0]], [[55, 0], [100, 0]]]);
  // 斜めの線は切った点を丸める
  const slant = cutPaths([[[0, 0], [30, 10]]], [[15, -10], [15, 20]], 2.5).paths;
  assert.equal(slant.length, 2);
  for (const point of slant.flat())
    assert.deepEqual(point.map((value) => Math.round(value * 100) / 100), point);
});

test('端だけを削る・全部消える・触れなければそのまま（同じ配列を返す）', () => {
  const paths = [[[0, 0], [100, 0]]];
  assert.deepEqual(cutPaths(paths, [[0, 0]], 10).paths, [[[10, 0], [100, 0]]]);
  assert.deepEqual(cutPaths(paths, [[-10, 0], [110, 0]], 1).paths, []);
  const same = cutPaths(paths, [[50, 30], [60, 30]], 5);
  assert.equal(same.changed, false);
  assert.equal(same.paths, paths);
});

test('折れ線の角をまたいで残る所は 1 本のままつなぎ、角を切ると 2 本に分かれる', () => {
  const path = [[0, 0], [50, 0], [50, 50], [100, 50]];
  // 最初の線分の途中だけを切る → [0..20] と [30..50, (50,50), (100,50)]
  const first = cutPaths([path], [[25, -10], [25, 10]], 5).paths;
  assert.deepEqual(first, [[[0, 0], [20, 0]], [[30, 0], [50, 0], [50, 50], [100, 50]]]);
  // 角 (50,50) を半径 5 で消す → 角の手前と後ろの 2 本
  const corner = cutPaths([path], [[50, 50]], 5).paths;
  assert.deepEqual(corner, [[[0, 0], [50, 0], [50, 45]], [[55, 50], [100, 50]]]);
});

test('長さ 0.5pt に満たない切れ端は捨て、ほかの線は残す', () => {
  assert.equal(MIN_PIECE, 0.5);
  // (0,0)→(10,0) の 9.7〜10 だけが残る（0.3pt）→ 捨てる
  const next = cutPaths([[[0, 0], [10, 0]], [[0, 50], [10, 50]]], [[0, 0], [4.7, 0]], 5).paths;
  assert.deepEqual(next, [[[0, 50], [10, 50]]]);
});

test('なぞりが 1 点（押しただけ）でも円の中を切り、太さぶんの reach で見る', () => {
  // 半径 8＋太さ 12 の半分＝14
  const next = cutPaths([[[0, 0], [100, 0]]], [[50, 10]], 14).paths;
  assert.equal(next.length, 2);
  near(next[0][1][0], 50 - Math.sqrt(14 * 14 - 100));
  near(next[1][0][0], 50 + Math.sqrt(14 * 14 - 100));
});

test('跡や reach が無ければ何もしない', () => {
  const paths = [[[0, 0], [100, 0]]];
  assert.equal(cutPaths(paths, [], 5).changed, false);
  assert.equal(cutPaths(paths, [[50, 0]], 0).changed, false);
});
