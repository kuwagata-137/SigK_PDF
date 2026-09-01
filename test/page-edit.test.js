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
