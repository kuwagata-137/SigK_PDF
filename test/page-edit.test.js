'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 編集結果を画面へ映す経路（spec-1-5 G）。
//
// plan を差し替えたときに、ページビュー・ページ番号・サムネイル・印刷の
// すべてが同じ並びを見ることを確かめる。映さないと「サイドパネルだけが
// 新しい並び、中央と印刷は元のまま」という二重状態になる（確定事項43）。
//
// 位置と見た目は jsdom では確かめられない（CSS を解釈せず
// getBoundingClientRect が 0 を返す）。そこは起動確認に残す。

const LANDSCAPE = { width: A4.height, height: A4.width };

async function withShell(t, options) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  return shell;
}

async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  return shell;
}

function pageNodes(document) {
  return [...document.querySelectorAll('#view-pages .pdf-page')];
}

// 印刷の 150dpi 描画だけを抜き出す。ページビューとサムネイルは別の倍率で
// 同じスタブを呼ぶため、倍率で切り分ける。
function printCalls(pdfjs, SigK) {
  return pdfjs.viewportCalls.filter((call) => call.scale === SigK.print.PRINT_SCALE);
}

function sizeOf(node) {
  return {
    width: Number.parseInt(node.style.width, 10),
    height: Number.parseInt(node.style.height, 10),
  };
}

// ---- 写像（確定事項44） ----

test('getPage は表示上の番号から元ファイルのページを引く', async (t) => {
  const { SigK } = await withOpenDocument(t);

  // 3ページ目を先頭へ動かす。
  const moved = SigK.pagePlan.movePages(SigK.viewer.getPlan(), [2], 0);
  SigK.viewer.applyPlan(moved.plan);

  assert.equal((await SigK.viewer.getPage(1)).pageNumber, 3);
  assert.equal((await SigK.viewer.getPage(2)).pageNumber, 1);
  assert.equal((await SigK.viewer.getPage(3)).pageNumber, 2);
});

test('getPage は plan の外を要求されたら null を返す', async (t) => {
  const { SigK } = await withOpenDocument(t);
  const deleted = SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [0]);
  SigK.viewer.applyPlan(deleted.plan);

  assert.equal(await SigK.viewer.getPage(3), null);
  assert.equal(await SigK.viewer.getPage(0), null);
});

test('開いた直後の plan は 0 から始まる連番である（確定事項5）', async (t) => {
  const { SigK } = await withOpenDocument(t);

  assert.deepEqual(SigK.viewer.getPlan(), SigK.pagePlan.createPlan(3));
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.viewer.getBasePageCount(), 3);
});

// ---- 寸法（確定事項45） ----

test('回転すると sizes の幅と高さが入れ替わる', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const before = sizeOf(pageNodes(document)[0]);

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  const after = sizeOf(pageNodes(document)[0]);

  assert.ok(before.height > before.width, 'A4 が縦向きになっていない');
  assert.ok(after.width > after.height, '回しても縦のままである');
  // 縦横がそっくり入れ替わる（倍率は同じ）。
  assert.equal(after.width, before.height);
  assert.equal(after.height, before.width);
});

test('180 度では幅と高さは入れ替わらない', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const before = sizeOf(pageNodes(document)[0]);

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 180));

  assert.deepEqual(sizeOf(pageNodes(document)[0]), before);
});

test('回転を戻すと寸法も戻る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const before = sizeOf(pageNodes(document)[0]);

  let plan = SigK.viewer.getPlan();
  for (let count = 0; count < 4; count += 1)
    plan = SigK.pagePlan.rotatePages(plan, [0], 90);
  SigK.viewer.applyPlan(plan);

  assert.deepEqual(sizeOf(pageNodes(document)[0]), before);
  assert.equal(SigK.viewer.isDirty(), false, '4回回して元に戻ったのに dirty のままである');
});

test('もともと横向きのページを回すと縦になる', async (t) => {
  const { document, SigK } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: [LANDSCAPE, A4] }),
  });
  const before = sizeOf(pageNodes(document)[0]);

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  const after = sizeOf(pageNodes(document)[0]);

  assert.ok(before.width > before.height);
  assert.ok(after.height > after.width);
});

// ---- ページ数の追従（確定事項45・46） ----

