'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/polygon-geometry.js');
require('../renderer/shape-handles.js');
require('../renderer/polygon-handles.js');

// 選んだ多角形の枠とつまみ（spec-4b-5a 確定事項22）。枠と回転のつまみは四角と同じ、つまみは頂点ごと。

const { polygonHandles, polygonGeometry, shapeHandles, shapeRotation } = globalThis.SigK;
const VIEW = { scale: 1, convertToViewportPoint: (x, y) => [x, 1000 - y], convertToPdfPoint: (x, y) => [x, 1000 - y] };
const VERTICES = [[100, 600], [180, 620], [200, 680], [150, 720], [90, 670]];

function entryOf(overrides = {}) {
  const rect = polygonGeometry.rectOfVertices(VERTICES, 2);
  return { kind: 'polygon', closed: true, color: '#c00000', lineWidth: 2, paths: [VERTICES], rect, quads: [shapeRotation.quadOf(rect, overrides.angle ?? 0)], ...overrides };
}

test('多角形は頂点ごとの白いつまみ（vertex）と回転のつまみを持ち、8 つのつまみは出さない', () => {
  const shown = shapeHandles.handlesOf(entryOf(), VIEW);
  const vertices = shown.handles.filter((handle) => handle.kind === 'vertex');
  assert.deepEqual(vertices.map((handle) => handle.id), ['v0', 'v1', 'v2', 'v3', 'v4']);
  assert.deepEqual(vertices.map((handle) => handle.at), VERTICES.map((point) => VIEW.convertToViewportPoint(...point)));
  assert.equal(shown.handles.filter((handle) => handle.kind === 'rotate').length, 1);
  assert.equal(shown.handles.filter((handle) => handle.kind === 'corner' || handle.kind === 'edge').length, 0);
  assert.equal(shown.frame.type, 'polygon');
  assert.deepEqual(shown.frame, shapeHandles.turnedFrameOf(entryOf(), VIEW, null).frame);
  assert.equal(shapeHandles.hasHandles(entryOf()), true);
  assert.equal(shapeHandles.hasHandles({ ...entryOf(), readonly: true }), false);
});

test('回した多角形のつまみは回した位置で、頂点は角のつまみと同じ順で当たる', () => {
  const entry = entryOf({ angle: 90 });
  const shown = shapeHandles.handlesOf(entry, VIEW);
  const world = polygonGeometry.worldVertices(entry);
  shown.handles.filter((handle) => handle.kind === 'vertex').forEach((handle, at) => assert.deepEqual(handle.at, VIEW.convertToViewportPoint(...world[at])));
  const first = shown.handles[0];
  assert.equal(shapeHandles.handleAt(shown.handles, [first.at[0] + 3, first.at[1]]).id, 'v0');
});

test('vertexIndexOf は v0・v1… から番号を、違えば null を返す', () => {
  assert.equal(polygonHandles.vertexIndexOf('v0'), 0);
  assert.equal(polygonHandles.vertexIndexOf('v12'), 12);
  assert.equal(polygonHandles.vertexIndexOf('rotate'), null);
  assert.equal(polygonHandles.vertexIndexOf(undefined), null);
});
