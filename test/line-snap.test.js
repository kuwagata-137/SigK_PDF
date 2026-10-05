'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/polygon-geometry.js');
require('../renderer/line-snap.js');

// 線の始点合わせの点（spec-4b-5a 確定事項19）。直線・矢印の両端、四角・×印の回した 4 隅、多角形の回した頂点。

const { lineSnap, shapeRotation, polygonGeometry } = globalThis.SigK;
const VIEW = { convertToViewportPoint: (x, y) => [x, 1000 - y] };

test('pointsOf は直線・矢印の両端、四角・×印の回した 4 隅、多角形の回した頂点を返し、ほかと表示のみは空', () => {
  assert.deepEqual(lineSnap.pointsOf({ kind: 'arrow', paths: [[[0, 0], [10, 5]]] }), [[0, 0], [10, 5]]);
  assert.deepEqual(lineSnap.pointsOf({ kind: 'square', rect: [0, 0, 40, 20] }), shapeRotation.cornersOf([0, 0, 40, 20], 0));
  assert.deepEqual(lineSnap.pointsOf({ kind: 'cross', rect: [0, 0, 40, 20], angle: 30 }), shapeRotation.cornersOf([0, 0, 40, 20], 30));
  const polygon = { kind: 'polygon', closed: true, paths: [[[0, 0], [40, 0], [20, 30]]], rect: polygonGeometry.rectOfVertices([[0, 0], [40, 0], [20, 30]], 2), angle: 90 };
  assert.deepEqual(lineSnap.pointsOf(polygon), polygonGeometry.worldVertices(polygon, 4));
  assert.deepEqual(lineSnap.pointsOf({ kind: 'circle', rect: [0, 0, 10, 10] }), []);
  assert.deepEqual(lineSnap.pointsOf({ kind: 'ink', paths: [[[0, 0], [1, 1]]] }), []);
  assert.deepEqual(lineSnap.pointsOf({ kind: 'square', rect: [0, 0, 10, 10], readonly: true }), []);
  assert.deepEqual(lineSnap.pointsOf(null), []);
});

test('nearest は表示で 11px 以内のいちばん近い点を返し、無ければ null', () => {
  const entries = [{ kind: 'square', rect: [100, 100, 200, 150] }, { kind: 'line', paths: [[[205, 155], [300, 300]]] }];
  assert.deepEqual(lineSnap.nearest(entries, VIEW, [203, 1000 - 153]), [205, 155], '四角の角より直線の端が近い');
  assert.deepEqual(lineSnap.nearest(entries, VIEW, [108, 1000 - 100]), [100, 100]);
  assert.equal(lineSnap.nearest(entries, VIEW, [150, 1000 - 125]), null);
  assert.equal(lineSnap.nearest(entries, VIEW, [112, 1000 - 100]), null, '12px は外');
});