test('削除すると pageCount とページ枠の数が減る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  const deleted = SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [1]);
  SigK.viewer.applyPlan(deleted.plan);

  assert.equal(SigK.viewer.getState().pageCount, 2);
  assert.equal(pageNodes(document).length, 2);
  // ツールバーの「/ N」も一緒に動く。
  assert.equal(document.getElementById('page-total').textContent, '/ 2');
});

test('ステータスバーのページ数は編集のたびに更新する（確定事項46）', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  assert.equal(document.getElementById('status-pages').textContent, '3 ページ');

  const deleted = SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [0, 1]);
  SigK.viewer.applyPlan(deleted.plan);

  assert.equal(document.getElementById('status-pages').textContent, '1 ページ');
});

test('末尾を削ると現在ページは最後のページに寄る', async (t) => {
  const { SigK } = await withOpenDocument(t);
  SigK.viewer.lastPage();
  assert.equal(SigK.viewer.getState().current, 2);

  const deleted = SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [2]);
  SigK.viewer.applyPlan(deleted.plan);

  assert.equal(SigK.viewer.getState().current, 1, '消えたページを指したままである');
});

// ---- 未保存の判定（確定事項6） ----

test('編集すると dirty になり、元に戻すと戻る', async (t) => {
  const { SigK } = await withOpenDocument(t);
  const original = SigK.viewer.getPlan();

  SigK.viewer.applyPlan(SigK.pagePlan.movePages(original, [0], 3).plan);
  assert.equal(SigK.viewer.isDirty(), true);

  SigK.viewer.applyPlan(original);
  assert.equal(SigK.viewer.isDirty(), false);
});

test('文書を開いていなければ dirty ではない', async (t) => {
  const { SigK } = await withShell(t);

  assert.equal(SigK.viewer.isDirty(), false);
});

// ---- 検索（確定事項47） ----

test('編集すると検索結果は捨てられる', async (t) => {
  const { SigK } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: [A4, A4, A4], textItems: ['あいうえお'] }),
  });

  const found = await SigK.find.run('あい', { matchCase: false });
  assert.ok(found.total > 0, '前提となるヒットが無い');

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));

  // matches はページ index とページ内オフセットを持つ。並べ替えなら
  // 付け替えられても削除では直せない。半分だけ正しいハイライトは無いより悪い。
  assert.equal(SigK.find.getState().total, 0);
});

// ---- サムネイル（確定事項29・44） ----

test('サムネイルは編集後の並びを受け取る', async (t) => {
  const { document, SigK, flush } = await withOpenDocument(t);

  const moved = SigK.pagePlan.movePages(SigK.viewer.getPlan(), [2], 0);
  SigK.viewer.applyPlan(moved.plan);
  await flush();

  // setDocument を呼び直さずに並びだけ差し替える（確定事項29）。
  assert.deepEqual([...SigK.thumbnails.getState().plan].map((page) => page.src), [2, 0, 1]);
  assert.equal(document.querySelectorAll('#thumbs .thumb').length, 3);
});

test('描画は表示上の位置ではなく元ページを引きに行く', async (t) => {
  const { SigK, pdfjs, flush } = await withOpenDocument(t);

  const moved = SigK.pagePlan.movePages(SigK.viewer.getPlan(), [2], 0);
  pdfjs.viewportCalls.length = 0;
  SigK.viewer.applyPlan(moved.plan);
  await flush();

  // 先頭に来たのは元の3ページ目である。写像を落とすと 1 を引きに行く。
  assert.ok(pdfjs.viewportCalls.some((call) => call.page === 3), '元の3ページ目を引いていない');
});

test('編集してもサムネイルのスクロール位置は残る（確定事項29）', async (t) => {
  const sizes = Array.from({ length: 20 }, () => A4);
  const { SigK, scrollSide, flush } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes }),
  });

  scrollSide(600);
  await flush();
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  await flush();

  assert.equal(SigK.thumbnails.getScrollTop(), 600, 'サイドパネルが先頭へ戻っている');
});

// ---- 印刷（確定事項39・48） ----

