'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/markup-quads.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-state.js');
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

test('hits は回した四角・丸を、回した箱の中だけで当てる（spec-4b-2 確定事項15）', () => {
  const rect = [100, 600, 300, 700];
  const square = { kind: 'square', rect, angle: 45, lineWidth: 2, quads: [globalThis.SigK.shapeRotation.quadOf(rect, 45)] };
  const viewport = { scale: 1 };
  assert.equal(hit.hits(square, [200, 650], viewport, [0, 0]), true, '中心');
  // 回す前の箱の右上の角（300, 700）は、45° 回すと箱の外になる
  assert.equal(hit.hits(square, [295, 695], viewport, [0, 0]), false);
  // 回す前は箱の外でも、回した箱の中なら当たる（長い辺の向き＝画面で右下へ 45° に、中心から 90pt。回す前の箱の下より下）
  assert.equal(hit.hits(square, [263.6, 586.4], viewport, [0, 0]), true);
  assert.equal(hit.hits({ ...square, angle: undefined, quads: [[100, 700, 300, 700, 100, 600, 300, 600]] }, [263.6, 586.4], viewport, [0, 0]), false);
  // 回していなければ今までどおり四角で見る
  assert.equal(hit.hits({ ...square, angle: undefined, quads: [[100, 700, 300, 700, 100, 600, 300, 600]] }, [295, 695], viewport, [0, 0]), true);
  assert.equal(hit.hits({ ...square, readonly: true }, [200, 650], viewport, [0, 0]), false);
});
