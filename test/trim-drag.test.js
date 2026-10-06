'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/trim-drag.js');
const drag = globalThis.SigK.trimDrag;

// トリミングの枠を画面の px で動かす純関数（spec-4b-6a 確定事項12・13）。枠は { x1, y1, x2, y2 }（ページの左上からの px、y は下向き）。

const BOUNDS = { width: 400, height: 600 };

// pdf.js の PageViewport と同じ式（scale・回転・原点のずれた viewBox）。test/harness.js の FakeViewport と同じ。
function viewportOf(viewBox, rotation, scale = 1) {
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotation];
  const sideways = a === 0;
  const offsetX = (sideways ? Math.abs(centerY - viewBox[1]) : Math.abs(centerX - viewBox[0])) * scale;
  const offsetY = (sideways ? Math.abs(centerX - viewBox[0]) : Math.abs(centerY - viewBox[1])) * scale;
  const t = [a * scale, b * scale, c * scale, d * scale, offsetX - a * scale * centerX - c * scale * centerY, offsetY - b * scale * centerX - d * scale * centerY];
  return {
    scale,
    width: (sideways ? viewBox[3] - viewBox[1] : viewBox[2] - viewBox[0]) * scale,
    height: (sideways ? viewBox[2] - viewBox[0] : viewBox[3] - viewBox[1]) * scale,
    convertToViewportPoint: (x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]],
    convertToPdfPoint: (px, py) => {
      const det = t[0] * t[3] - t[1] * t[2];
      return [(t[3] * (px - t[4]) - t[2] * (py - t[5])) / det, (-t[1] * (px - t[4]) + t[0] * (py - t[5])) / det];
    },
  };
}

test('rectFrom は押した点と今の点から枠を作り、どちら向きに引いても並べ直し、見える範囲に収める', () => {
  assert.deepEqual(drag.rectFrom([100, 200], [300, 450], BOUNDS), { x1: 100, y1: 200, x2: 300, y2: 450 });
  assert.deepEqual(drag.rectFrom([300, 450], [100, 200], BOUNDS), { x1: 100, y1: 200, x2: 300, y2: 450 });
  assert.deepEqual(drag.rectFrom([50, 50], [-80, 900], BOUNDS), { x1: 0, y1: 50, x2: 50, y2: 600 });
});

test('rectFrom は下限に足りなければ引いた向きへ広げ、端に当たれば逆へ寄せる', () => {
  assert.deepEqual(drag.rectFrom([100, 100], [104, 105], BOUNDS, 20), { x1: 100, y1: 100, x2: 120, y2: 120 });
  assert.deepEqual(drag.rectFrom([100, 100], [96, 95], BOUNDS, 20), { x1: 80, y1: 80, x2: 100, y2: 100 });
  assert.deepEqual(drag.rectFrom([395, 595], [399, 599], BOUNDS, 20), { x1: 380, y1: 580, x2: 400, y2: 600 });
  // 下限が見える範囲より大きければ、見える範囲いっぱいまで。
  assert.deepEqual(drag.rectFrom([1, 1], [2, 2], { width: 8, height: 6 }, 20), { x1: 0, y1: 0, x2: 8, y2: 6 });
});

