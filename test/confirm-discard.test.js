'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 未保存の表示と、閉じるときの確認（spec-1-5 I。決定3）。
//
// dirty になる経路は塊④ で初めて生まれる。ここを空けたままにすると、
// 編集したタブを閉じたときに確認も出ずに編集が消える。
//
// 塊④ の時点では保存の手段がまだ無いので2択だった（確定事項57・58）。
// 塊⑤ で保存の行き先ができたので、「保存／保存しない／キャンセル」の3択に
// なっている（spec-1-6 確定事項31〜36）。

async function withShell(t, options) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  return shell;
}

// 未保存の印はタブに出る。viewer.open() を直に呼ぶとタブが作られないので、
// ここでは実際の経路（tabs.openViaDialog）を通す。
async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, { openResults: [makeSource()], ...options });
  await shell.SigK.tabs.openViaDialog();
  await shell.flush();
  return shell;
}

async function withTwoTabs(t) {
  const shell = await withShell(t, {
    openResults: [
      makeSource({ path: 'C:\\work\\a.pdf' }),
      makeSource({ path: 'C:\\work\\b.pdf' }),
    ],
  });
  await shell.SigK.tabs.openViaDialog();
  await shell.flush();
  await shell.SigK.tabs.openViaDialog();
  await shell.flush();
  return shell;
}

function edit(shell) {
  const { SigK } = shell;
  SigK.pageEdit.rotate(90, [0]);
}

function dialogOf(document) {
  return document.getElementById('confirm-discard');
}

function isDialogOpen(document) {
  return dialogOf(document).hasAttribute('open') || dialogOf(document).open === true;
}

// ---- 未保存の表示（確定事項49） ----

test('編集するとステータスバーに「変更あり」が出る', async (t) => {
  const shell = await withOpenDocument(t);
  const mark = shell.document.getElementById('status-dirty');
  assert.equal(mark.hidden, true);

  edit(shell);
  assert.equal(mark.hidden, false);

  shell.SigK.pageEdit.undo();
  assert.equal(mark.hidden, true, '元に戻したのに印が残っている');
});

test('編集するとタブに点が付く', async (t) => {
  const shell = await withOpenDocument(t);
  assert.equal(shell.document.querySelector('#tabbar .tab .dirty'), null);

  edit(shell);

  assert.ok(shell.document.querySelector('#tabbar .tab .dirty') !== null, 'タブに点が付いていない');
});

test('点が付くのは編集したタブだけ', async (t) => {
  const shell = await withTwoTabs(t);
  const { SigK, document } = shell;

  edit(shell);
  await shell.flush();

  const tabs = [...document.querySelectorAll('#tabbar .tab')];
  const dirty = tabs.map((node) => node.querySelector('.dirty') !== null);
  assert.deepEqual(dirty, [false, true]);
  assert.equal(SigK.tabs.isDirty(SigK.tabs.list()[0].id), false);
  assert.equal(SigK.tabs.isDirty(SigK.tabs.list()[1].id), true);
});

// 映していないタブの plan は session の中にある。この非対称は塊② からの作り。
test('別のタブへ移っても、編集したタブの点は残る', async (t) => {
  const shell = await withTwoTabs(t);
  const { SigK, document } = shell;

  edit(shell);
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();

  const dirty = [...document.querySelectorAll('#tabbar .tab')].map((node) => node.querySelector('.dirty') !== null);
  assert.deepEqual(dirty, [false, true]);
  // いま映しているタブは編集していないので、ステータスバーの印は消える。
  assert.equal(document.getElementById('status-dirty').hidden, true);
});

test('未保存の数はメインへ知らせる（確定事項56）', async (t) => {
  const shell = await withOpenDocument(t);

  edit(shell);
  assert.equal(shell.dirtyCalls.at(-1), 1);

  shell.SigK.pageEdit.undo();
  assert.equal(shell.dirtyCalls.at(-1), 0);
});

// ---- タブを閉じるときの確認（確定事項56・57） ----

test('編集していないタブは確認なしで閉じる', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;

  SigK.tabs.closeActive();

  assert.equal(isDialogOpen(document), false, '確認が出ている');
  assert.equal(SigK.tabs.count(), 0);
});

test('編集したタブを閉じようとすると確認が出る', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  edit(shell);

  SigK.tabs.closeActive();

  assert.equal(isDialogOpen(document), true, '確認が出ていない');
  assert.equal(SigK.tabs.count(), 1, '聞く前に閉じている');
  // 文言はファイル名を添えて出す。どのタブの話か分かるようにするため。
  assert.match(document.getElementById('confirm-discard-text').textContent, /sample\.pdf/);
  assert.match(document.getElementById('confirm-discard-text').textContent, /保存されていません/);
});

test('「キャンセル」を選ぶと閉じない', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  edit(shell);

  const closing = SigK.tabs.closeActive();
  document.getElementById('confirm-discard-cancel').click();
  await closing;

  assert.equal(SigK.tabs.count(), 1);
  assert.equal(isDialogOpen(document), false);
  assert.equal(SigK.viewer.isDirty(), true, '編集が消えている');
});

test('「保存しない」を選ぶと閉じる', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  edit(shell);

  const closing = SigK.tabs.closeActive();
  document.getElementById('confirm-discard-discard').click();
  await closing;

  assert.equal(SigK.tabs.count(), 0);
  assert.equal(isDialogOpen(document), false);
});

