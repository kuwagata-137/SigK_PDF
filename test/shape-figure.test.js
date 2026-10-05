'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/cross-geometry.js');
require('../renderer/shape-style.js');
require('../renderer/shape-outline.js');
require('../renderer/cloud-geometry.js');
require('../renderer/shape-figure.js');

// 図形・ペン 1 つを表示の座標で描く部品（spec-4-3 確定事項8・11・25、spec-4b-1b 確定事項29〜33・40〜42）。

const figure = globalThis.SigK.shapeFigure;
const outline = globalThis.SigK.shapeOutline;
const cloudGeometry = globalThis.SigK.cloudGeometry;
const geo = globalThis.SigK.shapeGeometry;

// 回転 0・倍率 scale の viewport（A4）。回転 90 は pdf.js と同じ変換。
function viewport({ scale = 1, rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90)
    return { width: h * scale, height: w * scale, scale, rotation, convertToViewportPoint: (x, y) => [y * scale, x * scale] };
  return { width: w * scale, height: h * scale, scale, rotation, convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale] };
}

const SQUARE = { id: 'sigk-1', src: 0, kind: 'square', color: '#c00000', opacity: 1, lineWidth: 2, rect: [100, 600, 300, 700], quads: [[100, 700, 300, 700, 100, 600, 300, 600]] };
const ARROW = { id: 'sigk-2', src: 0, kind: 'arrow', head: 'open', color: '#4472c4', opacity: 1, lineWidth: 3, rect: [98.5, 548.5, 301.5, 601.5], quads: [[98.5, 601.5, 301.5, 601.5, 98.5, 548.5, 301.5, 548.5]], paths: [[[100, 600], [300, 550]]] };

function r2(value) {
  return Math.round(value * 100) / 100;
}

// 部品の点列を小数 2 桁に丸めて比べる形にする。
function pointsOf(segments) {
  return segments.map(({ op, points }) => [op, ...points.map((point) => point.map(r2))]);
}

// 紙の座標の点列を viewport で直したもの（期待値）。
function viewOf(segments, vp) {
  return pointsOf(segments.map(({ op, points }) => ({ op, points: points.map(([x, y]) => vp.convertToViewportPoint(x, y)) })));
}

test('viewBoxOf は紙の座標の箱を表示の px の箱にする（回転しても min/max で組む）', () => {
  assert.deepEqual(figure.viewBoxOf([100, 600, 300, 700], viewport({ scale: 2 })), { x: 200, y: 283.78, width: 400, height: 200 });
  assert.deepEqual(figure.viewBoxOf([100, 600, 300, 700], viewport({ rotation: 90 })), { x: 600, y: 100, width: 100, height: 200 });
});

test('実線の四角は描く線幅の半分だけ内側の rect で、描く線幅は短い辺の半分で頭打ちにする（確定事項30）', () => {
  const plain = figure.figureOf(SQUARE, viewport({ scale: 2 }));
  assert.deepEqual([plain.stroke, plain.fill, plain.width, plain.cap, plain.join], ['#c00000', null, 4, 'butt', 'miter']);
  assert.deepEqual(plain.parts, [{ type: 'rect', x: 202, y: 285.78, width: 396, height: 196, fillable: true }]);
  // 30×20 の箱に 40pt: 描く線幅は 10pt で、線が箱をすべて覆う。
  const thick = figure.figureOf({ ...SQUARE, lineWidth: 40, rect: [100, 600, 130, 620] }, viewport());
  assert.equal(thick.width, 10);
  assert.deepEqual(thick.parts, [{ type: 'rect', x: 105, y: 226.89, width: 20, height: 10, fillable: true }]);
});

test('塗りのある四角は fill を持ち、線なしは箱そのものを塗る', () => {
  const filled = figure.figureOf({ ...SQUARE, fill: '#ffff00' }, viewport({ scale: 2 }));
  assert.deepEqual([filled.stroke, filled.fill], ['#c00000', '#ffff00']);
  assert.equal(filled.parts[0].x, 202);
  const noStroke = figure.figureOf({ ...SQUARE, color: null, fill: '#ffff00' }, viewport({ scale: 2 }));
  assert.deepEqual([noStroke.stroke, noStroke.fill], [null, '#ffff00']);
  assert.deepEqual(noStroke.parts, [{ type: 'rect', x: 200, y: 283.78, width: 400, height: 200, fillable: true }]);
  const circle = figure.figureOf({ ...SQUARE, kind: 'circle', color: null, fill: '#ffff00' }, viewport({ scale: 2 }));
  assert.deepEqual(circle.parts, [{ type: 'ellipse', cx: 400, cy: 383.78, rx: 200, ry: 100, fillable: true }]);
});