test('handlesOf は 8 点のつまみの中心を左上から時計回りに返す', () => {
  const points = drag.handlesOf({ x1: 10, y1: 20, x2: 110, y2: 220 });
  assert.deepEqual(points.map((at) => at.name), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.deepEqual(points.map((at) => [at.x, at.y]), [[10, 20], [60, 20], [110, 20], [110, 120], [110, 220], [60, 220], [10, 220], [10, 120]]);
});

test('hitOf はつまみを枠の中より先に見て、外なら null を返す', () => {
  const rect = { x1: 100, y1: 100, x2: 300, y2: 400 };
  assert.equal(drag.hitOf(rect, [100, 100]), 'nw');
  assert.equal(drag.hitOf(rect, [100 + drag.REACH, 100 - drag.REACH]), 'nw');
  assert.equal(drag.hitOf(rect, [200, 404]), 's');
  assert.equal(drag.hitOf(rect, [296, 250]), 'e');
  assert.equal(drag.hitOf(rect, [200, 250]), 'inside');
  assert.equal(drag.hitOf(rect, [100 + drag.REACH + 1, 100 - drag.REACH - 1]), null);
  assert.equal(drag.hitOf(rect, [350, 250]), null);
  assert.equal(drag.hitOf(null, [200, 250]), null);
});

test('dragRect は中を掴むと大きさを保って動かし、見える範囲の端で止める', () => {
  const origin = { x1: 100, y1: 100, x2: 300, y2: 400 };
  assert.deepEqual(drag.dragRect(origin, 'inside', [30, -40], BOUNDS), { x1: 130, y1: 60, x2: 330, y2: 360 });
  assert.deepEqual(drag.dragRect(origin, 'inside', [500, -500], BOUNDS), { x1: 200, y1: 0, x2: 400, y2: 300 });
});

test('dragRect はつまみの辺だけを動かし、反対の辺から下限より近づけず、見える範囲を越えさせない', () => {
  const origin = { x1: 100, y1: 100, x2: 300, y2: 400 };
  assert.deepEqual(drag.dragRect(origin, 'se', [50, 60], BOUNDS, 20), { x1: 100, y1: 100, x2: 350, y2: 460 });
  assert.deepEqual(drag.dragRect(origin, 'n', [0, -300], BOUNDS, 20), { x1: 100, y1: 0, x2: 300, y2: 400 });
  assert.deepEqual(drag.dragRect(origin, 'w', [500, 0], BOUNDS, 20), { x1: 280, y1: 100, x2: 300, y2: 400 });
  assert.deepEqual(drag.dragRect(origin, 'e', [-500, 0], BOUNDS, 20), { x1: 100, y1: 100, x2: 120, y2: 400 });
  assert.deepEqual(drag.dragRect(origin, 'sw', [-200, 900], BOUNDS, 20), { x1: 0, y1: 100, x2: 300, y2: 600 });
});

test('cursorOf はつまみの向きと中の移動のカーソルを返す', () => {
  assert.deepEqual(['nw', 'se', 'ne', 'sw', 'n', 's', 'e', 'w', 'inside', null].map(drag.cursorOf),
    ['nwse', 'nwse', 'nesw', 'nesw', 'ns', 'ns', 'ew', 'ew', 'move', null]);
});

test('rectOf と boxOf は紙の座標と px を行き来し、回したページ・原点のずれた紙でも元に戻る', () => {
  const box = [150, 250, 350, 500];
  for (const rotation of [0, 90, 180, 270]) {
    const viewport = viewportOf([100, 200, 500, 700], rotation, 1.5);
    const rect = drag.rectOf(box, viewport);
    assert.ok(rect.x1 < rect.x2 && rect.y1 < rect.y2, `${rotation}°`);
    assert.ok(rect.x1 >= 0 && rect.y1 >= 0 && rect.x2 <= viewport.width + 1e-9 && rect.y2 <= viewport.height + 1e-9, `${rotation}°`);
    assert.deepEqual(drag.boxOf(rect, viewport), box, `${rotation}°`);
  }
  // 90° のページでは、紙の横幅が画面の縦になる。
  const turned = drag.rectOf(box, viewportOf([100, 200, 500, 700], 90));
  assert.equal(turned.y2 - turned.y1, 200);
  assert.equal(turned.x2 - turned.x1, 250);
});

test('minOf は 10pt を倍率と UserUnit で px にする', () => {
  assert.equal(drag.minOf({ scale: 1.5 }), 15);
  assert.equal(drag.minOf({ scale: 2, userUnit: 3 }), 60);
});
