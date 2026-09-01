'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// ページモードのサイドパネル（spec-1-5 C・D・E）。
//
// 選択とドラッグの結線を持つ。位置と見た目は jsdom では確かめられないので
// （CSS を解釈せず getBoundingClientRect が 0 を返す）、挿入位置の計算は
// page-plan.js の純粋関数へ出してある（確定事項33）。ここで見るのは
// 「どのクリックがどの選択になるか」と「その結果が DOM のクラスに出るか」である。

async function withShell(t, options) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  return shell;
}

async function withPagesMode(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'pages');
  await shell.flush();
  return shell;
}

function thumbsIn(document) {
  return [...document.querySelectorAll('#thumbs .thumb')];
}

function selectedIn(document) {
  return thumbsIn(document)
    .map((node, index) => (node.classList.contains('selected') ? index : -1))
    .filter((index) => index >= 0);
}

function clickThumb(shell, index, { ctrl = false, shift = false } = {}) {
  const node = thumbsIn(shell.document)[index];
  node.dispatchEvent(new shell.window.MouseEvent('click', {
    bubbles: true,
    ctrlKey: ctrl,
    shiftKey: shift,
  }));
}

// ---- クリックと選択（確定事項15〜17・22） ----

test('ページモードでクリックするとその1枚を選ぶ', async (t) => {
  const shell = await withPagesMode(t);

  clickThumb(shell, 1);

  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1]);
  assert.deepEqual(selectedIn(shell.document), [1]);
});

test('Ctrl クリックは選択を足し引きする', async (t) => {
  const shell = await withPagesMode(t);

  clickThumb(shell, 0);
  clickThumb(shell, 2, { ctrl: true });
  assert.deepEqual(selectedIn(shell.document), [0, 2]);

  clickThumb(shell, 2, { ctrl: true });
  assert.deepEqual(selectedIn(shell.document), [0]);
});

test('Shift クリックは起点からの範囲を選ぶ', async (t) => {
  const shell = await withPagesMode(t);

  clickThumb(shell, 0);
  clickThumb(shell, 2, { shift: true });

  assert.deepEqual(selectedIn(shell.document), [0, 1, 2]);
});

// 閲覧モードのサイドパネルは地図である。選択の概念を持ち込まない。
test('閲覧モードのクリックは従来どおりページ移動だけをする', async (t) => {
  const shell = await withShell(t);
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();

  clickThumb(shell, 2);

  assert.equal(shell.SigK.viewer.getState().current, 2);
  assert.deepEqual(selectedIn(shell.document), []);
  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], []);
});

// ---- 選択とページビュー（確定事項21） ----

test('1枚だけ選んだらページビューがそこへ寄る', async (t) => {
  const shell = await withPagesMode(t);

  clickThumb(shell, 2);

  assert.equal(shell.SigK.viewer.getState().current, 2);
});

test('複数選んでいる間はページビューを動かさない', async (t) => {
  const shell = await withPagesMode(t);

  clickThumb(shell, 0);
  const before = shell.SigK.viewer.getState().current;
  clickThumb(shell, 2, { shift: true });

  assert.equal(shell.SigK.viewer.getState().current, before, '複数選択でページが飛んでいる');
});

// ---- 選択の見た目（確定事項22） ----

test('選択の印は現在ページの印とは別に付く', async (t) => {
  const shell = await withPagesMode(t);

  clickThumb(shell, 0);
  clickThumb(shell, 2, { ctrl: true });

  const thumbs = thumbsIn(shell.document);
  // 現在ページは1枚目のまま（Ctrl クリックでは動かない）。
  assert.equal(thumbs[0].classList.contains('current'), true);
  assert.equal(thumbs[0].classList.contains('selected'), true);
  assert.equal(thumbs[2].classList.contains('current'), false);
  assert.equal(thumbs[2].classList.contains('selected'), true);
});

// 枠は幅の変更・列数の変更・編集のたびに作り直される。そのたびに選択の印が
// 消えては使い物にならない。
test('枠を作り直しても選択の印は残る', async (t) => {
  const shell = await withPagesMode(t);
  clickThumb(shell, 0);
  clickThumb(shell, 2, { ctrl: true });

  shell.resizeSide(400);
  await shell.flush();

  assert.deepEqual(selectedIn(shell.document), [0, 2]);
});

test('編集で並びが変わっても選択の印は付け直される', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  SigK.pageGrid.setSelection([2]);
  const moved = SigK.pagePlan.movePages(SigK.viewer.getPlan(), [2], 0);
  SigK.viewer.applyPlan(moved.plan);
  SigK.pageGrid.setSelection(moved.selection);
  await shell.flush();

  assert.deepEqual(selectedIn(shell.document), [0], '動かした先の紙が選ばれていない');
});

// ---- 選択の操作 ----

test('selectAll は全ページを選ぶ', async (t) => {
  const shell = await withPagesMode(t);

  shell.SigK.pageGrid.selectAll();

  assert.deepEqual(selectedIn(shell.document), [0, 1, 2]);
});

test('clearSelection で印が消える', async (t) => {
  const shell = await withPagesMode(t);
  clickThumb(shell, 1);

  shell.SigK.pageGrid.clearSelection();

  assert.deepEqual(selectedIn(shell.document), []);
});

test('setSelection は範囲外の index を落とす', async (t) => {
  const shell = await withPagesMode(t);

  shell.SigK.pageGrid.setSelection([1, 9, -2]);

  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1]);
});

// ---- タブごとの選択（確定事項11・14） ----

test('タブを切り替えても選択は残る', async (t) => {
  const shell = await withShell(t, {
    openResults: [
      makeSource({ path: 'C:\\work\\a.pdf' }),
      makeSource({ path: 'C:\\work\\b.pdf' }),
    ],
  });
  const { SigK } = shell;

  await SigK.tabs.openViaDialog();
  await shell.flush();
  SigK.shell.setMode(shell.document, 'pages');
  await shell.flush();
  clickThumb(shell, 0);
  clickThumb(shell, 2, { ctrl: true });
  const editedId = SigK.tabs.activeId();

  await SigK.tabs.openViaDialog();
  await shell.flush();
  assert.deepEqual([...SigK.pageGrid.getSelection()], [], '別のタブに選択が漏れている');

  SigK.tabs.activate(editedId);
  await shell.flush();
  assert.deepEqual([...SigK.pageGrid.getSelection()], [0, 2]);
  assert.deepEqual(selectedIn(shell.document), [0, 2]);
});

test('文書を閉じると選択も捨てる', async (t) => {
  const shell = await withPagesMode(t);
  clickThumb(shell, 1);

  shell.SigK.viewer.close();

  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], []);
});

test('削除で紙が減ったら、選択は残った範囲に収まる', async (t) => {
  const shell = await withPagesMode(t, { pdfjs: createPdfjsStub({ sizes: [A4, A4, A4, A4] }) });
  const { SigK } = shell;

  SigK.pageGrid.selectAll();
  const deleted = SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [3]);
  SigK.viewer.applyPlan(deleted.plan);
  await shell.flush();

  for (const index of SigK.pageGrid.getSelection())
    assert.ok(index < 3, `消えた紙 ${index} を選んだままである`);
});
