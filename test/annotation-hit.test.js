'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-geometry.js');
require('../renderer/annotation-hit.js');

// 書き込みの当たり判定（spec-4-3 確定事項12、spec-4b-2）。線の当たりは shape-geometry.js から移した。

const hit = globalThis.SigK.annotationHit;

test('hitsPath は線分からの距離が許容以内なら当たり、矢印は翼も見る', () => {
  const paths = [[[0, 0], [100, 0]]];
  assert.equal(hit.hitsPath(paths, [50, 2], 3), true);
  assert.equal(hit.hitsPath(paths, [50, 4], 3), false);
  assert.equal(hit.hitsPath(paths, [-2, 0], 3), true);
  assert.equal(hit.hitsPath(paths, [-4, 0], 3), false);
  // 矢じり: 翼は (89.61, ±6) へ伸びる（線幅 2）
  assert.equal(hit.hitsPath(paths, [92, 5], 1, { arrow: true, lineWidth: 2 }), true);
  assert.equal(hit.hitsPath(paths, [92, 5], 1), false);
  // 複数の path のどれかに当たれば当たり
  assert.equal(hit.hitsPath([[[0, 0], [10, 0]], [[0, 50], [10, 50]]], [5, 51], 2), true);
  assert.equal(hit.hitsPath([[[0, 0], [10, 0]], [[0, 50], [10, 50]]], [5, 25], 2), false);
});

test('hitTolerance は線幅の半分に 3px 相当を足す', () => {
  assert.equal(hit.HIT_SLACK, 3);
  assert.equal(hit.hitTolerance(2, 1), 4);
  assert.equal(hit.hitTolerance(4, 2), 3.5);
  assert.equal(hit.hitTolerance(1, 0), 3.5);
});
