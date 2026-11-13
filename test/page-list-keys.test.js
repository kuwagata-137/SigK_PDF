'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  copied, openShell, settle, thumbs, stripPages, rightClick, leftClick, menuShown, key, planOf, deleteShown, answerDelete,
} = require('./page-list-fixture.js');

// ページ一覧のキー（spec-7-5 確定事項K1・K2・M3・R1・T2・P2）。Delete・Ctrl+C/X/V は、ページ一覧にフォーカスがあるときだけページの操作になる。

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

// 編集モードで四角を 1 つ描いて選択する。描いた書き込みの id を返す。
function drawSquare(shell) {
  const { SigK } = shell;
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', node, px([100, 700]));
  mouse(shell, 'mousemove', shell.document.body, px([200, 600]));
  mouse(shell, 'mouseup', node, px([200, 600]));
  SigK.annotate.setTool(null);
  const id = SigK.viewer.getAnnotations().added.at(-1).id;
  SigK.annotate.select(id);
  return id;
}

const annotIds = (shell) => [...shell.SigK.viewer.getAnnotations().added.map((entry) => entry.id)];

// ページ編集モードの Delete だけは、左パネルにフォーカスが無くても効く（spec-1-5 確定事項55 のまま。K1 の 2026-11-12 の直し）。
test('ページ編集モード: 左パネルにフォーカスが無いとき、Delete は削除確認画面を表示し、Ctrl+C はページの操作にしない（K1）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  shell.SigK.pageGrid.setSelection([1]);
  shell.document.body.focus();
  key(shell, 'Delete', { target: shell.document.body });
  assert.equal(deleteShown(shell), true);
  await answerDelete(shell, false);
  assert.equal(deleteShown(shell), false);
  const copy = key(shell, 'c', { ctrl: true, target: shell.document.body });
  await settle(shell);
  assert.equal(copy.defaultPrevented, false);
  assert.equal(shell.taskCalls.length, 0);

  thumbs(shell)[1].click();
  shell.document.getElementById('side-scroll').focus();
  assert.equal(key(shell, 'c', { ctrl: true }).defaultPrevented, true);
  await settle(shell);
  assert.equal(shell.SigK.pageClipboard.has(), true);
});

test('Ctrl+V は、選択中のページのうち最も前のページの前へ、何も選択していなければ末尾へ貼り付ける（M3）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  shell.SigK.pageGrid.setSelection([0]);
  shell.document.getElementById('side-scroll').focus();
  key(shell, 'c', { ctrl: true });
  await settle(shell);

  shell.SigK.pageGrid.setSelection([2, 1]);
  key(shell, 'v', { ctrl: true });
  await settle(shell);
  assert.deepEqual(planOf(shell), [0, 'i0', 1, 2]);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1], '貼り付けたページを選択する');

  shell.SigK.pageGrid.clearSelection();
  key(shell, 'v', { ctrl: true });
  await settle(shell);
  assert.deepEqual(planOf(shell), [0, 'i0', 1, 2, 'i1']);
});

test('Ctrl+X は選択したページを切り取る。何も選択していなければ何もしない（M5）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  shell.document.getElementById('side-scroll').focus();
  key(shell, 'x', { ctrl: true });
  await settle(shell);
  assert.equal(shell.taskCalls.length, 0);

  shell.SigK.pageGrid.setSelection([2]);
  key(shell, 'x', { ctrl: true });
  await settle(shell);
  assert.deepEqual(planOf(shell), [0, 1]);
  assert.equal(deleteShown(shell), false, '切り取りは削除確認画面を表示しない');
});

test('編集モード: ページ表示にフォーカスがあるときは、Delete・Backspace は書き込みを削除し、Ctrl+C は文字のコピーのまま（K2）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  shell.SigK.pageGrid.setSelection([0]);
  drawSquare(shell);
  shell.document.body.focus();
  assert.equal(key(shell, 'c', { ctrl: true, target: shell.document.body }).defaultPrevented, false, '文字のコピーの既定の動きを止めない');
  key(shell, 'Delete', { target: shell.document.body });
  assert.deepEqual(annotIds(shell), []);
  assert.equal(deleteShown(shell), false);
  drawSquare(shell);
  key(shell, 'Backspace', { target: shell.document.body });
  assert.deepEqual(annotIds(shell), []);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
});

