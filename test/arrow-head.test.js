'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, arrowHead } = require('../worker/arrow-head.js');

// 矢じりの点（spec-4-3 確定事項10・22）。renderer/shape-geometry.js と同じ式（一致は shape-appearance.test.js でも見る）。

function near(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);
}

test('開いた矢じりの翼は、終点から線の逆向きへ 30° ずつ開き、長さは max(9, 線幅×6)', () => {
  assert.equal(ARROW_MIN_LENGTH, 9);
  assert.equal(ARROW_LENGTH_RATIO, 6);
  assert.equal(ARROW_ANGLE, Math.PI / 6);
  const [left, right] = arrowHead([0, 0], [100, 0], 1);
  near(left[0], 100 - 9 * Math.cos(Math.PI / 6));
  near(Math.abs(left[1]), 9 * Math.sin(Math.PI / 6));
  near(left[0], right[0]);
  near(left[1], -right[1]);
  const [wide] = arrowHead([0, 0], [100, 0], 4);
  near(Math.hypot(wide[0] - 100, wide[1]), 24);
});

test('翼の長さは線の向きによらない', () => {
  for (const to of [[0, 50], [-30, -40], [35, -35]]) {
    const [left, right] = arrowHead([0, 0], to, 2);
    near(Math.hypot(left[0] - to[0], left[1] - to[1]), 12);
    near(Math.hypot(right[0] - to[0], right[1] - to[1]), 12);
  }
});
