'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
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

test('importedShape は拾えない形（色が無い・3 点以上の PolyLine・閉じた矢じり・知らない種類）に null を返す', () => {
  assert.equal(shape.importedShape({ id: '50R', subtype: 'Square', rect: [0, 0, 10, 10], color: null, borderStyle: BORDER }, 0), null);
  assert.equal(shape.importedShape({ id: '51R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER, vertices: [0, 0, 5, 5, 10, 0], lineEndings: ['None', 'None'] }, 0), null);
  assert.equal(shape.importedShape({ id: '52R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], borderStyle: BORDER, vertices: [0, 0, 10, 0], lineEndings: ['None', 'ClosedArrow'] }, 0), null);
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

test('importedShape は線幅 0 と実線でない線に null を返す（imported-entry.js が表示のみにする）', () => {
  const base = { id: '72R', subtype: 'Circle', rect: [0, 0, 30, 30], color: [0, 0, 0] };
  assert.equal(shape.importedShape({ ...base, borderStyle: { width: 0, rawWidth: 1, style: 1 } }, 0), null);
  assert.equal(shape.importedShape({ ...base, borderStyle: { width: 2, rawWidth: 2, style: 2, dashArray: [3, 2] } }, 0), null);
  assert.equal(shape.isSolidLine({ style: 1 }), true);
  assert.equal(shape.isSolidLine({}), true, '線の形が無ければ実線');
  assert.equal(shape.isSolidLine(undefined), true);
  assert.equal(shape.isSolidLine({ style: 2 }), false);
  assert.equal(shape.isSolidLine({ style: 4 }), false);
});