test('編集モード: 左パネルにフォーカスがあるときは、Delete はページの削除になり、Backspace は何もしない（K1・K2）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  const id = drawSquare(shell);
  leftClick(shell, thumbs(shell)[1]);
  assert.equal(shell.document.activeElement.id, 'side-scroll');
  key(shell, 'Backspace');
  assert.deepEqual(annotIds(shell), [id], 'Backspace で書き込みを削除した');
  assert.equal(deleteShown(shell), false);

  key(shell, 'Delete');
  assert.equal(deleteShown(shell), true);
  await answerDelete(shell, false);
  assert.deepEqual(annotIds(shell), [id], 'Delete で書き込みを削除した');
});

test('ツールモード: 帯をクリックした後だけ、Delete がページの操作になる（K1）', async (t) => {
  const shell = await openShell(t, { mode: 'tools' });
  const tabId = shell.SigK.tabs.activeId();
  shell.SigK.stripSelection.set(tabId, [1], shell.SigK.tabs.peek(tabId).plan);
  shell.document.body.focus();
  key(shell, 'Delete', { target: shell.document.body });
  assert.equal(deleteShown(shell), false);

  leftClick(shell, stripPages(shell, 0)[1]);
  key(shell, 'Delete');
  assert.equal(deleteShown(shell), true);
  await answerDelete(shell, false);
});

test('パスワード付きのタブ・保存の途中では、Delete・Ctrl+C/X/V は何もしない（R1・P2）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  shell.SigK.pageGrid.setSelection([1]);
  shell.document.getElementById('side-scroll').focus();
  shell.SigK.viewer.getState().file.encrypted = true;
  for (const [name, ctrl] of [['Delete', false], ['c', true], ['x', true], ['v', true]])
    assert.equal(key(shell, name, { ctrl }).defaultPrevented, true, `${name} の既定の動きを止めない`);
  await settle(shell);
  assert.equal(deleteShown(shell), false);
  assert.equal(shell.taskCalls.length, 0);

  shell.SigK.viewer.getState().file.encrypted = false;
  shell.window.SigK.save.isBusy = () => true;
  key(shell, 'Delete');
  key(shell, 'c', { ctrl: true });
  await settle(shell);
  assert.equal(deleteShown(shell), false);
  assert.equal(shell.taskCalls.length, 0);
});

test('ツールモード: 分割を選んでいるときは、Delete は何もしない（T2）', async (t) => {
  const shell = await openShell(t, { mode: 'tools' });
  const tabId = shell.SigK.tabs.activeId();
  shell.SigK.tools.select('split');
  await settle(shell);
  shell.SigK.stripSelection.set(tabId, [1], shell.SigK.tabs.peek(tabId).plan);
  shell.document.getElementById('strips').focus();
  key(shell, 'Delete');
  assert.equal(deleteShown(shell), false);
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('右クリックメニューを表示している間のキーは、メニューを閉じてからページ一覧で受ける（P3・K1）', async (t) => {
  const shell = await openShell(t);
  rightClick(shell, thumbs(shell)[0]);
  assert.equal(menuShown(shell), true);
  key(shell, 'Delete');
  assert.equal(menuShown(shell), false);
  assert.equal(deleteShown(shell), true);
  await answerDelete(shell, false);
});

test('commandOf はキーを操作の名前にする（Shift・Alt 付きは受けない）', async (t) => {
  const shell = await openShell(t);
  const { commandOf } = shell.SigK.pageListKeys;
  const of = (init) => commandOf({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...init });
  assert.equal(of({ key: 'Delete' }), 'delete');
  assert.equal(of({ key: 'Backspace' }), 'none');
  assert.equal(of({ key: 'C', ctrlKey: true }), 'copy');
  assert.equal(of({ key: 'x', ctrlKey: true }), 'cut');
  assert.equal(of({ key: 'v', ctrlKey: true }), 'paste');
  assert.equal(of({ key: 'v', ctrlKey: true, shiftKey: true }), null);
  assert.equal(of({ key: 'Delete', shiftKey: true }), null);
  assert.equal(of({ key: 'c', ctrlKey: true, altKey: true }), null);
  assert.equal(of({ key: 'a', ctrlKey: true }), null);
});
