'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-print-layer.js');
require('../renderer/free-text-decor-graphics.js');
require('../renderer/shape-rotation.js');
require('../renderer/callout-geometry.js');
require('../renderer/callout-graphics.js');

// テキストの塗りと枠線の画面と印刷の部品（spec-4b-4a 確定事項D1〜D3）。

const decor = globalThis.SigK.freeTextDecorGraphics;
const ENTRY = { kind: 'text', rect: [100, 670, 200, 700], rotation: 0, fill: '#fff2cc', borderColor: '#c00000', borderWidth: 2 };

test('hasDecor は塗りか枠線があるときだけ true', () => {
  assert.equal(decor.hasDecor(ENTRY), true);
  assert.equal(decor.hasDecor({ fill: null }), false);
  assert.equal(decor.hasDecor({ borderColor: '#000000' }), true);
});

test('svgParts は塗りを箱いっぱい、枠線を箱の内側（太さの半分入れた四角）に置く', () => {
  const doc = new JSDOM('<!doctype html>').window.document;
  const [fill, border] = decor.svgParts(doc, ENTRY, 2);
  assert.deepEqual(['x', 'y', 'width', 'height', 'fill'].map((name) => fill.getAttribute(name)), ['0', '0', '200', '60', '#fff2cc']);
  assert.deepEqual(['x', 'y', 'width', 'height', 'stroke', 'stroke-width', 'fill'].map((name) => border.getAttribute(name)), ['2', '2', '196', '56', '#c00000', '4', 'none']);
  assert.deepEqual(decor.svgParts(doc, { ...ENTRY, fill: undefined, borderColor: undefined }, 1), []);
});

test('paint は塗りを fillRect、枠線を内側の strokeRect で描く', () => {
  const calls = [];
  const ctx = {
    fillRect: (...args) => calls.push(['fillRect', ...args]), strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    set fillStyle(v) { calls.push(['fillStyle', v]); }, set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set lineWidth(v) { calls.push(['lineWidth', v]); }, set lineJoin(v) {},
  };
  decor.paint(ctx, ENTRY, 1);
  assert.deepEqual(calls, [['fillStyle', '#fff2cc'], ['fillRect', 0, 0, 100, 30], ['strokeStyle', '#c00000'], ['lineWidth', 2], ['strokeRect', 1, 1, 98, 28]]);
});

test('layerFor は回した箱の外接だけの別の canvas を作り、作れなければ null', () => {
  const doc = new JSDOM('<!doctype html>').window.document;
  const made = [];
  const page = { width: 1000, height: 1000, ownerDocument: { createElement: () => { const canvas = { width: 0, height: 0, getContext: () => ({ translate: (x, y) => made.push([x, y]) }) }; return canvas; } } };
  const layer = decor.layerFor({ canvas: page }, ENTRY, [50, 60], 90, 1);
  // 90° 回すと、幅 100・高さ 30 の箱は左へ 30、下へ 100 の外接になる（余白 2）。
  assert.deepEqual([layer.x, layer.y, layer.canvas.height], [18, 58, 104]);
  assert.ok(layer.canvas.width >= 34 && layer.canvas.width <= 35, `幅 ${layer.canvas.width}（cos 90° の端数で 1px 広がることがある）`);
  assert.deepEqual(made, [[-18, -58]]);
  assert.equal(decor.layerFor({ canvas: { ownerDocument: doc, width: 0, height: 0 } }, ENTRY, [0, 0], 0, 1), null);
});

// 吹き出しは四角の代わりに角の丸い箱としっぽの輪郭を描き、印刷の別の層はしっぽも含む（spec-4b-4b 確定事項C7）。
test('吹き出しは svgParts・paint を callout-graphics に任せ、layerFor はしっぽを含む外接にする', () => {
  const doc = new JSDOM('<!doctype html>').window.document;
  const entry = { ...ENTRY, fontSize: 10, tip: [125, 650] };
  const parts = decor.svgParts(doc, entry, 1);
  assert.deepEqual(parts.map((node) => node.getAttribute('class')), ['free-text-callout']);
  const calls = [];
  const ctx = new Proxy({}, { get: (target, name) => (name in target ? target[name] : (...args) => calls.push(name)), set: (target, name, value) => { calls.push(`${String(name)}=${value}`); return true; } });
  decor.paint(ctx, entry, 1);
  assert.ok(calls.includes('bezierCurveTo') && !calls.includes('fillRect'));
  const page = { width: 1000, height: 1000, ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ translate: () => {} }) }) } };
  // 回さなければ、しっぽの先（左上から下へ 50）まで含む: 高さ 50＋線の太さの半分 1＋余白 2×2。
  const layer = decor.layerFor({ canvas: page }, entry, [50, 60], 0, 1);
  assert.deepEqual([layer.x, layer.y, layer.canvas.width, layer.canvas.height], [48, 58, 104, 55]);
});
