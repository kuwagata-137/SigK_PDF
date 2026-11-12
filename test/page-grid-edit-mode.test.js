'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openShell, thumbs, planOf } = require('./page-list-fixture.js');

// 編集モードのサムネイル（spec-7-5 確定事項E1）。クリック・Ctrl＋クリック・Shift＋クリック・ドラッグ（並べ替え）を、ページ編集モードと同じ動きにする。
// 選択の状態はページ編集モードと共通（タブごと）。

function clickThumb(shell, index, { ctrl = false, shift = false } = {}) {
  thumbs(shell)[index].dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, ctrlKey: ctrl, shiftKey: shift }));
}

function centerOf(shell, index) {
  const page = shell.SigK.thumbnails.getLayout().pages[index];
  return { x: page.left + page.width / 2, y: page.top + page.height / 2 };
}

test('編集モードでサムネイルをクリックすると、そのページを表示して選択する（E1）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  clickThumb(shell, 2);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [2]);
  assert.equal(shell.SigK.viewer.getState().current, 2);
  assert.equal(thumbs(shell)[2].classList.contains('selected'), true);
});

test('編集モードで Ctrl＋クリックは選択を追加・解除し、Shift＋クリックは範囲を選択する（E1）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  clickThumb(shell, 0);
  clickThumb(shell, 2, { shift: true });
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [0, 1, 2]);
  clickThumb(shell, 1, { ctrl: true });
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [0, 2]);
  clickThumb(shell, 1, { ctrl: true });
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [0, 1, 2]);
  assert.equal(shell.SigK.viewer.getState().current, 0, '複数を選択している間は表示を動かさない');
});

test('編集モードでサムネイルをドラッグすると並べ替え、Ctrl+Z 1 回で戻る（E1）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  const { firePointer } = shell;
  const start = centerOf(shell, 0);
  const end = centerOf(shell, 2);
  firePointer(thumbs(shell)[0], 'pointerdown', start);
  firePointer(thumbs(shell)[0], 'pointermove', { x: end.x, y: end.y + 40 });
  assert.equal(shell.SigK.pageGrid.isDragging(), true);
  firePointer(thumbs(shell)[2], 'pointerup', { x: end.x, y: end.y + 40 });
  assert.deepEqual(planOf(shell), [1, 2, 0]);
  shell.SigK.pageEdit.undo();
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('選択の状態はページ編集モードと共通。紙の上の小さなボタンは編集モードには出さない（E1）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  clickThumb(shell, 1);
  assert.equal(shell.document.querySelector('#thumbs .thumb-tools'), null);
  shell.SigK.shell.setMode(shell.document, 'pages');
  await shell.flush();
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1]);
  assert.notEqual(shell.document.querySelector('#thumbs .thumb-tools'), null);
});

test('編集モードで注釈一覧を表示しているときは、選択とドラッグを受けない', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  shell.SigK.shell.setEditSide(shell.document, 'list');
  await shell.flush();
  assert.equal(shell.SigK.pageGrid.handleClick(1, {}), false);
});
