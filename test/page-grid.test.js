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

// ---- ドラッグによる並べ替え（確定事項30〜37） ----
//
// jsdom は getBoundingClientRect が 0 を返すので、clientX / clientY が
// そのまま layoutThumbnails の座標になる。既定のパネル幅 240px は2列で、
// 1行目の枠は x=0 と x=115 に並ぶ。

// 掴む位置と落とす位置。実際の配置から引く（列幅を直に書くと、
// 列数の決め方を変えたときに黙って壊れる）。
function centerOf(SigK, index) {
  const page = SigK.thumbnails.getLayout().pages[index];
  return { x: page.left + page.width / 2, y: page.top + page.height / 2 };
}

function dragThumb(shell, from, to, { release = 'inside' } = {}) {
  const { SigK, firePointer, document } = shell;
  const thumbs = thumbsIn(document);
  const start = centerOf(SigK, from);
  const end = centerOf(SigK, to);

  firePointer(thumbs[from], 'pointerdown', start);
  firePointer(thumbs[from], 'pointermove', end);
  const target = release === 'outside' ? document.body : thumbs[to];
  firePointer(target, 'pointerup', end);
}

test('5px 動かなければ掴まない（確定事項32）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, firePointer, document } = shell;
  const thumbs = thumbsIn(document);
  const start = centerOf(SigK, 0);

  firePointer(thumbs[0], 'pointerdown', start);
  firePointer(thumbs[0], 'pointermove', { x: start.x + 2, y: start.y + 1 });

  assert.equal(SigK.pageGrid.isDragging(), false);
  assert.equal(document.querySelector('.drop-line'), null, '挿入位置の棒が出ている');
});

test('5px を超えたら掴み、印と枚数のバッジを出す（確定事項35）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, firePointer, document } = shell;
  const thumbs = thumbsIn(document);
  const start = centerOf(SigK, 0);

  firePointer(thumbs[0], 'pointerdown', start);
  firePointer(thumbs[0], 'pointermove', { x: start.x + 30, y: start.y });

  assert.equal(SigK.pageGrid.isDragging(), true);
  assert.equal(thumbs[0].classList.contains('dragging'), true, '掴んだ紙が半透明になっていない');
  assert.ok(document.querySelector('.drop-line') !== null, '挿入位置の棒が出ていない');
  assert.match(document.querySelector('.drag-badge').textContent, /1 ページ/);
});

test('ドラッグして離すと並びが変わる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  // 1枚目を2枚目の右へ落とす。
  dragThumb(shell, 0, 1);

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [1, 0, 2]);
  assert.equal(SigK.viewer.isDirty(), true);
});

test('落とした先が選び直される（確定事項14）', async (t) => {
  const shell = await withPagesMode(t);

  dragThumb(shell, 0, 1);

  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], [1]);
  assert.deepEqual(selectedIn(shell.document), [1]);
});

test('ドラッグ中の Esc で取り消す（確定事項37）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, firePointer, document, window } = shell;
  const thumbs = thumbsIn(document);
  const start = centerOf(SigK, 0);

  firePointer(thumbs[0], 'pointerdown', start);
  firePointer(thumbs[0], 'pointermove', centerOf(SigK, 1));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.equal(SigK.pageGrid.isDragging(), false);
  assert.equal(document.querySelector('.drop-line'), null);
  // 取り消したので並びは変わらない。
  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [0, 1, 2]);
  assert.equal(SigK.viewer.isDirty(), false);
});

test('パネルの外で離しても取り消す（確定事項37）', async (t) => {
  const shell = await withPagesMode(t);

  dragThumb(shell, 0, 1, { release: 'outside' });

  assert.deepEqual([...shell.SigK.viewer.getPlan()].map((page) => page.src), [0, 1, 2]);
  assert.equal(shell.SigK.viewer.isDirty(), false);
});

