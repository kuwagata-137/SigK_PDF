'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ページの解決は print-pages.js に移した（spec-7-7）。SigK.print からも同じ名前で呼べる。
require('../renderer/print-pages.js');
require('../renderer/print.js');
const print = globalThis.SigK.print;

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 印刷（spec-1-4 E）。
//
// 前半はページ範囲の解釈だけを見る。DOM も pdf.js も要らない。
// 後半はダイアログの経路で、実際に紙へ送る手前までを確かめる。
// jsdom には 2D コンテキストが無いので画像そのものは作れない。寸法と枚数までを
// ここで見て、PNG のバイト数と見た目は起動確認（SIGK_SMOKE_PRINT）に残す。

// ---- ページ範囲の解釈（確定事項34・35）----

test('「1-5, 8」を6ページとして読む', () => {
  assert.deepEqual(print.parsePageList('1-5, 8', 10), { pages: [1, 2, 3, 4, 5, 8] });
});

test('全角のカンマ・ハイフン・数字も受け付ける', () => {
  assert.deepEqual(print.parsePageList('１－３，７', 10), { pages: [1, 2, 3, 7] });
  // 読点と各種ダッシュも同じ扱いにする。
  assert.deepEqual(print.parsePageList('1—2、5', 10), { pages: [1, 2, 5] });
});

test('重なった指定はまとめ、順に並べ直す', () => {
  assert.deepEqual(print.parsePageList('5,1-3,2', 10), { pages: [1, 2, 3, 5] });
});

test('逆順の範囲は理由を返す', () => {
  const result = print.parsePageList('5-1', 10);

  assert.equal(result.pages, undefined);
  assert.match(result.error, /終了ページが開始ページより前/);
});

test('範囲外のページは理由を返す', () => {
  assert.match(print.parsePageList('0-3', 10).error, /1 〜 10 の範囲/);
  assert.match(print.parsePageList('9-12', 10).error, /1 〜 10 の範囲/);
});

test('数字でないものは理由を返す', () => {
  assert.match(print.parsePageList('あ', 10).error, /数字で指定/);
  assert.match(print.parsePageList('1-2-3', 10).error, /数字で指定/);
  assert.match(print.parsePageList('1,,2', 10).error, /読み取れません/);
});

test('空の指定は理由を返す', () => {
  assert.match(print.parsePageList('', 10).error, /指定してください/);
  assert.match(print.parsePageList('   ', 10).error, /指定してください/);
});

// ---- 範囲の解決と上限（確定事項33）----

test('「すべてのページ」は1からページ数までを返す', () => {
  assert.deepEqual(print.resolvePages({ mode: 'all', pageCount: 3 }), { pages: [1, 2, 3] });
});

test('「現在のページ」は0起点の現在位置を1起点へ直す', () => {
  assert.deepEqual(print.resolvePages({ mode: 'current', pageCount: 5, current: 2 }), { pages: [3] });
  assert.deepEqual(print.resolvePages({ mode: 'current', pageCount: 5, current: 0 }), { pages: [1] });
  // 範囲の外にいることは無いはずだが、外へはみ出させない。
  assert.deepEqual(print.resolvePages({ mode: 'current', pageCount: 2, current: 9 }), { pages: [2] });
});

test('100ページを超える指定は印刷しない', () => {
  assert.equal(print.MAX_PAGES, 100);
  assert.equal(print.resolvePages({ mode: 'all', pageCount: 100 }).pages.length, 100);

  const over = print.resolvePages({ mode: 'all', pageCount: 101 });
  assert.equal(over.pages, undefined);
  assert.match(over.error, /100 ページまで/);
  assert.match(print.resolvePages({ mode: 'custom', text: '1-200', pageCount: 300 }).error, /100 ページまで/);
});

test('文書が開かれていなければ理由を返す', () => {
  assert.match(print.resolvePages({ mode: 'all', pageCount: 0 }).error, /文書が開かれていません/);
});

test('150dpi 相当の倍率を持つ', () => {
  assert.equal(print.PRINT_DPI, 150);
  assert.equal(print.PRINT_SCALE, 150 / 72);
});

/// ---- 印刷画面の経路（docs/spec-7-7-print-dialog.md） ----

const UM_PER_PT = 25400 / 72;
// A4 のページを、試験用プリンターの A4（四辺 4.23 mm）に「合わせる」倍率。
const FIT_A4 = Math.min(201540 / (A4.width * UM_PER_PT), 288540 / (A4.height * UM_PER_PT));

