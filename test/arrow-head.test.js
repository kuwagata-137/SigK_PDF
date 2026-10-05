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

// ---- 塗った三角と画面側（renderer/arrow-head.js。spec-4b-5a 確定事項4・7・8・25） ----

require('../renderer/arrow-head.js');
const worker = require('../worker/arrow-head.js');

const head = globalThis.SigK.arrowHead;

test('画面側と保存側の矢印の先は同じ式（開いた矢じりと塗った三角）', () => {
  for (const name of ['ARROW_MIN_LENGTH', 'ARROW_LENGTH_RATIO', 'ARROW_ANGLE', 'CLOSED_MIN_LENGTH', 'CLOSED_LENGTH_RATIO', 'CLOSED_ANGLE'])
    assert.equal(head[name], worker[name], name);
  for (const [from, to, width] of [[[0, 0], [100, 0], 2], [[10, 10], [10, -20], 3], [[100, 600], [300, 550], 1], [[5, 5], [-40, 30], 12]]) {
    assert.deepEqual(head.arrowHead(from, to, width), worker.arrowHead(from, to, width));
    assert.deepEqual(head.closedHead(from, to, width), worker.closedHead(from, to, width));
  }
});

test('塗った三角は長さ max(12, 線幅×4)・開き 180°÷7 で、軸を止める底の中点を返す', () => {
  assert.equal(head.CLOSED_MIN_LENGTH, 12);
  assert.equal(head.CLOSED_LENGTH_RATIO, 4);
  assert.equal(head.CLOSED_ANGLE, Math.PI / 7);
  const thin = head.closedHead([0, 0], [100, 0], 2);
  near(Math.hypot(thin.left[0] - 100, thin.left[1]), 12);
  near(thin.base[0], 100 - 12 * Math.cos(Math.PI / 7));
  near(thin.base[1], 0);
  near(thin.left[0], thin.right[0]);
  near(thin.left[1], -thin.right[1]);
  near(Math.abs(thin.left[1]), 12 * Math.sin(Math.PI / 7));
  const wide = head.closedHead([0, 0], [0, 100], 5);
  near(Math.hypot(wide.left[0], wide.left[1] - 100), 20);
  near(wide.base[1], 100 - 20 * Math.cos(Math.PI / 7));
});

test('isClosed は head が open でない矢印だけ', () => {
  assert.equal(head.isClosed({ kind: 'arrow' }), true);
  assert.equal(head.isClosed({ kind: 'arrow', head: 'open' }), false);
  assert.equal(head.isClosed({ kind: 'line' }), false);
  assert.equal(head.isClosed(null), false);
});

test('outlineOf は開いた矢じりを 翼→先→翼、塗った三角を閉じた 3 角で返し、insideHead は三角の中だけ当たる', () => {
  const open = head.outlineOf([0, 0], [100, 0], 2, false);
  assert.equal(open.length, 3);
  assert.deepEqual(open[1], [100, 0]);
  const closed = head.outlineOf([0, 0], [100, 0], 2, true);
  assert.equal(closed.length, 4);
  assert.deepEqual(closed[0], closed[3]);
  assert.equal(head.insideHead([95, 0], [0, 0], [100, 0], 2), true);
  assert.equal(head.insideHead([100, 0], [0, 0], [100, 0], 2), true, '先の点は辺の上');
  assert.equal(head.insideHead([95, 4], [0, 0], [100, 0], 2), false);
  assert.equal(head.insideHead([80, 0], [0, 0], [100, 0], 2), false, '底より手前');
  assert.equal(head.inTriangle([1, 1], [0, 0], [4, 0], [0, 4]), true);
  assert.equal(head.inTriangle([3, 3], [0, 0], [4, 0], [0, 4]), false);
});
