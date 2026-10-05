'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-resize.js');

// つまみを引いたときの新しい形（spec-4b-2 確定事項16〜19）。

const SigK = globalThis.SigK;
const resize = SigK.shapeResize;
const rot = SigK.shapeRotation;

const SQUARE = { kind: 'square', rect: [100, 600, 300, 700], lineWidth: 2 };

function near(actual, expected, eps = 0.011) {
  assert.ok(actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= eps), `${actual} ≠ ${expected}`);
}

function viewport({ rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90)
    return { scale: 1, convertToViewportPoint: (x, y) => [y, x], convertToPdfPoint: (px, py) => [py, px] };
  return { scale: 1, convertToViewportPoint: (x, y) => [x, h - y], convertToPdfPoint: (px, py) => [px, h - py] };
}

test('角のつまみは掴んだ角だけを動かし、反対の角は動かない', () => {
  const patch = resize.resized(SQUARE, 'x2y2', [300, 700], [340, 720]);
  assert.deepEqual(patch.rect, [100, 600, 340, 720]);
  assert.deepEqual(patch.quads, [SigK.freeTextGeometry.quadOfRect([100, 600, 340, 720])]);
  assert.deepEqual(resize.resized(SQUARE, 'x1y1', [100, 600], [80, 650]).rect, [80, 650, 300, 700]);
});

test('辺のつまみはその向きだけを変える', () => {
  assert.deepEqual(resize.resized(SQUARE, 'x2', [300, 650], [360, 690]).rect, [100, 600, 360, 700]);
  assert.deepEqual(resize.resized(SQUARE, 'y2', [200, 700], [260, 740]).rect, [100, 600, 300, 740]);
});

test('辺は最小 1pt で、反対側を越えて裏返さない', () => {
  assert.deepEqual(resize.resized(SQUARE, 'x2', [300, 650], [50, 650]).rect, [100, 600, 101, 700]);
  assert.deepEqual(resize.resized(SQUARE, 'y1', [200, 600], [200, 900]).rect, [100, 699, 300, 700]);
});

test('角＋Shift は押したときの縦と横の比を保つ（大きく変わった向きに合わせる）', () => {
  // 200×100 の箱。右上の角を右へ 100 だけ引くと、横 300 に合わせて縦 150
  assert.deepEqual(resize.resized(SQUARE, 'x2y2', [300, 700], [400, 705], { shift: true }).rect, [100, 600, 400, 750]);
  // 左下の角は、右上の角を据え置いて広げる
  assert.deepEqual(resize.resized(SQUARE, 'x1y1', [100, 600], [100, 500], { shift: true }).rect, [-100, 500, 300, 700]);
  // 辺＋Shift は何もしない
  assert.deepEqual(resize.resized(SQUARE, 'x2', [300, 650], [360, 690], { shift: true }).rect, [100, 600, 360, 700]);
});

test('回した図形でも、掴んだつまみの反対側は紙の上で動かない', () => {
  const turned = { ...SQUARE, angle: 30 };
  const corners = rot.cornersOf(turned.rect, 30);
  // UL・UR・LL・LR の順。右上の角（x2y2 = UR）を引いても、左下の角（x1y1 = LL）は同じ所に残る
  const from = corners[1];
  const to = [from[0] + 25, from[1] + 10];
  const patch = resize.resized(turned, 'x2y2', from, to);
  near(rot.cornersOf(patch.rect, 30)[2], corners[2]);
  assert.deepEqual(patch.quads, [rot.quadOf(patch.rect, 30)]);
  // 右の辺（x2）を引いても、左の辺の 2 つの角は動かない
  const edge = resize.resized(turned, 'x2', from, to);
  near(rot.cornersOf(edge.rect, 30)[0], corners[0]);
  near(rot.cornersOf(edge.rect, 30)[2], corners[2]);
});

test('直線・矢印の端は動きの分だけ動き、Shift なら表示で横か縦にだけ動く（等しいときは横）', () => {
  const line = { kind: 'line', lineWidth: 2, rect: [99, 599, 201, 701], paths: [[[100, 600], [200, 700]]] };
  const vp = viewport();
  // 表示の press (200, 141.89)（＝終点）から右へ 30・下へ 10
  const free = resize.endpointMoved(line, 'end', [200, 141.89], [230, 151.89], vp);
  near(free.paths[0][1], [230, 690]);
  assert.deepEqual(free.paths[0][0], [100, 600]);
  const horizontal = resize.endpointMoved(line, 'end', [200, 141.89], [230, 151.89], vp, { shift: true });
  near(horizontal.paths[0][1], [230, 700]);
  const vertical = resize.endpointMoved(line, 'end', [200, 141.89], [205, 181.89], vp, { shift: true });
  near(vertical.paths[0][1], [200, 660]);
  const tie = resize.endpointMoved(line, 'start', [100, 241.89], [110, 251.89], vp, { shift: true });
  near(tie.paths[0][0], [110, 600]);
  // rect は描く点の外接に線幅の半分
  near(free.rect, SigK.shapeGeometry.rectOfShape({ kind: 'line', paths: free.paths, lineWidth: 2 }).rect);
});

test('回ったページでも、Shift の横・縦は表示の向き', () => {
  const line = { kind: 'line', lineWidth: 2, rect: [99, 599, 201, 701], paths: [[[100, 600], [200, 700]]] };
  // 90° のページでは表示の横（x）が紙の y
  const moved = resize.endpointMoved(line, 'end', [700, 200], [740, 205], viewport({ rotation: 90 }), { shift: true });
  near(moved.paths[0][1], [200, 740]);
});

test('2 つの端が 0.5pt より近づく位置へは動かさない（null）', () => {
  const line = { kind: 'arrow', lineWidth: 2, rect: [99, 599, 201, 701], paths: [[[100, 600], [200, 700]]] };
  assert.equal(resize.endpointMoved(line, 'end', [200, 141.89], [100.2, 241.89], viewport()), null);
});

test('回転は中心から見た向きの変化ぶんで、Shift なら 15° の角度そのものにそろう', () => {
  const center = [200, 191.89];
  // 真上から真右へ: 時計回りに 90°
  const quarter = resize.rotatedBy(SQUARE, [200, 100], [300, 191.89], center);
  assert.equal(quarter.angle, 90);
  assert.deepEqual(quarter.rect, SQUARE.rect);
  assert.deepEqual(quarter.quads, [rot.quadOf(SQUARE.rect, 90)]);
  // 30° 回したものを少し戻す（反時計回り 37° ほど）→ 整数に丸めて 360 の余り
  const back = resize.rotatedBy({ ...SQUARE, angle: 30 }, [300, 191.89], [300, 116.53], center);
  assert.equal(back.angle, 353);
  assert.equal(resize.rotatedBy({ ...SQUARE, angle: 30 }, [300, 191.89], [300, 116.53], center, { shift: true }).angle, 0);
  assert.equal(resize.rotatedBy(SQUARE, [200, 100], [262, 120], center, { shift: true }).angle, 45);
});