test('破線の四角・丸は保存と同じ始点と向きの path で、間隔は線の太さ × 倍率（確定事項32・41）', () => {
  const vp = viewport({ scale: 2 });
  const square = figure.figureOf({ ...SQUARE, lineStyle: 'dashed' }, vp);
  assert.equal(square.parts.length, 1);
  const [part] = square.parts;
  assert.deepEqual([part.type, part.cap, part.fillable], ['path', 'butt', true]);
  assert.deepEqual(part.dash, [12, 8]);
  // 左下（紙の座標）から反時計回り。表示では (202, 481.78) から右へ。
  assert.deepEqual(pointsOf(part.segments), viewOf(outline.rectOutline(SQUARE.rect, 2), vp));
  assert.deepEqual(pointsOf(part.segments)[0], ['M', [202, 481.78]]);
  const circle = figure.figureOf({ ...SQUARE, kind: 'circle', lineStyle: 'dashed' }, vp);
  assert.deepEqual(circle.parts[0].segments.map((segment) => segment.op), ['M', 'C', 'C', 'C', 'C', 'Z']);
  assert.deepEqual(pointsOf(circle.parts[0].segments)[0], ['M', [598, 383.78]], '丸は右端から');
  // 読み込んだ間隔（倍数）は線の太さを掛ける。
  const imported = figure.figureOf({ ...SQUARE, lineWidth: 3, lineStyle: 'dashed', dash: [2, 1] }, vp);
  assert.deepEqual(imported.parts[0].dash, [12, 6]);
  // 回転した紙でも、紙の座標の点列を直すので始点は同じ角。
  const rotated = figure.figureOf({ ...SQUARE, lineStyle: 'dashed' }, viewport({ rotation: 90 }));
  assert.deepEqual(pointsOf(rotated.parts[0].segments)[0], ['M', [601, 101]]);
  // 線なしの破線は塗りだけ（間隔は無い）。
  const noStroke = figure.figureOf({ ...SQUARE, color: null, fill: '#ffff00', lineStyle: 'dashed' }, vp);
  assert.deepEqual(noStroke.parts, [{ type: 'rect', x: 200, y: 283.78, width: 400, height: 200, fillable: true }]);
});

test('雲形は cloud-geometry の点列を表示へ直した path で、丸い角。小さすぎる箱は普通の四角（確定事項33）', () => {
  const vp = viewport();
  const entry = { ...SQUARE, rect: [60, 600, 260, 760], lineStyle: 'cloudy', cloudIntensity: 2 };
  const cloud = cloudGeometry.cloudOf({ kind: 'square', box: entry.rect, intensity: 2, lineWidth: 2 });
  const shape = figure.figureOf(entry, vp);
  assert.deepEqual([shape.width, shape.join, shape.parts.length], [cloud.drawWidth, 'round', 1]);
  assert.deepEqual([shape.parts[0].type, shape.parts[0].fillable, 'dash' in shape.parts[0]], ['path', true, false]);
  assert.deepEqual(pointsOf(shape.parts[0].segments), viewOf(cloud.segments, vp));
  // 強さが無ければ 1。線なしでも書き込みの太さで組む（線を戻しても雲の並びが変わらない）。
  const plain = figure.figureOf({ ...entry, cloudIntensity: undefined, color: null, fill: '#ffff00' }, vp);
  const one = cloudGeometry.cloudOf({ kind: 'square', box: entry.rect, intensity: 1, lineWidth: 2 });
  assert.deepEqual(pointsOf(plain.parts[0].segments), viewOf(one.segments, vp));
  assert.equal(plain.stroke, null);
  // 4×3 の箱では弧が 1pt を切るので、普通の四角（描く線幅 1.5 の半分だけ内側）。
  const tiny = figure.figureOf({ ...SQUARE, rect: [100, 600, 104, 603], lineStyle: 'cloudy', cloudIntensity: 1 }, vp);
  assert.deepEqual(tiny.parts, [{ type: 'rect', x: 100.75, y: 239.64, width: 2.5, height: 1.5, fillable: true }]);
});

