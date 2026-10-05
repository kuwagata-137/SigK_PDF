'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/polygon-geometry.js');

// 多角形の形（spec-4b-5a 確定事項3・10・23・24・40）。外接・回した頂点・回す前に戻す・内外・辺の当たり。

const polygon = globalThis.SigK.polygonGeometry;
const rotation = globalThis.SigK.shapeRotation;

const PENTAGON = [[100, 600], [180, 620], [200, 680], [150, 720], [90, 670]];

function entryOf(vertices, overrides = {}) {
  const lineWidth = overrides.lineWidth ?? 2;
  return { kind: 'polygon', closed: true, color: '#c00000', lineWidth, paths: [vertices], rect: polygon.rectOfVertices(vertices, lineWidth), ...overrides };
}

test('rectOfVertices は頂点の外接に線幅の半分を足す', () => {
  assert.deepEqual(polygon.rectOfVertices(PENTAGON, 2), [89, 599, 201, 721]);
  assert.deepEqual(polygon.rectOfVertices(PENTAGON, 5), [87.5, 597.5, 202.5, 722.5]);
});

test('worldVertices は 0° なら頂点のまま、回したら箱の中心まわりに回した位置', () => {
  const plain = entryOf(PENTAGON);
  assert.deepEqual(polygon.worldVertices(plain), PENTAGON);
  const turned = entryOf(PENTAGON, { angle: 90 });
  const center = rotation.centerOf(turned.rect);
  polygon.worldVertices(turned, 4).forEach((point, index) => {
    const expected = rotation.rotatePoint(PENTAGON[index], center, 90);
    assert.ok(Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 0.0001);
  });
});

test('unrotated は回した位置の頂点を、pdf.js を通しても回す前の頂点（小数 2 桁）に戻す', () => {
  for (const vertices of [PENTAGON, [[10.25, 20.5], [60.75, 25.25], [33.33, 80.01]], [[300, 300], [302, 300], [301, 301.5]]]) {
    for (const angle of [15, 30, 90, 200, 345, 359.5]) {
      const entry = entryOf(vertices, { angle });
      const world = polygon.worldVertices(entry, 4).map((point) => Array.from(Float32Array.from(point)));
      assert.deepEqual(polygon.unrotated(world, angle), vertices, `${angle}°`);
    }
  }
  assert.deepEqual(polygon.unrotated([[1.234, 5.678], [2, 3], [4, 4]], 0), [[1.23, 5.68], [2, 3], [4, 4]]);
});

test('contains は凸と凹（L 字）の多角形の中を見分ける', () => {
  assert.equal(polygon.contains([150, 660], PENTAGON), true);
  assert.equal(polygon.contains([95, 610], PENTAGON), false);
  const ell = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];
  assert.equal(polygon.contains([5, 30], ell), true);
  assert.equal(polygon.contains([30, 30], ell), false);
  assert.equal(polygon.contains([30, 5], ell), true);
});

test('distanceToEdges は閉じたものだけ最後の辺も見る', () => {
  const open = [[0, 0], [100, 0], [100, 100]];
  assert.ok(polygon.distanceToEdges([50, 50], open, true) < 0.001, '閉じれば 100,100 → 0,0 の辺の上');
  assert.ok(Math.abs(polygon.distanceToEdges([50, 50], open, false) - 50) < 0.001);
});

test('hits は辺の近くと、閉じて塗ったものの中だけ当たる（回したものは回す前の座標で）', () => {
  const lined = entryOf(PENTAGON);
  assert.equal(polygon.hits(lined, [140, 610], 4), true, '辺の近く');
  assert.equal(polygon.hits(lined, [150, 660], 4), false, '塗りが無ければ中は当たらない');
  assert.equal(polygon.hits(entryOf(PENTAGON, { fill: '#ffff00' }), [150, 660], 4), true);
  assert.equal(polygon.hits(entryOf(PENTAGON, { fill: '#ffff00', closed: false }), [150, 660], 4), false, '開いたものは中を見ない');
  const turned = entryOf(PENTAGON, { angle: 180 });
  const center = rotation.centerOf(turned.rect);
  const vertex = rotation.rotatePoint(PENTAGON[2], center, 180);
  assert.equal(polygon.hits(turned, vertex, 1), true);
  assert.equal(polygon.hits(turned, PENTAGON[2], 1), false);
});
