'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/shape-outline.js');
require('../renderer/shape-figure.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-print-layer.js');
require('../renderer/shape-graphics.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-layer.js');
require('../renderer/marking-rules.js');
require('../renderer/marking-glyphs.js');
require('../renderer/marking-geometry.js');
require('../renderer/marking-graphics.js');
require('../renderer/eraser-reach.js');

// 画面と印刷のマーキング（spec-7-9 確定事項F2・F3・F5）。形 5 種の部品、当たり、消しゴムの線。

const SigK = globalThis.SigK;
const geometry = SigK.markingGeometry;

const H = 841.89;
function viewport(scale = 1) {
  return { width: 595.28 * scale, height: H * scale, scale, rotation: 0, convertToViewportPoint: (x, y) => [x * scale, (H - y) * scale] };
}

function makeDoc() {
  return new JSDOM('<!doctype html><div></div>').window.document;
}

const SIZES = { outer: 32, dot: 9, ring: 16, cross: 44.8, fontSize: 16 };
function markingEntry(shape, extra = {}) {
  const marking = { shape, ...SIZES, ...(shape === 'number' ? { number: 7 } : {}), ...extra };
  return { id: `m-${shape}`, src: 0, kind: 'marking', color: '#0070c0', opacity: 1, lineWidth: 3, text: '', marking, ...geometry.frameOf(marking, [100, 700]) };
}

function draw(entry, scale = 1) {
  const doc = makeDoc();
  const svg = SigK.annotationLayer.mount(doc, doc.querySelector('div'), viewport(scale));
  SigK.annotationLayer.draw(svg, [entry], viewport(scale));
  return svg.querySelector('g[data-annot]');
}

test('点付き丸は、外の円の線（線は円の内側）と、中心を塗った中の円。中は塗らない', () => {
  const group = draw(markingEntry('target'), 2);
  assert.equal(group.getAttribute('data-kind'), 'marking');
  const marking = group.querySelector('g.marking.target');
  assert.equal(marking.getAttribute('fill'), 'none');
  assert.equal(marking.getAttribute('stroke'), '#0070c0');
  const [outer, dot] = marking.querySelectorAll('circle');
  // 中心 (100, 700) → 表示 (200, (841.89 − 700) × 2)。外の円の線の中心の半径は (32 − 3) / 2 = 14.5pt。
  assert.deepEqual(['cx', 'cy', 'r', 'stroke-width'].map((name) => outer.getAttribute(name)), ['200', '283.78', '29', '6']);
  assert.equal(outer.getAttribute('fill'), null);
  assert.deepEqual(['r', 'fill', 'stroke'].map((name) => dot.getAttribute(name)), ['9', '#0070c0', 'none']);
});

test('二重丸は外の円と中の円がどちらも線。照準は十字線（外の円より長い）。注意マークは三角形と「！」', () => {
  const double = draw(markingEntry('double')).querySelectorAll('circle');
  assert.equal(double.length, 2);
  assert.equal(double[1].getAttribute('r'), '6.5');
  assert.equal(double[1].getAttribute('fill'), null);
  const lines = [...draw(markingEntry('crosshair')).querySelectorAll('line')];
  assert.equal(lines.length, 2);
  assert.deepEqual(['x1', 'x2', 'stroke-linecap'].map((name) => lines[0].getAttribute(name)), ['77.6', '122.4', 'butt']);
  const caution = draw(markingEntry('caution'));
  assert.equal(caution.querySelector('circle:not([fill])'), null, '外の円は描かない');
  assert.equal(caution.querySelectorAll('polygon').length, 1);
  assert.equal(caution.querySelector('line').getAttribute('stroke-linecap'), 'round');
  assert.equal(caution.querySelector('circle[fill]').getAttribute('fill'), '#0070c0');
});

test('番号付き丸は外の円の中に番号を線で描く。番号の桁ごとに折れ線が増える', () => {
  const one = draw(markingEntry('number', { number: 1 }));
  assert.equal(one.querySelectorAll('circle').length, 1);
  assert.equal(one.querySelectorAll('polyline').length, 1);
  const twelve = draw(markingEntry('number', { number: 12 }));
  assert.equal(twelve.querySelectorAll('polyline').length, 2);
  // 番号の線の太さは文字の高さ（文字サイズの 0.7 倍）の 0.12 倍。
  assert.equal(twelve.querySelector('polyline').getAttribute('stroke-width'), '1.34');
  // 数字はどれも折れ線を持つ。
  for (let digit = 0; digit <= 9; digit += 1)
    assert.ok(SigK.markingGlyphs.GLYPHS[digit].length >= 1);
});

test('不透明度は <g opacity> で 1 つの絵として薄める', () => {
  assert.equal(draw({ ...markingEntry('target'), opacity: 0.4 }).getAttribute('opacity'), '0.4');
});

test('印刷は同じ部品を canvas に描く（円は arc、中の円は塗る）', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])),
    set: (target, name, value) => { calls.push([`=${String(name)}`, value]); return true; },
  });
  SigK.annotationLayer.paint(ctx, [markingEntry('target')], viewport());
  const arcs = calls.filter(([name]) => name === 'arc');
  assert.deepEqual(arcs.map((call) => call.slice(1, 4)), [[100, 141.89, 14.5], [100, 141.89, 4.5]]);
  assert.equal(calls.filter(([name]) => name === 'fill').length, 1);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1);
});

test('当たりは外の円の内側全体（余裕つき）。照準ははみ出した十字線、注意マークは三角形の中', () => {
  const target = markingEntry('target');
  assert.equal(geometry.hits(target, [100, 700]), true, '中心（透けている所）でも当たる');
  assert.equal(geometry.hits(target, [115.5, 700]), true);
  assert.equal(geometry.hits(target, [118, 700]), false);
  assert.equal(geometry.hits(target, [118, 700], 3), true);
  const crosshair = markingEntry('crosshair');
  assert.equal(geometry.hits(crosshair, [121, 700]), true, '十字線の先');
  assert.equal(geometry.hits(crosshair, [121, 705]), false);
  const caution = markingEntry('caution');
  assert.equal(geometry.hits(caution, [100, 700]), true);
  assert.equal(geometry.hits(caution, [86, 712]), false, '三角形の外（左上の隅）');
});

test('消しゴムは線に触れても、内側をなぞっても丸ごと削除する', () => {
  const target = markingEntry('target');
  assert.equal(SigK.eraserReach.touches(target, [[100, 700]], 1), true);
  assert.equal(SigK.eraserReach.touches(target, [[117, 700], [117, 690]], 1), true, "線の外側の縁から 1pt の所をなぞった");
  assert.equal(SigK.eraserReach.touches(target, [[130, 700]], 1), false);
});
