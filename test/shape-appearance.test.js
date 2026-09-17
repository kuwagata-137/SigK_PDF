'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KAPPA, ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, SUBTYPES,
  arrowHead, isShapeEntry, shapeAppearanceOf,
} = require('../worker/shape-appearance.js');

// 図形・ペン注釈の外観（/AP /N）の中身（spec-4-3 確定事項20〜22・30）。pdf-lib を知らない純粋層。

const RED = '#d92c2c';

function square(overrides = {}) {
  return { src: 0, kind: 'square', color: RED, opacity: 1, rect: [100, 600, 300, 700], lineWidth: 2, ...overrides };
}

function line(overrides = {}) {
  return { src: 0, kind: 'line', color: '#2c5cd9', opacity: 1, rect: [98.5, 548.5, 301.5, 601.5], lineWidth: 3, paths: [[[100, 600], [300, 550]]], ...overrides };
}

function ink(overrides = {}) {
  return { src: 1, kind: 'ink', color: '#2f9e5a', opacity: 1, rect: [99, 479, 151, 511], lineWidth: 2, paths: [[[100, 500], [120, 480], [150, 510]]], ...overrides };
}

test('矢じりの寸法と翼の式は renderer/shape-geometry.js と同値', () => {
  require('../renderer/free-text-geometry.js');
  require('../renderer/shape-geometry.js');
  const geo = globalThis.SigK.shapeGeometry;
  assert.equal(ARROW_MIN_LENGTH, geo.ARROW_MIN_LENGTH);
  assert.equal(ARROW_LENGTH_RATIO, geo.ARROW_LENGTH_RATIO);
  assert.equal(ARROW_ANGLE, geo.ARROW_ANGLE);
  for (const [from, to, width] of [[[0, 0], [100, 0], 2], [[10, 10], [10, -20], 3], [[100, 600], [300, 550], 1]])
    assert.deepEqual(arrowHead(from, to, width), geo.arrowHead(from, to, width));
  assert.equal(KAPPA, 0.5523);
});