test('破線の矢印は軸だけ破線で、矢じりは実線（確定事項32）。直線・ペンは塗りを持たない', () => {
  const vp = viewport();
  const solid = figure.figureOf(ARROW, vp);
  assert.deepEqual([solid.fill, solid.cap, solid.join, solid.width], [null, 'round', 'round', 3]);
  assert.deepEqual([solid.parts[0].type, solid.parts[0].from.map(r2), solid.parts[0].to.map(r2)], ['line', [100, 241.89], [300, 291.89]]);
  const [left, right] = geo.arrowHead([100, 600], [300, 550], 3);
  assert.deepEqual(solid.parts[1], { type: 'polyline', points: [left, [300, 550], right].map(([x, y]) => vp.convertToViewportPoint(x, y)) });
  const dashed = figure.figureOf({ ...ARROW, lineStyle: 'dashed' }, vp);
  assert.deepEqual([dashed.parts[0].type, dashed.parts[0].cap, dashed.parts[0].fillable], ['path', 'butt', false]);
  assert.deepEqual(dashed.parts[0].dash, [9, 6]);
  assert.deepEqual(pointsOf(dashed.parts[0].segments), [['M', [100, 241.89]], ['L', [300, 291.89]]]);
  assert.deepEqual([dashed.parts[1].type, 'dash' in dashed.parts[1], 'cap' in dashed.parts[1]], ['polyline', false, false]);
  const line = figure.figureOf({ ...ARROW, kind: 'line' }, vp);
  assert.equal(line.parts.length, 1);
  const ink = figure.figureOf({ ...ARROW, kind: 'ink', paths: [[[100, 500], [120, 480], [150, 510]], [[90, 505], [95, 506]]] }, vp);
  assert.deepEqual(ink.parts.map((part) => [part.type, part.points.length]), [['polyline', 3], ['polyline', 2]]);
  assert.equal(ink.fill, null);
});

// ---- 塗った三角の矢印（spec-4b-5a 確定事項7） ----

test('新しい矢印（head が無い）は軸を三角の底の中点で止め、三角を線の色で塗る部品（線は引かない）にする', () => {
  const closed = { ...ARROW, head: undefined };
  const shape = figure.figureOf(closed, viewport());
  const { left, right, base } = globalThis.SigK.arrowHead.closedHead([100, 600], [300, 550], 3);
  const view = viewport();
  const [axis, triangle] = shape.parts;
  assert.equal(axis.type, 'line');
  assert.deepEqual(axis.to.map(r2), view.convertToViewportPoint(...base).map(r2));
  assert.equal(triangle.type, 'polygon');
  assert.equal(triangle.paint, '#4472c4');
  assert.deepEqual(triangle.points.map((point) => point.map(r2)), [left, [300, 550], right].map((point) => view.convertToViewportPoint(...point).map(r2)));
  const dashed = figure.figureOf({ ...closed, lineStyle: 'dashed' }, viewport());
  assert.equal(dashed.parts[0].type, 'path');
  assert.ok(dashed.parts[0].dash.length > 0);
  assert.equal(dashed.parts[1].type, 'polygon');
});

// ---- ×印（spec-4b-5a 確定事項9） ----

test('×印は回す前の箱の対角線 2 本の <line>（破線なら点列）で、丸い端と角', () => {
  const crossEntry = { id: 'sigk-9', src: 0, kind: 'cross', color: '#c00000', opacity: 1, lineWidth: 2, rect: [100, 600, 160, 640], quads: [[100, 640, 160, 640, 100, 600, 160, 600]] };
  const view = viewport();
  const shape = figure.figureOf(crossEntry, view);
  assert.equal(shape.cap, 'round');
  assert.equal(shape.join, 'round');
  assert.equal(shape.fill, null);
  assert.deepEqual(shape.parts.map((part) => [part.type, part.from.map(r2), part.to.map(r2)]), [
    ['line', view.convertToViewportPoint(100, 640).map(r2), view.convertToViewportPoint(160, 600).map(r2)],
    ['line', view.convertToViewportPoint(160, 640).map(r2), view.convertToViewportPoint(100, 600).map(r2)],
  ]);
  const dashed = figure.figureOf({ ...crossEntry, lineStyle: 'dashed' }, view);
  assert.deepEqual(dashed.parts.map((part) => part.type), ['path', 'path']);
  assert.ok(dashed.parts.every((part) => part.dash.length > 0 && part.fillable === false));
});
