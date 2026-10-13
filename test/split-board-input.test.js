'use strict';

// 分割の盤を押す・なぞる・キーで動かす（spec-2-2b 確定事項C3・G2・G3）。
// 本物のマウスでは click の前に pointerdown が来るので、押して離して click まで送る（page-grid.test.js と同じ作法）。
// jsdom は大きさを計算しない（getBoundingClientRect は 0）ので、盤の器の幅と高さを与え、位置は配置の計算から取る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

async function createInputShell(t, { pages = 12 } = {}) {
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
  for (let i = 0; i < 4; i += 1)
    await shell.flush();
  return shell;
}

const plain = (value) => structuredClone(value);
const range = (shell) => plain(shell.SigK.splitSelection.range(shell.SigK.toolsSplitEdit.selection()));
const pageNode = (shell, page) => shell.document.querySelector(`.sb-page[data-page="${page}"]`);

function centerOf(shell, page) {
  const rect = shell.SigK.splitLayout.pageRect(shell.SigK.splitBoardView.layout(), page);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function pointer(shell, type, target, { x, y }, { shift = false } = {}) {
  const Ctor = shell.window.PointerEvent ?? shell.window.MouseEvent;
  target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: shift }));
}

// 動かさずに押して離す（クリック）。
function press(shell, page, { shift = false } = {}) {
  const node = pageNode(shell, page);
  const point = centerOf(shell, page);
  pointer(shell, 'pointerdown', node, point, { shift });
  pointer(shell, 'pointerup', node, point, { shift });
  node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, detail: 1, shiftKey: shift }));
}

function key(shell, target, name, extra = {}) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event);
  return event;
}

test('クリックはその 1 枚を選び、Shift＋クリックはその間を選ぶ', async (t) => {
  const shell = await createInputShell(t);
  press(shell, 2);
  assert.deepEqual(range(shell), { from: 2, to: 2 });
  press(shell, 5, { shift: true });
  assert.deepEqual(range(shell), { from: 2, to: 5 });
  assert.equal(shell.document.getElementById('split-band-text').textContent, '3〜6 ページを選んでいます');
});

test('押したままなぞると、押したページからなぞった所までを選ぶ。なぞったあとの click は捨てる', async (t) => {
  const shell = await createInputShell(t);
  press(shell, 7);
  const start = centerOf(shell, 1);
  pointer(shell, 'pointerdown', pageNode(shell, 1), start);
  pointer(shell, 'pointermove', shell.document, { x: start.x + 2, y: start.y });
  assert.deepEqual(range(shell), { from: 7, to: 7 }, '5px までは動かしても、なぞりは始まらない');
  const end = centerOf(shell, 6);
  pointer(shell, 'pointermove', shell.document, end);
  assert.deepEqual(range(shell), { from: 1, to: 6 });
  pointer(shell, 'pointerup', shell.document, end);
  pageNode(shell, 6).dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.deepEqual(range(shell), { from: 1, to: 6 }, 'なぞり終えたときの click では選び直さない');
});

test('なぞる途中の Esc は、なぞる前の選択に戻して止める（ほかの Esc の段には流さない）', async (t) => {
  const shell = await createInputShell(t);
  press(shell, 0);
  pointer(shell, 'pointerdown', pageNode(shell, 3), centerOf(shell, 3));
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 5));
  assert.deepEqual(range(shell), { from: 3, to: 5 });
  const event = key(shell, shell.document.body, 'Escape');
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(range(shell), { from: 0, to: 0 });
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 8));
  assert.deepEqual(range(shell), { from: 0, to: 0 }, 'Esc のあとは動かしても選ばない');
});

test('文字を打つ欄（N・ページ番号）の中の Esc は、選択を外さない（確定事項G2③）', async (t) => {
  const shell = await createInputShell(t);
  press(shell, 4);
  for (const id of ['split-every', 'split-at']) {
    const input = shell.document.getElementById(id);
    input.focus();
    key(shell, input, 'Escape');
    assert.deepEqual(range(shell), { from: 4, to: 4 }, id);
  }
});

