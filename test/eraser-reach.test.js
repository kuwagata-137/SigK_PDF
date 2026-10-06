'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-style.js');
require('../renderer/shape-outline.js');
require('../renderer/cloud-geometry.js');
require('../renderer/cross-geometry.js');
require('../renderer/eraser-reach.js');

// 図形が消しゴムでなぞった跡に触れたか（spec-4b-5b 確定事項20。決定62 ①②）。半径は 8pt として見る。

const { flatten, segmentDistance, touches } = globalThis.SigK.eraserReach;
const R = 8;

const square = (fields = {}) => ({ kind: 'square', color: '#c00000', opacity: 1, lineWidth: 2, rect: [100, 100, 300, 200], ...fields });

test('segmentDistance は交われば 0、離れていれば端からの近い方', () => {
  assert.equal(segmentDistance([0, 0], [10, 10], [0, 10], [10, 0]), 0);
  assert.equal(segmentDistance([0, 0], [10, 0], [0, 5], [10, 5]), 5);
  assert.equal(segmentDistance([0, 0], [10, 0], [15, 0], [20, 0]), 5);
});

test('flatten は M・L・C・Z を折れ線にし、ベジェは CURVE_STEPS に分ける', () => {
  const lines = flatten([{ op: 'M', points: [[0, 0]] }, { op: 'L', points: [[10, 0]] }, { op: 'C', points: [[10, 5], [5, 10], [0, 10]] }, { op: 'Z', points: [] }]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0][0], [0, 0]);
  assert.deepEqual(lines[0].at(-2), [0, 10]);
  assert.deepEqual(lines[0].at(-1), [0, 0]);
  assert.equal(lines[0].length, 2 + globalThis.SigK.eraserReach.CURVE_STEPS + 1);
});

test('塗っていない四角は線に触れたときだけで、内側をなぞっても触れない（決定62 ②）', () => {
  // 線の中心は箱の内側に 1pt（描く太さ 2 の半分）。上の辺 y=199 から 8＋1 以内なら触れる
  assert.equal(touches(square(), [[150, 215], [160, 208]], R), true);
  assert.equal(touches(square(), [[150, 215], [160, 208.5]], R), false);
  assert.equal(touches(square(), [[150, 150], [250, 150]], R), false, '内側だけ');
  // 外から内へ横切れば線に触れる
  assert.equal(touches(square(), [[50, 150], [150, 150]], R), true);
});

test('塗った四角は内側でも触れ、線なしの塗りは箱の縁と中で見る', () => {
  assert.equal(touches(square({ fill: '#ffff00' }), [[150, 150], [250, 150]], R), true);
  assert.equal(touches(square({ color: null, fill: '#ffff00' }), [[200, 150]], R), true);
  assert.equal(touches(square({ color: null, fill: '#ffff00' }), [[200, 209]], R), false, '縁から 9pt');
  assert.equal(touches(square({ color: null, fill: '#ffff00' }), [[200, 207]], R), true);
});

test('丸は楕円の線で見て、箱の角は線ではない', () => {
  const circle = square({ kind: 'circle' });
  // 上の端は (200, 199)。8＋1 以内なら触れる
  assert.equal(touches(circle, [[200, 207.9]], R), true);
  assert.equal(touches(circle, [[200, 208.5]], R), false);
  // 箱の左上の角の近くは、四角なら線、丸なら線の外
  assert.equal(touches(square(), [[104, 196]], R), true);
  assert.equal(touches(circle, [[104, 196]], R), false);
});

test('回した四角は回した線で見る', () => {
  // 45° 回した 100×100 の箱（中心 200,150）。回す前の右上の角は (250,200)。回すと角は中心の真上 (200, 150+70.7) あたりへ来る。
  const turned = square({ rect: [150, 100, 250, 200], angle: 45 });
  assert.equal(touches(turned, [[200, 150 + 70.71 + 6]], R), true);
  assert.equal(touches(turned, [[250 - 2, 200 - 2]], R), false, '回す前の角の近くは、回したあとは中（塗りなし）');
});

