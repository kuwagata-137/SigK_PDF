'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-layout.js');
require('../renderer/shape-rotation.js');
require('../renderer/callout-shape.js');

// 吹き出しの輪郭の純粋層（spec-4b-4b 確定事項E・D4・C4）。

const { SigK } = globalThis;
const callout = SigK.calloutShape;

const BOX = [100, 600, 220, 644];

const near = (a, b, tolerance = 1e-9) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);

test('sideOf は中心から先への (dx/幅, dy/高さ) の大きい方の辺（等しければ上下）を選ぶ（紙の座標で y が上）', () => {
  assert.equal(callout.sideOf(BOX, [130, 560]), 'bottom');
  assert.equal(callout.sideOf(BOX, [130, 700]), 'top');
  assert.equal(callout.sideOf(BOX, [300, 630]), 'right');
  assert.equal(callout.sideOf(BOX, [20, 610]), 'left');
  // dx/幅 = 60/120 = 0.5、dy/高さ = 22/44 = 0.5 で等しいときは上下。
  assert.equal(callout.sideOf(BOX, [220, 644]), 'top');
});

test('tailOf は先が箱の中なら null、外なら出る辺と付け根（角丸と半幅の内側に収める）を返す', () => {
  assert.equal(callout.tailOf(BOX, [150, 620], 12), null);
  assert.equal(callout.tailOf(BOX, [100, 600], 12), null, '辺の上も中とみなす');
  const tail = callout.tailOf(BOX, [80, 540], 12);
  assert.equal(tail.side, 'bottom');
  // 半幅 max(10, 12×0.6) = 10、角丸 min(10, 60, 22) = 10。付け根の中心は 100 + 10 + 10 = 120 に収める。
  assert.equal(tail.half, 10);
  assert.equal(tail.radius, 10);
  assert.deepEqual(tail.base, [120, 600]);
  const right = callout.tailOf(BOX, [400, 900], 24);
  assert.equal(right.side, 'top');
  // 半幅 max(10, 24×0.6) = 14.4。中心は 220 − 10 − 14.4 = 195.6 に収める。
  assert.ok(near(right.base, [195.6, 644], 1e-9));
});

test('角丸は先に決め（min(10, 幅/2, 高さ/2)）、付け根の半幅を辺の長さ/2−角丸で抑える。半幅が 3pt に満たないときだけ角丸を減らす', () => {
  // 12pt・1 行の吹き出し（箱 45.5×24.5）の左の辺: 角丸 10、半幅は min(10, 12.25 − 10) = 2.25 < 3 なので、角丸を 12.25 − 3 = 9.25 にして半幅 3。
  const line = [100, 600, 145.5, 624.5];
  const side = callout.tailOf(line, [60, 612], 12);
  assert.equal(side.side, 'left');
  assert.equal(side.half, 3);
  assert.equal(side.radius, 9.25);
  // 同じ箱の下の辺は、角丸 10・半幅 10 のまま（しっぽを横へ引いても角の形はほとんど変わらない）。
  const below = callout.tailOf(line, [110, 560], 12);
  assert.deepEqual([below.half, below.radius], [10, 10]);
  // 8pt・1 字の小さい吹き出しの下の辺（長さ 16）: 角丸 8、半幅 min(10, 0) < 3 なので角丸 5・半幅 3。
  const tiny = callout.tailOf([100, 600, 116, 617], [108, 560], 8);
  assert.deepEqual([tiny.half, tiny.radius, ...tiny.base], [3, 5, 108, 600]);
});

test('outlineOf は 1 本の輪郭（上の辺の左から時計回り）で、しっぽの辺に付け根→先→付け根を挟み、線の太さの半分だけ内へ寄せる', () => {
  const segments = callout.outlineOf(BOX, [80, 540], { fontSize: 12, inset: 0.75 });
  assert.equal(segments[0].op, 'M');
  assert.equal(segments.at(-1).op, 'Z');
  // 内へ寄せた箱 [100.75, 600.75, 219.25, 643.25] の上の辺の左（角丸 10 の分だけ右）。
  assert.ok(near(segments[0].points[0], [110.75, 643.25]));
  const lines = segments.filter((segment) => segment.op === 'L').map((segment) => segment.points[0]);
  const tipAt = lines.findIndex((point) => near(point, [80, 540]));
  assert.ok(tipAt > 0, '先を通る');
  // 下の辺は右から左へ進むので、付け根の右 → 先 → 付け根の左。
  assert.ok(near(lines[tipAt - 1], [120.75 + 10, 600.75]));
  assert.ok(near(lines[tipAt + 1], [120.75 - 10, 600.75]));
  assert.equal(segments.filter((segment) => segment.op === 'C').length, 4, '角は 4 つのベジェ');
  // 先が箱の中ならしっぽの点は無い。
  const plain = callout.outlineOf(BOX, [150, 620], { fontSize: 12, inset: 0 });
  assert.equal(plain.filter((segment) => segment.op === 'L').length, 4);
});

test('localTipOf は回した吹き出しの先を、箱の中心のまわりに回す前の座標へ戻す', () => {
  const entry = { rect: BOX, angle: 30, callout: { tip: SigK.shapeRotation.rotatePoint([80, 540], [160, 622], 30) } };
  assert.ok(near(callout.localTipOf(entry), [80, 540], 1e-9));
  assert.deepEqual(callout.localTipOf({ rect: BOX, callout: { tip: [80, 540] } }), [80, 540]);
});

test('defaultTipOf は置いた向きで、箱の左上から右へ min(幅×0.25, 40)、下へ 高さ＋大きさ×1.6', () => {
  assert.deepEqual(callout.defaultTipOf([100, 644], { width: 120, height: 44 }, 0, 12), [130, 580.8]);
  assert.deepEqual(callout.defaultTipOf([100, 644], { width: 200, height: 44 }, 0, 12), [140, 580.8]);
  // 置いた向き 90°: 表示の右は紙の +y、下は紙の +x。
  assert.deepEqual(callout.defaultTipOf([100, 600], { width: 120, height: 44 }, 90, 12), [163.2, 630]);
});

test('hitsTail は回す前の座標で、しっぽの三角（付け根の 2 点と先）の中の点に当たる', () => {
  const entry = { rect: BOX, fontSize: 12, callout: { tip: [80, 540] } };
  assert.equal(callout.hitsTail(entry, [110, 580]), true);
  assert.equal(callout.hitsTail(entry, [150, 580]), false);
  assert.equal(callout.hitsTail({ ...entry, callout: { tip: [150, 620] } }, [150, 620]), false, 'しっぽが無ければ当たらない');
});

test('extentOf は箱と先を囲む範囲（回す前の座標）', () => {
  assert.deepEqual(callout.extentOf(BOX, [80, 540]), [80, 540, 220, 644]);
  assert.deepEqual(callout.extentOf(BOX, [150, 620]), BOX);
});
