'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  openShell, settle, thumbs, stripPages, rightClick, leftClick, pick, key, planOf, deleteDialog, deleteShown, answerDelete,
} = require('./page-list-fixture.js');

// 削除確認画面（spec-7-5 確定事項D1〜D3・U1）。ページを削除する操作は、どの入口からもこの画面を通す。

const ALL_TEXT = 'すべてのページを削除することはできません。少なくとも 1 ページは残してください。';
const NOTE = '削除したページは、［元に戻す］（Ctrl+Z）で戻せます。';

const textOf = (shell) => shell.document.getElementById('confirm-page-delete-text').textContent;
const noteOf = (shell) => shell.document.getElementById('confirm-page-delete-note');
const okOf = (shell) => shell.document.getElementById('confirm-page-delete-ok');

test('題名は「ページの削除」。1 ページなら「N ページ目を削除しますか？」、複数なら「選択した N ページを削除しますか？」と注記（D2）', async (t) => {
  const shell = await openShell(t);
  assert.equal(deleteDialog(shell).querySelector('.dlg-head').textContent.trim(), 'ページの削除');

  const one = shell.SigK.confirmPageDelete.ask({ count: 1, page: 3 });
  assert.equal(textOf(shell), '3 ページ目を削除しますか？');
  assert.equal(noteOf(shell).textContent, NOTE);
  assert.equal(noteOf(shell).hidden, false);
  assert.equal(okOf(shell).disabled, false);
  assert.equal(shell.document.activeElement.id, 'confirm-page-delete-cancel', '最初のフォーカスは［キャンセル］');
  await answerDelete(shell, false);
  assert.equal(await one, false);

  const many = shell.SigK.confirmPageDelete.ask({ count: 2, page: 1 });
  assert.equal(textOf(shell), '選択した 2 ページを削除しますか？');
  await answerDelete(shell, true);
  assert.equal(await many, true);
  // 「次回から表示しない」は付けない。
  assert.equal(deleteDialog(shell).querySelector('input[type="checkbox"]'), null);
});

test('すべてのページが対象なら、削除できないことを書き、［削除］を押せなくする（D3）', async (t) => {
  const shell = await openShell(t);
  shell.SigK.pageGrid.selectAll();
  shell.document.getElementById('side-scroll').focus();
  key(shell, 'Delete');
  assert.equal(deleteShown(shell), true);
  assert.equal(textOf(shell), ALL_TEXT);
  assert.equal(noteOf(shell).hidden, true);
  assert.equal(okOf(shell).disabled, true);
  okOf(shell).click();
  assert.equal(deleteShown(shell), true, '押せない［削除］では閉じない');
  await answerDelete(shell, false);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
});

test('［キャンセル］と Esc では何も削除しない', async (t) => {
  const shell = await openShell(t);
  shell.SigK.pageGrid.setSelection([1]);
  shell.document.getElementById('side-scroll').focus();
  key(shell, 'Delete');
  assert.equal(textOf(shell), '2 ページ目を削除しますか？');
  await answerDelete(shell, false);
  assert.deepEqual(planOf(shell), [0, 1, 2]);

  shell.document.getElementById('side-scroll').focus();
  key(shell, 'Delete');
  assert.equal(deleteShown(shell), true);
  deleteDialog(shell).dispatchEvent(new shell.window.Event('cancel'));
  await settle(shell);
  assert.equal(deleteShown(shell), false);
  assert.deepEqual(planOf(shell), [0, 1, 2]);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1], '選択は残る');
});

// ---- どの入口からも表示する（D1） ----

test('ページ編集モード: Delete キー・右クリックメニューの［削除］・［削除］ボタン・［このページを削除］のどれも削除確認画面を通す（D1）', async (t) => {
  const shell = await openShell(t);
  const { SigK, document } = shell;
  const entries = [
    ['Delete キー', () => {
      SigK.pageGrid.setSelection([0]);
      document.getElementById('side-scroll').focus();
      key(shell, 'Delete');
    }, '1 ページ目を削除しますか？'],
    ['右クリックメニュー', () => {
      rightClick(shell, thumbs(shell)[1]);
      pick(shell, 'delete');
    }, '2 ページ目を削除しますか？'],
    ['［削除］ボタン', () => {
      SigK.pageGrid.setSelection([0, 2]);
      document.getElementById('act-delete').click();
    }, '選択した 2 ページを削除しますか？'],
    ['［このページを削除］', () => {
      SigK.pageGrid.setSelection([0]);
      thumbs(shell)[2].querySelector('.thumb-tool[data-tool="delete"]').click();
    }, '3 ページ目を削除しますか？'],
  ];
  for (const [name, open, text] of entries) {
    open();
    assert.equal(deleteShown(shell), true, `${name}で削除確認画面が出ない`);
    assert.equal(textOf(shell), text, name);
    assert.equal(SigK.viewer.getState().pageCount, 3, `${name}で確認の前に削除した`);
    await answerDelete(shell, false);
  }
  // ［削除］を押すと削除し、削除した位置に来たページを選択する。
  SigK.pageGrid.setSelection([1]);
  document.getElementById('side-scroll').focus();
  key(shell, 'Delete');
  await answerDelete(shell, true);
  assert.deepEqual(planOf(shell), [0, 2]);
  assert.deepEqual([...SigK.pageGrid.getSelection()], [1]);
});

test('編集モード: 左パネルのサムネイルで Delete を押すと、削除確認画面を通してページを削除する（D1・K1）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  leftClick(shell, thumbs(shell)[2]);
  assert.equal(shell.document.activeElement.id, 'side-scroll');
  key(shell, 'Delete');
  assert.equal(textOf(shell), '3 ページ目を削除しますか？');
  await answerDelete(shell, true);
  assert.deepEqual(planOf(shell), [0, 1]);
  // Ctrl+Z 1 回で戻る（U1。ページ編集の記録）。
  key(shell, 'z', { ctrl: true });
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('ツールモード: 帯で Delete・右クリックメニューの［削除］は削除確認画面を通し、ツールモードの記録で戻る（D1・U1）', async (t) => {
  const shell = await openShell(t, { mode: 'tools' });
  const tabId = shell.SigK.tabs.activeId();
  leftClick(shell, stripPages(shell, 0)[0]);
  assert.equal(shell.document.activeElement.id, 'strips');
  key(shell, 'Delete');
  assert.equal(textOf(shell), '1 ページ目を削除しますか？');
  await answerDelete(shell, true);
  assert.deepEqual(planOf(shell), [1, 2]);
  assert.deepEqual([...shell.SigK.stripSelection.get(tabId)], [0], '削除した位置に来たページを選択する');

  rightClick(shell, stripPages(shell, 0)[1]);
  pick(shell, 'delete');
  assert.equal(textOf(shell), '2 ページ目を削除しますか？');
  await answerDelete(shell, true);
  assert.deepEqual(planOf(shell), [1]);

  key(shell, 'z', { ctrl: true });
  assert.deepEqual(planOf(shell), [1, 2]);
  key(shell, 'z', { ctrl: true });
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('ツールモード: 何も選択していない帯で Delete を押しても、何もしない', async (t) => {
  const shell = await openShell(t, { mode: 'tools' });
  shell.document.getElementById('strips').focus();
  key(shell, 'Delete');
  assert.equal(deleteShown(shell), false);
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});