test('直線・矢印の先・塗った三角の中・×印・多角形', () => {
  const line = { kind: 'line', color: '#c00000', opacity: 1, lineWidth: 2, rect: [0, 0, 0, 0], paths: [[[0, 0], [100, 0]]] };
  assert.equal(touches(line, [[50, 9]], R), true);
  assert.equal(touches(line, [[50, 9.5]], R), false);
  const arrow = { ...line, kind: 'arrow', lineWidth: 4 };
  // 塗った三角は 太さ×4＝16pt、開き 180°÷7。線を引かずに塗るだけなので、輪郭から R 以内で触れる（(90, 13.5) は 7.83pt、(90, 14) は 8.28pt）
  assert.equal(touches(arrow, [[90, 13.5]], R), true);
  assert.equal(touches(arrow, [[90, 14]], R), false);
  assert.equal(touches(arrow, [[97, 0]], 0.1), true, '三角の中');
  const cross = { kind: 'cross', color: '#c00000', opacity: 1, lineWidth: 2, rect: [0, 0, 100, 100] };
  assert.equal(touches(cross, [[50, 50]], 1), true);
  assert.equal(touches(cross, [[50, 2]], 1), false);
  const polygon = { kind: 'polygon', closed: true, color: '#c00000', opacity: 1, lineWidth: 2, rect: [0, 0, 100, 100], paths: [[[0, 0], [100, 0], [50, 100]]] };
  assert.equal(touches(polygon, [[50, 40]], R), false, '塗っていない多角形の中');
  assert.equal(touches({ ...polygon, fill: '#ffff00' }, [[50, 40]], R), true);
  assert.equal(touches({ ...polygon, closed: false }, [[50, 40]], R), false);
  // 閉じる辺 (50,100)→(0,0) は、閉じた多角形にだけある
  assert.equal(touches(polygon, [[25, 50]], R), true);
  assert.equal(touches({ ...polygon, closed: false }, [[25, 50]], R), false);
  assert.equal(touches({ ...polygon, closed: false }, [[75, 50]], R), true, '辺 (100,0)→(50,100) の上');
});

test('雲形は雲の線で見る', () => {
  const cloudy = square({ lineStyle: 'cloudy' });
  assert.equal(touches(cloudy, [[200, 150]], R), false);
  assert.equal(touches(cloudy, [[200, 196]], R), true);
});

test('ペン・テキスト・ハイライト・ノート・表示のみ・跡が無いものは触れない', () => {
  for (const kind of ['ink', 'text', 'highlight', 'underline', 'strikeout', 'note', 'other'])
    assert.equal(touches({ kind, color: '#c00000', rect: [100, 100, 300, 200], paths: [[[100, 150], [300, 150]]] }, [[200, 150]], R), false, kind);
  assert.equal(touches(square({ readonly: true }), [[150, 199]], R), false);
  assert.equal(touches(square(), [], R), false);
});

test('塗った三角の矢印は、軸を底の中点までの太さの線、三角を太さ 0 の輪郭と中で見る（点検 5）', () => {
  const arrow = { kind: 'arrow', color: '#c00000', opacity: 1, lineWidth: 40, rect: [80, 450, 320, 550], paths: [[[100, 500], [300, 500]]] };
  assert.equal(touches(arrow, [[318, 500]], 6), false, '先から 18pt 外は、描いていない所');
  assert.equal(touches(arrow, [[305, 500]], 6), true, '先から 5pt');
  assert.equal(touches(arrow, [[290, 500]], 6), true, '三角の中');
  // 三角は長さ 160pt で底の中点は x≈155.8。軸はそこまでを太さ 40 で見る
  assert.equal(touches(arrow, [[120, 525]], 6), true, '軸の縁（中心から 20）から 5pt');
  assert.equal(touches(arrow, [[120, 527]], 6), false);
  // 開いた矢じりは今までどおり、翼と先も線の太さで見る
  assert.equal(touches({ ...arrow, head: 'open' }, [[318, 500]], 6), true);
});