test('印刷は編集後の並びを紙に出す', async (t) => {
  const { SigK, pdfjs } = await withOpenDocument(t);

  const moved = SigK.pagePlan.movePages(SigK.viewer.getPlan(), [2], 0);
  SigK.viewer.applyPlan(moved.plan);

  pdfjs.viewportCalls.length = 0;
  await SigK.print.prepare({ mode: 'all' });

  assert.deepEqual(printCalls(pdfjs, SigK).map((call) => call.page), [3, 1, 2]);
});

// getViewport を回転なしで呼んでいた4か所目。落とすと「画面では回っているのに
// 印刷は回っていない」が起きる。
test('印刷の画像にも回転が載る（確定事項39）', async (t) => {
  const { SigK, pdfjs } = await withOpenDocument(t);

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));

  pdfjs.viewportCalls.length = 0;
  const result = await SigK.print.prepare({ mode: 'custom', text: '1' });

  assert.equal(printCalls(pdfjs, SigK)[0].rotation, 90);
  // 縦横が入れ替わる。
  assert.ok(result.images[0].width > result.images[0].height, '印刷の画像が縦のままである');
});

test('元ページの /Rotate に相対角度を足す', async (t) => {
  const { SigK, pdfjs } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: [A4, A4], rotations: [90, 0] }),
  });

  // 90 度回っているページをさらに右へ90度。
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));

  pdfjs.viewportCalls.length = 0;
  await SigK.print.prepare({ mode: 'custom', text: '1' });

  assert.equal(printCalls(pdfjs, SigK)[0].rotation, 180);
});

// ---- タブごとの編集内容（確定事項7） ----

test('タブを切り替えても編集内容は残る', async (t) => {
  const { SigK, flush } = await withShell(t, {
    openResults: [
      makeSource({ path: 'C:\\work\\a.pdf' }),
      makeSource({ path: 'C:\\work\\b.pdf' }),
    ],
  });

  await SigK.tabs.openViaDialog();
  await flush();
  const deleted = SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [1]);
  SigK.viewer.applyPlan(deleted.plan);
  const editedId = SigK.tabs.activeId();
  assert.equal(SigK.viewer.getState().pageCount, 2);

  await SigK.tabs.openViaDialog();
  await flush();
  assert.equal(SigK.viewer.getState().pageCount, 3, '2枚目のタブにまで編集が及んでいる');
  assert.equal(SigK.viewer.isDirty(), false);

  SigK.tabs.activate(editedId);
  await flush();
  assert.equal(SigK.viewer.getState().pageCount, 2, '戻ったら編集が消えている');
  assert.equal(SigK.viewer.isDirty(), true);
  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [0, 2]);
});

test('別のタブへ移っても回転は残る', async (t) => {
  const { document, SigK, flush } = await withShell(t, {
    openResults: [
      makeSource({ path: 'C:\\work\\a.pdf' }),
      makeSource({ path: 'C:\\work\\b.pdf' }),
    ],
  });

  await SigK.tabs.openViaDialog();
  await flush();
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  const rotated = sizeOf(pageNodes(document)[0]);
  const editedId = SigK.tabs.activeId();

  await SigK.tabs.openViaDialog();
  await flush();
  SigK.tabs.activate(editedId);
  await flush();

  assert.deepEqual(sizeOf(pageNodes(document)[0]), rotated);
});

test('文書を閉じると plan も捨てる', async (t) => {
  const { SigK } = await withOpenDocument(t);
  SigK.viewer.applyPlan(SigK.pagePlan.deletePages(SigK.viewer.getPlan(), [0]).plan);

  SigK.viewer.close();

  assert.equal(SigK.viewer.getPlan().length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.viewer.getBasePageCount(), 0);
});

test('文書が無いときの applyPlan は何もしない', async (t) => {
  const { SigK } = await withShell(t);

  assert.equal(SigK.viewer.applyPlan([{ src: 0, rotate: 0 }]), false);
});

// ---- 回転（確定事項38・39） ----

function pressKey(shell, key, { ctrl = false, shift = false, target = null } = {}) {
  const node = target ?? shell.document;
  node.dispatchEvent(new shell.window.KeyboardEvent('keydown', {
    key,
    ctrlKey: ctrl,
    shiftKey: shift,
    bubbles: true,
  }));
}

