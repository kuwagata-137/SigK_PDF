'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-shape.js');

// 画面のテキスト注釈の書体（spec-4-2 確定事項10・14・29・33）。フォントの先読みと幅の計測。
// SVG の <text> と印刷用の canvas 2D の描き手は test/free-text-graphics.test.js。

const shape = globalThis.SigK.freeTextShape;
const { PADDING, BASELINE, LINE_HEIGHT } = globalThis.SigK.freeTextGeometry;

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

const ENTRY = {
  id: 'sigk-9', src: 0, kind: 'text', color: '#d92c2c', opacity: 1, text: 'こんにちは\nab', fontSize: 12, rotation: 0,
  rect: [100, 690, 164, 720], quads: [[100, 720, 164, 720, 100, 690, 164, 690]],
};

test('FAMILY と fontOf は同梱フォントの名前を使う', () => {
  assert.equal(shape.FAMILY, 'SigK Noto Sans JP');
  assert.equal(shape.fontOf(12), '12px "SigK Noto Sans JP"');
});

test('ensureLoaded は document.fonts が無ければ false で、あれば標準と太字の load を一度だけ待つ', async () => {
  const bare = makeDoc();
  assert.equal(await shape.ensureLoaded(bare), false);

  const loads = [];
  const doc = makeDoc();
  Object.defineProperty(doc, 'fonts', { value: { load: async (font) => { loads.push(font); return []; } } });
  assert.equal(await shape.ensureLoaded(doc), true);
  assert.equal(await shape.ensureLoaded(doc), true);
  // 標準と太字を一度ずつ（spec-4b-4a 確定事項D4）。
  assert.deepEqual(loads, ['12px "SigK Noto Sans JP"', '700 12px "SigK Noto Sans JP"']);
  assert.equal(shape.isLoaded(), true);
});

test('measure は canvas が無ければ全角 1em・半角 0.5em の見積もり', () => {
  const doc = makeDoc();
  assert.equal(shape.measure(doc, 'あい', 12), 24);
  assert.equal(shape.measure(doc, 'ab', 12), 12);
  assert.equal(shape.measure(doc, '', 12), 0);
  assert.equal(shape.measure(doc, 'あa', 10), 15);
});

test('measure は canvas があればそれで測る', () => {
  const doc = makeDoc();
  doc.defaultView.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  const calls = [];
  const original = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = original(tag);
    if (tag === 'canvas')
      node.getContext = () => ({ set font(value) { calls.push(value); }, measureText: (text) => ({ width: text.length * 7 }) });
    return node;
  };
  assert.equal(shape.measure(doc, 'abc', 14), 21);
  assert.deepEqual(calls, ['14px "SigK Noto Sans JP"']);
});

// ---- 字の送り幅（spec-4b-4a 確定事項B6。事前調査 E） ----

test('fontOf は太字なら weight 700 を付ける', () => {
  assert.equal(shape.fontOf(12, true), '700 12px "SigK Noto Sans JP"');
  assert.equal(shape.fontOf(12, false), '12px "SigK Noto Sans JP"');
});

test('advanceOf は canvas が無ければ全角 1em・半角 0.5em の見積もり', () => {
  const doc = makeDoc();
  assert.equal(shape.advanceOf(doc, 'あ'), 1);
  assert.equal(shape.advanceOf(doc, 'a', true), 0.5);
});

test('advanceOf は kerning を切った canvas で 1000px で測って em にし、フォントが読めていれば字ごとに覚える', async () => {
  const doc = makeDoc();
  Object.defineProperty(doc, 'fonts', { value: { load: async () => [] } });
  await shape.ensureLoaded(doc);
  doc.defaultView.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  const measured = [];
  const original = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = original(tag);
    if (tag === 'canvas') {
      const ctx = { font: '', fontKerning: 'auto', measureText: (text) => {
        measured.push([ctx.font, ctx.fontKerning, text]);
        return { width: ctx.font.startsWith('700 ') ? 943 : 500 };
      } };
      node.getContext = () => ctx;
    }
    return node;
  };
  assert.equal(shape.advanceOf(doc, 'W', true), 0.943);
  assert.equal(shape.advanceOf(doc, 'W', true), 0.943);
  assert.equal(shape.advanceOf(doc, 'W'), 0.5);
  assert.deepEqual(measured, [['700 1000px "SigK Noto Sans JP"', 'none', 'W'], ['1000px "SigK Noto Sans JP"', 'none', 'W']]);
});
