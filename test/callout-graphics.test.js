'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/shape-rotation.js');
require('../renderer/free-text-geometry.js');
require('../renderer/callout-geometry.js');
require('../renderer/callout-graphics.js');

// 吹き出しの画面と印刷の部品（spec-4b-4b 確定事項C4・C7・D2）。

const graphics = globalThis.SigK.calloutGraphics;
const geometry = globalThis.SigK.calloutGeometry;
// 表示の左上 (100, 700)、幅 100・高さ 30、先は左上から右へ 25・下へ 50。
const ENTRY = {
  kind: 'text', rect: [100, 670, 200, 700], rotation: 0, fontSize: 10, fill: '#ffffff', borderColor: '#c00000', borderWidth: 2, tip: [125, 650],
};

test('localTipOf は先を表示の左上から見た右と下にする（文字の向き 90 も）', () => {
  assert.deepEqual(graphics.localTipOf(ENTRY), [25, 50]);
  // 向き 90: 表示の左上は rect の左下、表示の右は紙の上、下は紙の右。
  const turned = { ...ENTRY, rect: [100, 600, 130, 700], rotation: 90, tip: [180, 625] };
  assert.deepEqual(graphics.localTipOf(turned), [25, 80]);
});

test('outlineOf は枠線の太さの半分だけ内側に入れた輪郭で、先を通る', () => {
  const outline = graphics.outlineOf(ENTRY);
  assert.deepEqual(outline, geometry.outlineOf({ width: 100, height: 30, tip: [25, 50], fontSize: 10, inset: 1 }));
  assert.equal(outline.edge, 'bottom');
  // 枠線なしは内側に入れない。
  assert.deepEqual(graphics.outlineOf({ ...ENTRY, borderColor: null }).segments[0].points[0], [6, 0]);
});

test('svgParts は塗りと枠線を 1 本の path で描き、角を丸く結ぶ（倍率を掛ける）', () => {
  const doc = new JSDOM('<!doctype html>').window.document;
  const [path, ...rest] = graphics.svgParts(doc, ENTRY, 2);
  assert.equal(rest.length, 0);
  assert.equal(path.getAttribute('class'), 'free-text-callout');
  assert.deepEqual(['fill', 'stroke', 'stroke-width', 'stroke-linejoin'].map((name) => path.getAttribute(name)), ['#ffffff', '#c00000', '4', 'round']);
  assert.match(path.getAttribute('d'), /^M 14 2 /, '左上の角の丸みの終わりから（(1 + 6) × 2）');
  assert.match(path.getAttribute('d'), / L 50 100 /, '先 (25, 50) × 2 を通る');
  const plain = graphics.svgParts(doc, { ...ENTRY, fill: null }, 1)[0];
  assert.equal(plain.getAttribute('fill'), 'none');
  const noBorder = graphics.svgParts(doc, { ...ENTRY, borderColor: null }, 1)[0];
  assert.deepEqual([noBorder.getAttribute('stroke'), noBorder.getAttribute('stroke-width')], ['none', '0']);
});

test('paint は同じ輪郭を canvas に描き、塗ってから線を引く', () => {
  const calls = [];
  const ctx = {
    beginPath: () => calls.push('beginPath'), moveTo: () => calls.push('moveTo'), lineTo: () => calls.push('lineTo'),
    bezierCurveTo: () => calls.push('bezierCurveTo'), closePath: () => calls.push('closePath'),
    fill: () => calls.push('fill'), stroke: () => calls.push('stroke'),
    set fillStyle(v) { calls.push(`fillStyle ${v}`); }, set strokeStyle(v) { calls.push(`strokeStyle ${v}`); },
    set lineWidth(v) { calls.push(`lineWidth ${v}`); }, set lineJoin(v) { calls.push(`lineJoin ${v}`); },
  };
  graphics.paint(ctx, ENTRY, 1);
  assert.equal(calls[0], 'beginPath');
  assert.equal(calls.filter((call) => call === 'bezierCurveTo').length, 4);
  assert.deepEqual(calls.slice(calls.indexOf('closePath')), ['closePath', 'fillStyle #ffffff', 'fill', 'strokeStyle #c00000', 'lineWidth 2', 'lineJoin round', 'stroke']);
});

test('boundsOf は箱と先を含む外接（倍率を掛ける）', () => {
  assert.deepEqual(graphics.boundsOf(ENTRY, 2), [0, 0, 200, 102]);
});

test('hitsTail はしっぽに当たり、回した吹き出しでは回したしっぽに当たる（確定事項C4）', () => {
  // 先 (125, 650) と根元の間（箱の下端 670 の少し下）。
  assert.equal(graphics.hitsTail(ENTRY, [125, 660], 0), true);
  assert.equal(graphics.hitsTail(ENTRY, [180, 660], 0), false);
  // 180° 回すと、しっぽは箱の中心 (150, 685) の向こう側へ回る。
  const turned = { ...ENTRY, angle: 180 };
  assert.equal(graphics.hitsTail(turned, [125, 660], 0), false);
  assert.equal(graphics.hitsTail(turned, [175, 710], 0), true);
});

test('createEditorOutline と placeEditorOutline は入力中の輪郭を入力欄の左上に回して置く（確定事項D2）', () => {
  const doc = new JSDOM('<!doctype html>').window.document;
  const svg = graphics.createEditorOutline(doc);
  assert.equal(svg.getAttribute('class'), 'callout-editor-outline');
  graphics.placeEditorOutline(svg, { ...ENTRY, kind: undefined }, { at: [40, 60], angle: 30, scale: 2, size: { width: 50, height: 20 }, tip: [10, 40] });
  assert.deepEqual([svg.style.left, svg.style.top, svg.style.transform], ['40px', '60px', 'rotate(30deg)']);
  const path = svg.querySelector('path');
  assert.match(path.getAttribute('d'), / L 20 80 /, '先 (10, 40) × 2');
  graphics.placeEditorOutline(svg, ENTRY, { at: [0, 0], angle: 0, scale: 1, size: { width: 50, height: 20 }, tip: [10, 40] });
  assert.equal(svg.style.transform, '');
  assert.equal(svg.querySelectorAll('path').length, 1, '描き直しで重ならない');
});