async function withPagesMode(t, options = {}) {
  const shell = await withOpenDocument(t, options);
  shell.SigK.shell.setMode(shell.document, 'pages');
  await shell.flush();
  return shell;
}

test('右回転のボタンで選択中のページが回る', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.setSelection([1]);
  document.getElementById('act-rotate-right').click();

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.rotate), [0, 90, 0]);
});

test('左回転は 270 として持つ', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.setSelection([0]);
  document.getElementById('act-rotate-left').click();

  assert.equal(SigK.viewer.getPlan()[0].rotate, 270);
});

test('選択が無ければ現在のページに掛かる（確定事項38）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.viewer.goToPage(2);
  SigK.pageGrid.clearSelection();
  document.getElementById('act-rotate-right').click();

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.rotate), [0, 0, 90]);
});

test('選択中の複数ページをまとめて回す', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.setSelection([0, 2]);
  document.getElementById('act-rotate-right').click();

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.rotate), [90, 0, 90]);
  // 回した紙はそのまま選ばれ続ける。続けてもう90度回せる。
  assert.deepEqual([...SigK.pageGrid.getSelection()], [0, 2]);
});

// ---- 削除（確定事項40〜42） ----

test('削除のボタンで選択中のページが消える', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.setSelection([1]);
  document.getElementById('act-delete').click();

  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [0, 2]);
  // 消した位置に来たページが選ばれる。続けて Delete を押せる。
  assert.deepEqual([...SigK.pageGrid.getSelection()], [1]);
});

// 確認を出さない根拠は「Ctrl+Z で戻せる」ことである（確定事項40）。
test('削除に確認は出ないが、戻せる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.setSelection([1]);
  document.getElementById('act-delete').click();
  assert.equal(document.querySelector('dialog[open]'), null, '確認ダイアログが出ている');

  SigK.pageEdit.undo();
  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.src), [0, 1, 2]);
});

test('全ページを選ぶと削除は押せなくなる（確定事項41）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.selectAll();

  assert.equal(document.getElementById('act-delete').getAttribute('aria-disabled'), 'true');
  document.getElementById('act-delete').click();
  assert.equal(SigK.viewer.getState().pageCount, 3, '最後の1枚まで消えている');
});

test('最後の1ページになったら削除は効かない', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  SigK.pageGrid.setSelection([1, 2]);
  SigK.pageEdit.remove();
  assert.equal(SigK.viewer.getState().pageCount, 1);

  SigK.pageGrid.setSelection([0]);
  assert.equal(SigK.pageEdit.remove(), false);
  assert.equal(SigK.viewer.getState().pageCount, 1);
});

// ---- ボタンの有効・無効（確定事項51・53） ----

test('文書が無ければ編集のボタンは押せない', async (t) => {
  const { document } = await withShell(t);

  for (const id of ['act-rotate-left', 'act-rotate-right', 'act-delete', 'btn-undo', 'btn-redo'])
    assert.equal(document.getElementById(id).getAttribute('aria-disabled'), 'true', id);
});

test('文書を開くと回転が押せるようになる', async (t) => {
  const { document } = await withOpenDocument(t);

  assert.equal(document.getElementById('act-rotate-left').hasAttribute('aria-disabled'), false);
  assert.equal(document.getElementById('act-rotate-right').hasAttribute('aria-disabled'), false);
});

// 決定1。どちらもファイルを書く操作で、書き出し経路は塊⑤ の担当である。
test('抽出と挿入は枠だけ置いて押せないままにする', async (t) => {
  const { document } = await withOpenDocument(t);

  assert.equal(document.getElementById('act-extract').getAttribute('aria-disabled'), 'true');
  assert.equal(document.getElementById('act-insert').getAttribute('aria-disabled'), 'true');
});

test('元に戻す・やり直しは、戻せるときだけ押せる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;
  assert.equal(document.getElementById('btn-undo').getAttribute('aria-disabled'), 'true');

  SigK.pageGrid.setSelection([0]);
  document.getElementById('act-rotate-right').click();
  assert.equal(document.getElementById('btn-undo').hasAttribute('aria-disabled'), false);
  assert.equal(document.getElementById('btn-redo').getAttribute('aria-disabled'), 'true');

  document.getElementById('btn-undo').click();
  assert.equal(SigK.viewer.getPlan()[0].rotate, 0);
  assert.equal(document.getElementById('btn-redo').hasAttribute('aria-disabled'), false);

  document.getElementById('btn-redo').click();
  assert.equal(SigK.viewer.getPlan()[0].rotate, 90);
});

