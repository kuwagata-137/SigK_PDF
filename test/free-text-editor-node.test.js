'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// 紙の上の入力欄の要素（spec-4-2 確定事項3・9・10。free-text-editor.js から移した作る・置く部分）。

function makeWorld() {
  const dom = new JSDOM('<!doctype html><div class="pdf-page"></div>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.SigK = {};
  for (const name of ['free-text-geometry', 'free-text-shape', 'free-text-editor-node']) {
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
