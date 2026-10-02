'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-shape.js');

// 画面のテキスト注釈（spec-4-2 確定事項10・14・29・33）。フォントの先読み、幅の計測、
// SVG の <text>、印刷用の canvas 2D の描き手。

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

test('layoutOf は表示の左上・角度・行を出す', () => {
  const layout = shape.layoutOf(ENTRY, viewport({ scale: 2 }));
  assert.deepEqual(layout.origin, [200, (841.89 - 720) * 2]);
  assert.equal(layout.angle, 0);
  assert.equal(layout.scale, 2);
  assert.deepEqual(layout.lines, ['こんにちは', 'ab']);
  // 置いたあとに紙を 90 度回すと、画面では 90 度傾く。
  assert.equal(shape.layoutOf(ENTRY, viewport({ rotation: 90 })).angle, 90);
  assert.equal(shape.layoutOf({ ...ENTRY, rotation: 90 }, viewport({ rotation: 90 })).angle, 0);
});

test('svgOf は行ごとの <text> を回転付きの <g> に入れる', () => {
  const doc = makeDoc();
  const g = shape.svgOf(doc, ENTRY, viewport({ scale: 2 }));
  assert.equal(g.tagName.toLowerCase(), 'g');
  assert.equal(g.getAttribute('class'), 'free-text');
  assert.equal(g.getAttribute('fill'), '#d92c2c');
  assert.equal(g.getAttribute('transform'), 'translate(200 243.78) rotate(0)');
  const texts = [...g.querySelectorAll('text')];
  assert.deepEqual(texts.map((t) => t.textContent), ['こんにちは', 'ab']);
  assert.deepEqual(texts.map((t) => t.getAttribute('font-size')), ['24', '24']);
  // x は余白、y は余白＋ベースライン（＋行送り）。すべて倍率を掛けた px。
  assert.deepEqual(texts.map((t) => Number(t.getAttribute('x'))), [PADDING * 2, PADDING * 2]);
  assert.deepEqual(texts.map((t) => Number(t.getAttribute('y'))),
    [(PADDING + BASELINE * 12) * 2, (PADDING + BASELINE * 12 + LINE_HEIGHT * 12) * 2].map((v) => Math.round(v * 100) / 100));
  assert.equal(texts[0].getAttribute('xml:space'), 'preserve');
});

test('svgOf は回転した紙の上では角度を付ける', () => {
  const doc = makeDoc();
  const g = shape.svgOf(doc, ENTRY, viewport({ rotation: 90 }));
  assert.equal(g.getAttribute('transform'), 'translate(720 100) rotate(90)');
});

test('paint は canvas 2D に同じ位置と角度で fillText する', () => {
  const calls = [];
  const ctx = {
    save: () => calls.push(['save']), restore: () => calls.push(['restore']),
    translate: (x, y) => calls.push(['translate', x, y]), rotate: (r) => calls.push(['rotate', r]),
    fillText: (text, x, y) => calls.push(['fillText', text, x, y]),
    set font(v) { calls.push(['font', v]); }, set fillStyle(v) { calls.push(['fillStyle', v]); },
    set textBaseline(v) { calls.push(['textBaseline', v]); }, set globalAlpha(v) { calls.push(['alpha', v]); },
  };
  assert.equal(shape.paint(ctx, ENTRY, viewport({ scale: 2, rotation: 90 })), 2);
  assert.deepEqual(calls[0], ['save']);
  assert.ok(calls.some(([name, v]) => name === 'font' && v === '24px "SigK Noto Sans JP"'));
  assert.ok(calls.some(([name, v]) => name === 'fillStyle' && v === '#d92c2c'));
  assert.ok(calls.some(([name, v]) => name === 'textBaseline' && v === 'alphabetic'));
  assert.deepEqual(calls.find(([name]) => name === 'translate'), ['translate', 1440, 200]);
  assert.deepEqual(calls.find(([name]) => name === 'rotate'), ['rotate', Math.PI / 2]);
  const texts = calls.filter(([name]) => name === 'fillText');
  assert.deepEqual(texts.map((c) => c[1]), ['こんにちは', 'ab']);
  assert.deepEqual(texts.map((c) => c[2]), [PADDING * 2, PADDING * 2]);
  assert.equal(texts[1][3] - texts[0][3], LINE_HEIGHT * 12 * 2);
  assert.deepEqual(calls.at(-1), ['restore']);
});