test('ダブルクリックは、2 回目の click で盤が描き直されても大きく見る窓を開く（ページ番号の上でも）', async (t) => {
  // Chromium は click と同じ要素へ dblclick を配る。2 回目の click で盤が作り直されると、その要素は文書から外れ、
  // dblclick が盤の器まで届かない（点検 R1）。2 回目の click（detail が 2）で開く。
  const shell = await createInputShell(t);
  const clickAt = (node, detail) => node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  clickAt(pageNode(shell, 4).querySelector('.cap'), 1);
  const second = pageNode(shell, 4).querySelector('.cap');
  clickAt(second, 2);
  second.dispatchEvent(new shell.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
  for (let i = 0; i < 3; i += 1)
    await shell.flush();
  assert.equal(shell.SigK.splitZoom.isOpen(), true);
  assert.equal(shell.SigK.splitZoom.current(), 4);
});

test('選んでいないときの Shift＋→ は、今のページから選択を広げる', async (t) => {
  const shell = await createInputShell(t);
  const scroll = shell.document.getElementById('split-board-scroll');
  scroll.focus();
  key(shell, scroll, 'ArrowRight');
  assert.equal(range(shell), null, 'Shift なしでは今のページが動くだけ');
  key(shell, scroll, 'ArrowRight', { shiftKey: true });
  assert.deepEqual(range(shell), { from: 1, to: 2 });
});

test('0 ページの PDF でも、盤の上のキーで止まらない', async (t) => {
  const shell = await createInputShell(t, { pages: 0 });
  const errors = [];
  shell.window.addEventListener('error', (event) => errors.push(event.error ?? event.message));
  const scroll = shell.document.getElementById('split-board-scroll');
  scroll.focus();
  for (const name of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', ' ', 'Enter'])
    key(shell, scroll, name);
  assert.deepEqual(errors, []);
});

test('なぞっている途中で窓が非活性になったら、なぞるのを取りやめて前の選択に戻す', async (t) => {
  const shell = await createInputShell(t);
  press(shell, 0);
  pointer(shell, 'pointerdown', pageNode(shell, 3), centerOf(shell, 3));
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 5));
  assert.deepEqual(range(shell), { from: 3, to: 5 });
  shell.window.dispatchEvent(new shell.window.Event('blur'));
  assert.deepEqual(range(shell), { from: 0, to: 0 });
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 8));
  assert.deepEqual(range(shell), { from: 0, to: 0 }, '取りやめたあとは動かしても選ばない');
});

test('なぞっていないときの Esc は、選択を外す（確定事項G2④）', async (t) => {
  const shell = await createInputShell(t);
  press(shell, 4);
  assert.deepEqual(range(shell), { from: 4, to: 4 });
  key(shell, shell.document.body, 'Escape');
  assert.equal(range(shell), null);
});

test('✂ と［つなげる］の上では、なぞり始めない', async (t) => {
  const shell = await createInputShell(t);
  const cut = shell.document.querySelector('.sb-cut[data-cut="3"]');
  const at = centerOf(shell, 3);
  pointer(shell, 'pointerdown', cut, at);
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 6));
  assert.equal(range(shell), null);
  // ページの上からなら、同じ動かし方でなぞれる（上の確かめが空振りでないこと）。
  pointer(shell, 'pointerup', shell.document, centerOf(shell, 6));
  pointer(shell, 'pointerdown', pageNode(shell, 3), at);
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 6));
  assert.deepEqual(range(shell), { from: 3, to: 6 });
});