// 選んでいない紙を掴んだのに、選択中の別の紙が動くのは驚く（確定事項34）。
test('選択外の紙を掴んだら、その1枚だけを選び直してから動かす', async (t) => {
  const shell = await withPagesMode(t, { pdfjs: createPdfjsStub({ sizes: [A4, A4, A4, A4] }) });
  const { SigK, firePointer, document } = shell;

  SigK.pageGrid.setSelection([0, 1]);
  const thumbs = thumbsIn(document);
  const head = SigK.thumbnails.getLayout().pages[0];
  // 先頭の枠の左半分（中心より左）へ落とす＝いちばん手前に入る。
  const end = { x: head.left + 2, y: head.top + 10 };

  firePointer(thumbs[2], 'pointerdown', centerOf(SigK, 2));
  firePointer(thumbs[2], 'pointermove', end);
  firePointer(thumbs[0], 'pointerup', end);

  // 選択中だった 0・1 は動かず、掴んだ 2 だけが先頭へ来る。
  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [2, 0, 1, 3]);
  assert.deepEqual([...SigK.pageGrid.getSelection()], [0]);
});

test('選んだ複数枚はまとめて動く', async (t) => {
  const shell = await withPagesMode(t, { pdfjs: createPdfjsStub({ sizes: [A4, A4, A4, A4] }) });
  const { SigK, firePointer, document } = shell;

  SigK.pageGrid.setSelection([0, 1]);
  const thumbs = thumbsIn(document);
  const start = centerOf(SigK, 0);
  // 4枚・2列なので、index 3 は2行目の右。その右半分へ落とす。
  const last = SigK.thumbnails.getLayout().pages[3];
  const end = { x: last.left + last.width - 1, y: last.top + 10 };

  firePointer(thumbs[0], 'pointerdown', start);
  firePointer(thumbs[0], 'pointermove', end);
  assert.match(document.querySelector('.drag-badge').textContent, /2 ページ/);
  firePointer(thumbs[3], 'pointerup', end);

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [2, 3, 0, 1]);
});

test('同じ位置へ落としても履歴は増えない', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;
  const before = SigK.pageEdit.getHistoryState().depth;

  // 1枚目を、1枚目自身の左半分へ落とす（動かない）。
  dragThumb(shell, 0, 0);

  assert.equal(SigK.pageEdit.getHistoryState().depth, before);
  assert.equal(SigK.viewer.isDirty(), false);
});

// ---- 履歴（確定事項8〜13） ----

test('ドラッグ1回が1世代になり、Ctrl+Z で戻せる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  dragThumb(shell, 0, 1);
  assert.equal(SigK.pageEdit.getHistoryState().depth, 2);
  assert.equal(SigK.pageEdit.canUndo(), true);

  SigK.pageEdit.undo();

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [0, 1, 2]);
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.pageEdit.canRedo(), true);
});

test('やり直すと並べ替えが戻ってくる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  dragThumb(shell, 0, 1);
  SigK.pageEdit.undo();
  SigK.pageEdit.redo();

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [1, 0, 2]);
});

test('戻すと、その操作の対象だった紙が選ばれる（確定事項12）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  dragThumb(shell, 0, 1);
  assert.deepEqual([...SigK.pageGrid.getSelection()], [1]);

  SigK.pageEdit.undo();

  // 戻した先では、掴んだときの位置にいる。
  assert.deepEqual([...SigK.pageGrid.getSelection()], [0]);
});

test('履歴はタブごとに分かれる（確定事項11）', async (t) => {
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
  dragThumb(shell, 0, 1);
  const editedId = SigK.tabs.activeId();

  await SigK.tabs.openViaDialog();
  await shell.flush();
  assert.equal(SigK.pageEdit.canUndo(), false, '別のタブの履歴が見えている');

  SigK.tabs.activate(editedId);
  await shell.flush();
  assert.equal(SigK.pageEdit.canUndo(), true);
  SigK.pageEdit.undo();
  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [0, 1, 2]);
});

test('文書を開き直すと履歴は捨てられる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;
  dragThumb(shell, 0, 1);
  assert.equal(SigK.pageEdit.canUndo(), true);

  await SigK.viewer.open(makeSource({ path: 'C:\\work\\other.pdf' }));
  await shell.flush();

  assert.equal(SigK.pageEdit.canUndo(), false);
});
