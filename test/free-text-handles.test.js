'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-rotation.js');
require('../renderer/shape-handles.js');
require('../renderer/free-text-geometry.js');
require('../renderer/free-text-wrap.js');
require('../renderer/free-text-layout.js');
require('../renderer/free-text-handles.js');
require('../renderer/free-text-turn.js');

// テキストの枠と左右の幅のつまみ（spec-4b-4a 確定事項F1・F2）。

const textHandles = globalThis.SigK.freeTextHandles;

function viewport({ scale = 1, rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90)
    return { scale, rotation, convertToViewportPoint: (x, y) => [y * scale, x * scale] };
  return { scale, rotation, convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale] };
}

function near(actual, expected, eps = 0.01) {
  assert.ok(Math.abs(actual[0] - expected[0]) <= eps && Math.abs(actual[1] - expected[1]) <= eps, `${actual} ≠ ${expected}`);
}

const TEXT = { id: 'sigk-1', kind: 'text', rect: [100, 671, 224, 700], rotation: 0, fontSize: 10, text: 'あいう' };

test('枠は箱に 3px の余白を足した四角で、つまみは左右の辺の中点の外。カーソルは文字の向きに沿った左右', () => {
  const shape = textHandles.handlesOf(TEXT, viewport({ scale: 2 }));
  const top = (841.89 - 700) * 2;
  const bottom = (841.89 - 671) * 2;
  assert.equal(shape.frame.type, 'polygon');
  near(shape.frame.points[0], [200 - 3, top - 3]);
  near(shape.frame.points[2], [448 + 3, bottom + 3]);
  // 回転のつまみの軸は上の辺の外（spec-4b-4b 確定事項C1）。
  near(shape.stem.from, [324, top - 3]);
  const [left, right] = shape.handles;
  near(left.at, [200 - 3, (top + bottom) / 2]);
  near(right.at, [448 + 3, (top + bottom) / 2]);
  assert.equal(left.cursor, 'ew-resize');
});

test('置いたときに回した表示のテキストは、表示の右の向きでつまみを置き、カーソルも向きに合わせる', () => {
  // 置いたときの表示が 90°（紙では y の向きに字が並ぶ）を、回していない表示で見る。
  const turned = { ...TEXT, rotation: 90, rect: [100, 600, 129, 724] };
  const shape = textHandles.handlesOf(turned, viewport());
  const [left, right] = shape.handles;
  // 表示の右は紙の +y で、回していない表示では上向き。
  assert.ok(left.at[1] > right.at[1]);
  assert.equal(left.cursor, 'ns-resize');
  const box = textHandles.boxOf(turned, viewport());
  near(box.right, [0, -1]);
  near(box.down, [1, 0]);
});

test('表示のみ・テキストでないものは null', () => {
  assert.equal(textHandles.handlesOf({ ...TEXT, readonly: true }, viewport()), null);
  assert.equal(textHandles.handlesOf({ ...TEXT, kind: 'square' }, viewport()), null);
});

// ---- 回したテキスト（spec-4b-4b 確定事項C1・C3） ----

test('回したテキストは、枠とつまみを回した箱に置き、上の辺の外に回転のつまみを出す', () => {
  const turned = { ...TEXT, angle: 90 };
  const shape = textHandles.handlesOf(turned, viewport());
  // 中心 (162, 685.5) のまわりに時計回り 90°。表示の右は下向き、下は左向き。
  const box = textHandles.boxOf(turned, viewport());
  near(box.right, [0, 1]);
  near(box.down, [-1, 0]);
  const [left, right, rotate] = shape.handles;
  assert.deepEqual([left.id, right.id, rotate.id, rotate.kind], ['left', 'right', 'rotate', 'rotate']);
  assert.ok(left.at[1] < right.at[1]);
  assert.equal(left.cursor, 'ns-resize');
  // 回転のつまみは上の辺（回した左上と右上の辺。表示では右側の縦の辺）の中点から外へ、余白＋26px。
  const center = [162, 841.89 - 685.5];
  near(rotate.at, [center[0] + 14.5 + 3 + 26, center[1]]);
  near(shape.stem.from, [center[0] + 14.5 + 3, center[1]]);
  near(shape.stem.to, [center[0] + 14.5 + 3 + 26 - 8, center[1]]);
});

test('回転のつまみが見える範囲の外に出るなら、下の辺の外に出す', () => {
  const room = { left: 0, top: 150, right: 595, bottom: 842 };
  const shape = textHandles.handlesOf(TEXT, viewport(), room);
  const rotate = shape.handles.find((handle) => handle.id === 'rotate');
  // 上の辺の外（y ≒ 141.89 − 29）は範囲の外なので、下の辺の外（y ≒ 170.89 ＋ 29）。
  near(rotate.at, [162, 841.89 - 671 + 3 + 26]);
});