// 黙って編集が消えるより、閉じないほうが安全である。
test('Esc でダイアログを閉じたらキャンセル扱いにする', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  edit(shell);

  const closing = SigK.tabs.closeActive();
  dialogOf(document).dispatchEvent(new shell.window.Event('cancel'));
  const closed = await closing;

  assert.equal(closed, false);
  assert.equal(SigK.tabs.count(), 1);
});

test('forceCloseTab は確認を飛ばして閉じる', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;
  edit(shell);

  SigK.tabs.forceCloseTab(SigK.tabs.list()[0].id);

  assert.equal(SigK.tabs.count(), 0);
  assert.equal(isDialogOpen(document), false);
});

// ---- 終了するときの確認（確定事項56） ----

test('未保存が無ければ、終了はそのまま通す', async (t) => {
  const shell = await withOpenDocument(t);

  await shell.fireCloseRequest();

  assert.deepEqual(shell.closeAnswers, [true]);
});

test('未保存があれば聞き、保存しないを選べば終了を通す', async (t) => {
  const shell = await withOpenDocument(t);
  edit(shell);

  const asking = shell.fireCloseRequest();
  await shell.flush();
  assert.equal(isDialogOpen(shell.document), true);
  shell.document.getElementById('confirm-discard-discard').click();
  await asking;

  assert.deepEqual(shell.closeAnswers, [true]);
});

test('ひとつでもキャンセルしたら終了そのものを取りやめる', async (t) => {
  const shell = await withOpenDocument(t);
  edit(shell);

  const asking = shell.fireCloseRequest();
  await shell.flush();
  shell.document.getElementById('confirm-discard-cancel').click();
  await asking;

  assert.deepEqual(shell.closeAnswers, [false]);
});

test('未保存のタブが複数あれば1枚ずつ聞く', async (t) => {
  const shell = await withTwoTabs(t);
  const { SigK, document } = shell;

  // 2枚目を編集し、1枚目へ移ってそちらも編集する。
  edit(shell);
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();
  edit(shell);
  assert.equal(shell.dirtyCalls.at(-1), 2);

  const asking = shell.fireCloseRequest();
  await shell.flush();
  // 1枚目について聞かれている。聞く前にそのタブへ切り替わる。
  assert.match(document.getElementById('confirm-discard-text').textContent, /a\.pdf/);
  document.getElementById('confirm-discard-discard').click();
  await shell.flush();

  // 続けて2枚目。
  assert.match(document.getElementById('confirm-discard-text').textContent, /b\.pdf/);
  document.getElementById('confirm-discard-cancel').click();
  await asking;

  // 2枚目でやめたので、終了は取りやめになる。
  assert.deepEqual(shell.closeAnswers, [false]);
});

// ---- 3択の「保存」（spec-1-6 確定事項31〜36） ----

test('「保存」を選ぶと、保存してから閉じる', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ ok: true, path: 'C:\work\sample.pdf', signature: { size: 9, mtimeMs: 9 } }],
  });
  edit(shell);
  const id = shell.SigK.tabs.activeId();

  const closing = shell.SigK.tabs.closeTab(id);
  await shell.flush();
  shell.document.getElementById('confirm-discard-save').click();
  await closing;
  await shell.flush();

  assert.equal(shell.taskCalls.length, 1, 'ワーカーへ渡している');
  assert.equal(shell.SigK.tabs.count(), 0, '保存できたので閉じる');
});

test('保存に失敗したら閉じない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ error: 'ファイルが他のプログラムで使われています。' }],
  });
  edit(shell);
  const id = shell.SigK.tabs.activeId();

  const closing = shell.SigK.tabs.closeTab(id);
  await shell.flush();
  shell.document.getElementById('confirm-discard-save').click();

  assert.equal(await closing, false);
  await shell.flush();
  // 編集を消さない（確定事項34）。理由は帯に出ている。
  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.isDirty(), true);
  assert.match(shell.SigK.viewBanner.text(), /他のプログラムで使われています/);
});

test('ask は3つの答えを返す', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK, document } = shell;

  const first = SigK.confirmDiscard.ask({ name: 'a.pdf' });
  document.getElementById('confirm-discard-save').click();
  assert.equal(await first, SigK.confirmDiscard.SAVE);

  const second = SigK.confirmDiscard.ask({ name: 'a.pdf' });
  document.getElementById('confirm-discard-discard').click();
  assert.equal(await second, SigK.confirmDiscard.DISCARD);

  const third = SigK.confirmDiscard.ask({ name: 'a.pdf' });
  document.getElementById('confirm-discard-cancel').click();
  assert.equal(await third, SigK.confirmDiscard.CANCEL);
});

test('終了しようとしたときも「保存」を選べる', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ ok: true, path: 'C:\work\sample.pdf', signature: { size: 9, mtimeMs: 9 } }],
  });
  edit(shell);

  const asking = shell.fireCloseRequest();
  await shell.flush();
  shell.document.getElementById('confirm-discard-save').click();
  await asking;

  assert.deepEqual(shell.closeAnswers, [true], '保存できたので終了を通す');
  assert.equal(shell.taskCalls.length, 1);
});
