'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/shape-style.js');
require('../renderer/imported-shape.js');

// 図形・ペン（Square・Circle・Ink と 2 点の PolyLine）の 1 件を自前の形にする層（spec-4-3 確定事項13）。
// imported-entry.js から移した（spec-4b-1a 確定事項36）。表示のみへの振り分けは imported-entry.test.js が見る。

const shape = globalThis.SigK.importedShape;
const BORDER = { width: 3, rawWidth: 3, style: 1, dashArray: [3] };

test('importedShape は Square・Circle を箱・色・線幅・不透明度で組み、paths を持たせない', () => {
  const square = shape.importedShape({ id: '30R', subtype: 'Square', rect: [300, 300, 400, 380], color: [0, 0, 255], borderStyle: BORDER, opacity: 0.5 }, 2);
  assert.deepEqual(square, {
    ref: '30R', src: 2, kind: 'square', color: '#0000ff', opacity: 0.5, lineWidth: 3,
    rect: [300, 300, 400, 380], quads: [[300, 380, 400, 380, 300, 300, 400, 300]],
  });
  assert.equal(shape.importedShape({ id: '31R', subtype: 'Circle', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER }, 0).kind, 'circle');
  // 不透明度が無ければ 1（pdf.js は矩形・楕円に opacity を返さない。spec-4b-1a 事前調査 A）。
  assert.equal(shape.importedShape({ id: '31R', subtype: 'Circle', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER }, 0).opacity, 1);
});

test('importedShape は 2 点の PolyLine を直線か矢印に、Ink を点列にする', () => {
  const line = shape.importedShape({ id: '40R', subtype: 'PolyLine', rect: [0, 0, 100, 10], color: [0, 0, 0], borderStyle: BORDER, vertices: [0, 5, 100, 5], lineEndings: ['None', 'None'] }, 0);
  assert.equal(line.kind, 'line');
  assert.deepEqual(line.paths, [[[0, 5], [100, 5]]]);
  const arrow = shape.importedShape({ id: '41R', subtype: 'PolyLine', rect: [0, 0, 100, 10], color: [0, 0, 0], borderStyle: BORDER, vertices: [0, 5, 100, 5], lineEndings: ['None', 'OpenArrow'] }, 0);
  assert.equal(arrow.kind, 'arrow');
  const ink = shape.importedShape({ id: '42R', subtype: 'Ink', rect: [0, 0, 50, 50], color: [0, 0, 0], borderStyle: BORDER, inkLists: [[1, 2, 3, 4, 5, 6], [7, 8]] }, 0);
  assert.equal(ink.kind, 'ink');
  assert.deepEqual(ink.paths, [[[1, 2], [3, 4], [5, 6]]], '2 点未満の path は捨てる');
});

