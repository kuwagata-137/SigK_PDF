'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/shape-style.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/polygon-geometry.js');
require('../renderer/imported-shape.js');
require('../renderer/imported-polygon.js');

// 他のアプリと自前の多角形の読み込み（spec-4b-5a 確定事項40）。pdf.js の vertices から組み、口の答えで塗り・回転・雲形を当てる。

const { importedPolygon: imp, polygonGeometry, shapeRotation } = globalThis.SigK;
const BORDER = { width: 2, rawWidth: 2, style: 1, dashArray: [3] };
const VERTICES = [100, 600, 180, 620, 200, 680, 150, 720, 90, 670];

function data(overrides = {}) {
  return { id: '40R', subtype: 'Polygon', rect: [80, 590, 210, 730], color: [192, 0, 0], borderStyle: BORDER, vertices: Float32Array.from(VERTICES), ...overrides };
}

test('isPolygonData は 3 点以上の Polygon と、矢じりの無い 3 点以上の PolyLine', () => {
  assert.equal(imp.isPolygonData(data()), true);
  assert.equal(imp.isPolygonData(data({ subtype: 'PolyLine', lineEndings: ['None', 'None'] })), true);
  assert.equal(imp.isPolygonData(data({ subtype: 'PolyLine' })), true, '/LE が無ければ矢じり無し');
  assert.equal(imp.isPolygonData(data({ subtype: 'PolyLine', lineEndings: ['None', 'OpenArrow'] })), false);
  assert.equal(imp.isPolygonData(data({ vertices: [0, 0, 10, 10] })), false);
  assert.equal(imp.isPolygonData(data({ subtype: 'Square' })), false);
});

test('importedPolygon は閉じた・開いた多角形を、頂点・線・箱で組む（不透明度と塗りは口の答えで当てる）', () => {
  const closed = imp.importedPolygon(data(), 0);
  assert.equal(closed.kind, 'polygon');
  assert.equal(closed.closed, true);
  assert.equal(closed.color, '#c00000');
  assert.equal(closed.lineWidth, 2);
  assert.equal(closed.opacity, 1);
  assert.equal(closed.paths[0].length, 5);
  assert.deepEqual(closed.rect, [89, 599, 201, 721]);
  const open = imp.importedPolygon(data({ subtype: 'PolyLine', lineEndings: ['None', 'None'] }), 0);
  assert.equal(open.closed, false);
  const dashed = imp.importedPolygon(data({ borderStyle: { width: 2, style: 2, dashArray: [6, 4] } }), 0);
  assert.equal(dashed.lineStyle, 'dashed');
  // 線の見えない閉じた多角形は線なしの候補（塗りは口の答え）。開いたものは拾わない
  assert.equal(imp.importedPolygon(data({ color: null }), 0).color, null);
  assert.equal(imp.importedPolygon(data({ subtype: 'PolyLine', color: null }), 0), null);
});

test('withPolygonDetails は閉じたものにだけ塗りを当て、答えが無ければ頂点を丸めるだけ', () => {
  const raw = imp.importedPolygon(data({ vertices: Float32Array.from([100.123, 600, 180, 620, 200, 680]) }), 0);
  const plain = imp.withPolygonDetails(raw, null);
  assert.deepEqual(plain.paths[0][0], [100.12, 600]);
  assert.equal(plain.fill, undefined);
  assert.equal(imp.withPolygonDetails(raw, { interior: [1, 1, 0] }).fill, '#ffff00');
  const open = imp.importedPolygon(data({ subtype: 'PolyLine' }), 0);
  assert.equal(imp.withPolygonDetails(open, { interior: [1, 1, 0] }).fill, undefined);
});

test('withPolygonDetails は回した多角形の頂点を回す前に戻し、角度と箱を当てる。雲形・ゆがんだ外観は null', () => {
  const vertices = [[100, 600], [180, 620], [200, 680], [150, 720], [90, 670]];
  const rect = polygonGeometry.rectOfVertices(vertices, 2);
  const world = polygonGeometry.worldVertices({ paths: [vertices], rect, angle: 30 }, 4);
  const raw = imp.importedPolygon(data({ vertices: Float32Array.from(world.flat()) }), 0);
  const read = imp.withPolygonDetails(raw, { rotation: { box: rect, angle: 30 } });
  assert.equal(read.angle, 30);
  assert.deepEqual(read.paths[0], vertices);
  assert.deepEqual(read.rect, rect);
  assert.deepEqual(read.quads, [shapeRotation.quadOf(rect, 30)]);
  assert.equal(imp.withPolygonDetails(raw, { rotation: 'skewed' }), null);
  assert.equal(imp.withPolygonDetails(raw, { cloudy: true, cloudIntensity: 1 }), null);
});