test('盤の上のキー: ←→ で今のページを動かし、Shift で選択を広げ、Space で選ぶ。Home・End で端へ', async (t) => {
  const shell = await createInputShell(t);
  const scroll = shell.document.getElementById('split-board-scroll');
  scroll.focus();
  const right = key(shell, scroll, 'ArrowRight');
  assert.equal(right.defaultPrevented, true);
  assert.equal(shell.SigK.splitBoardInput.current(), 1, '今のページが無ければ先頭から');
  assert.equal(pageNode(shell, 1).classList.contains('current'), true);
  key(shell, scroll, ' ');
  assert.deepEqual(range(shell), { from: 1, to: 1 });
  key(shell, scroll, 'ArrowRight', { shiftKey: true });
  key(shell, scroll, 'ArrowRight', { shiftKey: true });
  assert.deepEqual(range(shell), { from: 1, to: 3 });
  key(shell, scroll, 'End');
  assert.equal(shell.SigK.splitBoardInput.current(), 11);
  key(shell, scroll, 'Home');
  assert.equal(shell.SigK.splitBoardInput.current(), 0);
  key(shell, scroll, 'ArrowLeft');
  assert.equal(shell.SigK.splitBoardInput.current(), 0, '先頭より前へは行かない');
});

test('↑↓ は上下の段へ動く（1 段に 4 枚の箱）', async (t) => {
  const shell = await createInputShell(t);
  const scroll = shell.document.getElementById('split-board-scroll');
  press(shell, 1);
  key(shell, scroll, 'ArrowDown');
  assert.equal(shell.SigK.splitBoardInput.current(), 5);
  key(shell, scroll, 'ArrowUp');
  assert.equal(shell.SigK.splitBoardInput.current(), 1);
});

test('盤のキーは裏の画面へ流さない', async (t) => {
  const shell = await createInputShell(t);
  const scroll = shell.document.getElementById('split-board-scroll');
  let reached = false;
  shell.document.addEventListener('keydown', () => { reached = true; });
  key(shell, scroll, 'PageDown');
  key(shell, scroll, 'ArrowDown');
  assert.equal(reached, false);
});

// ---- 元に戻す・やり直すのキー（spec-2-2b 確定事項G1） ----

test('分割の画面の Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z は、文書が開いていなくても盤の操作を戻す・やり直す', async (t) => {
  const shell = await createInputShell(t);
  const edit = shell.SigK.toolsSplitEdit;
  edit.cut(3);
  edit.cut(6);
  const parts = () => plain(shell.SigK.toolsSplit.currentPlan().parts).map((pages) => pages.length);
  const z = key(shell, shell.document.body, 'z', { ctrlKey: true });
  assert.equal(z.defaultPrevented, true);
  assert.deepEqual(parts(), [3, 9]);
  key(shell, shell.document.body, 'y', { ctrlKey: true });
  assert.deepEqual(parts(), [3, 3, 6]);
  key(shell, shell.document.body, 'z', { ctrlKey: true });
  key(shell, shell.document.body, 'Z', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(parts(), [3, 3, 6]);
});

test('まとめて分けるの欄の中の Ctrl+Z は、欄の文字の取り消しに任せて盤を戻さない', async (t) => {
  const shell = await createInputShell(t);
  shell.SigK.toolsSplitEdit.cut(3);
  const input = shell.document.getElementById('split-at');
  input.focus();
  const event = key(shell, input, 'z', { ctrlKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(shell.SigK.toolsSplitEdit.canUndo(), true, '盤は戻していない');
});

test('文書を開いていても、分割の画面の Ctrl+Z は文書の編集ではなく盤を戻す', async (t) => {
  const shell = await createInputShell(t);
  const { SigK, document: doc } = shell;
  await SigK.tabs.openPath(A);
  await shell.flush();
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  SigK.shell.setMode(doc, 'tools');
  SigK.tools.select('split');
  SigK.toolsSplitEdit.cut(3);
  key(shell, doc.body, 'z', { ctrlKey: true });
  assert.equal(SigK.toolsSplitEdit.canUndo(), false, '盤を戻した');
  assert.equal(SigK.viewer.isDirty(), true, '文書の編集は残っている');
  SigK.tools.select('merge');
  key(shell, doc.body, 'z', { ctrlKey: true });
  assert.equal(SigK.viewer.isDirty(), false, 'ほかのツールの画面では、今までどおり文書の編集を戻す');
});