async function withDocument(t, options = {}) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\a.pdf' }));
  await shell.flush();
  return shell;
}

async function openPrint(shell) {
  assert.equal(shell.SigK.print.open(), true);
  await shell.SigK.print.whenConfigReady();
  return shell.document;
}

test('文書を開いていなければ印刷画面は開かない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.equal(shell.SigK.print.open(), false);
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), false);
});

test('印刷画面は「すべて(A)」・部数 1 で開き、ページ指定の欄に灰色で「1 - 総ページ数」を表示する', async (t) => {
  const shell = await withDocument(t);
  const document = await openPrint(shell);

  assert.equal(document.getElementById('print-range-all').checked, true);
  assert.equal(document.getElementById('print-copies').value, '1');
  assert.equal(document.getElementById('print-pages').disabled, true);
  assert.equal(document.getElementById('print-pages').value, '1 - 3');
  assert.equal(document.getElementById('print-error').hidden, true);
});

test('プリンターの一覧を取得して既定のプリンターを選び、設定を取得するまで［印刷］は押せない', async (t) => {
  const shell = await withDocument(t);
  shell.SigK.print.open();
  const { document } = shell;
  assert.equal(document.getElementById('print-run').disabled, true, '取得中は押せない');
  await shell.SigK.print.whenConfigReady();

  const select = document.getElementById('print-printer');
  assert.deepEqual([...select.options].map((option) => option.value), ['試験用プリンター', '試験用プリンター2']);
  assert.equal(select.value, '試験用プリンター');
  assert.equal(document.getElementById('print-run').disabled, false);
});

test('ページを画像にする準備が、指定したページ数だけ走る（用紙の上で 150 dpi）', async (t) => {
  const shell = await withDocument(t);
  await openPrint(shell);

  const result = await shell.SigK.print.prepare({ mode: 'custom', text: '1,3' });

  assert.equal(result.ok, true);
  assert.deepEqual([...result.pages], [1, 3]);
  assert.equal(result.sheets, 2);
  assert.deepEqual([...result.rendered.map((entry) => entry.page)], [1, 3]);
  // A4 のページを A4 の印刷可能領域に合わせた倍率で、用紙の上で 150 dpi になるように描く（確定事項31）。
  assert.ok(Math.abs(result.rendered[0].width - A4.width * print.PRINT_SCALE * FIT_A4) <= 1, `${result.rendered[0].width}`);
  assert.equal(shell.document.querySelectorAll('#print-area img').length, 0, 'jsdom では画像を作らない');
});

test('範囲がおかしければ、押す前に印刷画面の中で理由を表示する', async (t) => {
  const shell = await withDocument(t);
  const document = await openPrint(shell);

  const result = await shell.SigK.print.prepare({ mode: 'custom', text: '9-1' });

  assert.equal(result.ok, undefined);
  assert.equal(document.getElementById('print-error').hidden, false);
  assert.match(document.getElementById('print-error').textContent, /終了ページが開始ページより前/);
});

test('中止すると準備は無効になり、作りかけを残さない', async (t) => {
  const sizes = Array.from({ length: 12 }, () => A4);
  const shell = await withDocument(t, { pdfjs: createPdfjsStub({ sizes }) });
  const document = await openPrint(shell);

  const pending = shell.SigK.print.prepare({ mode: 'all' });
  // 準備の途中で閉じる。世代が上がるので、飛んでいる分は捨てられる。
  shell.SigK.print.close();
  const result = await pending;

  assert.equal(result.canceled, true);
  assert.equal(document.querySelectorAll('#print-area img').length, 0);
  assert.equal(shell.SigK.print.isBusy(), false);
});

test('［印刷］は印刷画面を閉じ、Windows の印刷画面を表示せずに、選んだプリンターへ直接送る（質問 PR1 案A）', async (t) => {
  const shell = await withDocument(t);
  await openPrint(shell);

  const result = await shell.SigK.print.run({ mode: 'current' });

  assert.equal(result.ok, true);
  assert.equal(shell.printCalls.length, 1);
  // 用紙がプリンターの既定（A4）と同じなので、用紙は指定しない（メイン側が usePrinterDefaultPageSize を使う）。
  assert.deepEqual({ ...shell.printCalls[0] }, {
    silent: true, deviceName: '試験用プリンター', copies: 1, collate: true, color: true, duplexMode: 'simplex', landscape: false,
  });
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), false);
  assert.equal(shell.document.getElementById('print-progress-dialog').hasAttribute('open'), false, '終わったら進行状況画面を閉じる');
  assert.equal(shell.document.querySelectorAll('#print-area img').length, 0);
});

