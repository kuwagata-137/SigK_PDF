'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// 紙の上の文字入力（spec-4-2 確定事項3〜5・8〜10）。下書きは DOM ではなく状態が真で、
// 枠が捨てられても生き残る。確定は annotate-text.commitDraft へ渡す。
// 置く・直す・履歴との結び付きは annotate-text.test.js（画面全体）が見る。

function makeWorld() {
  const dom = new JSDOM('<!doctype html><div id="view"><div class="pdf-page" data-page="1"></div><div class="pdf-page" data-page="2"></div></div><button id="outside"></button>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.SigK = {};
  // ビューア・指揮は偽物。描き直しと確定の呼び出しだけ控える。
  const calls = { redraw: 0, commits: [] };
  win.SigK.viewer = { redrawAnnotations: () => { calls.redraw += 1; } };
  win.SigK.annotateText = { commitDraft: (draft) => { calls.commits.push(draft); } };
  for (const name of ['free-text-geometry', 'free-text-shape', 'free-text-editor']) {
    const script = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', `${name}.js`), 'utf8');
    win.eval(script);
  }
  const editor = win.SigK.freeTextEditor;
  editor.init(win.document, win);
  return { win, doc: win.document, editor, calls };
}

// 回転 0・倍率 2 の viewport（A4）。
const viewport = {
  width: 595.28 * 2, height: 841.89 * 2, scale: 2, rotation: 0,
  convertToViewportPoint: (x, y) => [x * 2, (841.89 - y) * 2],
  convertToPdfPoint: (px, py) => [px / 2, 841.89 - py / 2],
};

function draft(overrides = {}) {
  return { key: null, entry: null, src: 0, index: 0, origin: [100, 700], text: '', fontSize: 12, color: '#1c2430', rotation: 0, ...overrides };
}

test('begin は枠があれば入力欄を置いてフォーカスし、無ければ状態だけ持つ', () => {
  const { doc, editor, calls } = makeWorld();
  assert.equal(editor.begin(draft()), true);
  assert.equal(editor.isEditing(), true);
  assert.equal(editor.getNode(), null);
  assert.equal(calls.redraw, 1);

  const page = doc.querySelector('.pdf-page[data-page="1"]');
  editor.onPageRendered(0, page, viewport);
  const node = editor.getNode();
  assert.ok(node !== null);
  assert.equal(node.parentNode, page);
  assert.equal(node.className, 'free-text-editor');
  // 枠が戻って再マウントしたときはフォーカスを戻さない（確定事項9）
  assert.notEqual(doc.activeElement, node);
  assert.equal(node.style.fontSize, '24px');
  assert.equal(node.style.padding, '4px');
  assert.equal(parseFloat(node.style.left), 200 - editor.BORDER);
  assert.equal(Math.round(parseFloat(node.style.top) * 100) / 100, Math.round(((841.89 - 700) * 2 - editor.BORDER) * 100) / 100);
  assert.equal(node.style.transform, '');
});

test('置いたときに枠があればフォーカスし、打った文字は下書きへ写る', () => {
  const { doc, win, editor } = makeWorld();
  editor.onPageRendered(0, doc.querySelector('.pdf-page[data-page="1"]'), viewport);
  editor.begin(draft({ text: 'ab' }));
  const node = editor.getNode();
  assert.equal(doc.activeElement, node);
  assert.equal(node.value, 'ab');
  node.value = 'abc\nd';
  node.dispatchEvent(new win.Event('input'));
  assert.equal(editor.getDraft().text, 'abc\nd');
  // 幅は最長行（半角 3 文字 × 0.5em × 12pt = 18pt）、高さは 2 行 × 15pt、倍率 2
  assert.equal(node.style.width, '36px');
  assert.equal(node.style.height, '60px');
});

test('枠が捨てられても下書きは残り、枠が戻れば同じ文字で再マウントする', () => {
  const { doc, editor } = makeWorld();
  const page = doc.querySelector('.pdf-page[data-page="1"]');
  editor.onPageRendered(0, page, viewport);
  editor.begin(draft({ text: '途中' }));
  editor.getNode().value = '途中まで';
  editor.onPageReleased(0);
  assert.equal(editor.getNode(), null);
  assert.equal(editor.isEditing(), true);
  assert.equal(editor.getDraft().text, '途中まで');
  assert.equal(editor.pageOf(0), null);

  editor.onPageRendered(0, page, { ...viewport, scale: 1 });
  assert.equal(editor.getNode().value, '途中まで');
  assert.equal(editor.getNode().style.fontSize, '12px');
  // 別のページの枠は関係ない
  editor.onPageReleased(1);
  assert.ok(editor.getNode() !== null);
});

test('finish は入力欄を閉じて下書きを commitDraft へ渡し、cancel は渡さない', () => {
  const { doc, editor, calls } = makeWorld();
  editor.onPageRendered(0, doc.querySelector('.pdf-page[data-page="1"]'), viewport);
  editor.begin(draft({ key: 'sigk-1', entry: { id: 'sigk-1' }, text: 'x' }));
  assert.equal(editor.editingKey(), 'sigk-1');
  const finished = editor.finish();
  assert.equal(finished.text, 'x');
  assert.equal(finished.key, 'sigk-1');
  assert.equal(editor.isEditing(), false);
  assert.equal(editor.getNode(), null);
  assert.equal(calls.commits.length, 1);
  assert.equal(editor.finish(), null);

  editor.begin(draft({ text: 'y' }));
  assert.equal(editor.cancel(), true);
  assert.equal(calls.commits.length, 1);
  assert.equal(editor.isEditing(), false);
  assert.equal(editor.cancel(), false);
});

test('Esc と Ctrl+Enter は確定し、変換中や素の Enter は入力欄に任せる', () => {
  const { doc, win, editor, calls } = makeWorld();
  editor.onPageRendered(0, doc.querySelector('.pdf-page[data-page="1"]'), viewport);
  editor.begin(draft({ text: 'x' }));
  const node = editor.getNode();
  const fire = (options) => {
    const event = new win.KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...options });
    node.dispatchEvent(event);
    return event;
  };
  assert.equal(fire({ key: 'Enter' }).defaultPrevented, false);
  assert.equal(fire({ key: 'Escape', isComposing: true }).defaultPrevented, false);
  assert.equal(fire({ key: 'Enter', ctrlKey: true, keyCode: 229 }).defaultPrevented, false);
  assert.equal(editor.isEditing(), true);
  assert.equal(fire({ key: 'Enter', ctrlKey: true }).defaultPrevented, true);
  assert.equal(editor.isEditing(), false);
  assert.equal(calls.commits.length, 1);

  editor.begin(draft({ text: 'y' }));
  const escape = new win.KeyboardEvent('keydown', { cancelable: true, bubbles: true, key: 'Escape' });
  editor.getNode().dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(calls.commits.length, 2);
  assert.equal(calls.commits[1].text, 'y');
});

