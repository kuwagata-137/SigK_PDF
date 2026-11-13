'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { A, B, copied, openShell, settle, thumbs, stripPages, rightClick, pick, planOf, deleteShown } = require('./page-list-fixture.js');

// コピー・切り取り・貼り付け（spec-7-5 確定事項PG1・M3〜M5・R1・R2・U1・P1）。右クリックメニューの項目から操作する。
// コピーの中身はワーカー（copy-pages）が作るので、page-transfer.test.js と同じ形の結果を返させる。

const MOSAIC = 'モザイクを保存していないページはコピーできません。「会議資料.pdf」を上書き保存してから、もう一度操作してください。';

async function menuCopy(shell, index, action = 'copy') {
  rightClick(shell, thumbs(shell)[index]);
  pick(shell, action);
  await settle(shell);
}

async function menuPaste(shell, index) {
  rightClick(shell, thumbs(shell)[index]);
  pick(shell, 'paste');
  await settle(shell);
}

test('コピーしたページは、右クリックしたページの前に貼り付け、貼り付けたページを選択する（PG1・M3）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  await menuCopy(shell, 0);
  assert.equal(shell.SigK.viewBanner.text(), '1 ページをコピーしました。');
  assert.deepEqual(planOf(shell), [0, 1, 2], 'コピーしただけでは変わらない');

  await menuPaste(shell, 2);
  assert.deepEqual(planOf(shell), [0, 1, 'i0', 2], '3 ページ目を右クリックして貼り付けると、新しい 3 ページ目になる');
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [2]);
});

test('コピーの中身は、押した時点の内容（保存していない回転を含む）を持ち、貼り付けのたびに作り直さない（M4）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  shell.SigK.pageEdit.rotate(90, [1]);
  await menuCopy(shell, 1);
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.kind, 'copy-pages');
  assert.deepEqual(structuredClone(spec.pages), [{ src: 1, rotate: 90 }]);

  shell.SigK.pageEdit.rotate(90, [1]);
  await menuPaste(shell, 0);
  await menuPaste(shell, 0);
  assert.equal(shell.taskCalls.length, 1, '貼り付けではワーカーを呼ばない');
  assert.deepEqual(planOf(shell), ['i1', 'i0', 0, 1, 2], '何度でも貼り付けられる');
  const inserts = shell.SigK.viewer.peek().inserts;
  assert.notEqual(inserts[0].copy, inserts[1].copy, '貼り付けのたびに新しい写し');
  assert.ok(inserts.every((entry) => entry.bytes.length > 0), '保存に使うバイト列を持っている');
});

test('貼り付けたページは差し込みとして入り、Ctrl+Z 1 回で戻る（P1・U1）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(2)] });
  shell.SigK.pageGrid.setSelection([0, 1]);
  await menuCopy(shell, 0);
  const depth = shell.SigK.pageEdit.getHistoryState().at;
  await menuPaste(shell, 1);
  const plan = shell.SigK.viewer.getPlan();
  assert.deepEqual(planOf(shell), [0, 'i0', 'i1', 1, 2]);
  assert.equal(Number.isInteger(plan[1].insert), true);
  assert.equal(shell.SigK.pageEdit.getHistoryState().at, depth + 1, '1 回の貼り付けで 1 世代');
  shell.SigK.pageEdit.undo();
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('［切り取り］は削除確認画面を出さずに元のページを削除し、貼り付けると移動になる。Ctrl+Z 1 回で戻る（M5・U1）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  await menuCopy(shell, 0, 'cut');
  assert.equal(deleteShown(shell), false);
  assert.deepEqual(planOf(shell), [1, 2]);
  assert.equal(shell.SigK.viewBanner.text(), '1 ページを切り取りました。');
  assert.equal(shell.SigK.pageClipboard.has(), true);

  rightClick(shell, shell.document.getElementById('side-scroll'));
  pick(shell, 'paste');
  await settle(shell);
  assert.deepEqual(planOf(shell), [1, 2, 'i0'], 'ページの無い所で貼り付けると末尾に入る');

  shell.SigK.pageEdit.undo();
  shell.SigK.pageEdit.undo();
  assert.deepEqual(planOf(shell), [0, 1, 2], '切り取りも 1 回で戻る');
});

