'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  A, B, copied, openShell, settle, thumbs, stripNodes, stripPages, rightClick, leftClick, menu, menuShown, itemOf, enabledItems, key,
} = require('./page-list-fixture.js');
const { createPdfjsStub } = require('./harness.js');

// ページの右クリックメニュー（spec-7-5 確定事項M1・M2・M5・T1・T2・R1・P2・P3・PG2）。項目を押したときの操作は page-clipboard.test.js と
// confirm-page-delete.test.js が見る。

const ALL = ['copy', 'cut', 'paste', 'delete'];

test('メニューの項目は、上から［コピー］［切り取り］［貼り付け］・区切り線・［削除］（M1）', async (t) => {
  const shell = await openShell(t);
  const rows = [...menu(shell).children].map((node) => (node.getAttribute('role') === 'separator'
    ? '---'
    : `${node.querySelector('.label').textContent}／${node.querySelector('.key').textContent}`));
  assert.deepEqual(rows, ['コピー／Ctrl+C', '切り取り／Ctrl+X', '貼り付け／Ctrl+V', '---', '削除／Delete']);
  assert.equal(itemOf(shell, 'delete').classList.contains('danger'), true, '［削除］は危険色');
  // 見た目は書き込みの右クリックメニューと同じ（同じクラスの CSS）。
  assert.equal(menu(shell).classList.contains('annot-menu'), true);
  assert.equal(menuShown(shell), false);
});

test('ページ編集モード: 選択していないページを右クリックすると、そのページだけを選択して表示する（M2）', async (t) => {
  const shell = await openShell(t);
  shell.SigK.pageGrid.setSelection([0, 1]);
  const event = rightClick(shell, thumbs(shell)[2], { x: 120, y: 80 });
  assert.equal(event.defaultPrevented, true);
  assert.equal(menuShown(shell), true);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [2]);
  assert.equal(menu(shell).style.left, '120px');
  assert.equal(menu(shell).style.top, '80px');
  // コピーしたページが無いので［貼り付け］は灰色（M1）。
  assert.deepEqual(enabledItems(shell), ['copy', 'cut', 'delete']);
  assert.equal(shell.SigK.viewer.getState().current, 0, '右クリックではページを移らない');
});

test('選択したページの上で右クリックすると、選択はそのまま（M2）', async (t) => {
  const shell = await openShell(t);
  shell.SigK.pageGrid.setSelection([0, 1]);
  rightClick(shell, thumbs(shell)[1]);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [0, 1]);
  assert.equal(menuShown(shell), true);
});

test('すべてのページを選択しているときは［切り取り］を押せない（M5）', async (t) => {
  const shell = await openShell(t);
  shell.SigK.pageGrid.selectAll();
  rightClick(shell, thumbs(shell)[0]);
  assert.deepEqual(enabledItems(shell), ['copy', 'delete']);
});

test('ページの無い所を右クリックすると、選択は変えず［貼り付け］だけを押せる（M2）', async (t) => {
  const shell = await openShell(t, { taskResults: [copied(1)] });
  shell.SigK.pageGrid.setSelection([1]);
  rightClick(shell, shell.document.getElementById('side-scroll'));
  assert.equal(menuShown(shell), true);
  assert.deepEqual(enabledItems(shell), [], 'コピーしていなければ、どれも押せない');

  await shell.SigK.pageListCommands.copy(shell.SigK.pageListTarget.thumbs(), [1]);
  rightClick(shell, shell.document.getElementById('thumbs'));
  assert.deepEqual(enabledItems(shell), ['paste']);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1], '選択は変えない');
});

test('パスワード付きのタブでは、項目をすべて灰色にする（R1）', async (t) => {
  const shell = await openShell(t);
  shell.SigK.viewer.getState().file.encrypted = true;
  rightClick(shell, thumbs(shell)[0]);
  assert.equal(menuShown(shell), true);
  assert.deepEqual(enabledItems(shell), []);
  // 灰色の項目を押しても何もしない。
  itemOf(shell, 'delete').click();
  assert.equal(menuShown(shell), true);
});

test('編集モードでも、サムネイルを表示していれば同じメニューを表示する。注釈一覧のときは表示しない（PG2・E1）', async (t) => {
  const shell = await openShell(t, { mode: 'annot' });
  rightClick(shell, thumbs(shell)[1]);
  assert.equal(menuShown(shell), true);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1]);
  assert.deepEqual(enabledItems(shell), ['copy', 'cut', 'delete']);
  shell.SigK.pageMenu.close();

  shell.SigK.shell.setEditSide(shell.document, 'list');
  await shell.flush();
  rightClick(shell, shell.document.getElementById('side-scroll'));
  assert.equal(menuShown(shell), false);
});

test('閲覧モードのサムネイルでは表示しない', async (t) => {
  const shell = await openShell(t, { mode: 'view' });
  rightClick(shell, thumbs(shell)[1]);
  assert.equal(menuShown(shell), false);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], []);
});

test('右クリックすると、その一覧にフォーカスが移る（K1）', async (t) => {
  const shell = await openShell(t);
  rightClick(shell, thumbs(shell)[0]);
  assert.equal(shell.document.activeElement.id, 'side-scroll');
});

// ---- ツールモード（T1・T2・R1） ----