test('印刷できなかったら、通知バー（赤）に理由を表示する（確定事項C6）', async (t) => {
  const shell = await withDocument(t, { printResult: { ok: false, canceled: false, reason: 'プリンタが見つかりません' } });
  await openPrint(shell);

  const result = await shell.SigK.print.run({ mode: 'current' });

  assert.equal(result.ok, false);
  assert.match(shell.SigK.viewBanner.text(), /印刷できませんでした。プリンタが見つかりません/);
});

test('printAPI が無くても落ちない', async (t) => {
  const shell = await withDocument(t);
  delete shell.window.printAPI;
  await openPrint(shell);

  const result = await shell.SigK.print.run({ mode: 'current' });

  assert.match(result.reason, /印刷機能を使用できません/);
  assert.match(shell.SigK.viewBanner.text(), /印刷機能を使用できません/);
});

// 開いている <dialog> に showModal() をもう一度呼ぶと InvalidStateError になる。
test('印刷画面を続けて開いても落ちず、印刷するページと部数は毎回戻し、ほかの設定は覚えている（確定事項C4）', async (t) => {
  const shell = await withDocument(t);
  const document = await openPrint(shell);
  const click = (id) => document.getElementById(id).click();

  click('print-range-custom');
  document.getElementById('print-copies').value = '3';
  document.getElementById('print-copies').dispatchEvent(new shell.window.Event('change'));
  click('print-handling-multiple');
  assert.equal(shell.SigK.print.open(), true, '2 度目も落ちない');
  assert.equal(document.getElementById('print-range-all').checked, true);
  assert.equal(document.getElementById('print-copies').value, '1');
  assert.equal(document.getElementById('print-handling-multiple').getAttribute('aria-pressed'), 'true', 'ページサイズ処理は覚えている');
  assert.equal(document.getElementById('print-dialog').hasAttribute('open'), true);
});

test('Ctrl+P で印刷画面が開く', async (t) => {
  const shell = await withDocument(t);

  shell.document.dispatchEvent(new shell.window.KeyboardEvent('keydown', {
    key: 'p', ctrlKey: true, bubbles: true, cancelable: true,
  }));

  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), true);
});

test('ツールバーの印刷ボタンは文書を開くまで押せない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const button = shell.document.getElementById('btn-print');

  assert.equal(button.getAttribute('aria-disabled'), 'true');
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), false);

  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  assert.equal(button.hasAttribute('aria-disabled'), false);
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), true);
});

test('準備の途中で進行状況画面の［キャンセル］を押すと、印刷へ進まない', async (t) => {
  const sizes = Array.from({ length: 12 }, () => A4);
  const shell = await withDocument(t, { pdfjs: createPdfjsStub({ sizes }) });
  const document = await openPrint(shell);

  const pending = shell.SigK.print.run({ mode: 'all' });
  // ［印刷］を押すと、すぐに印刷画面を閉じて進行状況画面を表示する。
  assert.equal(document.getElementById('print-dialog').hasAttribute('open'), false);
  assert.equal(document.getElementById('print-progress-dialog').hasAttribute('open'), true);
  document.getElementById('print-progress-cancel').click();
  const result = await pending;

  assert.equal(result.canceled, true);
  assert.equal(shell.printCalls.length, 0);
  assert.equal(shell.SigK.print.isBusy(), false);
  assert.equal(document.querySelectorAll('#print-area img').length, 0);
  assert.equal(document.getElementById('print-progress-dialog').hasAttribute('open'), false);
});

test('準備の途中で印刷画面が Esc で閉じても、準備は無効になる（spec-4b-7a 確定事項D1）', async (t) => {
  const sizes = Array.from({ length: 12 }, () => A4);
  const shell = await withDocument(t, { pdfjs: createPdfjsStub({ sizes }) });
  const { window } = shell;
  const document = await openPrint(shell);

  for (const type of ['cancel', 'close']) {
    const pending = shell.SigK.print.prepare({ mode: 'all' });
    // Esc は窓が自分で閉じる（cancel → close）。jsdom には無いので、知らせだけを作る。
    document.getElementById('print-dialog').dispatchEvent(new window.Event(type));
    assert.equal((await pending).canceled, true, type);
  }
  assert.equal(shell.printCalls.length, 0);
  assert.equal(shell.SigK.print.isBusy(), false);
});
