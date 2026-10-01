'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-rotation.js');
require('../renderer/shape-handles.js');

// 選んだ四角・丸・直線・矢印の枠とつまみの位置（spec-4b-2 確定事項10・11・13・15・24）。

const handles = globalThis.SigK.shapeHandles;

// 回転 0（y を上下に返す）か 90（pdf.js と同じ変換）の viewport。
function viewport({ scale = 1, rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90)
    return { scale, width: h * scale, height: w * scale, convertToViewportPoint: (x, y) => [y * scale, x * scale] };
  return { scale, width: w * scale, height: h * scale, convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale] };
}

const SQUARE = { id: 'sigk-1', kind: 'square', rect: [100, 600, 300, 700], lineWidth: 2 };
const ARROW = { id: 'sigk-2', kind: 'arrow', rect: [98.5, 543.55, 301.5, 601.5], lineWidth: 3, paths: [[[100, 600], [300, 550]]] };

function near(actual, expected, eps = 0.01) {
  assert.ok(Math.abs(actual[0] - expected[0]) <= eps && Math.abs(actual[1] - expected[1]) <= eps, `${actual} ≠ ${expected}`);
}

function byId(shape) {
  return Object.fromEntries(shape.handles.map((handle) => [handle.id, handle]));
}

test('四角・丸は 4 隅と辺の中点のつまみ 8 つと、上の辺から 26px 上の回転のつまみを持つ', () => {
  const shape = handles.handlesOf(SQUARE, viewport());
  const at = byId(shape);
  assert.deepEqual(Object.keys(at), ['x1y1', 'x2y1', 'x1y2', 'x2y2', 'x1', 'x2', 'y1', 'y2', 'rotate']);
  // 箱は表示で 100〜300 × 141.89〜241.89。余白 3px を足した枠の角につまみ
  near(at.x1y2.at, [97, 138.89]);
  near(at.x2y1.at, [303, 244.89]);
  near(at.y2.at, [200, 138.89]);
  near(at.rotate.at, [200, 112.89]);
  near(shape.stem.from, [200, 138.89]);
  near(shape.stem.to, [200, 120.89]);
  assert.equal(shape.frame.type, 'polygon');
  near(shape.frame.points[0], [97, 138.89]);
  assert.deepEqual([at.x1.cursor, at.y1.cursor, at.x2y2.cursor, at.x1y2.cursor], ['ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize']);
  assert.equal(at.rotate.cursor, 'rotate');
});

test('回した四角では枠もつまみも回り、90° なら回転のつまみは右へ出る', () => {
  const shape = handles.handlesOf({ ...SQUARE, angle: 90 }, viewport());
  const at = byId(shape);
  // 中心 (200, 191.89)。回す前の高さの半分 50 ＋ 余白 3 ＋ 26 だけ右
  near(at.rotate.at, [279, 191.89]);
  near(at.y2.at, [253, 191.89]);
  assert.equal(at.x1.cursor, 'ns-resize', '回すと左右の辺のつまみは上下の向き');
});

test('回ったページでも、紙の上の向きに回転のつまみを出す', () => {
  const shape = handles.handlesOf(SQUARE, viewport({ rotation: 90 }));
  const at = byId(shape);
  // 紙の上（y が大きい方）は、90° 回したページの表示では右
  assert.ok(at.rotate.at[0] > at.y2.at[0]);
  near(at.rotate.at, [729, 200]);
});