test('コピーを中止したら、コピーの中身を持たない', async (t) => {
  const shell = await openShell(t, { taskResults: [{ canceled: true }] });
  await menuCopy(shell, 0);
  assert.equal(shell.SigK.pageClipboard.has(), false);
  assert.equal(shell.SigK.viewBanner.text(), 'ページのコピーを中止しました。');
});

test('切り取りを中止したら、元のページを削除しない', async (t) => {
  const shell = await openShell(t, { taskResults: [{ canceled: true }] });
  await menuCopy(shell, 0, 'cut');
  assert.deepEqual(planOf(shell), [0, 1, 2]);
  assert.equal(shell.SigK.viewBanner.text(), '切り取りを中止しました。');
});

test('保存していないモザイクがあるページは、コピー・切り取りできない（R2）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  const plan = shell.SigK.viewer.getPlan();
  plan[1] = { ...plan[1], mosaic: [{ box: [0, 0, 10, 10], block: 8 }] };
  shell.SigK.pageEdit.commit(plan, { after: [] });

  await menuCopy(shell, 1);
  assert.equal(shell.SigK.viewBanner.text(), MOSAIC);
  assert.equal(shell.SigK.pageClipboard.has(), false);
  await menuCopy(shell, 1, 'cut');
  assert.equal(shell.SigK.viewBanner.text(), MOSAIC);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3, '切り取っていない');
  assert.equal(shell.taskCalls.length, 0);
});

// ---- ツールモード（M4・U1） ----

test('ツールモード: 元の帯を閉じても、ほかの帯に貼り付けられる。貼り付けはツールモードの記録に入る（M4・U1）', async (t) => {
  const shell = await openShell(t, { mode: 'tools', paths: [A, B], taskResults: [copied(1)] });
  const [first, second] = shell.SigK.tabs.list().map((tab) => tab.id);
  rightClick(shell, stripPages(shell, 0)[1]);
  pick(shell, 'copy');
  await settle(shell);
  await shell.SigK.tabs.closeTab(first);
  await settle(shell);
  assert.equal(shell.SigK.tabs.count(), 1);

  rightClick(shell, stripPages(shell, 0)[0]);
  pick(shell, 'paste');
  await settle(shell);
  assert.equal(shell.SigK.tabs.activeId(), second);
  assert.deepEqual(planOf(shell), ['i0', 0, 1, 2]);
  assert.deepEqual([...shell.SigK.stripSelection.get(second)], [0], '貼り付けたページを選択する');

  // ツールモードの［元に戻す］はツールモードの記録から戻す。
  shell.SigK.toolHistory.undo();
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('ツールモード: パスワード付きの帯は貼り付け先にならない（R1）', async (t) => {
  const shell = await openShell(t, { mode: 'tools', paths: [A, B], taskResults: [copied(1)] });
  const [, second] = shell.SigK.tabs.list().map((tab) => tab.id);
  rightClick(shell, stripPages(shell, 0)[0]);
  pick(shell, 'copy');
  await settle(shell);
  shell.SigK.tabs.peek(second).file.encrypted = true;

  rightClick(shell, stripPages(shell, 1)[0]);
  assert.equal(shell.SigK.tabs.activeId(), second);
  assert.equal(shell.document.querySelector('#page-menu [data-action="paste"]').getAttribute('aria-disabled'), 'true');
  const result = await shell.SigK.pageListCommands.paste(shell.SigK.pageListTarget.strips(), 0);
  assert.equal(result, false);
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('ツールモード: 切り取りもツールモードの記録に入り、元に戻すで戻る（U1）', async (t) => {
  const shell = await openShell(t, { mode: 'tools', taskResults: [copied(1)] });
  rightClick(shell, stripPages(shell, 0)[2]);
  pick(shell, 'cut');
  await settle(shell);
  assert.deepEqual(planOf(shell), [0, 1]);
  assert.equal(shell.SigK.toolHistory.canUndo(), true);
  shell.SigK.toolHistory.undo();
  assert.deepEqual(planOf(shell), [0, 1, 2]);
});

test('すべてのページを選択しているときの切り取りは何もしない（M5）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(3)] });
  const result = await shell.SigK.pageListCommands.cut(shell.SigK.pageListTarget.thumbs(), [0, 1, 2]);
  assert.equal(result.refused, 'all');
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
});