test('Subtype は矩形 Square・楕円 Circle・直線と矢印 PolyLine・ペン Ink', () => {
  assert.deepEqual(SUBTYPES, { square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', ink: 'Ink' });
});

test('矩形は線幅の半分だけ内側に re S を書く', () => {
  const appearance = shapeAppearanceOf(square());
  assert.equal(appearance.content, '/GS gs\n0.85 0.17 0.17 RG\n2 w 101 601 198 98 re S');
  assert.deepEqual(appearance.bbox, [100, 600, 300, 700]);
  assert.equal(appearance.subtype, 'Square');
  assert.equal(appearance.lineWidth, 2);
  assert.equal(appearance.opacity, 1);
  assert.deepEqual(appearance.rgb.map((v) => Math.round(v * 100) / 100), [0.85, 0.17, 0.17]);
  assert.equal('vertices' in appearance, false);
  assert.equal('inkList' in appearance, false);
});

test('楕円はベジェ 4 本で、線幅の半分だけ内側に描く', () => {
  const appearance = shapeAppearanceOf(square({ kind: 'circle', rect: [330, 650, 500, 780], lineWidth: 3 }));
  assert.equal(appearance.subtype, 'Circle');
  assert.equal(appearance.content, [
    '/GS gs', '0.85 0.17 0.17 RG', '3 w',
    '498.5 715 m',
    '498.5 750.07 461.12 778.5 415 778.5 c',
    '368.88 778.5 331.5 750.07 331.5 715 c',
    '331.5 679.93 368.88 651.5 415 651.5 c',
    '461.12 651.5 498.5 679.93 498.5 715 c',
    'h S',
  ].join('\n'));
});

test('小さすぎる箱では線を内側に収めきれず、幅 0 で描く（負にならない）', () => {
  const appearance = shapeAppearanceOf(square({ rect: [100, 600, 101, 601], lineWidth: 8 }));
  assert.equal(appearance.content, '/GS gs\n0.85 0.17 0.17 RG\n8 w 104 604 0 0 re S');
  assert.match(shapeAppearanceOf(square({ kind: 'circle', rect: [100, 600, 101, 601], lineWidth: 8 })).content, /^\/GS gs\n0\.85 0\.17 0\.17 RG\n8 w\n100\.5 600\.5 m\n/);
});

test('直線は丸い端の m l S で、/Vertices と /LE を返す', () => {
  const appearance = shapeAppearanceOf(line());
  assert.equal(appearance.content, '/GS gs\n0.17 0.36 0.85 RG\n3 w 1 J 100 600 m 300 550 l S');
  assert.equal(appearance.subtype, 'PolyLine');
  assert.deepEqual(appearance.vertices, [100, 600, 300, 550]);
  assert.deepEqual(appearance.lineEndings, ['None', 'None']);
  assert.deepEqual(appearance.bbox, [98.5, 548.5, 301.5, 601.5]);
});

test('矢印は直線のあとに翼 2 本を丸い角で描き、/LE は終点だけ OpenArrow', () => {
  const appearance = shapeAppearanceOf(line({ kind: 'arrow', rect: [98.5, 543.55, 301.5, 601.5] }));
  const [left, right] = arrowHead([100, 600], [300, 550], 3);
  assert.equal(appearance.content, [
    '/GS gs', '0.17 0.36 0.85 RG', '3 w 1 J 1 j',
    '100 600 m 300 550 l S',
    `${left.map((v) => String(Math.round(v * 100) / 100)).join(' ')} m 300 550 l ${right.map((v) => String(Math.round(v * 100) / 100)).join(' ')} l S`,
  ].join('\n'));
  assert.deepEqual(appearance.vertices, [100, 600, 300, 550]);
  assert.deepEqual(appearance.lineEndings, ['None', 'OpenArrow']);
});

test('ペンは path ごとに m l … S で、/InkList は平たい数の並び', () => {
  const appearance = shapeAppearanceOf(ink({ paths: [[[100, 500], [120, 480], [150, 510]], [[90, 505], [95.5, 506.25]]] }));
  assert.equal(appearance.content, [
    '/GS gs', '0.18 0.62 0.35 RG', '2 w 1 J 1 j',
    '100 500 m 120 480 l 150 510 l S',
    '90 505 m 95.5 506.25 l S',
  ].join('\n'));
  assert.equal(appearance.subtype, 'Ink');
  assert.deepEqual(appearance.inkList, [[100, 500, 120, 480, 150, 510], [90, 505, 95.5, 506.25]]);
  assert.equal('vertices' in appearance, false);
});

test('不透明度は 0〜1 に丸め、無ければ 1。座標は小数 2 桁', () => {
  assert.equal(shapeAppearanceOf(square({ opacity: 2 })).opacity, 1);
  assert.equal(shapeAppearanceOf(square({ opacity: 0.5 })).opacity, 0.5);
  assert.equal(shapeAppearanceOf(square({ opacity: undefined })).opacity, 1);
  const appearance = shapeAppearanceOf(line({ paths: [[[100.004, 600.006], [300.126, 550]]], rect: [98.499, 548.5, 301.626, 601.506] }));
  assert.deepEqual(appearance.vertices, [100, 600.01, 300.13, 550]);
  assert.deepEqual(appearance.bbox, [98.5, 548.5, 301.63, 601.51]);
});

test('isShapeEntry は形だけを見る', () => {
  assert.equal(isShapeEntry(square()), true);
  assert.equal(isShapeEntry(line()), true);
  assert.equal(isShapeEntry(ink()), true);
  assert.equal(isShapeEntry(square({ kind: 'text' })), false);
  assert.equal(isShapeEntry(square({ kind: 'highlight' })), false);
  assert.equal(isShapeEntry(square({ lineWidth: 0 })), false);
  assert.equal(isShapeEntry(square({ color: 'red' })), false);
  assert.equal(isShapeEntry(square({ rect: [1, 2, 3] })), false);
  assert.equal(isShapeEntry(line({ paths: undefined })), false);
  assert.equal(isShapeEntry(line({ paths: [[[100, 600]]] })), false);
  assert.equal(isShapeEntry(line({ paths: [[[100, 600], [300, 550], [1, 1]]] })), false);
  assert.equal(isShapeEntry(line({ paths: [[[100, 600], [300, 550]], [[0, 0], [1, 1]]] })), false);
  assert.equal(isShapeEntry(ink({ paths: [] })), false);
  assert.equal(isShapeEntry(ink({ paths: [[[100, 500], [120, NaN]]] })), false);
  assert.equal(isShapeEntry(ink({ paths: [[[1, 2], [3, 4]], [[5, 6], [7, 8], [9, 10]]] })), true);
  assert.equal(isShapeEntry(null), false);
});

test('形が違えば null', () => {
  assert.equal(shapeAppearanceOf(square({ kind: 'note' })), null);
  assert.equal(shapeAppearanceOf(line({ paths: [] })), null);
  assert.equal(shapeAppearanceOf(square({ color: '#12345' })), null);
});
