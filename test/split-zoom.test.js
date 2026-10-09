'use strict';

// 分割の盤のページを大きく見る窓（spec-2-2b 第 E 章。見本 screenshots/phase2-2b-06-zoom.png）。
// jsdom には showModal が無いので open 属性で代える（help-dialog.js と同じ）。描いたかは pdf.js の偽物の viewportCalls、
// 手放したかは cleanups で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

async function createZoomShell(t, { pages = 6 } = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: pages }, () => A4) }),
    files: { [A]: makeSource({ path: A }) },
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  const scroll = shell.document.getElementById('split-board-scroll');
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 500 });
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  await shell.SigK.toolsSplit.setSource(A);
  await settle(shell);
  return shell;
}

const settle = async (shell) => {
  for (let i = 0; i < 6; i += 1)
    await shell.flush();
};
const $ = (shell, selector) => shell.document.querySelector(selector);
const dialog = (shell) => $(shell, '#split-zoom');
const key = (shell, target, name) => target.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

async function doubleClick(shell, page) {
  $(shell, `.sb-page[data-page="${page}"]`).dispatchEvent(new shell.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await settle(shell);
}

test('ページをダブルクリックすると窓が開き、何ページ目か・どのファイルに入るかを出す', async (t) => {
  const shell = await createZoomShell(t);
  shell.SigK.toolsSplitEdit.cut(3);
  shell.pdfjs.viewportCalls.length = 0;
  await doubleClick(shell, 4);
  assert.equal(dialog(shell).hasAttribute('open'), true);
  assert.equal($(shell, '#split-zoom-title').textContent, '5 / 6 ページ');
  assert.equal($(shell, '#split-zoom-file').textContent, 'a_002.pdf に入るページです');
  assert.ok(shell.pdfjs.viewportCalls.some((call) => call.page === 5), '5 ページ目を描いた');
  assert.deepEqual(structuredClone(shell.SigK.splitZoom.current()), 4);
});

test('← → で前後のページへ移り、移るたびに前のページを手放す。端では止まり、ボタンも押せない', async (t) => {
  const shell = await createZoomShell(t);
  await doubleClick(shell, 0);
  assert.equal($(shell, '#split-zoom-prev').getAttribute('aria-disabled'), 'true');
  shell.pdfjs.cleanups.length = 0;
  key(shell, dialog(shell), 'ArrowRight');
  await settle(shell);
  assert.equal(shell.SigK.splitZoom.current(), 1);
  assert.equal($(shell, '#split-zoom-title').textContent, '2 / 6 ページ');
  assert.ok(shell.pdfjs.cleanups.includes(1), '1 ページ目を手放した');
  key(shell, dialog(shell), 'ArrowLeft');
  key(shell, dialog(shell), 'ArrowLeft');
  await settle(shell);
  assert.equal(shell.SigK.splitZoom.current(), 0);
  $(shell, '#split-zoom-next').click();
  await settle(shell);
  assert.equal(shell.SigK.splitZoom.current(), 1);
});

test('Esc と × で閉じ、持っていたページを手放す', async (t) => {
  const shell = await createZoomShell(t);
  await doubleClick(shell, 2);
  shell.pdfjs.cleanups.length = 0;
  key(shell, dialog(shell), 'Escape');
  assert.equal(dialog(shell).hasAttribute('open'), false);
  assert.ok(shell.pdfjs.cleanups.includes(3));
  assert.equal(shell.SigK.splitZoom.isOpen(), false);
  await doubleClick(shell, 1);
  $(shell, '#split-zoom-close').click();
  assert.equal(dialog(shell).hasAttribute('open'), false);
});

test('書き出さないページは、そう出す', async (t) => {
  const shell = await createZoomShell(t);
  shell.SigK.toolsSplitEdit.select(2);
  shell.SigK.toolsSplitEdit.skip();
  await doubleClick(shell, 2);
  assert.equal($(shell, '#split-zoom-file').textContent, '書き出さないページです');
});

test('盤にフォーカスがあるときの Enter でも開く。開いている間のキーは盤へ届かない', async (t) => {
  const shell = await createZoomShell(t);
  const scroll = $(shell, '#split-board-scroll');
  scroll.focus();
  key(shell, scroll, 'ArrowRight');
  key(shell, scroll, 'Enter');
  await settle(shell);
  assert.equal(shell.SigK.splitZoom.current(), 1);
  key(shell, dialog(shell), 'ArrowRight');
  await settle(shell);
  assert.equal(shell.SigK.splitBoardInput.current(), 1, '盤の今のページは動かない');
});
