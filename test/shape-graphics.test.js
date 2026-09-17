'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-graphics.js');

// 画面の図形・ペン（spec-4-3 確定事項8・11・25）。SVG の要素と、印刷用の canvas 2D の描き手。

const graphics = globalThis.SigK.shapeGraphics;
const geo = globalThis.SigK.shapeGeometry;

function makeDoc() {
  return new JSDOM('<!doctype html><div class="pdf-page"></div>').window.document;
}

// 回転 0・倍率 scale の viewport（A4）。回転 90 は pdf.js と同じ変換。
function viewport({ scale = 1, rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90) {
    return {
      width: h * scale, height: w * scale, scale, rotation,
      convertToViewportPoint: (x, y) => [y * scale, x * scale],
    };
  }
  return {
    width: w * scale, height: h * scale, scale, rotation,
    convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale],
  };
}

const SQUARE = { id: 'sigk-1', src: 0, kind: 'square', color: '#d92c2c', opacity: 1, lineWidth: 2, rect: [100, 600, 300, 700], quads: [[100, 700, 300, 700, 100, 600, 300, 600]] };
const CIRCLE = { ...SQUARE, id: 'sigk-2', kind: 'circle' };
const LINE = { id: 'sigk-3', src: 0, kind: 'line', color: '#2c5cd9', opacity: 1, lineWidth: 3, rect: [98.5, 548.5, 301.5, 601.5], quads: [[98.5, 601.5, 301.5, 601.5, 98.5, 548.5, 301.5, 548.5]], paths: [[[100, 600], [300, 550]]] };
const ARROW = { ...LINE, id: 'sigk-4', kind: 'arrow' };
const INK = { id: 'sigk-5', src: 0, kind: 'ink', color: '#2f9e5a', opacity: 1, lineWidth: 2, rect: [89, 479, 151, 511], quads: [[89, 511, 151, 511, 89, 479, 151, 479]], paths: [[[100, 500], [120, 480], [150, 510]], [[90, 505], [95, 506]]] };

function num(value) {
  return Math.round(value * 100) / 100;
}

function recordingContext(calls) {
  return new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
}

test('viewBoxOf は紙の座標の箱を表示の px の箱にする（回転しても min/max で組む）', () => {
  assert.deepEqual(graphics.viewBoxOf([100, 600, 300, 700], viewport({ scale: 2 })), { x: 200, y: 283.78, width: 400, height: 200 });
  assert.deepEqual(graphics.viewBoxOf([100, 600, 300, 700], viewport({ rotation: 90 })), { x: 600, y: 100, width: 100, height: 200 });
});

test('svgOf は矩形を線幅の半分だけ内側の <rect> にし、線の属性は <g> に付ける', () => {
  const g = graphics.svgOf(makeDoc(), SQUARE, viewport({ scale: 2 }));
  assert.equal(g.tagName.toLowerCase(), 'g');
  assert.equal(g.getAttribute('class'), 'shape square');
  assert.equal(g.getAttribute('stroke'), '#d92c2c');
  assert.equal(g.getAttribute('stroke-width'), '4');
  assert.equal(g.getAttribute('fill'), 'none');
  assert.equal(g.getAttribute('stroke-linecap'), 'butt');
  assert.equal(g.getAttribute('stroke-linejoin'), 'miter');
  const rect = g.querySelector('rect');
  assert.deepEqual(['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name)), ['202', '285.78', '396', '196']);
  assert.equal(g.children.length, 1);
});

test('svgOf は楕円を中心と半径の <ellipse> にする（回転した紙でも軸に沿う）', () => {
  const ellipse = graphics.svgOf(makeDoc(), CIRCLE, viewport({ scale: 2 })).querySelector('ellipse');
  assert.deepEqual(['cx', 'cy', 'rx', 'ry'].map((name) => ellipse.getAttribute(name)), ['400', '383.78', '198', '98']);
  const rotated = graphics.svgOf(makeDoc(), CIRCLE, viewport({ rotation: 90 })).querySelector('ellipse');
  assert.deepEqual(['cx', 'cy', 'rx', 'ry'].map((name) => rotated.getAttribute(name)), ['650', '200', '49', '99']);
});

test('svgOf は直線を丸い端の <line> にする', () => {
  const g = graphics.svgOf(makeDoc(), LINE, viewport());
  assert.equal(g.getAttribute('class'), 'shape line');
  assert.equal(g.getAttribute('stroke-linecap'), 'round');
  assert.equal(g.getAttribute('stroke-linejoin'), 'round');
  assert.equal(g.getAttribute('stroke-width'), '3');
  const line = g.querySelector('line');
  assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((name) => line.getAttribute(name)), ['100', '241.89', '300', '291.89']);
  assert.equal(g.children.length, 1);
});

test('svgOf は矢印に翼の <polyline> を足す（翼は紙の座標で計算してから表示へ直す）', () => {
  const g = graphics.svgOf(makeDoc(), ARROW, viewport({ scale: 2 }));
  assert.equal(g.getAttribute('class'), 'shape arrow');
  assert.equal(g.children.length, 2);
  const [left, right] = geo.arrowHead([100, 600], [300, 550], 3);
  const vp = viewport({ scale: 2 });
  const expected = [left, [300, 550], right].map((p) => vp.convertToViewportPoint(p[0], p[1]).map(num).join(',')).join(' ');
  assert.equal(g.querySelector('polyline').getAttribute('points'), expected);
  assert.equal(g.querySelector('polyline').getAttribute('fill'), 'none');
});

test('svgOf はペンを path ごとの <polyline> にする', () => {
  const g = graphics.svgOf(makeDoc(), INK, viewport());
  assert.equal(g.getAttribute('class'), 'shape ink');
  const polylines = [...g.querySelectorAll('polyline')];
  assert.equal(polylines.length, 2);
  assert.equal(polylines[0].getAttribute('points'), '100,341.89 120,361.89 150,331.89');
  assert.equal(polylines[1].getAttribute('points'), '90,336.89 95,335.89');
});

test('paint は canvas 2D に同じ絵を描く', () => {
  const calls = [];
  const ctx = recordingContext(calls);
  assert.equal(graphics.paint(ctx, SQUARE, viewport({ scale: 2 })), 1);
  assert.deepEqual(calls[0], ['save']);
  assert.deepEqual(calls.at(-1), ['restore']);
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'strokeStyle' && value === '#d92c2c'));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineWidth' && value === 4));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineCap' && value === 'butt'));
  assert.deepEqual(calls.find(([name]) => name === 'strokeRect'), ['strokeRect', 202, 285.78, 396, 196]);

  calls.length = 0;
  graphics.paint(ctx, CIRCLE, viewport({ scale: 2 }));
  const ellipse = calls.find(([name]) => name === 'ellipse');
  assert.deepEqual(ellipse.slice(1, 5).map(num), [400, 383.78, 198, 98]);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1);

  calls.length = 0;
  graphics.paint(ctx, ARROW, viewport());
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineCap' && value === 'round'));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineJoin' && value === 'round'));
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);
  assert.equal(calls.filter(([name]) => name === 'moveTo').length, 2);
  assert.deepEqual(calls.find(([name]) => name === 'moveTo').slice(1).map(num), [100, 241.89]);

  calls.length = 0;
  graphics.paint(ctx, INK, viewport());
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);
  assert.equal(calls.filter(([name]) => name === 'lineTo').length, 3);

  calls.length = 0;
  graphics.paint(ctx, { ...LINE, opacity: 0.5 }, viewport());
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'globalAlpha' && value === 0.5));
});