test('ツールモード: 枠でない帯のページを右クリックすると、その帯を枠にしてから選択する（T1・M2）', async (t) => {
  const shell = await openShell(t, { mode: 'tools', paths: [A, B] });
  const [first, second] = shell.SigK.tabs.list().map((tab) => tab.id);
  assert.equal(shell.SigK.tabs.activeId(), second);
  rightClick(shell, stripPages(shell, 0)[2]);
  assert.equal(shell.SigK.tabs.activeId(), first, '右クリックした帯が枠になる');
  assert.deepEqual([...shell.SigK.stripSelection.get(first)], [2]);
  assert.equal(menuShown(shell), true);
  assert.deepEqual(enabledItems(shell), ['copy', 'cut', 'delete']);
  assert.equal(shell.document.activeElement.id, 'strips');
});

test('ツールモード: 帯のページの右（ページの無い所）では、選択は変えず［貼り付け］だけ（M2）', async (t) => {
  const shell = await openShell(t, { mode: 'tools', taskResults: [copied(1)] });
  const [first] = shell.SigK.tabs.list().map((tab) => tab.id);
  leftClick(shell, stripPages(shell, 0)[1]);
  await shell.SigK.pageListCommands.copy(shell.SigK.pageListTarget.strips(), [1]);
  rightClick(shell, stripNodes(shell)[0].querySelector('.strip-pages'));
  assert.deepEqual(enabledItems(shell), ['paste']);
  assert.deepEqual([...shell.SigK.stripSelection.get(first)], [1]);
});

test('ツールモード: 分割を選んでいるとき（分割画面）は表示しない（T2）', async (t) => {
  const shell = await openShell(t, { mode: 'tools' });
  shell.SigK.tools.select('split');
  await settle(shell);
  const cell = shell.document.querySelector('#strips .strip-page, #strips .sb-page');
  rightClick(shell, cell ?? stripNodes(shell)[0]);
  assert.equal(menuShown(shell), false);
});

test('ツールモード: 「変換する画像」の帯では表示せず、その帯に枠があるときの Delete は何もしない。PDF の帯を右クリックすると枠が移る（T2・T1）', async (t) => {
  const image = 'C:\\photo\\a.png';
  const shell = await openShell(t, { mode: 'tools', imageInfos: { [image]: { kind: 'png', width: 64, height: 64 } } });
  const tabId = shell.SigK.tabs.activeId();
  shell.SigK.tools.select('convert');
  await shell.SigK.toolsConvert.addPaths([image]);
  await settle(shell);
  assert.equal(shell.SigK.imageStrip.hasFrame(), true);
  rightClick(shell, shell.document.querySelector('#image-strip .img-item'));
  assert.equal(menuShown(shell), false);

  shell.SigK.stripSelection.set(tabId, [0], shell.SigK.tabs.peek(tabId).plan);
  shell.document.getElementById('strips').focus();
  key(shell, 'Delete');
  assert.equal(shell.document.getElementById('confirm-page-delete').hasAttribute('open'), false);

  rightClick(shell, stripPages(shell, 0)[1]);
  assert.equal(shell.SigK.imageStrip.hasFrame(), false, '枠は PDF の帯へ移る');
  assert.equal(menuShown(shell), true);
  assert.deepEqual([...shell.SigK.stripSelection.get(tabId)], [1]);
});

test('ツールモード: 開けなかった帯には表示しない（R1）', async (t) => {
  const error = Object.assign(new Error('broken'), { name: 'InvalidPDFException' });
  const shell = await openShell(t, { mode: 'tools', pdfjs: createPdfjsStub({ openError: error }) });
  const [node] = stripNodes(shell);
  assert.equal(node.classList.contains('failed'), true);
  rightClick(shell, node.querySelector('.strip-head'));
  assert.equal(menuShown(shell), false);
});

test('開いている途中・保存の途中は表示しない（P2）', async (t) => {
  const shell = await openShell(t);
  shell.window.SigK.save.isBusy = () => true;
  rightClick(shell, thumbs(shell)[1]);
  assert.equal(menuShown(shell), false);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [], '選択も変えない');
});

// ---- 閉じるきっかけ（P3） ----

test('メニューの外のクリック・ほかのキー・スクロール・ホイール・ウインドウの大きさの変更・フォーカスが外れたときに閉じる（P3）', async (t) => {
  const shell = await openShell(t);
  const { document, window } = shell;
  const reopen = () => {
    rightClick(shell, thumbs(shell)[0]);
    assert.equal(menuShown(shell), true);
  };
  const triggers = [
    () => document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })),
    () => key(shell, 'a', { target: document.body }),
    () => document.getElementById('side-scroll').dispatchEvent(new window.Event('scroll')),
    () => document.getElementById('view').dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 })),
    () => window.dispatchEvent(new window.Event('resize')),
    () => window.dispatchEvent(new window.Event('blur')),
  ];
  for (const [index, fire] of triggers.entries()) {
    reopen();
    fire();
    assert.equal(menuShown(shell), false, `きっかけ ${index} で閉じない`);
  }
});

test('Esc はメニューだけを閉じ、ページの選択は残す（P3・Esc でキャンセルする順序の 3）', async (t) => {
  const shell = await openShell(t);
  rightClick(shell, thumbs(shell)[1]);
  const esc = key(shell, 'Escape');
  assert.equal(esc.defaultPrevented, true);
  assert.equal(menuShown(shell), false);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1], '選択は 2 回目の Esc で外れる');
  key(shell, 'Escape');
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], []);
});

test('項目を押すとメニューを閉じる。押せる項目は ALL のどれか', async (t) => {
  const shell = await openShell(t);
  rightClick(shell, thumbs(shell)[1]);
  assert.ok(enabledItems(shell).every((action) => ALL.includes(action)));
  itemOf(shell, 'delete').click();
  assert.equal(menuShown(shell), false);
  // 削除は削除確認画面を通す（D1）。取りやめておく。
  shell.document.getElementById('confirm-page-delete-cancel').click();
  await settle(shell);
});
