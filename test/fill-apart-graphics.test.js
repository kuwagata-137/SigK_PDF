'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/cross-geometry.js');
require('../renderer/polygon-geometry.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/shape-outline.js');
require('../renderer/cloud-geometry.js');
require('../renderer/shape-figure.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-print-layer.js');
require('../renderer/shape-graphics.js');
require('../renderer/hatch-geometry.js');
require('../renderer/fill-apart-graphics.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-layer.js');

// 塗りと枠線を分けて描く図形（spec-7-9 確定事項B4・B5・C1〜C4）と、ハッチングの線の幾何。

const SigK = globalThis.SigK;
const graphics = SigK.shapeGraphics;
const hatchGeometry = SigK.hatchGeometry;

function makeDoc() {
  return new JSDOM('<!doctype html><div></div>').window.document;
}

function viewport(scale = 1) {
  const h = 841.89;
  return { width: 595.28 * scale, height: h * scale, scale, rotation: 0, convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale] };
}

const HATCH = Object.freeze({ pattern: 'diagonal', color: '#0070c0', gap: 10, width: 1 });
const SQUARE = { id: 'sigk-1', src: 0, kind: 'square', color: '#c00000', fill: '#ffd966', opacity: 1, lineWidth: 4, rect: [100, 600, 200, 700], quads: [[100, 700, 200, 700, 100, 600, 200, 600]] };