test('回転のつまみは、上の辺の外が見える範囲から出て、下の辺の外なら収まるときだけ下の辺の外に出す', () => {
  // 紙の上端の近くの四角（表示で y 6.89〜26.89）。1 ページ目の上の余白 18px より上へは見えない
  const top = { ...SQUARE, rect: [100, 815, 300, 835] };
  const room = { left: -10, top: -18, right: 605.28, bottom: 900 };
  const flipped = handles.handlesOf(top, viewport(), room);
  near(byId(flipped).rotate.at, [200, 55.89]);
  near(flipped.stem.from, [200, 29.89]);
  near(flipped.stem.to, [200, 47.89]);
  // 範囲を渡さなければ、今までどおり上の辺の外（はみ出したまま）
  near(byId(handles.handlesOf(top, viewport())).rotate.at, [200, -22.11]);
  // 上に収まれば上のまま
  near(byId(handles.handlesOf(SQUARE, viewport(), room)).rotate.at, [200, 112.89]);
  // 上にも下にも収まらなければ上のまま
  near(byId(handles.handlesOf(top, viewport(), { left: 0, top: 0, right: 595.28, bottom: 40 })).rotate.at, [200, -22.11]);
  // 90° 回した四角が紙の右端の近くにあれば、回転のつまみは右でなく左に出る（中心 x 560。右へ 79px は 605.28 を越える）
  const right = handles.handlesOf({ ...SQUARE, rect: [460, 600, 660, 700], angle: 90 }, viewport(), room);
  near(byId(right).rotate.at, [481, 191.89]);
});

test('小さな図形では、短い向きの辺の中点のつまみを隠す（表示で 24px 未満）', () => {
  const thin = handles.handlesOf({ ...SQUARE, rect: [100, 600, 300, 620] }, viewport());
  assert.deepEqual(thin.handles.map((handle) => handle.id), ['x1y1', 'x2y1', 'x1y2', 'x2y2', 'y1', 'y2', 'rotate']);
  // 倍率を上げれば出る
  assert.equal(handles.handlesOf({ ...SQUARE, rect: [100, 600, 300, 620] }, viewport({ scale: 2 })).handles.length, 9);
});

test('直線・矢印は線に沿った枠と両端のつまみ。ペン・テキスト・表示のみはつまみを出さない', () => {
  const shape = handles.handlesOf(ARROW, viewport());
  assert.equal(shape.frame.type, 'line');
  near(shape.frame.from, [100, 241.89]);
  near(shape.frame.to, [300, 291.89]);
  assert.deepEqual(shape.handles.map((handle) => [handle.id, handle.cursor]), [['start', 'move'], ['end', 'move']]);
  assert.equal(shape.stem, null);
  assert.equal(handles.handlesOf({ ...ARROW, kind: 'ink' }, viewport()), null);
  assert.equal(handles.handlesOf({ kind: 'text', rect: [0, 0, 1, 1] }, viewport()), null);
  assert.equal(handles.handlesOf({ ...SQUARE, readonly: true }, viewport()), null);
});

test('handleAt は 7px 以内で、回転 → 角 → 辺 → 端 の順、同じ順なら近いものを返す', () => {
  const shape = handles.handlesOf(SQUARE, viewport());
  assert.equal(handles.handleAt(shape.handles, [98, 140]).id, 'x1y2');
  assert.equal(handles.handleAt(shape.handles, [200, 118]).id, 'rotate');
  assert.equal(handles.handleAt(shape.handles, [150, 160]), null);
  // 重なったら優先の高い方
  const crowd = [{ id: 'y2', kind: 'edge', at: [10, 10] }, { id: 'x1y2', kind: 'corner', at: [14, 10] }, { id: 'rotate', kind: 'rotate', at: [16, 10] }];
  assert.equal(handles.handleAt(crowd, [11, 10]).id, 'rotate');
  assert.equal(handles.handleAt(crowd.slice(0, 2), [11, 10]).id, 'x1y2');
});

test('resizeCursorOf は表示の向きに近い 4 つの大きさ変えのカーソル', () => {
  assert.equal(handles.resizeCursorOf([1, 0]), 'ew-resize');
  assert.equal(handles.resizeCursorOf([-1, 0]), 'ew-resize');
  assert.equal(handles.resizeCursorOf([1, 1]), 'nwse-resize');
  assert.equal(handles.resizeCursorOf([0, -1]), 'ns-resize');
  assert.equal(handles.resizeCursorOf([1, -1]), 'nesw-resize');
  assert.equal(handles.resizeCursorOf([1, 0.2]), 'ew-resize');
});
