'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-font.js');

// テキスト注釈の書体と字の幅（spec-4-2 確定事項33、spec-4b-4a 確定事項B6・D4）。free-text-shape.js から移した（spec-4b-4b）。

const shape = globalThis.SigK.freeTextFont;

function makeDoc() {
  return new JSDOM('<!doctype html><div class="pdf-page"></div>').window.document;
}

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
