'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// 紙の上の入力欄の要素（spec-4-2 確定事項3・9・10。free-text-editor.js から移した作る・置く部分）。

function makeWorld() {
  const dom = new JSDOM('<!doctype html><div class="pdf-page"></div>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.SigK = {};
  for (const name of ['free-text-geometry', 'free-text-shape', 'free-text-wrap', 'free-text-layout', 'free-text-metrics', 'free-text-editor-node']) {
    const script = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', `${name}.js`), 'utf8');
    win.eval(script);
  }
  return { win, doc: win.document, node: win.SigK.freeTextEditorNode };
}

test('create は折り返しの無い textarea を作り、入力とキーを渡す', () => {
  const { doc, node } = makeWorld();
  const calls = [];
  const area = node.create(doc, 'あいう', { onInput: () => calls.push('input'), onKeyDown: () => calls.push('key') });
  assert.equal(area.tagName, 'TEXTAREA');
  assert.equal(area.className, 'free-text-editor');
  assert.equal(area.getAttribute('aria-label'), 'テキストの書き込み');
  assert.equal(area.wrap, 'off');
  assert.equal(area.value, 'あいう');
  area.dispatchEvent(new doc.defaultView.Event('input'));
  area.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'a' }));
  assert.deepEqual(calls, ['input', 'key']);
});

test('place は表示の左上へ枠線ぶん外に置き、倍率で大きさを、画面の角度で向きを付ける', () => {
  const { doc, node } = makeWorld();
  const area = node.create(doc, '', { onInput() {}, onKeyDown() {} });
  const viewport = { scale: 2, rotation: 90, convertToViewportPoint: (x, y) => [x * 2, (842 - y) * 2] };
  node.place(area, { origin: [100, 700], fontSize: 12, color: '#c00000', rotation: 0 }, viewport);
  assert.equal(area.style.left, `${200 - node.BORDER}px`);
  assert.equal(area.style.top, `${284 - node.BORDER}px`);
  assert.equal(area.style.fontSize, '24px');
  assert.equal(area.style.padding, '4px');
  assert.equal(area.style.transform, 'rotate(90deg)');
});

// ---- 新しい形の入力欄（spec-4b-4a 確定事項E） ----

test('place は新しい形を折り返す入力欄にし、余白と斜体の分を内側の余白に、太字・斜体を文字に当てる', () => {
  const { doc, node } = makeWorld();
  const area = node.create(doc, '', { onInput() {}, onKeyDown() {} });
  const viewport = { scale: 2, rotation: 0, convertToViewportPoint: (x, y) => [x * 2, (842 - y) * 2] };
  node.place(area, { origin: [100, 700], fontSize: 12, color: '#c00000', rotation: 0, width: 'auto', bold: true, italic: true }, viewport);
  assert.equal(area.wrap, 'soft');
  assert.equal(area.classList.contains('wrapped'), true);
  // 上 2・右 2＋3（斜体の右）・下 2・左 2＋0.96（斜体の左）を倍率 2 で。
  assert.equal(area.style.padding, '4px 10px 4px 5.92px');
  assert.equal(area.style.fontWeight, '700');
  assert.equal(area.style.fontStyle, 'italic');
  // 今までの形に戻すと、折り返さない入力欄に戻る。
  node.place(area, { origin: [100, 700], fontSize: 12, color: '#c00000', rotation: 0 }, viewport);
  assert.equal(area.wrap, 'off');
  assert.equal(area.classList.contains('wrapped'), false);
  assert.equal(area.style.fontWeight, '');
});

test('autosize は新しい形なら真ん中の幅と折り返した行数の高さにする', () => {
  const { doc, node } = makeWorld();
  const area = node.create(doc, 'あいうえおかきくけこさしすせそ', { onInput() {}, onKeyDown() {} });
  const viewport = { scale: 2, rotation: 0, convertToViewportPoint: (x, y) => [x * 2, (842 - y) * 2] };
  const draft = { src: 0, origin: [100, 700], fontSize: 10, color: '#000000', rotation: 0, width: 'auto' };
  node.place(area, draft, viewport);
  node.autosize(area, draft, viewport);
  // 12 字（120）と、送った 1 字を足した 130 の真ん中 125。2 行 × 12.5。どちらも倍率 2。
  assert.equal(area.style.width, '250px');
  assert.equal(area.style.height, '50px');
});
