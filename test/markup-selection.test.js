'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/markup-quads.js');
require('../renderer/markup-selection.js');

// 文字の選択範囲をページごとの四角に切る層（spec-4-1 確定事項11〜14）。
// jsdom は配置しないので、矩形は span に持たせた pt の位置から作る（rectsOf を差し替える）。

const selection = globalThis.SigK.markupSelection;

// 回転 0・倍率 1 の viewport（A4）。
const VIEWPORT = {
  convertToViewportPoint: (x, y) => [x, 841.89 - y],
  convertToPdfPoint: (px, py) => [px, 841.89 - py],
};

const ITEMS = [
  { str: 'あいうえお', transform: [12, 0, 0, 12, 50, 700], width: 60, fontName: 'f1' },
  { str: '', hasEOL: true },
  { str: 'かきくけこ', transform: [12, 0, 0, 12, 50, 680], width: 60, fontName: 'f1' },
];
const STYLES = { f1: { ascent: 0.9, descent: -0.2 } };

// 1 ページぶんの DOM と handle。span は str を持つ item にだけ作る（本物の TextLayer と同じ）。
function makePage(dom, number) {
  const doc = dom.window.document;
  const node = doc.createElement('div');
  node.className = 'pdf-page';
  node.dataset.page = String(number);
  const text = doc.createElement('div');
  text.className = 'textLayer';
  node.append(text);
  const divs = ITEMS.map((item) => {
    const span = doc.createElement('span');
    span.textContent = item.str;
    if (item.transform !== undefined) {
      span.dataset.x = item.transform[4];
      span.dataset.y = item.transform[5];
      span.dataset.w = item.width;
      span.dataset.h = 12;
      text.append(span);
    }
    return span;
  });
  doc.body.append(node);
  const handle = { viewport: VIEWPORT, textDivs: () => divs, items: () => ITEMS, styles: () => STYLES };
  return { index: number - 1, src: number - 1, node, handle, spans: divs.filter((div) => div.isConnected) };
}

// 矩形を span の pt から作る。部分選択は文字数で按分。
function rectsOf(range, div) {
  const length = div.textContent.length || 1;
  const from = range.startContainer === div.firstChild ? range.startOffset : 0;
  const to = range.endContainer === div.firstChild ? range.endOffset : length;
  const x = Number(div.dataset.x);
  const y = Number(div.dataset.y);
  const w = Number(div.dataset.w);
  const left = x + w * (from / length);
  const right = x + w * (to / length);
  const top = 841.89 - (y + 13);
  const bottom = 841.89 - (y - 4);
  return [{ left, top, right, bottom, width: right - left, height: bottom - top }];
}

function setup() {
  const dom = new JSDOM('<!doctype html><body></body>');
  const pages = [makePage(dom, 1), makePage(dom, 2)];
  const doc = dom.window.document;
  const select = (startSpan, startOffset, endSpan, endOffset) => {
    const range = doc.createRange();
    range.setStart(startSpan.firstChild, startOffset);
    range.setEnd(endSpan.firstChild, endOffset);
    const sel = dom.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel;
  };
  return { dom, doc, pages, select };
}

test('span 全体を選ぶと、横は矩形から、縦はフォントからの四角が 1 つできる', () => {
  const { doc, pages, select } = setup();
  const sel = select(pages[0].spans[0], 0, pages[0].spans[0], 5);
  const found = selection.collect({ doc, selection: sel, pages, rectsOf });
  assert.equal(found.length, 1);
  assert.equal(found[0].src, 0);
  assert.deepEqual(found[0].quads, [[50, 710.8, 110, 710.8, 50, 697.6, 110, 697.6]]);
  assert.deepEqual(found[0].rect, [50, 697.6, 110, 710.8]);
  assert.equal(found[0].text, 'あいうえお');
});

test('部分選択は文字の範囲だけ、複数の span は行ごとに四角になる', () => {
  const { doc, pages, select } = setup();
  const sel = select(pages[0].spans[0], 2, pages[0].spans[1], 3);
  const found = selection.collect({ doc, selection: sel, pages, rectsOf });
  assert.equal(found.length, 1);
  assert.equal(found[0].quads.length, 2);
  assert.deepEqual(found[0].quads[0].slice(0, 4), [74, 710.8, 110, 710.8]);
  assert.deepEqual(found[0].quads[1].slice(0, 4), [50, 690.8, 86, 690.8]);
  assert.deepEqual(found[0].rect, [50, 677.6, 110, 710.8]);
  assert.equal(found[0].text, 'うえおかきく');
});

test('ページをまたぐ選択はページごとに分かれる', () => {
  const { doc, pages, select } = setup();
  const sel = select(pages[0].spans[1], 0, pages[1].spans[0], 5);
  const found = selection.collect({ doc, selection: sel, pages, rectsOf });
  assert.deepEqual(found.map((page) => page.src), [0, 1]);
  assert.equal(found[0].quads.length, 1);
  assert.equal(found[1].quads.length, 1);
  assert.equal(found[1].text, 'あいうえお');
});

test('空の選択・何も選んでいない・テキストレイヤーの無いページでは空', () => {
  const { dom, doc, pages, select } = setup();
  assert.deepEqual(selection.collect({ doc, selection: null, pages, rectsOf }), []);
  assert.deepEqual(selection.collect({ doc, selection: dom.window.getSelection(), pages, rectsOf }), []);
  const sel = select(pages[0].spans[0], 2, pages[0].spans[0], 2);
  assert.deepEqual(selection.collect({ doc, selection: sel, pages, rectsOf }), []);
  const bare = [{ ...pages[0], handle: null }];
  const whole = select(pages[0].spans[0], 0, pages[0].spans[0], 5);
  assert.deepEqual(selection.collect({ doc, selection: whole, pages: bare, rectsOf }), []);
});

test('大きさの無い矩形は捨てる', () => {
  const { doc, pages, select } = setup();
  const sel = select(pages[0].spans[0], 0, pages[0].spans[0], 5);
  const found = selection.collect({ doc, selection: sel, pages, rectsOf: () => [{ left: 1, top: 1, right: 1, bottom: 1, width: 0, height: 0 }] });
  assert.deepEqual(found, []);
});

test('文字は 200 字で切る', () => {
  const { doc, pages, select } = setup();
  const long = 'x'.repeat(300);
  pages[0].spans[0].textContent = long;
  const sel = select(pages[0].spans[0], 0, pages[0].spans[0], 300);
  const found = selection.collect({ doc, selection: sel, pages, rectsOf });
  assert.equal(found[0].text.length, selection.TEXT_LIMIT);
});