// ---- 新しい形の描き方（spec-4b-4a 確定事項D） ----

test('svgOf は太字なら font-weight 700、斜体なら font-style italic を付け、行と中身の位置は free-text-metrics.js から取る', (t) => {
  globalThis.SigK.freeTextMetrics = { layoutOfEntry: () => ({ lines: ['こんにち', 'は'], inset: { left: 2.96, top: 2 } }) };
  t.after(() => { delete globalThis.SigK.freeTextMetrics; });
  const doc = makeDoc();
  const g = shape.svgOf(doc, { ...ENTRY, width: 'auto', bold: true, italic: true }, viewport({ scale: 2 }));
  assert.equal(g.getAttribute('font-weight'), '700');
  assert.equal(g.getAttribute('font-style'), 'italic');
  const texts = [...g.querySelectorAll('text')];
  assert.deepEqual(texts.map((el) => el.textContent), ['こんにち', 'は']);
  assert.deepEqual(texts.map((el) => Number(el.getAttribute('x'))), [5.92, 5.92]);
  const plain = shape.svgOf(doc, ENTRY, viewport({ scale: 2 }));
  assert.equal(plain.hasAttribute('font-weight') || plain.hasAttribute('font-style'), false);
});

test('paint は太字・斜体を font に入れ、詰めと合字を切って描く', () => {
  const state = {};
  const ctx = {
    save() {}, restore() {}, translate() {}, rotate() {}, fillText() {},
    set font(v) { state.font = v; }, set fillStyle(v) {}, set textBaseline(v) {}, set globalAlpha(v) {},
    set fontKerning(v) { state.fontKerning = v; }, set textRendering(v) { state.textRendering = v; },
  };
  shape.paint(ctx, { ...ENTRY, bold: true, italic: true, width: 'auto' }, viewport({ scale: 2 }));
  assert.deepEqual(state, { font: 'italic 700 24px "SigK Noto Sans JP"', fontKerning: 'none', textRendering: 'optimizeSpeed' });
});

// ---- 塗りと枠線（spec-4b-4a 確定事項D1〜D3） ----

test('svgOf は塗りと枠線を文字より先に置き、paint は半透明で飾りがあれば別の canvas に描いてから重ねる', () => {
  require('../renderer/shape-print-layer.js');
  require('../renderer/free-text-decor-graphics.js');
  const doc = makeDoc();
  const decorated = { ...ENTRY, width: 'auto', fill: '#fff2cc', borderColor: '#c00000', borderWidth: 2 };
  const g = shape.svgOf(doc, decorated, viewport());
  assert.deepEqual([...g.children].map((node) => node.getAttribute('class') ?? node.tagName.toLowerCase()), ['free-text-fill', 'free-text-border', 'text', 'text']);

  const drawn = [];
  const layerCtx = { save() {}, restore() {}, translate() {}, rotate() {}, fillText: (text) => drawn.push(['layer', text]), fillRect() {}, strokeRect() {} };
  const page = { width: 1000, height: 1000, ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => layerCtx }) } };
  const ctx = {
    canvas: page, save() {}, restore() {}, translate() {}, rotate() {}, fillText: (text) => drawn.push(['page', text]), fillRect() {}, strokeRect() {},
    drawImage: (canvas, x, y) => drawn.push(['image', x, y]),
    set globalAlpha(value) { drawn.push(['alpha', value]); },
  };
  shape.paint(ctx, { ...decorated, opacity: 0.5 }, viewport());
  assert.deepEqual(drawn.filter(([kind]) => kind !== 'alpha').map(([kind]) => kind), ['layer', 'layer', 'image']);
  assert.ok(drawn.some(([kind, value]) => kind === 'alpha' && value === 0.5));
});