test('ハッチングの線は箱の中心を通る 1 本を基準に間隔ごとに並び、種類ごとの向きを持つ', () => {
  const box = [0, 0, 100, 40];
  const horizontal = hatchGeometry.linesOf(box, { ...HATCH, pattern: 'horizontal' });
  assert.deepEqual(horizontal.map(([from]) => from[1]), [0, 10, 20, 30, 40]);
  assert.ok(horizontal.every(([from, to]) => from[0] === 0 && to[0] === 100));
  const vertical = hatchGeometry.linesOf(box, { ...HATCH, pattern: 'vertical' });
  assert.deepEqual(vertical.map(([from]) => from[0]).sort((a, b) => a - b), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  // 斜線は右上がり（紙の座標で x と y が一緒に増える）、逆斜線は左上がり。
  const [from, to] = hatchGeometry.linesOf(box, HATCH)[0];
  assert.ok(to[0] > from[0] && to[1] > from[1]);
  const [rFrom, rTo] = hatchGeometry.linesOf(box, { ...HATCH, pattern: 'reverse' })[0];
  assert.ok(rTo[0] > rFrom[0] && rTo[1] < rFrom[1]);
  // 交差斜線と格子は 2 方向を合わせたもの。
  assert.equal(hatchGeometry.linesOf(box, { ...HATCH, pattern: 'grid' }).length, horizontal.length + vertical.length);
  assert.equal(hatchGeometry.linesOf(box, { ...HATCH, pattern: 'cross' }).length, hatchGeometry.linesOf(box, HATCH).length * 2);
  // 大きな図形に細かい間隔でも、1 方向の本数は上限まで。
  assert.ok(hatchGeometry.linesOf([0, 0, 14400, 14400], { ...HATCH, gap: 1 }).length <= hatchGeometry.LINES_MAX + 1);
  assert.deepEqual(hatchGeometry.boxOf({ kind: 'polygon', rect: [0, 0, 9, 9], paths: [[[1, 2], [5, 8], [3, 1]]] }), [1, 1, 5, 8]);
});

test('同じ不透明度でハッチングが無い四角は、今までどおり <g opacity> で 1 つの絵として薄める', () => {
  const doc = makeDoc();
  const svg = SigK.annotationLayer.mount(doc, doc.querySelector('div'), viewport());
  SigK.annotationLayer.draw(svg, [{ ...SQUARE, opacity: 0.5 }], viewport());
  const group = svg.querySelector('g[data-annot]');
  assert.equal(group.getAttribute('opacity'), '0.5');
  assert.equal(group.querySelector('.apart'), null);
});

test('塗りと枠線の不透明度が違う四角は、塗りを塗りの不透明度で、枠線を枠線の不透明度で描き、内側から枠線の帯を抜く', () => {
  const doc = makeDoc();
  const svg = SigK.annotationLayer.mount(doc, doc.querySelector('div'), viewport(2));
  SigK.annotationLayer.draw(svg, [{ ...SQUARE, opacity: 0.6, fillOpacity: 0.3 }], viewport(2));
  const group = svg.querySelector('g[data-annot]');
  assert.equal(group.getAttribute('opacity'), null);
  const apart = group.querySelector('g.apart');
  const inside = apart.querySelector('g.fill-inside');
  const filled = inside.querySelector('rect');
  assert.deepEqual([filled.getAttribute('fill'), filled.getAttribute('fill-opacity'), filled.getAttribute('stroke')], ['#ffd966', '0.3', 'none']);
  // 抜く帯は、白で塗った部品から、黒で同じ太さの線を引いたもの。
  const mask = apart.querySelector(`mask#${inside.getAttribute('mask').slice(5, -1)}`);
  const [white, black] = mask.children;
  assert.deepEqual([white.getAttribute('fill'), black.getAttribute('stroke'), black.getAttribute('stroke-width')], ['#ffffff', '#000000', '8']);
  const stroke = apart.lastElementChild;
  assert.deepEqual([stroke.getAttribute('stroke'), stroke.getAttribute('fill'), stroke.getAttribute('opacity'), stroke.getAttribute('stroke-width')], ['#c00000', 'none', '0.6', '8']);
});

test('ハッチングは塗りつぶしの上・枠線の下に、不透明で、図形の形で切り抜いて描く', () => {
  const doc = makeDoc();
  const entry = { ...SQUARE, kind: 'circle', fillOpacity: 0.4, hatch: { ...HATCH } };
  const group = graphics.svgOf(doc, entry, viewport());
  const inside = group.querySelector('g.fill-inside');
  assert.deepEqual([...inside.children].map((node) => node.tagName), ['ellipse', 'g']);
  const lines = inside.querySelector('g.hatch');
  assert.deepEqual([lines.getAttribute('stroke'), lines.getAttribute('stroke-width'), lines.getAttribute('opacity')], ['#0070c0', '1', null]);
  const clip = group.querySelector(`clipPath#${lines.getAttribute('clip-path').slice(5, -1)}`);
  assert.equal(clip.firstElementChild.tagName, 'ellipse');
  assert.equal(lines.querySelectorAll('line').length, hatchGeometry.linesOf(entry.rect, entry.hatch).length);
  // 枠線が不透明なら、帯は抜かない（枠線が覆う）。
  assert.equal(inside.getAttribute('mask'), null);
  assert.equal(group.lastElementChild.getAttribute('stroke'), '#c00000');
  // 塗りつぶしなしでもハッチングは描き、背景は透過。
  const noFill = graphics.svgOf(doc, { ...entry, fill: null }, viewport());
  assert.equal(noFill.querySelector('g.fill-inside ellipse'), null);
  assert.notEqual(noFill.querySelector('g.hatch'), null);
});

test('回した四角は、ハッチングも図形と一緒に回る（<g> の回転の中に描く）', () => {
  const doc = makeDoc();
  const group = graphics.svgOf(doc, { ...SQUARE, angle: 30, hatch: { ...HATCH } }, viewport());
  assert.match(group.getAttribute('transform'), /^rotate\(30 /);
  assert.notEqual(group.querySelector('g.hatch'), null);
});

// 呼ばれた口と代入を calls に残す ctx。
function recordingContext(calls) {
  return new Proxy({}, {
    get: (_target, name) => (name === 'canvas' ? {} : (...args) => { calls.push([name, ...args]); }),
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
}

test('印刷: 塗りを塗りの不透明度で、ハッチングを不透明で切り抜いて、枠線を枠線の不透明度で描く', () => {
  const calls = [];
  graphics.paint(recordingContext(calls), { ...SQUARE, opacity: 0.6, fillOpacity: 0.3, hatch: { ...HATCH } }, viewport());
  const alphas = calls.filter(([name, field]) => name === 'set' && field === 'globalAlpha').map((call) => call[2]);
  assert.deepEqual(alphas, [0.3, 1, 0.6]);
  const order = calls.filter(([name]) => ['fillRect', 'clip', 'stroke', 'strokeRect'].includes(name)).map(([name]) => name);
  assert.deepEqual(order, ['fillRect', 'clip', 'stroke', 'strokeRect']);
});