// ---- 紙の上のボタン（確定事項52） ----

test('紙の上のボタンはその1枚だけに掛かる', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  SigK.pageGrid.setSelection([0]);
  const thumb = document.querySelectorAll('#thumbs .thumb')[2];
  thumb.querySelector('.thumb-tool[data-tool="rotateRight"]').click();

  // 選択中の 0 ではなく、押した 2 が回る。
  assert.deepEqual([...SigK.viewer.getPlan()].map((page) => page.rotate), [0, 0, 90]);
});

test('紙の上のボタンは閲覧モードには出さない', async (t) => {
  const shell = await withOpenDocument(t);

  assert.equal(shell.document.querySelector('#thumbs .thumb-tools'), null);
});

// ---- キー操作（確定事項54・55） ----

test('Ctrl+Z と Ctrl+Y はどのモードでも効く（確定事項55）', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;

  SigK.pageGrid.setSelection([0]);
  SigK.pageEdit.rotate(90);
  // 閲覧モードへ戻ってから取り消す。編集したまま読みに戻ることがある。
  SigK.shell.setMode(shell.document, 'view');
  await shell.flush();

  pressKey(shell, 'z', { ctrl: true });
  assert.equal(SigK.viewer.getPlan()[0].rotate, 0);

  pressKey(shell, 'y', { ctrl: true });
  assert.equal(SigK.viewer.getPlan()[0].rotate, 90);
});

test('Delete はページモードでだけ効く（確定事項55）', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;

  SigK.pageGrid.setSelection([1]);
  pressKey(shell, 'Delete');
  assert.equal(SigK.viewer.getState().pageCount, 3, '閲覧モードで消えている');

  SigK.shell.setMode(shell.document, 'pages');
  await shell.flush();
  SigK.pageGrid.setSelection([1]);
  pressKey(shell, 'Delete');
  assert.equal(SigK.viewer.getState().pageCount, 2);
});

// 奪いすぎると閲覧モードで文字を選べなくなる（確定事項18）。
test('Ctrl+A はページモードでサイドパネルにフォーカスがあるときだけ効く', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;

  pressKey(shell, 'a', { ctrl: true });
  assert.deepEqual([...SigK.pageGrid.getSelection()], [], 'フォーカスが無いのに全選択されている');

  document.getElementById('side-scroll').focus();
  pressKey(shell, 'a', { ctrl: true });
  assert.deepEqual([...SigK.pageGrid.getSelection()], [0, 1, 2]);
});

test('閲覧モードの Ctrl+A は奪わない', async (t) => {
  const shell = await withOpenDocument(t);

  shell.document.getElementById('side-scroll').focus();
  pressKey(shell, 'a', { ctrl: true });

  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], []);
});

test('Esc は選択を解除する', async (t) => {
  const shell = await withPagesMode(t);
  shell.SigK.pageGrid.setSelection([0, 1]);

  pressKey(shell, 'Escape');

  assert.deepEqual([...shell.SigK.pageGrid.getSelection()], []);
});

// docs/04 第8章が Esc に2つ割り当てているので、優先順位をここで固定する
// （確定事項19）。
test('検索バーが開いていれば Esc は検索バーを閉じるほうが先', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK } = shell;
  SigK.pageGrid.setSelection([0, 1]);
  SigK.findBar.open();

  pressKey(shell, 'Escape');

  assert.equal(SigK.findBar.isOpen(), false);
  assert.deepEqual([...SigK.pageGrid.getSelection()], [0, 1], '選択まで解除されている');
});

test('入力欄の Delete はページ削除に使わない', async (t) => {
  const shell = await withPagesMode(t);
  const { SigK, document } = shell;
  SigK.pageGrid.setSelection([1]);

  pressKey(shell, 'Delete', { target: document.getElementById('page-current') });

  assert.equal(SigK.viewer.getState().pageCount, 3);
});