test('importedShape は拾えない形（線の見えない直線・3 点以上の PolyLine・知らない矢じり・知らない種類）に null を返す', () => {
  assert.equal(shape.importedShape({ id: '50R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: null, borderStyle: BORDER, vertices: [0, 0, 10, 0], lineEndings: ['None', 'None'] }, 0), null);
  assert.equal(shape.importedShape({ id: '51R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER, vertices: [0, 0, 5, 5, 10, 0], lineEndings: ['None', 'None'] }, 0), null);
  assert.equal(shape.importedShape({ id: '52R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER, vertices: [0, 0, 10, 0], lineEndings: ['None', 'Diamond'] }, 0), null);
  assert.equal(shape.importedShape({ id: '53R', subtype: 'Polygon', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER }, 0), null);
});

// ---- 線幅と線の形（spec-4b-1a 確定事項24。事前調査 A） ----

test('importedShape の線幅は、pdf.js が /Rect に合わせて 1 に置き換える前の rawWidth を使う', () => {
  // 水平な 2pt の直線は /Rect の高さがちょうど 2 なので、pdf.js は width を 1 に置き換える（今は保存して開き直すと 1pt に戻っていた）。
  const line = shape.importedShape({ id: '70R', subtype: 'PolyLine', rect: [0, 4, 100, 6], color: [0, 0, 0], borderStyle: { width: 1, rawWidth: 2, style: 1 }, vertices: [0, 5, 100, 5], lineEndings: ['None', 'None'] }, 0);
  assert.equal(line.lineWidth, 2);
  const thick = shape.importedShape({ id: '71R', subtype: 'Square', rect: [0, 0, 30, 30], color: [0, 0, 0], borderStyle: { width: 1, rawWidth: 40, style: 1 } }, 0);
  assert.equal(thick.lineWidth, 40);
  // rawWidth が無い（古い形の偽物など）なら width。borderStyle が無ければ 1。
  assert.equal(shape.lineWidthOf({ width: 4 }), 4);
  assert.equal(shape.lineWidthOf(undefined), 1);
  assert.equal(shape.lineWidthOf({ width: 0, rawWidth: 1 }), 0);
});

// 線の見えない四角・丸（/C が無いか線幅 0）は線なしの候補にする。塗りは口の答えで当て、無ければ表示のみ
// （annotation-details.js。spec-4b-1b 確定事項36）。線幅 0 のものは、線を戻したときの太さを既定の 2pt にする。
test('importedShape は線の見えない四角・丸を線なしの候補にする', () => {
  const base = { id: '72R', subtype: 'Circle', rect: [0, 0, 30, 30] };
  const noColor = shape.importedShape({ ...base, color: null, borderStyle: BORDER }, 0);
  assert.equal(noColor.color, null);
  assert.equal(noColor.lineWidth, 3, '/C が無くても /BS /W は太さとして持つ');
  const zeroWidth = shape.importedShape({ ...base, color: [0, 0, 0], borderStyle: { width: 0, rawWidth: 1, style: 1 } }, 0);
  assert.equal(zeroWidth.color, null);
  assert.equal(zeroWidth.lineWidth, 2);
  assert.equal(shape.importedShape({ id: '73R', subtype: 'Ink', rect: [0, 0, 50, 50], color: [0, 0, 0], borderStyle: { width: 0, style: 1 }, inkLists: [[1, 2, 3, 4]] }, 0), null);
});

// 破線は間隔を線の太さの倍数で持つ（3:2 なら持たない）。描けない線の形は拾わない（spec-4b-1b 確定事項37）。
test('importedShape は破線を線種と間隔の倍数で読み、描けない線の形に null を返す', () => {
  const base = { id: '74R', subtype: 'Circle', rect: [0, 0, 30, 30], color: [0, 0, 0] };
  const custom = shape.importedShape({ ...base, borderStyle: { width: 2, rawWidth: 2, style: 2, dashArray: [3, 2] } }, 0);
  assert.equal(custom.lineStyle, 'dashed');
  assert.deepEqual(custom.dash, [1.5, 1]);
  const standard = shape.importedShape({ ...base, borderStyle: { width: 2, rawWidth: 2, style: 2, dashArray: [6, 4] } }, 0);
  assert.equal(standard.lineStyle, 'dashed');
  assert.equal('dash' in standard, false, '3:2 は既定なので持たない');
  const empty = shape.importedShape({ ...base, borderStyle: { width: 2, style: 2, dashArray: [] } }, 0);
  assert.equal('lineStyle' in empty, false, '空の間隔は実線');
  const line = shape.importedShape({ id: '75R', subtype: 'PolyLine', rect: [0, 0, 100, 10], color: [0, 0, 0], borderStyle: { width: 2, style: 2, dashArray: [4, 2] }, vertices: [0, 5, 100, 5], lineEndings: ['None', 'OpenArrow'] }, 0);
  assert.deepEqual([line.kind, line.lineStyle, line.dash], ['arrow', 'dashed', [2, 1]]);
  assert.equal(shape.importedShape({ ...base, borderStyle: { width: 1, style: 2, dashArray: [1000] } }, 0), null, '範囲の外の間隔');
  assert.equal(shape.importedShape({ ...base, borderStyle: { width: 2, style: 3 } }, 0), null, '立体');
  assert.equal(shape.importedShape({ ...base, borderStyle: { width: 2, style: 5 } }, 0), null, '下線');
  assert.equal(shape.importedShape({ id: '76R', subtype: 'Ink', rect: [0, 0, 50, 50], color: [0, 0, 0], borderStyle: { width: 2, style: 2, dashArray: [3] }, inkLists: [[1, 2, 3, 4]] }, 0), null, 'ペンは実線だけ');
  assert.equal(shape.isSolidLine({ style: 1 }), true);
  assert.equal(shape.isSolidLine({}), true, '線の形が無ければ実線');
  assert.equal(shape.isSolidLine(undefined), true);
  assert.equal(shape.isSolidLine({ style: 2 }), false);
});

test('dashRatiosOf は間隔を線の太さの倍数にし、3:2 なら null、空なら []、範囲の外は undefined', () => {
  assert.deepEqual(shape.dashRatiosOf([4, 2], 2), [2, 1]);
  assert.deepEqual(shape.dashRatiosOf([3], 1), [3], 'pdf.js の既定の [3] は 3 倍の線と間');
  assert.equal(shape.dashRatiosOf([6, 4], 2), null);
  assert.equal(shape.dashRatiosOf([3.01, 2], 1), null, '差 0.01 以内は 3:2');
  assert.deepEqual(shape.dashRatiosOf(undefined, 1), [3], '間隔が無ければ pdf.js の既定の [3]');
  assert.deepEqual(shape.dashRatiosOf([], 2), []);
  assert.equal(shape.dashRatiosOf([0, 0], 1), undefined);
  assert.deepEqual(shape.dashRatiosOf(new Float32Array([4, 2]), 4), [1, 0.5]);
});

// ---- ×印（spec-4b-5a 確定事項39） ----

test('importedShape は ×印の形の Ink を、箱と角度の ×印にし、ほかの 2 本の Ink はペンのまま', () => {
  require('../renderer/shape-rotation.js');
  require('../renderer/cross-geometry.js');
  const lists = globalThis.SigK.crossGeometry.diagonalsOf([100, 600, 160, 640], 30).map((line) => Float32Array.from(line.flat()));
  const cross = shape.importedShape({ id: '60R', subtype: 'Ink', rect: [80, 580, 180, 660], color: [192, 0, 0], borderStyle: BORDER, inkLists: lists, opacity: 0.5 }, 0);
  assert.equal(cross.kind, 'cross');
  assert.deepEqual(cross.rect, [100, 600, 160, 640]);
  assert.equal(cross.angle, 30);
  assert.equal(cross.opacity, 0.5);
  assert.equal(cross.paths, undefined);
  assert.equal(cross.quads.length, 1);
  const dashed = shape.importedShape({ id: '61R', subtype: 'Ink', rect: [80, 580, 180, 660], color: [192, 0, 0], borderStyle: { width: 2, style: 2, dashArray: [6, 4] }, inkLists: lists }, 0);
  assert.equal(dashed.kind, 'cross');
  assert.equal(dashed.lineStyle, 'dashed');
  const pen = shape.importedShape({ id: '62R', subtype: 'Ink', rect: [0, 0, 100, 100], color: [0, 0, 0], borderStyle: BORDER, inkLists: [Float32Array.from([0, 0, 50, 50]), Float32Array.from([60, 0, 0, 60])] }, 0);
  assert.equal(pen.kind, 'ink');
  // ペンの破線は今までどおり表示のみ（null）
  assert.equal(shape.importedShape({ id: '63R', subtype: 'Ink', rect: [0, 0, 100, 100], color: [0, 0, 0], borderStyle: { width: 2, style: 2, dashArray: [6, 4] }, inkLists: [Float32Array.from([0, 0, 50, 50, 90, 10])] }, 0), null);
});
