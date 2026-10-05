'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/cross-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/free-text-layout.js');
require('../renderer/callout-shape.js');
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

test('hitsPath は塗った三角の矢印の 3 辺と中に当たる（spec-4b-5a 確定事項25）', () => {
  const paths = [[[0, 0], [100, 0]]];
  // 線幅 2 の三角は長さ 12・開き 180°÷7。底は x = 89.19、底の幅の半分は 5.21
  assert.equal(hit.hitsPath(paths, [93, 2.5], 0.1, { arrow: true, lineWidth: 2, closed: true }), true, '三角の中');
  assert.equal(hit.hitsPath(paths, [93, 2.5], 0.1, { arrow: true, lineWidth: 2 }), false, '開いた矢じりなら中は当たらない');
  assert.equal(hit.hitsPath(paths, [89.2, 5.5], 0.5, { arrow: true, lineWidth: 2, closed: true }), true, '底の角の近く');
  assert.equal(hit.hitsPath(paths, [95, 6], 0.5, { arrow: true, lineWidth: 2, closed: true }), false);
  const entry = { kind: 'arrow', paths, lineWidth: 2, quads: [[0, 6, 100, 6, 0, -6, 100, -6]], rect: [0, -6, 100, 6] };
  const viewport = { scale: 10 };
  assert.equal(hit.hits(entry, [93, 2.5], viewport, null), true);
  assert.equal(hit.hits({ ...entry, head: 'open' }, [93, 2.5], viewport, null), false);
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

// 点検で見つけた誤り（2026-10-04）: 吹き出しのしっぽは三角の中だけで当たり、先へ細る所は押しにくかった（spec-4b-4b 確定事項C4）。
test('hits は吹き出しのしっぽに、線と同じ余裕（枠線の太さの半分と 3px 相当。枠線が無ければ 3px 相当）で当てる', () => {
  const rect = [100, 600, 220, 644];
  const callout = {
    kind: 'text', rect, quads: [[100, 644, 220, 644, 100, 600, 220, 600]], text: '確認', fontSize: 12, rotation: 0,
    borderColor: '#c00000', borderWidth: 1.5, callout: { tip: [80, 540] },
  };
  // しっぽの左の辺（付け根の左から先へ）の中ほどから、三角の外へ 3.5pt
  const tail = globalThis.SigK.calloutShape.tailOf(rect, [80, 540], 12);
  const a = [tail.base[0] - tail.half, tail.base[1]];
  const length = Math.hypot(80 - a[0], 540 - a[1]);
  const away = [(540 - a[1]) / length, -(80 - a[0]) / length];
  const point = [(a[0] + 80) / 2 + away[0] * 3.5, (a[1] + 540) / 2 + away[1] * 3.5];
  assert.equal(globalThis.SigK.calloutShape.hitsTail(callout, point), false, '三角の外');
  assert.equal(hit.hits(callout, point, { scale: 1 }, [0, 0]), true, '1.5 / 2 + 3 = 3.75pt 以内');
  assert.equal(hit.hits(callout, point, { scale: 2 }, [0, 0]), false, '倍率 2 では 0.75 + 1.5 = 2.25pt');
  const { borderColor, borderWidth, ...bare } = callout;
  assert.equal(hit.hits(bare, point, { scale: 1 }, [0, 0]), false, '枠線が無ければ 3pt');
  assert.equal(hit.hits({ ...callout, readonly: true }, point, { scale: 1 }, [0, 0]), false);
});

test('hits は ×印を対角線の近くだけで当て、箱の中の空いた所は当てない（回したものも。spec-4b-5a 確定事項21）', () => {
  const entry = { kind: 'cross', rect: [0, 0, 40, 40], lineWidth: 2, quads: [[0, 40, 40, 40, 0, 0, 40, 0]], color: '#c00000' };
  const viewport = { scale: 1 };
  assert.equal(hit.hits(entry, [20, 20], viewport, null), true);
  assert.equal(hit.hits(entry, [10, 10.5], viewport, null), true);
  assert.equal(hit.hits(entry, [20, 4], viewport, null), false, '上の辺の中ほどは空いている');
  const turned = { ...entry, angle: 45 };
  assert.equal(hit.hits(turned, [20, 35], viewport, null), true);
  assert.equal(hit.hits(turned, [10, 10], viewport, null), false);
});

test('hits は多角形を辺の近くと、閉じて塗ったものの中で当てる（spec-4b-5a 確定事項24）', () => {
  require('../renderer/polygon-geometry.js');
  const entry = { kind: 'polygon', closed: true, color: '#c00000', lineWidth: 2, paths: [[[0, 0], [100, 0], [100, 100], [0, 100]]], rect: [-1, -1, 101, 101], quads: [[-1, 101, 101, 101, -1, -1, 101, -1]] };
  const viewport = { scale: 1 };
  assert.equal(hit.hits(entry, [50, 2], viewport, null), true);
  assert.equal(hit.hits(entry, [50, 50], viewport, null), false);
  assert.equal(hit.hits({ ...entry, fill: '#ffff00' }, [50, 50], viewport, null), true);
  assert.equal(hit.hits({ ...entry, closed: false }, [2, 50], viewport, null), false, '開いたものは最後の辺が無い');
});