test('枠の外を押すと確定し、その押し離しは 1 度だけ飲み込む', () => {
  const { doc, win, editor, calls } = makeWorld();
  editor.onPageRendered(0, doc.querySelector('.pdf-page[data-page="1"]'), viewport);
  editor.begin(draft({ text: 'x' }));
  // 入力欄の中を押しても確定しない
  editor.getNode().dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(editor.isEditing(), true);
  assert.equal(editor.takeSwallow(), false);

  doc.getElementById('outside').dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(editor.isEditing(), false);
  assert.equal(calls.commits.length, 1);
  assert.equal(editor.takeSwallow(), true);
  assert.equal(editor.takeSwallow(), false);

  // 押し離しが終われば印は消える（#view の外で押したとき用）
  editor.begin(draft({ text: 'y' }));
  doc.getElementById('outside').dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
  doc.getElementById('outside').dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(editor.takeSwallow(), false);
});

test('回転した紙の上では角度を付け、次の begin は前の下書きを確定する', () => {
  const { doc, editor, calls } = makeWorld();
  const rotated = { ...viewport, rotation: 90, convertToViewportPoint: (x, y) => [y * 2, x * 2] };
  editor.onPageRendered(0, doc.querySelector('.pdf-page[data-page="1"]'), rotated);
  editor.begin(draft({ text: 'x', rotation: 0 }));
  assert.equal(editor.getNode().style.transform, 'rotate(90deg)');
  editor.begin(draft({ text: 'y', rotation: 90 }));
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].text, 'x');
  assert.equal(editor.getNode().style.transform, '');
  assert.equal(editor.getDraft().text, 'y');
});
